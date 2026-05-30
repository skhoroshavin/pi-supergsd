import assert from 'node:assert';

import { describe, it } from 'node:test';

import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type Theme,
} from '@earendil-works/pi-coding-agent';

export {
  assistant,
  user,
  task,
  taskResult,
  userEsc,
  userCtrlC,
  userRunsAuto,
  notification,
  makeHarness,
  pathSuite,
};

export type {
  BranchEntry,
  MatchDescriptor,
  ReactionDescriptor,
  AutoConfig,
  NotificationEntry,
  PathNode,
  PathFn,
};

const assistant = (content: string, stopReason?: string) => ({
  type: 'message' as const,
  message: {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text: content }],
    ...(stopReason ? { stopReason } : {}),
  }
}) as unknown as Partial<BranchEntry>;

const user = (content: string) => ({
  type: 'message' as const,
  message: { role: 'user' as const, content: [{ type: 'text', text: content }] }
}) as unknown as Partial<BranchEntry>;

const task = (prompt: string, inherit_context = false) => ({
  type: 'custom' as const,
  customType: 'task',
  data: { prompt, inherit_context }
}) as unknown as Partial<BranchEntry>;

const taskResult = (slug: string, content?: string) => ({
  type: 'custom_message' as const,
  customType: 'task-result',
  details: { slug },
  ...(content !== undefined ? { content: [{ type: 'text' as const, text: content }] } : {}),
}) as unknown as Partial<BranchEntry>;

function pathSuite(
  description: string,
  implementation: HarnessImplementation,
  fn: (path: PathFn) => PathNode | PathNode[],
): void {
    describe(description, () => {
        const roots = fn(path);
        const rootsArray = Array.isArray(roots) ? roots : [roots];

        function registerTests(node: PathNode, ancestors: PathNode[]): void {
            const chain = [...ancestors, node];
            const name = chain.map(n => n.name).join(' → ');

            it(name, async () => {
                const h = makeHarness(implementation);
                for (const ancestor of chain) {
                    if (ancestor.fn) {
                        await ancestor.fn(h);
                    }
                }
            });

            for (const child of node.children) {
                registerTests(child, chain);
            }
        }

        for (const root of rootsArray) {
            registerTests(root, []);
        }
    });
}

const path: PathFn = (name, fn, ...children) => ({ name, fn, children });

type PathFn = (
    name: string,
    fn?: (h: ReturnType<typeof makeHarness>) => Promise<void> | void,
    ...children: PathNode[]
) => PathNode;

// ── pathSuite test helper ───────────────────────────────────────

interface PathNode {
    name: string;
    fn?: (h: ReturnType<typeof makeHarness>) => Promise<void> | void;
    children: PathNode[];
}

// ── Test harness ─────────────────────────────────────────────────

