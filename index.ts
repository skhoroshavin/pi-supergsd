import {
  defineTool,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type RegisteredCommand,
  type SessionEntry,
  type SessionMessageEntry,
  Theme,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';

import { Box, Text } from '@earendil-works/pi-tui';

import { Type } from 'typebox';

export default function registerTaskCommands(pi: ExtensionAPI): void {
  pi.registerTool(createPushTaskTool(pi));
  pi.registerCommand('start-task', createStartTaskCommand(pi));
  pi.registerCommand('discard-task', createDiscardTaskCommand(pi));
  pi.registerCommand('finish-task', createFinishTaskCommand(pi));
  pi.registerCommand('abort-task', createAbortTaskCommand());
  pi.registerCommand('auto', createAutoCommand(pi));

  pi.registerMessageRenderer('task-result', (message, _options, theme) => {
    const details = message.details as { slug?: string; sourceEntryId?: string } | undefined;
    const label = details?.slug
      ? theme.fg('customMessageLabel', `${details.slug} result:`)
      : theme.fg('customMessageLabel', 'result:');
    const text = extractTextContent(message.content);
    const box = new Box(1, 1, (t: string) => theme.bg('customMessageBg', t));
    box.addChild(new Text(`${label}\n${text}`, 0, 0));
    return box;
  });

  pi.on('session_start', async (_event, ctx) => {
    updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
  });

  pi.on('turn_end', async (_event, ctx) => {
    updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
  });

  pi.on('session_tree', async (_event, ctx) => {
    updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
  });
}

export function createAutoCommand(pi: ExtensionAPI): CommandOptions {
  let running = false;
  let stopped = false;

  // Register shutdown handler inside the closure so it can set `stopped`.
  pi.on('session_shutdown', async () => {
    stopped = true;
  });

  return {
    description: 'Automatically run pushed task branches',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (running) {
        ctx.ui.notify('Auto is already running.', 'warning');
        return;
      }

      running = true;
      let sawTaskActivity = false;

      try {
        while (!stopped) {
          await ctx.waitForIdle();

          // Re-check after idle: userCtrlC/stopped may have been set
          // while we were waiting (the reaction engine runs before the
          // waiter resolves). Without this, we'd fall through to task
          // processing and might call finishTask even though the session
          // was shut down.
          if (stopped) break;

          if (lastAssistantWasAborted(ctx.sessionManager)) break;

          if (pendingTask(ctx.sessionManager)) {
            const result = await startTask(pi, ctx);
            if (result === 'cancelled') break;
            sawTaskActivity = true;
            continue;
          }

          if (currentTask(ctx.sessionManager)) {
            const result = await finishTask(pi, ctx);
            if (result === 'cancelled') break;
            sawTaskActivity = true;
            continue;
          }

          // No pending tasks and no current task
          if (!sawTaskActivity) {
            // Never had any task activity — nothing to process
            ctx.ui.notify('No pending tasks to run.', 'info');
            break;
          }

          if (!ctx.hasPendingMessages()) {
            break;
          }
        }
      } finally {
        running = false;
        stopped = false;
      }
    },
  };
}

export function createPushTaskTool(pi: ExtensionAPI): ToolDefinition {
  return defineTool({
    name: 'push-task',
    label: 'Push Task',
    description: 'Store a task prompt for a user-started navigation branch.',
    promptSnippet: 'Store a focused task prompt for a user-started navigation branch.',
    promptGuidelines: [
      'Use push-task to hand off a self-contained task for isolated execution.',
      'Do not batch multiple push-task calls together, and do not mix push-task with other tool calls in the same turn.',
    ],
    parameters: pushTaskParameters,
    renderCall(args, theme, context) {
      const header = theme.fg('toolTitle', theme.bold('push-task'))
        + (args.inherit_context ? ' ' + theme.fg('warning', '[inherit]') : '');

      const promptLines = (args.prompt as string).split('\n');
      const maxLines = context.expanded ? promptLines.length : 7;
      const displayLines = promptLines.slice(0, maxLines)
        .map(l => theme.fg('dim', l.trimEnd() || ' '));

      if (!context.expanded && promptLines.length > maxLines) {
        const totalLines = promptLines.length;
        const moreLines = totalLines - maxLines;
        displayLines.push(theme.fg('muted', `... (${moreLines} more lines, ${totalLines} total, ctrl+o to expand)`));
      }

      return new Text([header, ...displayLines].join('\n'), 0, 0);
    },
    renderResult() {
      return new Text('', 0, 0);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) {
        throw new Error('Task storage aborted.');
      }

      pi.appendEntry(TASK_ENTRY_TYPE, { prompt: params.prompt, inherit_context: params.inherit_context ?? false });

      if (ctx.hasUI) {
        updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
        ctx.ui.notify('Task stored. Use `/start-task` or `/auto` to start it.', 'info');
      }

      return {
        content: [],
        details: { prompt: params.prompt, inherit_context: params.inherit_context ?? false },
        terminate: true,
      };
    },
  });
}

