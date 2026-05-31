import assert from 'node:assert';

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type SessionEntry,
  type SessionMessageEntry,
} from '@earendil-works/pi-coding-agent';

// eslint-disable-next-line unslop/import-control -- extension factory not available via src test-helpers import chain
import registerSuperGsd from '../../index.js';
import { updateTaskStatus } from '../index.js';
import { assertBranchHistory, assertSessionContains } from './assertions.js';
import type { AutoConfig, BranchEntry, ResponseDescriptor } from './descriptors.js';
import { extractTextContent, makeSlug, taskResultTextContent } from '../text-content.js';
import { FAUX_MODEL, FAUX_PROVIDER, FauxResponseQueue } from './faux-provider.js';
import { scanAndReact } from './reactions.js';
import type { ReactionRuntime } from './reactions.js';
import { TestUI } from './ui.js';

export class TestHarness {
  private constructor(
    private readonly session: AgentSession,
    private readonly sessionManager: SessionManager,
    private readonly ui: TestUI,
    private readonly fauxResponses: FauxResponseQueue,
  ) {
    this.cancelNextNav = false;
  }

  private cancelNextNav: boolean;

  // Reaction engine state — set by runAuto, consumed by waitForIdle
  private activeReactions: NonNullable<AutoConfig['reactions']> | null = null;
  private activeSeenIds: Set<string> | null = null;
  private activeRuntime: ReactionRuntime | null = null;

  // ── Task workflow methods (replicate push-task, start-task, etc.) ──

  async runPushTask(prompt_: string, inherit_context: boolean = false): Promise<void> {
    this.sessionManager.appendCustomEntry('task', { prompt: prompt_, inherit_context });
    this.refreshTaskStatus();
    this.ui.notify('Task stored. Use `/start-task` or `/auto` to start it.');
    await this.session.agent.waitForIdle();
  }

  async runStartTask(): Promise<void> {
    const pending = this.findPendingTask();
    if (!pending) {
      this.ui.notify('No pending task. Use push-task first.', 'warning');
      this.refreshTaskStatus();
      await this.session.agent.waitForIdle();
      return;
    }

    if (!pending.data.inherit_context) {
      const departureLeafId = this.sessionManager.getLeafId()!;
      const freshTargetId = this.findFreshTargetId();
      if (freshTargetId) {
        const result = await this.session.navigateTree(freshTargetId, { summarize: false });
        if (result.cancelled) return;
      }
      this.sessionManager.appendCustomEntry('task-start', { returnTo: departureLeafId });
    } else {
      this.sessionManager.appendCustomEntry('task-start', { returnTo: this.sessionManager.getLeafId()! });
    }

    // Inject the task prompt as a user message (bypassing the LLM)
    this.sessionManager.appendMessage(makeUserMessage(pending.data.prompt));

    this.refreshTaskStatus();
    await this.session.agent.waitForIdle();
  }

  async runFinishTask(): Promise<void> {
    const taskStart = this.findCurrentTask();
    if (!taskStart) {
      this.ui.notify('Not inside task, nothing to finish.', 'warning');
      this.refreshTaskStatus();
      await this.session.agent.waitForIdle();
      return;
    }

    const branch = this.sessionManager.getBranch();
    const lastAssistant = this.findLastAssistantMessage(branch);
    const lastAssistantContent = lastAssistant
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AgentMessage union needs narrowing; we know this is an assistant message
      ? taskResultTextContent((lastAssistant.message as any).content)
      : undefined;
    const taskPrompt = this.findTaskPrompt(branch);
    const slug = taskPrompt ? makeSlug(taskPrompt) : undefined;

    // Navigate back to the task start point
    await this.session.navigateTree(taskStart.data.returnTo, { summarize: false });

    // Inject the task result
    if (lastAssistantContent !== undefined) {
      this.sessionManager.appendCustomMessageEntry(
        'task-result',
        lastAssistantContent,
        true,
        { slug },
      );
    }

    // Mark any pending tasks as done (handles push-task during a task)
    if (this.findPendingTask()) {
      this.sessionManager.appendCustomEntry('task-done', {});
    }

    this.ui.notify('Task finished. Last response attached.', 'info');
    this.refreshTaskStatus();
    await this.session.agent.waitForIdle();
  }

  async runDiscardTask(): Promise<void> {
    const pending = this.findPendingTask();
    if (!pending) {
      this.ui.notify('No pending task to discard.', 'warning');
      this.refreshTaskStatus();
      await this.session.agent.waitForIdle();
      return;
    }

    this.sessionManager.appendCustomEntry('task-done', {});
    this.ui.notify('Task discarded.', 'info');
    this.refreshTaskStatus();
    await this.session.agent.waitForIdle();
  }

  async runAbortTask(): Promise<void> {
    const taskStart = this.findCurrentTask();
    if (!taskStart) {
      this.ui.notify('Not inside task, nothing to abort.', 'warning');
      this.refreshTaskStatus();
      await this.session.agent.waitForIdle();
      return;
    }

    await this.session.navigateTree(taskStart.data.returnTo, { summarize: false });
    this.ui.notify('Task aborted. Branch abandoned without summary.', 'info');
    this.refreshTaskStatus();
    await this.session.agent.waitForIdle();
  }