function makeHarness(implementation: HarnessImplementation) {
  // userEsc, userCtrlC, userRunsAuto are referenced through reaction types in
  // runAuto; reference them here to suppress TS6133.
  void userEsc;
  void userCtrlC;
  void userRunsAuto;

  const sm = SessionManager.inMemory();
  // Seed a non-visible root entry so findFreshTargetId can escape past user messages.
  // Pi always inserts thinking_level_change at session creation (main.js:471).
  sm.appendThinkingLevelChange('off');
  const idleWaiters: Array<() => void> = [];
  const sessionShutdownHandlers: Array<() => unknown> = [];
  const triggeredCustomMessages = new Set<string>();
  const triggeredUserMessages = new Set<string>();

  const trackedHints: Array<{ text: string; afterEntryId: string | null }> = [];
  const notificationLog: string[] = [];
  const taskStatusHistory: Array<string | undefined> = [];
  let cancelNextNav = false;
  let taskStatus: string | undefined;


  const pi = {
    appendEntry(customType: string, data?: unknown) {
      sm.appendCustomEntry(customType, data);
    },
    sendUserMessage(content: string | Array<{ type: string; text: string }>) {
      const text = typeof content === 'string' ? content : content.map((b) => b.text).join('');
      sm.appendMessage({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() });
      const branch = sm.getBranch();
      const last = branch[branch.length - 1];
      if (last) triggeredUserMessages.add(last.id);
    },
    sendMessage(
      message: { customType: string; content: unknown; display?: boolean; details?: unknown },
      options?: { triggerTurn?: boolean },
    ) {
      sm.appendCustomMessageEntry(
        message.customType,
        message.content as string,
        message.display ?? true,
        message.details,
      );

      if (options?.triggerTurn) {
        const branch = sm.getBranch();
        const last = branch[branch.length - 1];
        if (last) triggeredCustomMessages.add(last.id);
      }
    },
    on(eventName: string, handler: () => unknown) {
      if (eventName === 'session_shutdown') sessionShutdownHandlers.push(handler);
    },
    registerMessageRenderer() {},
    registerTool() {},
    registerCommand() {},
  } as unknown as ExtensionAPI;

  const ctx = {
    hasUI: true,
    waitForIdle: async () => {
      await new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },
    hasPendingMessages: () => false,
    sessionManager: sm,
    ui: {
      notify(message: string) {
        trackedHints.push({ text: message, afterEntryId: sm.getLeafId() });
        notificationLog.push(message);
      },
      setStatus(key: string, value: string | undefined) {
        if (key === 'task') {
          taskStatus = value;
          taskStatusHistory.push(value);
        }
      },
      theme: {
        fg: (_key: string, text: string) => text,
        bg: (_key: string, text: string) => text,
        bold: (text: string) => text,
      } as unknown as Theme,
    },
    navigateTree: async (targetId: string) => {
      if (cancelNextNav) {
        cancelNextNav = false;
        return { cancelled: true };
      }
      sm.branch(targetId);
      return { cancelled: false };
    },
  } as unknown as ExtensionCommandContext & { sessionManager: SessionManager };

  // ── Plumbing helpers ──────────────────────────────────────────

  function isLlmTriggered(): boolean {
    const branch = sm.getBranch();
    if (branch.length === 0) return false;
    // Walk backwards past 'custom' entries (data-only bookkeeping, invisible to LLM)
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry.type === 'custom') continue;
      if (entry.type === 'message' && entry.message.role === 'user') return triggeredUserMessages.has(entry.id);
      if (entry.type === 'message' && entry.message.role === 'assistant') return false;
      if (entry.type === 'custom_message') return triggeredCustomMessages.has(entry.id);
      return false;
    }
    return false;
  }

  function appendUserMessage(text: string): void {
    sm.appendMessage({ role: 'user', content: [{ type: 'text', text }], timestamp: 0 });
  }

  function appendAssistantMessage(text: string, stopReason?: string): void {
    sm.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      timestamp: 0,
      model: 'test',
      provider: 'test',
      ...(stopReason ? { stopReason } : {}),
    } as Parameters<typeof sm.appendMessage>[0]);
  }

  function stripVisibleEntry(entry: BranchEntry): Partial<BranchEntry> | null {
    const HIDDEN_TYPES = new Set(['thinking_level_change', 'model_change', 'session_info', 'label']);
    const isSkipped =
      HIDDEN_TYPES.has(entry.type) ||
      (entry.type === 'custom' && (entry.customType === 'task-done' || entry.customType === 'task-start'));

    if (isSkipped) {
      return null;
    }

    const { id: _id, parentId: _pid, timestamp: _ts, display: _dp, data: rawData, details: rawDetails, ...restEntry } = entry as unknown as Record<string, unknown>;
    const stripped: Record<string, unknown> = { ...restEntry };

    if (stripped.message && typeof stripped.message === 'object') {
      const { timestamp: _mt, model: _mp, provider: _pp, ...msgRest } = stripped.message as Record<string, unknown>;
      stripped.message = msgRest;
    }

    if (rawData && typeof rawData === 'object') {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawData as Record<string, unknown>)) {
        if (typeof v !== 'string' || !/^[a-f0-9]{8}$/.test(v)) {
          cleaned[k] = v;
        }
      }
      if (Object.keys(cleaned).length > 0) stripped.data = cleaned;
    }

    if (rawDetails && typeof rawDetails === 'object') {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawDetails as Record<string, unknown>)) {
        if (typeof v !== 'string' || !/^[a-f0-9]{8}$/.test(v)) {
          cleaned[k] = v;
        }
      }
      if (Object.keys(cleaned).length > 0) stripped.details = cleaned;
    }

    return stripped as Partial<BranchEntry>;
  }

  function entriesEqual(actual: Partial<BranchEntry>, expected: Partial<BranchEntry>): boolean {
    try {
      assert.deepStrictEqual(actual, expected);
      return true;
    } catch {
      return false;
    }
  }

  function assertBranchHistory(...expected: Partial<BranchEntry>[]) {
    const entries = sm.getBranch();
    const actual: Partial<BranchEntry>[] = [];
    const consumedHints = new Set<number>();

    for (const entry of entries) {
      const stripped = stripVisibleEntry(entry);
      if (stripped) {
        actual.push(stripped);
      }

      // Insert tracked hints with matching afterEntryId after the entry
      for (let i = 0; i < trackedHints.length; i++) {
        if (trackedHints[i].afterEntryId === entry.id) {
          actual.push(notification(trackedHints[i].text));
          consumedHints.add(i);
        }
      }
    }

    // Unclassified hints (afterEntryId === null) go at start
    for (let i = 0; i < trackedHints.length; i++) {
      if (!consumedHints.has(i) && trackedHints[i].afterEntryId === null) {
        actual.unshift(notification(trackedHints[i].text));
        consumedHints.add(i);
      }
    }

    // Remove consumed hints so they don't leak across calls.
    // Also discard orphaned hints (non-null afterEntryId from a different branch).
    const remaining: Array<{ text: string; afterEntryId: string | null }> = [];
    for (let i = 0; i < trackedHints.length; i++) {
      if (!consumedHints.has(i) && trackedHints[i].afterEntryId === null) {
        remaining.push(trackedHints[i]);
      }
    }
    trackedHints.length = 0;
    trackedHints.push(...remaining);

    assert.deepStrictEqual(actual, expected);
  }

  function assertSessionContains(...expected: Partial<BranchEntry>[]): void {
    const actual = sm.getEntries()
      .map(entry => stripVisibleEntry(entry))
      .filter((entry): entry is Partial<BranchEntry> => entry !== null);

    for (const expectedEntry of expected) {
      assert.ok(
        actual.some(entry => entriesEqual(entry, expectedEntry)),
        `Expected session to contain entry: ${JSON.stringify(expectedEntry)}`,
      );
    }
  }

  function assertNotifications(...expected: string[]): void {
    for (const text of expected) {
      assert.ok(notificationLog.includes(text), `Expected notification log to include: ${text}`);
    }
  }

  function assertTaskStatusHistoryIncludes(expected: string | undefined): void {
    assert.ok(
      taskStatusHistory.includes(expected),
      `Expected task status history to include ${JSON.stringify(expected)}, got ${JSON.stringify(taskStatusHistory)}`,
    );
  }



  // ── Convenience wrappers (pre-bound to pi / ctx) ───────────────

  async function runPushTask(prompt: string, inherit_context?: boolean) {
    const tool = implementation.createPushTaskTool(pi) as {
      execute: (
        toolCallId: string,
        params: { prompt: string; inherit_context?: boolean },
        signal: AbortSignal | undefined,
        onUpdate: unknown,
        ctx: ExtensionCommandContext,
      ) => Promise<unknown>;
    };
    await tool.execute('call-1', { prompt, inherit_context }, undefined, undefined, ctx);
  }

  async function runTaskCommand(command: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<unknown> }) {
    const handlerP = command.handler('', ctx);
    const next = idleWaiters.shift();
    assert.ok(next, 'Expected a pending waitForIdle call.');
    next();
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    await handlerP;
  }

  const runStartTask = () => runTaskCommand(implementation.createStartTaskCommand(pi) as { handler: (args: string, ctx: ExtensionCommandContext) => Promise<unknown> });
  const runFinishTask = () => runTaskCommand(implementation.createFinishTaskCommand(pi) as { handler: (args: string, ctx: ExtensionCommandContext) => Promise<unknown> });
  const runDiscardTask = () => runTaskCommand(implementation.createDiscardTaskCommand(pi) as { handler: (args: string, ctx: ExtensionCommandContext) => Promise<unknown> });
  const runAbortTask = () => runTaskCommand(implementation.createAbortTaskCommand() as { handler: (args: string, ctx: ExtensionCommandContext) => Promise<unknown> });

  // Shared auto handler — created once so closure state (running/stopped)
  // is shared across runAuto and userRunsAuto reaction.
  const autoHandler = (implementation.createAutoCommand(pi) as { handler: (args: string, ctx: ExtensionCommandContext) => Promise<unknown> }).handler;



  /**
   * Scan branch entries not yet in the seenIds set and apply the first
   * matching reaction for each new entry. Uses entry IDs to track seen
   * state, so it works correctly across navigation (branch length changes).
   */
  function scanAndReact(
    session: SessionManager,
    reactions: Array<[MatchDescriptor, ReactionDescriptor]>,
    seenIds: Set<string>,
  ): void {
    const branch = session.getBranch();
    for (const entry of branch) {
      if (seenIds.has(entry.id)) continue;
      seenIds.add(entry.id);
      for (const [match, reaction] of reactions) {
        if (entryMatches(entry, match)) {
          applyReaction(session, reaction);
          break; // first match wins per entry
        }
      }
    }
  }

  /**
   * Check whether a branch entry matches a match descriptor.
   * Phase 2: supports user() match — user messages whose text contains the pattern.
   */
  function entryMatches(entry: BranchEntry, match: MatchDescriptor): boolean {
    const m = match as Record<string, unknown>;

    // --- message-type matches (user, assistant) ---
    if (m.type === 'message' && m.message && typeof m.message === 'object') {
      const msg = m.message as Record<string, unknown>;
      const matchRole = msg.role as string;

      // Narrow to user/assistant roles which have `content` (excludes BashExecutionMessage etc.)
      if (entry.type === 'message' && (entry.message.role === 'user' || entry.message.role === 'assistant')) {
        if (entry.message.role !== matchRole) return false;
        const matchText = extractContentText(msg.content);
        const entryText = extractContentText(entry.message.content);
        if (matchText && entryText && entryText.includes(matchText)) return true;
      }
      return false;
    }

    // --- custom-type matches (task) ---
    if (m.type === 'custom' && entry.type === 'custom') {
      const matchCustomType = m.customType as string;
      const matchData = m.data as Record<string, unknown> | undefined;

      if (entry.customType !== matchCustomType) return false;

      // If the match has data, check the entry's data fields
      if (matchData) {
        const entryData = entry.data as Record<string, unknown> | undefined;
        if (!entryData) return false;

        // task("prompt") match: data.prompt must contain the pattern
        if (typeof matchData.prompt === 'string') {
          const entryPrompt = entryData.prompt;
          if (typeof entryPrompt !== 'string') return false;
          if (!entryPrompt.includes(matchData.prompt)) return false;
        }

        // task("prompt", inherit) match: inherit_context must match if specified
        if (typeof matchData.inherit_context === 'boolean') {
          if (entryData.inherit_context !== matchData.inherit_context) return false;
        }
      }

      return true;
    }

    return false;
  }

  /**
   * Apply a reaction descriptor to the session.
   * Phase 2: supports assistant() reaction — injects an assistant message.
   */
  function applyReaction(session: SessionManager, reaction: ReactionDescriptor): void {
    const r = reaction as Record<string, unknown>;

    // --- user-esc reaction: cancel next navigation ---
    if (r.type === 'user-esc') {
      cancelNextNav = true;
      return;
    }

    // --- user-ctrl-c reaction: trigger session shutdown ---
    if (r.type === 'user-ctrl-c') {
      for (const handler of sessionShutdownHandlers) {
        handler();
      }
      return;
    }

    // --- user-runs-auto reaction: invoke auto handler reentrantly ---
    if (r.type === 'user-runs-auto') {
      // Invoke the same auto handler from within the active run. The
      // second invocation detects the closure's `running` flag is true,
      // injects "Auto is already running", and returns immediately.
      // Fire-and-forget: the handler is async but the guard check and
      // notification happen synchronously before any await.
      autoHandler('', ctx).catch(() => {});
      return;
    }

    // --- message-type reactions (assistant, user) ---
    if (r.type === 'message' && r.message && typeof r.message === 'object') {
      const msg = r.message as Record<string, unknown>;

      if (msg.role === 'assistant') {
        const text = extractContentText(msg.content) ?? '';
        const stopReason = msg.stopReason as string | undefined;
        session.appendMessage({
          role: 'assistant',
          content: [{ type: 'text', text }],
          timestamp: 0,
          model: 'test',
          provider: 'test',
          ...(stopReason ? { stopReason } : {}),
        } as Parameters<typeof session.appendMessage>[0]);
        return;
      }

      if (msg.role === 'user') {
        const text = extractContentText(msg.content) ?? '';
        session.appendMessage({
          role: 'user',
          content: [{ type: 'text', text }],
          timestamp: 0,
        });
        return;
      }
    }

    // --- custom-type reactions (task) ---
    if (r.type === 'custom' && r.customType === 'task') {
      const data = r.data as Record<string, unknown> | undefined;
      const prompt = typeof data?.prompt === 'string' ? data.prompt : '';
      const inherit_context = data?.inherit_context === true;
      session.appendCustomEntry('task', { prompt, inherit_context });
      return;
    }
  }

  /** Extract plain text from content (string or array of text blocks). */
  function extractContentText(content: unknown): string | null {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const blocks = content as Array<{ type?: string; text?: string }>;
      return blocks
        .filter(b => b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text!)
        .join('');
    }
    return null;
  }

  async function runAuto(config: AutoConfig): Promise<void> {
    const reactions = config.reactions ?? [];
    let settled = false;
    let lastStep = -1;
    // Start with empty seen set so the first scan covers all pre-existing entries.
    // This is needed for user-esc tests where the task entry exists before auto runs.
    const seenIds = new Set<string>();

    const handlerPromise = autoHandler('', ctx).finally(() => { settled = true; });

    const MAX_STEPS = 100;
    for (let steps = 0; steps < MAX_STEPS && !settled; steps++) {
      lastStep = steps;
      await Promise.resolve();

      const waiter = idleWaiters.shift();
      if (waiter) {
        // ── Fixed-point reaction engine ──────────────────────────
        // Run reactions to completion before resolving the idle, so
        // reaction chains (e.g., assistant → user → assistant) all
        // fire before auto's handler gets to respond.
        let dirty: boolean;
        do {
          const lenBefore = sm.getBranch().length;
          scanAndReact(sm, reactions, seenIds);
          dirty = sm.getBranch().length > lenBefore;
        } while (dirty);

        waiter();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
    }

    if (!settled) {
      throw new Error(
        `runAuto did not complete within step cap (${MAX_STEPS}); lastStep=${lastStep}, taskStatus=${JSON.stringify(taskStatus)}, waiters=${idleWaiters.length}`,
      );
    }

    await handlerPromise;
  }

  function getStatus(): string | undefined {
    return taskStatus;
  }

  return {
    assertBranchHistory,
    assertSessionContains,
    assertNotifications,
    assertTaskStatusHistoryIncludes,
    isLlmTriggered,
    getStatus,
    appendUserMessage,
    appendAssistantMessage,
    runPushTask,
    runStartTask,
    runFinishTask,
    runDiscardTask,
    runAbortTask,
    runAuto,
  };
}

