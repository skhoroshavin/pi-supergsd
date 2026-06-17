import {
  defineTool,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type MessageRenderer,
  type ModelRegistry,
  type RegisteredCommand,
  type SessionEntry,
  type SessionMessageEntry,
  type Skill,
  type Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import type { Api, Model } from "@earendil-works/pi-ai";

import { Box, Text, type AutocompleteItem } from "@earendil-works/pi-tui";

import { Type, type Static } from "typebox";

import { renderTextContent, taskResultTextContent } from "./text-content.js";

export function toolPushTask(pi: PushTaskAPI): ToolDefinition {
  return defineTool({
    name: "push-task",
    label: "Push Task",
    description: "Store a task prompt for a user-started navigation branch.",
    promptSnippet: "Store a focused task prompt for a user-started navigation branch.",
    promptGuidelines: [
      "Use push-task to hand off a self-contained task for isolated execution.",
      "Do not batch multiple push-task calls together, and do not mix push-task with other tool calls in the same turn.",
    ],
    parameters: pushTaskParameters,
    renderCall(args: PushTaskParams, theme, context) {
      const title = args.title.trim();
      const header = theme.fg("toolTitle", theme.bold(`push-task: ${title}`));

      const promptLines = args.prompt.split("\n");
      const maxLines = context.expanded ? promptLines.length : 7;
      const displayLines = promptLines
        .slice(0, maxLines)
        .map((l) => theme.fg("dim", l.trimEnd() || " "));

      if (!context.expanded && promptLines.length > maxLines) {
        const totalLines = promptLines.length;
        const moreLines = totalLines - maxLines;
        displayLines.push(
          theme.fg("muted", `... (${moreLines} more lines, ${totalLines} total, ctrl+o to expand)`),
        );
      }

      return new Text([header, ...displayLines].join("\n"), 0, 0);
    },
    renderResult() {
      return new Text("", 0, 0);
    },
    async execute(_toolCallId, params: PushTaskParams, signal, _onUpdate, ctx) {
      if (signal?.aborted) {
        throw new Error("Task storage aborted.");
      }

      const title = params.title.trim();

      const { rewritten, unresolved } = resolveSkillRefs(params.prompt);

      pi.appendEntry(TASK_ENTRY_TYPE, {
        title,
        prompt: rewritten,
      });

      if (ctx.hasUI) {
        refreshTaskStatus(ctx);
        if (unresolved.length > 0) {
          const names = unresolved.map((n) => `/skill:${n}`).join(", ");
          ctx.ui.notify(
            `Warning: ${names} were not resolved.\nTask stored. Use \`/start-task\` or \`/auto\` to start it.`,
            "warning",
          );
        } else {
          ctx.ui.notify("Task stored. Use `/start-task` or `/auto` to start it.", "info");
        }
      }

      return {
        content: [],
        details: {
          title,
          prompt: rewritten,
        },
        terminate: true,
      };
    },
  });
}

export function cmdStartTask(pi: TaskCommandAPI): CommandOptions {
  return {
    description: "Navigate to a fresh context and inject the active task prompt",
    getArgumentCompletions: (argumentPrefix: string) => {
      if (!modelRegistry) return null;
      return getModelCompletions(argumentPrefix, modelRegistry);
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      const modelArg = args.trim() || undefined;
      await startTask(pi, ctx, { modelArg });
    },
  };
}

export function cmdDiscardTask(pi: TaskCommandAPI): CommandOptions {
  return {
    description: "Discard the active task without executing it",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await discardTask(pi, ctx);
    },
  };
}

export function cmdFinishTask(pi: TaskCommandAPI): CommandOptions {
  return {
    description: "Finish the current task and return to the task start point",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await finishTask(pi, ctx);
    },
  };
}

export function cmdAbortTask(pi: TaskCommandAPI): CommandOptions {
  return {
    description: "Abort the current task without finishing",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await abortTask(pi, ctx);
    },
  };
}

