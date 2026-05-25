import {
  defineTool,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type RegisteredCommand,
  type SessionEntry,
  type SessionMessageEntry,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';

import { Type } from 'typebox';

export default function registerTaskCommands(pi: ExtensionAPI): void {
  pi.registerTool(createPushTaskTool(pi));
  pi.registerCommand('start-task', createStartTaskCommand(pi));
  pi.registerCommand('discard-task', createDiscardTaskCommand(pi));
  pi.registerCommand('finish-task', createFinishTaskCommand(pi));
  pi.registerCommand('abort-task', createAbortTaskCommand(pi));
}

export function createPushTaskTool(pi: ExtensionAPI): ToolDefinition {
  return defineTool({
    name: 'push-task',
    label: 'Push Task',
    description: 'Store a task prompt for a user-started navigation branch.',
    promptSnippet: 'Store a focused task prompt for a user-started navigation branch.',
    promptGuidelines: [
      'Use push-task when a skill needs the user to start a focused branch workflow with /start-task.',
    ],
    parameters: pushTaskParameters,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) {
        throw new Error('Task storage aborted.');
      }

      pi.appendEntry(TASK_ENTRY_TYPE, { prompt: params.prompt, context: params.context ?? 'fresh' });

      return {
        content: [{ type: 'text', text: 'Task stored. Run `/start-task` to begin.' }],
        details: {},
      };
    },
  });
}

export function createStartTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Navigate to a fresh context and inject the active task prompt',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();

      const activeTask = findActiveTask(ctx.sessionManager);
      if (!activeTask) {
        ctx.ui.notify('No pending task. Use push-task first.', 'warning');
        return;
      }

      const taskContext = activeTask.data.context ?? 'fresh';

      if (taskContext === 'fresh') {
        const departureLeafId = ctx.sessionManager.getLeafId()!;
        const freshTargetId = findFreshTargetId(ctx.sessionManager);
        if (!freshTargetId) {
          ctx.ui.notify('No starting point found on current branch.', 'warning');
          return;
        }

        const result = await ctx.navigateTree(freshTargetId, { summarize: false });
        if (result.cancelled) return;

        pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: departureLeafId });
      } else {
        // Branch context — same as /start-branch
        pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: ctx.sessionManager.getLeafId()! });
      }

      pi.sendUserMessage(activeTask.data.prompt);
    },
  };
}

export function createDiscardTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Discard the active task without executing it',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();

      const activeTask = findActiveTask(ctx.sessionManager);
      if (!activeTask) {
        ctx.ui.notify('No pending task.', 'warning');
        return;
      }

      pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});

      ctx.ui.notify('Task discarded.', 'info');
    },
  };
}

export function createFinishTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Finish the current task and return to the task start point',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();

      const taskStart = findTaskStart(ctx.sessionManager);
      if (!taskStart) {
        ctx.ui.notify('No task start point.', 'warning');
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

      const result = await ctx.navigateTree(taskStart.data.returnTo, {
        summarize: false,
      });
      if (result.cancelled) return;

      // Inject last assistant message after navigation
      if (lastAssistantId) {
        pi.sendMessage({
          customType: 'branch-result',
          // Content is filtered to only TextContent blocks (or original string)
          content: lastAssistantContent as unknown as string,
          display: true,
          details: { sourceEntryId: lastAssistantId },
        }, { triggerTurn: true });
      }

      if (findActiveTask(ctx.sessionManager)) {
        pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
      }

      const label = lastAssistantId ? 'Last response attached.' : 'No last response to attach.';
      ctx.ui.notify(`Task finished. ${label}`, 'info');
    },
  };
}

export function createAbortTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Abort the current task without finishing',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();

      const taskStart = findTaskStart(ctx.sessionManager);

      if (!taskStart) {
        ctx.ui.notify('No task start point.', 'warning');
        return;
      }

      const result = await ctx.navigateTree(taskStart.data.returnTo, { summarize: false });
      if (result.cancelled) return;

      if (findActiveTask(ctx.sessionManager)) {
        pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
      }

      ctx.ui.notify('Task aborted. Branch abandoned without summary.', 'info');
    },
  };
}

/** Type guard: is the entry an assistant message with content? */
function isAssistantMessageEntry(entry: SessionEntry): entry is SessionMessageEntry & { message: { role: 'assistant' } } {
  return entry.type === 'message' && entry.message.role === 'assistant';
}

// ── Lookup utilities ──────────────────────────────────────────────

export function findActiveTask(
  session: ReadonlySessionLike,
): (SessionEntry & { data: TaskData }) | null {
  const entries = session.getEntries();
  const byId = new Map<string, SessionEntry>(entries.map((e) => [e.id, e]));
  let skip = 0;
  const leafId = session.getLeafId();
  let current = leafId ? byId.get(leafId) : undefined;

  while (current) {
    if (current.type === 'custom' && current.customType === TASK_DONE_ENTRY_TYPE) {
      skip++;
    } else if (current.type === 'custom' && current.customType === TASK_ENTRY_TYPE) {
      if (skip === 0) return current as SessionEntry & { data: TaskData };
      skip--;
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return null;
}

export const TASK_ENTRY_TYPE = 'task';

export const TASK_DONE_ENTRY_TYPE = 'task-done';

export interface TaskData {
  prompt: string;
  context: 'fresh' | 'branch';
}

export function findTaskStart(
  session: ReadonlySessionLike,
): (SessionEntry & { data: TaskStartData }) | null {
  const entries = session.getEntries();
  const byId = new Map<string, SessionEntry>(entries.map((e) => [e.id, e]));
  const leafId = session.getLeafId();
  let current = leafId ? byId.get(leafId) : undefined;

  while (current) {
    if (current.type === 'custom' && current.customType === TASK_START_ENTRY_TYPE) {
      return current as SessionEntry & { data: TaskStartData };
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return null;
}

export const TASK_START_ENTRY_TYPE = 'task-start';

export interface TaskStartData {
  returnTo: string;
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

/**
 * Minimal read-only session interface needed by lookup functions.
 * Compatible with both ReadonlySessionManager (from ExtensionCommandContext)
 * and SessionManager (full mutable version).
 */
export interface ReadonlySessionLike {
  getEntries(): SessionEntry[];
  getLeafId(): string | null;
  getBranch(): SessionEntry[];
}

type CommandOptions = Omit<RegisteredCommand, 'name' | 'sourceInfo'>;

const pushTaskParameters = Type.Object({
  prompt: Type.String({ description: 'Full prompt for the task, including all context and instructions.' }),
  context: Type.Optional(Type.Union([
    Type.Literal('fresh'),
    Type.Literal('branch'),
  ], { description: 'Context mode: "fresh" (clean slate, default) or "branch" (current branch).' })),
});