interface HarnessImplementation {
  createPushTaskTool: (pi: ExtensionAPI) => unknown;
  createStartTaskCommand: (pi: ExtensionAPI) => unknown;
  createFinishTaskCommand: (pi: ExtensionAPI) => unknown;
  createDiscardTaskCommand: (pi: ExtensionAPI) => unknown;
  createAbortTaskCommand: () => unknown;
  createAutoCommand: (pi: ExtensionAPI) => unknown;
}

interface AutoConfig {
  reactions?: Array<[MatchDescriptor, ReactionDescriptor]>;
}

// ── Auto test types ─────────────────────────────────────────────

/** Entry kinds that can appear in a reaction pair's match slot. */
type MatchDescriptor =
  | Partial<BranchEntry>   // user(), assistant(), task() helpers produce these
  ;

/** Entry kinds that can appear in a reaction pair's reaction slot. */
type ReactionDescriptor =
  | Partial<BranchEntry>                        // assistant(), user(), task() helpers produce these
  | { type: 'user-esc' }                       // userEsc()
  | { type: 'user-ctrl-c' }                    // userCtrlC()
  | { type: 'user-runs-auto' }                 // userRunsAuto()
  ;

const userEsc = () => ({ type: 'user-esc' as const });

const userCtrlC = () => ({ type: 'user-ctrl-c' as const });

const userRunsAuto = () => ({ type: 'user-runs-auto' as const });

const notification = (text: string) => ({
  type: 'notification' as const,
  text,
  afterEntryId: null as string | null
}) as unknown as Partial<BranchEntry>;

type BranchEntry = import('@earendil-works/pi-coding-agent').SessionEntry | NotificationEntry;

// ── Branch history helpers ──────────────────────────────────────

type NotificationEntry = {
  type: 'notification';
  text: string;
  afterEntryId: string | null;
};