export function cmdAuto(pi: AutoCommandAPI): CommandOptions {
  let running = false;
  let stopCurrentRun: (() => void) | null = null;

  pi.on("session_shutdown", async () => {
    stopCurrentRun?.();
  });

  return {
    description: "Automatically run pushed task branches",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (running) {
        ctx.ui.notify("Auto is already running.", "warning");
        return;
      }

      running = true;
      let stopped = false;
      let sawTaskActivity = false;
      stopCurrentRun = () => {
        stopped = true;
      };

      const autoStatusOptions = {
        prefix: "[auto] ",
      } satisfies TaskStatusOptions;
      refreshTaskStatus(ctx, autoStatusOptions);

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
            const result = await startTask(pi, ctx, {
              statusPrefix: autoStatusOptions.prefix,
            });
            if (result === "cancelled") break;
            sawTaskActivity = true;
            continue;
          }

          if (currentTask(ctx.sessionManager)) {
            const result = await finishTask(pi, ctx, {
              statusPrefix: autoStatusOptions.prefix,
            });
            if (result === "cancelled") break;
            sawTaskActivity = true;
            continue;
          }

          // No pending tasks and no current task
          if (!sawTaskActivity) {
            // Never had any task activity — nothing to process
            ctx.ui.notify("No pending tasks to run.", "info");
            break;
          }

          if (!ctx.hasPendingMessages()) {
            break;
          }
        }
      } finally {
        stopCurrentRun = null;
        refreshTaskStatus(ctx);
        running = false;
      }
    },
  };
}

export const rendererTaskResult: MessageRenderer<{ title?: string }> = (
  message,
  _options,
  theme,
): Box => {
  const label = message.details?.title
    ? theme.fg("customMessageLabel", `${message.details.title} result:`)
    : theme.fg("customMessageLabel", "result:");
  const text = renderTextContent(message.content);
  const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
  box.addChild(new Text(`${label}\n${text}`, 0, 0));
  return box;
};

export function updateTaskStatus(
  session: ReadonlySessionLike,
  setStatus: (key: string, value: string | undefined) => void,
  theme: TaskStatusTheme,
  options: TaskStatusOptions = {},
): void {
  const prefix = options.prefix ?? "";
  const pending = pendingTask(session);
  if (pending) {
    setStatus(
      "task",
      `${prefix}${theme.fg("dim", `pending task: ${taskTitle(pending.data.title)}`)}`,
    );
    return;
  }

  const active = currentTask(session);
  if (active) {
    setStatus(
      "task",
      `${prefix}${theme.fg("dim", `current task: ${taskTitle(active.data.title)}`)}`,
    );
    return;
  }

  setStatus("task", undefined);
}

export function setSkills(s: Skill[]): void {
  skills = s;
  skillsExternallySet = true;
}

/**
 * Used by before_agent_start handler to prime the registry from Pi's
 * skill list. Does nothing if skills were already explicitly set
 * (e.g., by tests calling setSkills before h.prompt()).
 */
export function setSkillsFromEvent(s: Skill[]): void {
  if (!skillsExternallySet) {
    skills = s;
  }
}

type CommandOptions = Omit<RegisteredCommand, "name" | "sourceInfo">;

type PushTaskAPI = Pick<ExtensionAPI, "appendEntry">;

interface AutoCommandAPI extends TaskCommandAPI {
  on(eventName: "session_shutdown", handler: () => unknown): void;
}

type TaskStatusTheme = Pick<Theme, "fg">;

type TaskStatusOptions = {
  prefix?: string;
};

type PushTaskParams = Static<typeof pushTaskParameters>;

type TaskActionOptions = {
  statusPrefix?: string;
  modelArg?: string;
};

function lastAssistantWasAborted(session: ReadonlySessionLike): boolean {
  const branch = session.getBranch();
  const last = branch[branch.length - 1];
  return (
    last?.type === "message" &&
    last.message.role === "assistant" &&
    last.message.stopReason === "aborted"
  );
}