// ── Thin command wrappers ───────────────────────────────────────

export function createStartTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Navigate to a fresh context and inject the active task prompt',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await startTask(pi, ctx);
    },
  };
}

export function createDiscardTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Discard the active task without executing it',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await discardTask(pi, ctx);
    },
  };
}

export function createFinishTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Finish the current task and return to the task start point',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await finishTask(pi, ctx);
    },
  };
}

export function createAbortTaskCommand(): CommandOptions {
  return {
    description: 'Abort the current task without finishing',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await abortTask(ctx);
    },
  };
}

type CommandOptions = Omit<RegisteredCommand, 'name' | 'sourceInfo'>;

function lastAssistantWasAborted(session: ReadonlySessionLike): boolean {
  const branch = session.getBranch();
  const last = branch[branch.length - 1];
  return last?.type === 'message'
    && last.message.role === 'assistant'
    && last.message.stopReason === 'aborted';
}

async function startTask(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<TaskActionResult> {
  const activeTask = pendingTask(ctx.sessionManager);
  if (!activeTask) {
    ctx.ui.notify('No pending task. Use push-task first.', 'warning');
    return;
  }

  const inheritContext = activeTask.data.inherit_context ?? false;

  if (!inheritContext) {
    const departureLeafId = ctx.sessionManager.getLeafId()!;
    const freshTargetId = findFreshTargetId(ctx.sessionManager);
    if (!freshTargetId) {
      ctx.ui.notify('No starting point found on current branch.', 'warning');
      return;
    }

    const result = await ctx.navigateTree(freshTargetId, { summarize: false });
    if (result.cancelled) return 'cancelled';

    pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: departureLeafId });
  } else {
    pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: ctx.sessionManager.getLeafId()! });
  }

  pi.sendUserMessage(activeTask.data.prompt);

  if (ctx.hasUI) {
    updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
  }
}

