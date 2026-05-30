import assert from 'node:assert';

import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionEntry,
  type Theme,
} from '@earendil-works/pi-coding-agent';

import {
  toolPushTask,
  cmdAuto,
  cmdStartTask,
  cmdFinishTask,
  cmdDiscardTask,
  cmdAbortTask,
} from '../index.js';

import {
  assumeCommandContext,
  notification,
  type AutoConfig,
  type BranchEntry,
  type MatchDescriptor,
  type ReactionDescriptor,
} from './common.js';

export class Harness {
  constructor() {
    // Seed a non-visible root entry so findFreshTargetId can escape past user messages.
    // Pi always inserts thinking_level_change at session creation (main.js:471).
    this.sm.appendThinkingLevelChange('off');

    this.pi = {
      appendEntry: (customType: string, data?: unknown) => {
        this.sm.appendCustomEntry(customType, data);
      },
      sendUserMessage: (content: Parameters<ExtensionAPI['sendUserMessage']>[0]) => {
        const text = extractContentText(content) ?? '';
        this.sm.appendMessage(makeUserMessage(text, Date.now()));
        const branch = this.sm.getBranch();
        const last = branch[branch.length - 1];
        if (last) this.triggeredUserMessages.add(last.id);
      },
      sendMessage: (
        message: Parameters<ExtensionAPI['sendMessage']>[0],
        options?: Parameters<ExtensionAPI['sendMessage']>[1],
      ) => {
        this.sm.appendCustomMessageEntry(
          message.customType,
          message.content,
          message.display ?? true,
          message.details,
        );

        if (options?.triggerTurn) {
          const branch = this.sm.getBranch();
          const last = branch[branch.length - 1];
          if (last) this.triggeredCustomMessages.add(last.id);
        }
      },
      on: (eventName: string, handler: () => unknown) => {
        if (eventName === 'session_shutdown') this.sessionShutdownHandlers.push(handler);
      },
    };

    this.ctx = assumeCommandContext({
      hasUI: true,
      waitForIdle: async () => {
        await new Promise<void>((resolve) => {
          this.idleWaiters.push(resolve);
        });
      },
      hasPendingMessages: () => false,
      sessionManager: this.sm,
      ui: {
        notify: (message: string) => {
          this.trackedHints.push({ text: message, afterEntryId: this.sm.getLeafId() });
          this.notificationLog.push(message);
        },
        setStatus: (key: string, value: string | undefined) => {
          if (key === 'task') {
            this.taskStatus = value;
            this.taskStatusHistory.push(value);
          }
        },
        theme: {
          fg: (_key: string, text: string) => text,
          bg: (_key: string, text: string) => text,
          bold: (text: string) => text,
        } satisfies Pick<Theme, 'fg' | 'bg' | 'bold'>,
      },
      navigateTree: async (targetId: string) => {
        if (this.cancelNextNav) {
          this.cancelNextNav = false;
          return { cancelled: true };
        }
        this.sm.branch(targetId);
        return { cancelled: false };
      },
    });

    // Shared auto handler — created once so closure state (running/stopped)
    // is shared across runAuto and userRunsAuto reaction.
    this.autoHandler = cmdAuto(this.pi).handler;
  }

  private readonly sm = SessionManager.inMemory();
  private readonly idleWaiters: Array<() => void> = [];
  private readonly sessionShutdownHandlers: Array<() => unknown> = [];
  private readonly triggeredCustomMessages = new Set<string>();
  private readonly triggeredUserMessages = new Set<string>();
  private readonly trackedHints: Array<{ text: string; afterEntryId: string | null }> = [];
  private readonly notificationLog: string[] = [];
  private readonly taskStatusHistory: Array<string | undefined> = [];
  private cancelNextNav = false;
  private taskStatus: string | undefined;
  private readonly pi: Parameters<typeof cmdAuto>[0] & Parameters<typeof toolPushTask>[0];
  private readonly ctx: ExtensionCommandContext;
  private readonly autoHandler: ReturnType<typeof cmdAuto>['handler'];