async function startTask(
  pi: TaskCommandAPI,
  ctx: ExtensionCommandContext,
  options: TaskActionOptions = {},
): Promise<TaskActionResult> {
  const activeTask = pendingTask(ctx.sessionManager);
  if (!activeTask) {
    ctx.ui.notify("No pending task. Use push-task first.", "warning");
    return;
  }

  // ── Model switching ─────────────────────────────────────────────
  let previousModel: TaskStartData["previousModel"];
  if (options.modelArg) {
    const matched = resolveModelPattern(options.modelArg, ctx.modelRegistry);
    if (matched === null) {
      ctx.ui.notify(`No model matching "${options.modelArg}".`, "warning");
      return;
    }
    if (matched === "ambiguous") {
      const names = matchModels(options.modelArg, ctx.modelRegistry)
        .map((m) => `${m.provider}/${m.id}`)
        .join(", ");
      ctx.ui.notify(`Ambiguous model: matches ${names}.`, "warning");
      return;
    }

    const currentModel = ctx.model;
    if (currentModel) {
      previousModel = { provider: currentModel.provider, modelId: currentModel.id };
    }

    const switched = await pi.setModel(matched);
    if (!switched) {
      ctx.ui.notify(`No API key configured for ${matched.provider}/${matched.id}.`, "warning");
      return;
    }
  }

  // ── Task start ──────────────────────────────────────────────────
  const departureLeafId = ctx.sessionManager.getLeafId()!;
  const freshTargetId = findFreshTargetId(ctx.sessionManager);
  if (!freshTargetId) {
    ctx.ui.notify("No starting point found on current branch.", "warning");
    return;
  }

  const result = await ctx.navigateTree(freshTargetId, { summarize: false });
  if (result.cancelled) return "cancelled";

  const startEntryData: TaskStartData = {
    title: taskTitle(activeTask.data.title),
    returnTo: departureLeafId,
  };
  if (previousModel) {
    startEntryData.previousModel = previousModel;
  }
  pi.appendEntry(TASK_START_ENTRY_TYPE, startEntryData);

  pi.sendUserMessage(activeTask.data.prompt);

  refreshTaskStatus(ctx, { prefix: options.statusPrefix });
}

async function discardTask(
  pi: TaskCommandAPI,
  ctx: ExtensionCommandContext,
): Promise<TaskActionResult> {
  const activeTask = pendingTask(ctx.sessionManager);
  if (!activeTask) {
    ctx.ui.notify("No pending task to discard.", "warning");
    return;
  }

  pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
  ctx.ui.notify("Task discarded.", "info");

  refreshTaskStatus(ctx);
}

async function finishTask(
  pi: TaskCommandAPI,
  ctx: ExtensionCommandContext,
  options: TaskActionOptions = {},
): Promise<TaskActionResult> {
  const taskStart = currentTask(ctx.sessionManager);
  if (!taskStart) {
    ctx.ui.notify("Not inside task, nothing to finish.", "warning");
    return;
  }

  // Capture last assistant message content before navigation. Only text blocks
  // are valid for custom_message content; provider-specific thinking/tool blocks
  // must not be replayed into the parent branch.
  const lastAssistant = findLastEntry(ctx.sessionManager, isAssistantMessageEntry);
  const lastAssistantContent = lastAssistant
    ? taskResultTextContent(lastAssistant.message.content)
    : undefined;
  const lastAssistantId = lastAssistant?.id;

  const title = taskTitle(taskStart.data.title);

  const result = await ctx.navigateTree(taskStart.data.returnTo, {
    summarize: false,
  });
  if (result.cancelled) return "cancelled";

  // Inject last assistant message after navigation
  if (lastAssistantId && lastAssistantContent !== undefined) {
    pi.sendMessage(
      {
        customType: "task-result",
        // Content is filtered to only TextContent blocks (or original string)
        content: lastAssistantContent,
        display: true,
        details: { title },
      },
      { triggerTurn: true },
    );
  }

  if (pendingTask(ctx.sessionManager)) {
    pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
  }

  const label = lastAssistantId ? "Last response attached." : "No last response to attach.";
  ctx.ui.notify(`Task finished. ${label}`, "info");

  await restorePreviousModel(pi, taskStart, ctx);

  refreshTaskStatus(ctx, { prefix: options.statusPrefix });
}

type TaskCommandAPI = Pick<
  ExtensionAPI,
  "appendEntry" | "sendMessage" | "sendUserMessage" | "setModel"
>;