async function discardTask(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<TaskActionResult> {
  const activeTask = pendingTask(ctx.sessionManager);
  if (!activeTask) {
    ctx.ui.notify('No pending task to discard.', 'warning');
    return;
  }

  pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
  ctx.ui.notify('Task discarded.', 'info');

  if (ctx.hasUI) {
    updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
  }
}

async function finishTask(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<TaskActionResult> {
  const taskStart = currentTask(ctx.sessionManager);
  if (!taskStart) {
    ctx.ui.notify('Not inside task, nothing to finish.', 'warning');
    return;
  }

  // Capture last assistant message content before navigation
  let lastAssistantContent: unknown;
  let lastAssistantId: string | undefined;
  const branch = ctx.sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (isAssistantMessageEntry(entry)) {
      const rawContent = entry.message.content;
      // Filter to only text blocks — thinking and toolCall blocks are not
      // valid for custom_message content and cause provider errors (e.g.,
      // DeepSeek rejects unrecognized content block variants).
      if (Array.isArray(rawContent)) {
        lastAssistantContent = rawContent.filter(
          (block): block is { type: 'text'; text: string } =>
            typeof block === 'object' && block !== null && 'type' in block && block.type === 'text',
        );
      } else {
        lastAssistantContent = rawContent;
      }
      lastAssistantId = entry.id;
      break;
    }
  }

  // Find the task prompt on the current branch for the slug label
  const taskPrompt = findTaskPrompt(ctx.sessionManager);
  const slug = taskPrompt ? makeSlug(taskPrompt) : undefined;

  const result = await ctx.navigateTree(taskStart.data.returnTo, {
    summarize: false,
  });
  if (result.cancelled) return 'cancelled';

  // Inject last assistant message after navigation
  if (lastAssistantId) {
    pi.sendMessage({
      customType: 'task-result',
      // Content is filtered to only TextContent blocks (or original string)
      content: lastAssistantContent as unknown as string,
      display: true,
      details: { sourceEntryId: lastAssistantId, slug },
    }, { triggerTurn: true });
  }

  if (pendingTask(ctx.sessionManager)) {
    pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
  }

  const label = lastAssistantId ? 'Last response attached.' : 'No last response to attach.';
  ctx.ui.notify(`Task finished. ${label}`, 'info');

  if (ctx.hasUI) {
    updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
  }
}

async function abortTask(
  ctx: ExtensionCommandContext,
): Promise<TaskActionResult> {
  const taskStart = currentTask(ctx.sessionManager);
  if (!taskStart) {
    ctx.ui.notify('Not inside task, nothing to abort.', 'warning');
    return;
  }

  const result = await ctx.navigateTree(taskStart.data.returnTo, { summarize: false });
  if (result.cancelled) return 'cancelled';

  ctx.ui.notify('Task aborted. Branch abandoned without summary.', 'info');

  if (ctx.hasUI) {
    updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
  }
}

type TaskActionResult = 'cancelled' | void;

/** Type guard: is the entry an assistant message with content? */
function isAssistantMessageEntry(entry: SessionEntry): entry is SessionMessageEntry & { message: { role: 'assistant' } } {
  return entry.type === 'message' && entry.message.role === 'assistant';
}

/**
 * Find the target ID for navigating to a fresh context.
 * Returns the parent of the first model-visible entry, or the branch root as fallback.
 * Returns null if no valid target is found.
 */
function findFreshTargetId(session: ReadonlySessionLike): string | null {
  const branch = session.getBranch();
  if (branch.length === 0) return null;

  const firstVisible = findPreConversationEntry(session);
  if (firstVisible) {
    return firstVisible.parentId ?? firstVisible.id;
  }

  // Fallback: use branch root's parent (or the root itself if no parent)
  return branch[0].parentId ?? branch[0].id;
}

/**
 * Find the first model-visible entry on the current branch (closest to root).
 *
 * "Model-visible" means the entry participates in LLM context via buildSessionContext:
 * messages (user/assistant), compaction summaries, branch summaries, and custom messages.
 * Entries like thinking_level_change, model_change, custom (data-only), label, and
 * session_info are NOT visible — Pi may insert them before the conversation begins.
 *
 * Returns null if the branch has no model-visible entries (e.g., only non-visible setup
 * entries) or if there is no leaf.
 */
function findPreConversationEntry(
  session: ReadonlySessionLike,
): SessionEntry | null {
  const leafId = session.getLeafId();
  if (!leafId) return null;

  const branch = session.getBranch();
  for (const entry of branch) {
    if (
      entry.type === 'message' ||
      entry.type === 'compaction' ||
      entry.type === 'branch_summary' ||
      entry.type === 'custom_message'
    ) {
      return entry;
    }
  }

  return null;
}

function updateTaskStatus(
  session: ReadonlySessionLike,
  setStatus: (key: string, value: string | undefined) => void,
  theme: Theme,
): void {
  const pending = pendingTask(session);
  if (pending) {
    const slug = makeSlug(pending.data.prompt);
    setStatus('task', theme.fg('dim', `pending task: ${slug}`));
    return;
  }

  if (currentTask(session)) {
    const prompt = findTaskPrompt(session);
    if (prompt) {
      const slug = makeSlug(prompt);
      setStatus('task', theme.fg('dim', `current task: ${slug}`));
    }
    return;
  }

  setStatus('task', undefined);
}

/**
 * Find the user message content injected as the task prompt after the
 * most recent TASK_START entry. Returns undefined if no task is active.
 */
function findTaskPrompt(session: ReadonlySessionLike): string | undefined {
  const branch = session.getBranch();

  // Walk backward to find the most recent TASK_START
  let startIdx = -1;
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === 'custom' && entry.customType === TASK_START_ENTRY_TYPE) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return undefined;

  // Walk forward from TASK_START to find the next user message
  for (let i = startIdx + 1; i < branch.length; i++) {
    const entry = branch[i];
    if (entry.type === 'message' && entry.message.role === 'user') {
      if (typeof entry.message.content === 'string') return entry.message.content;
      if (Array.isArray(entry.message.content)) {
        const textBlock = entry.message.content.find(
          (b): b is { type: 'text'; text: string } => b.type === 'text',
        );
        return textBlock?.text;
      }
      return undefined;
    }
  }
  return undefined;
}