  isLlmTriggered(): boolean {
    const branch = this.sm.getBranch();
    if (branch.length === 0) return false;

    // Walk backwards past 'custom' entries (data-only bookkeeping, invisible to LLM)
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry.type === 'custom') continue;
      if (entry.type === 'message' && entry.message.role === 'user') return this.triggeredUserMessages.has(entry.id);
      if (entry.type === 'message' && entry.message.role === 'assistant') return false;
      if (entry.type === 'custom_message') return this.triggeredCustomMessages.has(entry.id);
      return false;
    }

    return false;
  }

  appendUserMessage(text: string): void {
    this.sm.appendMessage(makeUserMessage(text));
  }

  appendAssistantMessage(text: string, stopReason?: string): void {
    this.sm.appendMessage(makeAssistantMessage(text, stopReason));
  }

  assertBranchHistory(...expected: BranchEntry[]): void {
    const entries = this.sm.getBranch();
    const actual: BranchEntry[] = [];
    const consumedHints = new Set<number>();

    for (const entry of entries) {
      const stripped = this.stripVisibleEntry(entry);
      if (stripped) {
        actual.push(stripped);
      }

      // Insert tracked hints with matching afterEntryId after the entry
      for (let i = 0; i < this.trackedHints.length; i++) {
        if (this.trackedHints[i].afterEntryId === entry.id) {
          actual.push(notification(this.trackedHints[i].text));
          consumedHints.add(i);
        }
      }
    }

    // Unclassified hints (afterEntryId === null) go at start
    for (let i = 0; i < this.trackedHints.length; i++) {
      if (!consumedHints.has(i) && this.trackedHints[i].afterEntryId === null) {
        actual.unshift(notification(this.trackedHints[i].text));
        consumedHints.add(i);
      }
    }

    // Remove consumed hints so they don't leak across calls.
    // Also discard orphaned hints (non-null afterEntryId from a different branch).
    const remaining: Array<{ text: string; afterEntryId: string | null }> = [];
    for (let i = 0; i < this.trackedHints.length; i++) {
      if (!consumedHints.has(i) && this.trackedHints[i].afterEntryId === null) {
        remaining.push(this.trackedHints[i]);
      }
    }
    this.trackedHints.length = 0;
    this.trackedHints.push(...remaining);

    assert.deepStrictEqual(actual, expected);
  }

  assertSessionContains(...expected: BranchEntry[]): void {
    const actual = this.sm.getEntries()
      .map(entry => this.stripVisibleEntry(entry))
      .filter((entry): entry is BranchEntry => entry !== null);

    for (const expectedEntry of expected) {
      assert.ok(
        actual.some(entry => this.entriesEqual(entry, expectedEntry)),
        `Expected session to contain entry: ${JSON.stringify(expectedEntry)}`,
      );
    }
  }

  assertNotifications(...expected: string[]): void {
    for (const text of expected) {
      assert.ok(this.notificationLog.includes(text), `Expected notification log to include: ${text}`);
    }
  }

  assertTaskStatusHistoryIncludes(expected: string | undefined): void {
    assert.ok(
      this.taskStatusHistory.includes(expected),
      `Expected task status history to include ${JSON.stringify(expected)}, got ${JSON.stringify(this.taskStatusHistory)}`,
    );
  }

  async runPushTask(prompt: string, inherit_context?: boolean): Promise<void> {
    const tool = toolPushTask(this.pi);
    await tool.execute('call-1', { prompt, inherit_context }, undefined, undefined, this.ctx);
  }

  async runStartTask(): Promise<void> {
    await this.runTaskCommand(cmdStartTask(this.pi));
  }

  async runFinishTask(): Promise<void> {
    await this.runTaskCommand(cmdFinishTask(this.pi));
  }

  async runDiscardTask(): Promise<void> {
    await this.runTaskCommand(cmdDiscardTask(this.pi));
  }

  async runAbortTask(): Promise<void> {
    await this.runTaskCommand(cmdAbortTask());
  }

  async runAuto(config: AutoConfig): Promise<void> {
    const reactions = config.reactions ?? [];
    let settled = false;
    let lastStep = -1;
    // Start with empty seen set so the first scan covers all pre-existing entries.
    // This is needed for user-esc tests where the task entry exists before auto runs.
    const seenIds = new Set<string>();

    const handlerPromise = this.autoHandler('', this.ctx).finally(() => {
      settled = true;
    });

    const MAX_STEPS = 100;
    for (let steps = 0; steps < MAX_STEPS && !settled; steps++) {
      lastStep = steps;
      await Promise.resolve();

      const waiter = this.idleWaiters.shift();
      if (waiter) {
        // ── Fixed-point reaction engine ──────────────────────────
        // Run reactions to completion before resolving the idle, so
        // reaction chains (e.g., assistant → user → assistant) all
        // fire before auto's handler gets to respond.
        let dirty: boolean;
        do {
          const lenBefore = this.sm.getBranch().length;
          this.scanAndReact(reactions, seenIds);
          dirty = this.sm.getBranch().length > lenBefore;
        } while (dirty);

        waiter();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
    }

    if (!settled) {
      throw new Error(
        `runAuto did not complete within step cap (${MAX_STEPS}); lastStep=${lastStep}, taskStatus=${JSON.stringify(this.taskStatus)}, waiters=${this.idleWaiters.length}`,
      );
    }

    await handlerPromise;
  }

  getStatus(): string | undefined {
    return this.taskStatus;
  }

  private stripVisibleEntry(entry: SessionEntry): BranchEntry | null {
    const HIDDEN_TYPES = new Set(['thinking_level_change', 'model_change', 'session_info', 'label']);
    const isSkipped =
      HIDDEN_TYPES.has(entry.type)
      || (entry.type === 'custom' && (entry.customType === 'task-done' || entry.customType === 'task-start'));

    if (isSkipped) {
      return null;
    }

    if (entry.type === 'message') {
      if (entry.message.role === 'user') {
        const text = extractContentText(entry.message.content) ?? '';
        return {
          type: 'message',
          message: { role: 'user', content: [{ type: 'text', text }] },
        };
      }

      if (entry.message.role === 'assistant') {
        const text = extractContentText(entry.message.content) ?? '';
        return {
          type: 'message',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text }],
            ...(entry.message.stopReason && entry.message.stopReason !== 'stop'
              ? { stopReason: entry.message.stopReason }
              : {}),
          },
        };
      }

      return null;
    }

    if (entry.type === 'custom') {
      if (entry.customType !== 'task') return null;
      const data = readTaskData(entry.data);
      if (!data) return null;
      return {
        type: 'custom',
        customType: 'task',
        data,
      };
    }

    if (entry.type === 'custom_message') {
      if (entry.customType !== 'task-result') return null;
      const slug = readTaskResultSlug(entry.details);
      if (!slug) return null;
      const text = extractContentText(entry.content);
      return {
        type: 'custom_message',
        customType: 'task-result',
        details: { slug },
        ...(text !== null ? { content: [{ type: 'text', text }] } : {}),
      };
    }

    return null;
  }

  private entriesEqual(actual: BranchEntry, expected: BranchEntry): boolean {
    try {
      assert.deepStrictEqual(actual, expected);
      return true;
    } catch {
      return false;
    }
  }

  private async runTaskCommand(command: TaskCommand): Promise<void> {
    const handlerP = command.handler('', this.ctx);
    const next = this.idleWaiters.shift();
    assert.ok(next, 'Expected a pending waitForIdle call.');
    next();
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    await handlerP;
  }

  private scanAndReact(
    reactions: Array<[MatchDescriptor, ReactionDescriptor]>,
    seenIds: Set<string>,
  ): void {
    const branch = this.sm.getBranch();
    for (const entry of branch) {
      if (seenIds.has(entry.id)) continue;
      seenIds.add(entry.id);
      for (const [match, reaction] of reactions) {
        if (this.entryMatches(entry, match)) {
          this.applyReaction(reaction);
          break; // first match wins per entry
        }
      }
    }
  }

  private entryMatches(entry: SessionEntry, match: MatchDescriptor): boolean {
    if (match.type === 'message') {
      if (entry.type !== 'message') return false;
      if (entry.message.role !== 'user' && entry.message.role !== 'assistant') return false;
      if (entry.message.role !== match.message.role) return false;

      const matchText = extractContentText(match.message.content);
      const entryText = extractContentText(entry.message.content);
      return matchText !== null && entryText !== null && entryText.includes(matchText);
    }

    if (match.type === 'custom') {
      if (entry.type !== 'custom' || entry.customType !== match.customType) return false;
      const entryData = readTaskData(entry.data);
      if (!entryData) return false;

      if (!entryData.prompt.includes(match.data.prompt)) return false;
      if (entryData.inherit_context !== match.data.inherit_context) return false;
      return true;
    }

    return false;
  }

  private applyReaction(reaction: ReactionDescriptor): void {
    // --- user-esc reaction: cancel next navigation ---
    if (reaction.type === 'user-esc') {
      this.cancelNextNav = true;
      return;
    }

    // --- user-ctrl-c reaction: trigger session shutdown ---
    if (reaction.type === 'user-ctrl-c') {
      for (const handler of this.sessionShutdownHandlers) {
        handler();
      }
      return;
    }

    // --- user-runs-auto reaction: invoke auto handler reentrantly ---
    if (reaction.type === 'user-runs-auto') {
      // Invoke the same auto handler from within the active run. The
      // second invocation detects the closure's `running` flag is true,
      // injects "Auto is already running", and returns immediately.
      // Fire-and-forget: the handler is async but the guard check and
      // notification happen synchronously before any await.
      this.autoHandler('', this.ctx).catch(() => {});
      return;
    }

    // --- message-type reactions (assistant, user) ---
    if (reaction.type === 'message') {
      const text = extractContentText(reaction.message.content) ?? '';

      if (reaction.message.role === 'assistant') {
        this.sm.appendMessage(makeAssistantMessage(text, reaction.message.stopReason));
        return;
      }

      this.sm.appendMessage(makeUserMessage(text));
      return;
    }

    // --- custom-type reactions (task) ---
    if (reaction.type === 'custom') {
      this.sm.appendCustomEntry('task', reaction.data);
    }
  }
}