async function abortTask(
  pi: TaskCommandAPI,
  ctx: ExtensionCommandContext,
): Promise<TaskActionResult> {
  const taskStart = currentTask(ctx.sessionManager);
  if (!taskStart) {
    ctx.ui.notify("Not inside task, nothing to abort.", "warning");
    return;
  }

  const result = await ctx.navigateTree(taskStart.data.returnTo, {
    summarize: false,
  });
  if (result.cancelled) return "cancelled";

  ctx.ui.notify("Task aborted. Branch abandoned without summary.", "info");

  await restorePreviousModel(pi, taskStart, ctx);

  refreshTaskStatus(ctx);
}

/** Restore the model that was active before a task started, if one was recorded. */
async function restorePreviousModel(
  pi: TaskCommandAPI,
  taskStart: TaskStartEntry,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!taskStart.data.previousModel) return;

  const { provider, modelId } = taskStart.data.previousModel;
  const restoredModel = ctx.modelRegistry.find(provider, modelId);
  if (restoredModel) {
    if (!(await pi.setModel(restoredModel))) {
      ctx.ui.notify(`Failed to restore previous model ${provider}/${modelId}.`, "warning");
    }
  } else {
    ctx.ui.notify(`Previous model ${provider}/${modelId} no longer available.`, "warning");
  }
}

type TaskActionResult = "cancelled" | void;

function refreshTaskStatus(ctx: TaskStatusContext, options: TaskStatusOptions = {}): void {
  if (ctx.hasUI) {
    updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme, options);
  }
}

type TaskStatusContext = Pick<ExtensionCommandContext, "hasUI" | "sessionManager" | "ui">;

/** Type guard: is the entry an assistant message with content? */
function isAssistantMessageEntry(
  entry: SessionEntry,
): entry is SessionMessageEntry & { message: { role: "assistant" } } {
  return entry.type === "message" && entry.message.role === "assistant";
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
function findPreConversationEntry(session: ReadonlySessionLike): SessionEntry | null {
  if (!session.getLeafId()) return null;

  const branch = session.getBranch();
  for (const entry of branch) {
    if (
      entry.type === "message" ||
      entry.type === "compaction" ||
      entry.type === "branch_summary" ||
      entry.type === "custom_message"
    ) {
      return entry;
    }
  }

  return null;
}

// ── Lookup utilities ──────────────────────────────────────────────

function pendingTask(session: ReadonlySessionLike): TaskEntry | null {
  const branch = session.getBranch();
  let skip = 0;

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "custom" && entry.customType === TASK_START_ENTRY_TYPE) {
      return null;
    }
    if (entry.type === "custom" && entry.customType === TASK_DONE_ENTRY_TYPE) {
      skip++;
      continue;
    }
    if (isTaskEntry(entry)) {
      if (skip === 0) return entry;
      skip--;
    }
  }

  return null;
}

const TASK_DONE_ENTRY_TYPE = "task-done";

function currentTask(session: ReadonlySessionLike): TaskStartEntry | null {
  return findLastEntry(session, isTaskStartEntry) ?? null;
}

function findLastEntry<T extends SessionEntry>(
  session: ReadonlySessionLike,
  predicate: (entry: SessionEntry) => entry is T,
): T | undefined {
  const branch = session.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (predicate(entry)) return entry;
  }
  return undefined;
}

/**
 * Minimal read-only session interface needed by lookup functions.
 * Compatible with both ReadonlySessionManager (from ExtensionCommandContext)
 * and SessionManager (full mutable version).
 */
interface ReadonlySessionLike {
  getLeafId(): string | null;
  getBranch(): SessionEntry[];
}

function isTaskEntry(entry: SessionEntry): entry is TaskEntry {
  return isCustomEntry(entry, TASK_ENTRY_TYPE, isTaskData);
}

type TaskEntry = CustomEntry<typeof TASK_ENTRY_TYPE, TaskData>;

const TASK_ENTRY_TYPE = "task";

function isTaskData(value: unknown): value is TaskData {
  return (
    isRecord(value) &&
    typeof value.prompt === "string" &&
    (value.title === undefined || typeof value.title === "string")
  );
}

interface TaskData {
  title?: string;
  prompt: string;
}

function isTaskStartEntry(entry: SessionEntry): entry is TaskStartEntry {
  return isCustomEntry(entry, TASK_START_ENTRY_TYPE, isTaskStartData);
}

type TaskStartEntry = CustomEntry<typeof TASK_START_ENTRY_TYPE, TaskStartData>;