// ── Lookup utilities ──────────────────────────────────────────────

function pendingTask(
  session: ReadonlySessionLike,
): (SessionEntry & { data: TaskData }) | null {
  const branch = session.getBranch();
  let skip = 0;

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === 'custom' && entry.customType === TASK_START_ENTRY_TYPE) {
      return null;
    }
    if (entry.type === 'custom' && entry.customType === TASK_DONE_ENTRY_TYPE) {
      skip++;
      continue;
    }
    if (entry.type === 'custom' && entry.customType === TASK_ENTRY_TYPE) {
      if (skip === 0) return entry as SessionEntry & { data: TaskData };
      skip--;
    }
  }

  return null;
}

const TASK_ENTRY_TYPE = 'task';

const TASK_DONE_ENTRY_TYPE = 'task-done';

interface TaskData {
  prompt: string;
  inherit_context: boolean;
}

function currentTask(
  session: ReadonlySessionLike,
): (SessionEntry & { data: TaskStartData }) | null {
  const branch = session.getBranch();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === 'custom' && entry.customType === TASK_START_ENTRY_TYPE) {
      return entry as SessionEntry & { data: TaskStartData };
    }
  }

  return null;
}

const TASK_START_ENTRY_TYPE = 'task-start';

interface TaskStartData {
  returnTo: string;
}

/**
 * Minimal read-only session interface needed by lookup functions.
 * Compatible with both ReadonlySessionManager (from ExtensionCommandContext)
 * and SessionManager (full mutable version).
 */
interface ReadonlySessionLike {
  getEntries(): SessionEntry[];
  getLeafId(): string | null;
  getBranch(): SessionEntry[];
}

function makeSlug(prompt: string): string {
  const words = prompt.split(/\s+/)
    .filter(w => !STOPWORDS.has(w.toLowerCase()))
    .map(w => w.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, ''))
    .filter(w => w.length > 0);
  if (words.length === 0) return '<no description>';

  let result = words[0]!;
  for (let i = 1; i < Math.min(words.length, 7); i++) {
    const next = `-${words[i]}`;
    if ((result + next).length <= 40 || result.length <= 40 - next.length) {
      result += next;
    } else {
      break;
    }
  }
  return result;
}

/** Extract a plain text string from content that may be a string or an array of text blocks. */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: 'text'; text: string } =>
        typeof b === 'object' && b !== null && 'type' in b && b.type === 'text',
      )
      .map(b => b.text)
      .join('\n');
  }
  return String(content ?? '');
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could', 'i', 'you', 'he',
  'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my',
  'your', 'his', 'its', 'our', 'their', 'this', 'that', 'these', 'those',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'under', 'and', 'but', 'or', 'nor', 'not', 'so', 'if',
  'than', 'too', 'very', 'just', 'now', 'then', 'also', 'here', 'there',
  'when', 'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'up',
  'out', 'about', 'over', 'again', 'while',
]);

const pushTaskParameters = Type.Object({
  prompt: Type.String({ description: 'Full prompt for the task, including all context and instructions.' }),
  inherit_context: Type.Optional(Type.Boolean({
    default: false,
    description: 'Whether to inherit the current branch context instead of starting fresh.',
  })),
});