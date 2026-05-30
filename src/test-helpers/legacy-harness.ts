import assert from 'node:assert';

import {
  AuthStorage,
  createExtensionRuntime,
  ExtensionRunner,
  ModelRegistry,
  SessionManager,
  type ExtensionCommandContext,
  type ExtensionUIContext,
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
  notification,
  type AutoConfig,
  type BranchEntry,
  type MatchDescriptor,
  type ReactionDescriptor,
} from './common.js';
import { extractContentText, makeUserMessage, PiStub } from './pi-stub.js';

export class LegacyTestHarness {
  constructor() {
    // Seed a non-visible root entry so findFreshTargetId can escape past user messages.
    // Pi always inserts thinking_level_change at session creation (main.js:471).
    this.sm.appendThinkingLevelChange('off');

    this.pi = new PiStub(this.sm);

    this.ctx = this.createCommandContext();

    // Shared auto handler — created once so closure state (running/stopped)
    // is shared across runAuto and userRunsAuto reaction.
    this.autoHandler = cmdAuto(this.pi).handler;
  }

  private createCommandContext(): ExtensionCommandContext {
    const runner = new ExtensionRunner(
      [],
      createExtensionRuntime(),
      process.cwd(),
      this.sm,
      ModelRegistry.inMemory(AuthStorage.inMemory()),
    );

    runner.setUIContext({
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
    } as ExtensionUIContext);

    runner.bindCommandContext({
      waitForIdle: async () => {
        await new Promise<void>((resolve) => {
          this.idleWaiters.push(resolve);
        });
      },
      newSession: async () => ({ cancelled: false }),
      fork: async () => ({ cancelled: false }),
      navigateTree: async (targetId: string) => {
        if (this.cancelNextNav) {
          this.cancelNextNav = false;
          return { cancelled: true };
        }
        this.sm.branch(targetId);
        return { cancelled: false };
      },
      switchSession: async () => ({ cancelled: false }),
      reload: async () => {},
    });

    return runner.createCommandContext();
  }

  private readonly sm = SessionManager.inMemory();
  private readonly idleWaiters: Array<() => void> = [];
  private readonly trackedHints: Array<{ text: string; afterEntryId: string | null }> = [];
  private readonly notificationLog: string[] = [];
  private readonly taskStatusHistory: Array<string | undefined> = [];
  private cancelNextNav = false;
  private taskStatus: string | undefined;
  private readonly pi: PiStub;
  private readonly ctx: ExtensionCommandContext;
  private readonly autoHandler: ReturnType<typeof cmdAuto>['handler'];

  isLlmTriggered(): boolean {
    const branch = this.sm.getBranch();

    // Walk backwards past 'custom' entries (data-only bookkeeping, invisible to LLM)
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];

      switch (entry.type) {
        case 'custom':
          continue;
        case 'message':
          return entry.message.role === 'user' && this.pi.isTriggeredUserMessage(entry.id);
        case 'custom_message':
          return this.pi.isTriggeredCustomMessage(entry.id);
        default:
          return false;
      }
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

    const maxSteps = 100;
    for (let steps = 0; steps < maxSteps && !settled; steps++) {
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
        await flushMicrotasks();
      }
    }

    if (!settled) {
      throw new Error(
        `runAuto did not complete within step cap (${maxSteps}); lastStep=${lastStep}, taskStatus=${JSON.stringify(this.taskStatus)}, waiters=${this.idleWaiters.length}`,
      );
    }

    await handlerPromise;
  }

  getStatus(): string | undefined {
    return this.taskStatus;
  }

  private stripVisibleEntry(entry: SessionEntry): BranchEntry | null {
    if (isHiddenEntry(entry)) {
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
    await flushMicrotasks();
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
      return entryData !== null
        && entryData.prompt.includes(match.data.prompt)
        && entryData.inherit_context === match.data.inherit_context;
    }

    return false;
  }

  private applyReaction(reaction: ReactionDescriptor): void {
    switch (reaction.type) {
      case 'user-esc':
        this.cancelNextNav = true;
        return;
      case 'user-ctrl-c':
        this.pi.triggerSessionShutdown();
        return;
      case 'user-runs-auto':
        // Fire-and-forget: the running guard and notification happen before the first await.
        this.autoHandler('', this.ctx).catch(() => {});
        return;
      case 'message': {
        const text = extractContentText(reaction.message.content) ?? '';
        const message = reaction.message.role === 'assistant'
          ? makeAssistantMessage(text, reaction.message.stopReason)
          : makeUserMessage(text);

        this.sm.appendMessage(message);
        return;
      }
      case 'custom':
        this.sm.appendCustomEntry('task', reaction.data);
    }
  }
}

type TaskCommand = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function isHiddenEntry(entry: SessionEntry): boolean {
  switch (entry.type) {
    case 'thinking_level_change':
    case 'model_change':
    case 'session_info':
    case 'label':
      return true;
    case 'custom':
      return entry.customType === 'task-done' || entry.customType === 'task-start';
    default:
      return false;
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