  // ── Private helpers ──

  private refreshTaskStatus(): void {
    updateTaskStatus(
      this.sessionManager as Parameters<typeof updateTaskStatus>[0],
      (key: string, value: string | undefined) => {
        if (key === 'task') this.ui.context.setStatus(key, value);
      },
      this.ui.theme,
    );
  }

  /** Find the most recent pending (not-started, not-done) task entry. */
  private findPendingTask(): { data: { prompt: string; inherit_context: boolean } } | null {
    const branch = this.sessionManager.getBranch();
    let skip = 0;
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry!.type === 'custom' && entry!.customType === 'task-start') return null;
      if (entry!.type === 'custom' && entry!.customType === 'task-done') {
        skip++;
        continue;
      }
      if (entry!.type === 'custom' && entry!.customType === 'task') {
        const data = entry!.data as { prompt: string; inherit_context: boolean } | undefined;
        if (data && typeof data.prompt === 'string' && typeof data.inherit_context === 'boolean') {
          if (skip === 0) return { data };
          skip--;
        }
      }
    }
    return null;
  }

  /** Find the most recent task-start entry (indicating a running task). */
  private findCurrentTask(): { data: { returnTo: string } } | null {
    const branch = this.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry!.type === 'custom' && entry!.customType === 'task-start') {
        const data = entry!.data as { returnTo: string } | undefined;
        if (data && typeof data.returnTo === 'string') return { data };
      }
    }
    return null;
  }

  /** Find the first model-visible entry's parent ID for fresh-context navigation. */
  private findFreshTargetId(): string | null {
    const branch = this.sessionManager.getBranch();
    if (branch.length === 0) return null;

    for (const entry of branch) {
      if (
        entry.type === 'message' ||
        entry.type === 'compaction' ||
        entry.type === 'branch_summary' ||
        entry.type === 'custom_message'
      ) {
        return entry.parentId ?? entry.id;
      }
    }

    return branch[0].parentId ?? branch[0].id;
  }

  /** Find the last assistant message on the current branch. */
  private findLastAssistantMessage(branch: readonly SessionEntry[]): SessionMessageEntry | null {
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i]!;
      if (entry.type === 'message' && entry.message?.role === 'assistant') {
        return entry;
      }
    }
    return null;
  }

  /** Find the task prompt (user message after the most recent task-start). */
  private findTaskPrompt(branch: readonly SessionEntry[]): string | undefined {
    const startIdx = this.findLastIndex(branch, (e) => e.type === 'custom' && e.customType === 'task-start');
    if (startIdx === -1) return undefined;
    for (let i = startIdx + 1; i < branch.length; i++) {
      const entry = branch[i];
      if (entry.type === 'message' && entry.message?.role === 'user') {
        return extractTextContent(entry.message.content, '') ?? undefined;
      }
    }
    return undefined;
  }

  private findLastIndex(branch: readonly SessionEntry[], predicate: (e: SessionEntry) => boolean): number {
    for (let i = branch.length - 1; i >= 0; i--) {
      if (predicate(branch[i])) return i;
    }
    return -1;
  }

  static async create(): Promise<TestHarness> {
    const cwd = process.cwd();
    const agentDir = getAgentDir();
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    const sessionManager = SessionManager.inMemory(cwd);
    const fauxResponses = new FauxResponseQueue();
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      extensionFactories: [
        (pi) => {
          pi.registerProvider(FAUX_PROVIDER, {
            api: FAUX_MODEL.api,
            baseUrl: FAUX_MODEL.baseUrl,
            apiKey: 'test-key',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline types don't match pi-ai ProviderConfig
            streamSimple: fauxResponses.stream as any,
            models: [{
              id: FAUX_MODEL.id,
              name: FAUX_MODEL.name,
              api: FAUX_MODEL.api,
              baseUrl: FAUX_MODEL.baseUrl,
              reasoning: FAUX_MODEL.reasoning,
              thinkingLevelMap: FAUX_MODEL.thinkingLevelMap,
              input: [...FAUX_MODEL.input],
              cost: FAUX_MODEL.cost,
              contextWindow: FAUX_MODEL.contextWindow,
              maxTokens: FAUX_MODEL.maxTokens,
            }],
          });
        },
        registerSuperGsd,
      ],
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd,
      agentDir,
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager,
      settingsManager,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline types don't match pi-ai Model<any>
      model: FAUX_MODEL as any,
      thinkingLevel: 'off' as const,
      noTools: 'builtin',
    });

    const ui = new TestUI();
    const harness = new TestHarness(session, sessionManager, ui, fauxResponses);
    await session.bindExtensions({
      uiContext: ui.context,
      commandContextActions: harness.commandContextActions(),
      shutdownHandler: () => {
        // No-op: we don't want extension shutdown to terminate the process.
      },
    });
    return harness;
  }

  dispose(): void {
    this.session.dispose();
  }

  getStatus(): string | undefined {
    return this.ui.getStatus();
  }

  assertBranchHistory(...expected: BranchEntry[]): void {
    assertBranchHistory(this.sessionManager, expected);
  }

  assertSessionContains(...expected: BranchEntry[]): void {
    assertSessionContains(this.sessionManager, expected);
  }

  assertNotifications(...expected: string[]): void {
    for (const text of expected) {
      assert.ok(this.ui.notifications().includes(text), `Expected notification log to include: ${text}`);
    }
  }

  assertTaskStatusHistoryIncludes(expected: string | undefined): void {
    assert.ok(
      this.ui.taskStatuses().includes(expected),
      `Expected task status history to include ${JSON.stringify(expected)}`,
    );
  }

  async waitForIdle(): Promise<void> {
    await this.session.agent.waitForIdle();
  }

  registeredToolNames(): string[] {
    return this.session.getAllTools().map(tool => tool.name).sort();
  }

  modelName(): string | undefined {
    const model = this.session.model;
    return model ? `${model.provider}/${model.id}` : undefined;
  }

  async prompt(text: string, ...responses: ResponseDescriptor[]): Promise<void> {
    this.fauxResponses.enqueue(...responses);
    await this.session.prompt(text, { expandPromptTemplates: false, source: 'test' as never });
    await this.session.agent.waitForIdle();
    this.assertNoQueuedResponses(`prompt(${JSON.stringify(text)})`);
  }

  async runAuto(config: AutoConfig): Promise<void> {
    const reactions = config.reactions ?? [];
    const seenIds = new Set<string>();

    this.activeReactions = reactions;
    this.activeSeenIds = seenIds;

    const runtime: ReactionRuntime = {
      appendUserMessage: (text: string) => {
         
         
        this.sessionManager.appendMessage({
          role: 'user',
          content: [{ type: 'text' as const, text }],
          api: FAUX_MODEL.api,
          provider: FAUX_PROVIDER,
          model: FAUX_MODEL.id,
          usage: FAUX_TEST_USAGE,
          stopReason: 'stop' as const,
          timestamp: Date.now(),
        } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      },
      appendAssistantMessage: (text: string, stopReason?: string) => {
         
        this.sessionManager.appendMessage({
          role: 'assistant',
          content: [{ type: 'text' as const, text }],
          api: FAUX_MODEL.api,
          provider: FAUX_PROVIDER,
          model: FAUX_MODEL.id,
          usage: FAUX_TEST_USAGE,
          stopReason: (stopReason ?? 'stop') as 'stop' | 'aborted' | 'toolUse' | 'length' | 'error',
          timestamp: Date.now(),
        } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      },
      appendTaskEntry: (prompt: string, inherit_context: boolean) => {
        this.sessionManager.appendCustomEntry('task', { prompt, inherit_context });
      },
      cancelNextNavigation: () => { this.cancelNextNav = true; },
      triggerShutdown: () => { this.triggerSessionShutdown().catch(() => {}); },
      runAutoAgain: () => {
        this.session.prompt('/auto', { expandPromptTemplates: true, source: 'test' as never }).catch(() => {});
      },
    };
    this.activeRuntime = runtime;

    try {
      await this.session.prompt('/auto', { expandPromptTemplates: true, source: 'test' as never });
    } finally {
      this.activeReactions = null;
      this.activeSeenIds = null;
      this.activeRuntime = null;
      this.cancelNextNav = false;
    }

    this.assertNoQueuedResponses('runAuto');
  }

  async triggerSessionShutdown(): Promise<void> {
    await this.session.extensionRunner.emit({
      type: 'session_shutdown',
      reason: 'quit',
    });
  }

  private assertNoQueuedResponses(label: string): void {
    const remaining = this.fauxResponses.remaining();
    assert.deepStrictEqual(remaining, [], `${label} left unused faux responses queued`);
  }

  private commandContextActions() {
    return {
      waitForIdle: async () => {
        // First wait for the agent to be idle so all pending operations
        // (user messages triggered by sendUserMessage, LLM calls, etc.)
        // have flushed to the session manager.
        await this.session.agent.waitForIdle();
        // Then run reactions on the settled session state.
        if (this.activeReactions && this.activeSeenIds && this.activeRuntime) {
          let reacted: boolean;
          do {
            reacted = scanAndReact(this.sessionManager, this.activeReactions, this.activeSeenIds, this.activeRuntime);
            await flushMicrotasks();
          } while (reacted);
        }
      },
      navigateTree: async (targetId: string, options?: Parameters<AgentSession['navigateTree']>[1]) => {
        if (this.cancelNextNav) {
          this.cancelNextNav = false;
          return { cancelled: true };
        }
        return this.session.navigateTree(targetId, options);
      },
      newSession: async () => ({ cancelled: false }),
      fork: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      reload: async () => {
        await this.session.reload();
      },
    };
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => queueMicrotask(resolve));
}

const FAUX_TEST_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function makeUserMessage(text: string) {
  return {
    role: 'user' as const,
    content: [{ type: 'text' as const, text }],
    api: FAUX_MODEL.api,
    provider: FAUX_PROVIDER,
    model: FAUX_MODEL.id,
    usage: FAUX_TEST_USAGE,
    stopReason: 'stop' as const,
    timestamp: Date.now(),
  };
}
