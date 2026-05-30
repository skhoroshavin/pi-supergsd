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
} from '@earendil-works/pi-coding-agent';

// eslint-disable-next-line unslop/import-control -- extension factory not available via src test-helpers import chain
import registerSuperGsd from '../../index.js';
import { assertBranchHistory, assertSessionContains } from './assertions.js';
import type { BranchEntry } from './descriptors.js';
import { TestUI } from './ui.js';

export class TestHarness {
  private constructor(
    private readonly session: AgentSession,
    private readonly sessionManager: SessionManager,
    private readonly ui: TestUI,
  ) {}

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
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      extensionFactories: [registerSuperGsd],
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
      noTools: 'builtin',
    });

    const ui = new TestUI();
    const harness = new TestHarness(session, sessionManager, ui);
    await session.bindExtensions({
      uiContext: ui.context,
      commandContextActions: harness.commandContextActions(),
      shutdownHandler: () => {},
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

  private commandContextActions() {
    return {
      waitForIdle: async () => {
        await this.session.agent.waitForIdle();
      },
      navigateTree: async (targetId: string, options?: Parameters<AgentSession['navigateTree']>[1]) => {
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