type TaskCommand = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };

function makeUserMessage(text: string, timestamp = 0): AppendedMessage {
  return { role: 'user', content: [{ type: 'text', text }], timestamp };
}

function makeAssistantMessage(
  text: string,
  stopReason?: string,
): AssistantAppendedMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'test',
    provider: 'test',
    model: 'test',
    usage: TEST_USAGE,
    stopReason: normalizeStopReason(stopReason),
    timestamp: 0,
  };
}

const TEST_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

type AssistantAppendedMessage = Extract<AppendedMessage, { role: 'assistant' }>;

type AppendedMessage = Parameters<SessionManager['appendMessage']>[0];

function readTaskData(data: unknown): { prompt: string; inherit_context: boolean } | null {
  if (!isRecord(data)) return null;
  if (typeof data.prompt !== 'string' || typeof data.inherit_context !== 'boolean') return null;
  return { prompt: data.prompt, inherit_context: data.inherit_context };
}

function readTaskResultSlug(details: unknown): string | null {
  return isRecord(details) && typeof details.slug === 'string' ? details.slug : null;
}

function extractContentText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  return content
    .filter(isTextBlock)
    .map(block => block.text)
    .join('');
}

function normalizeStopReason(stopReason?: string): AssistantAppendedMessage['stopReason'] {
  switch (stopReason) {
    case 'length':
    case 'toolUse':
    case 'error':
    case 'aborted':
      return stopReason;
    default:
      return 'stop';
  }
}

function isTextBlock(value: unknown): value is TextBlock {
  return isRecord(value) && value.type === 'text' && typeof value.text === 'string';
}

type TextBlock = { type: 'text'; text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