const TASK_START_ENTRY_TYPE = "task-start";

function isCustomEntry<TCustomType extends string, TData>(
  entry: SessionEntry,
  customType: TCustomType,
  isData: (value: unknown) => value is TData,
): entry is CustomEntry<TCustomType, TData> {
  return entry.type === "custom" && entry.customType === customType && isData(entry.data);
}

type CustomEntry<TCustomType extends string, TData> = SessionEntry & {
  type: "custom";
  customType: TCustomType;
  data: TData;
};

function isTaskStartData(value: unknown): value is TaskStartData {
  if (
    !isRecord(value) ||
    typeof value.returnTo !== "string" ||
    (value.title !== undefined && typeof value.title !== "string")
  ) {
    return false;
  }
  if (value.previousModel !== undefined) {
    return (
      isRecord(value.previousModel) &&
      typeof value.previousModel.provider === "string" &&
      typeof value.previousModel.modelId === "string"
    );
  }
  return true;
}

interface TaskStartData {
  title?: string;
  returnTo: string;
  previousModel?: { provider: string; modelId: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Normalize an optional title to a non-empty display string. */
function taskTitle(title?: string): string {
  return title || "untitled";
}

function resolveSkillRefs(prompt: string): ResolveResult {
  const unresolvedSet = new Set<string>();
  const byName = new Map<string, string>();
  for (const skill of skills) {
    byName.set(skill.name, skill.filePath);
  }

  const rewritten = prompt.replace(
    /\/skill:([a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9])/g,
    (match, name) => {
      const filePath = byName.get(name);
      if (filePath) {
        return filePath;
      }
      unresolvedSet.add(name);
      return match;
    },
  );

  return { rewritten, unresolved: [...unresolvedSet] };
}

/** Case-insensitive substring match of `pattern` against each available model's id, name, or provider/id. */
function matchModels(pattern: string, registry: ModelRegistry): Model<Api>[] {
  const lower = pattern.toLowerCase();
  return registry
    .getAvailable()
    .filter(
      (m) =>
        m.id.toLowerCase().includes(lower) ||
        m.name.toLowerCase().includes(lower) ||
        `${m.provider}/${m.id}`.toLowerCase().includes(lower),
    );
}

interface ResolveResult {
  rewritten: string;
  unresolved: string[];
}

/**
 * Resolve a model pattern to a single model, null (no match), or "ambiguous".
 *
 * Matching order:
 * 1. If pattern contains "/": split as provider/modelId, try exact lookup.
 *    Falls through to substring matching even if the exact lookup fails.
 * 2. Substring, case-insensitive match against each available model's
 *    id, name, and provider/id.
 */
function resolveModelPattern(
  pattern: string,
  registry: ModelRegistry,
): Model<Api> | "ambiguous" | null {
  if (pattern.includes("/")) {
    const slashIdx = pattern.indexOf("/");
    const found = registry.find(pattern.slice(0, slashIdx), pattern.slice(slashIdx + 1));
    if (found) return found;
  }

  const matches = matchModels(pattern, registry);
  if (matches.length === 0) return null;
  if (matches.length > 1) return "ambiguous";
  return matches[0];
}

/**
 * Autocompletion for /start-task model argument, mirroring the /model
 * command: label is the model id, description is the provider, and value
 * is provider/id (what gets typed and resolved). Returns up to 20 items.
 */
function getModelCompletions(argumentPrefix: string, registry: ModelRegistry): AutocompleteItem[] {
  return matchModels(argumentPrefix, registry)
    .slice(0, 20)
    .map((m) => ({
      value: `${m.provider}/${m.id}`,
      label: m.id,
      description: m.provider,
    }));
}

const pushTaskParameters = Type.Object({
  title: Type.String({
    description: "Short task title shown in status, results, and tool rendering.",
  }),
  prompt: Type.String({
    description: "Full prompt for the task, including all context and instructions.",
  }),
});

// ── Skill resolution registry ─────────────────────────────────────

let skills: Skill[] = [];

let skillsExternallySet = false;

let modelRegistry: ModelRegistry | undefined;

export function setModelRegistry(mr: ModelRegistry): void {
  modelRegistry = mr;
}
