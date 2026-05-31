import assert from "node:assert";

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type InputSource,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

// eslint-disable-next-line unslop/import-control -- extension factory not available via src test-helpers import chain
import registerSuperGsd from "../../index.js";
import { updateTaskStatus } from "../index.js";
import { extractTextContent } from "../text-content.js";
import { assertBranchHistory, assertSessionContains } from "./assertions.js";
import type { BranchEntry } from "./descriptors.js";
import { FAUX_MODEL, FAUX_PROVIDER, FauxProvider } from "./faux-provider.js";
import { MockLLM } from "./mock-llm.js";
import { MockUser, type MockUserAction } from "./mock-user.js";
import { TestUI } from "./ui.js";

export class TestHarness {
  private constructor(
    readonly llm: MockLLM,
    readonly user: MockUser,
    private readonly session: AgentSession,
    private readonly sessionManager: SessionManager,
    private readonly ui: TestUI,
    private readonly fauxProvider: FauxProvider,
  ) {}

  private cancelNextNav = false;
  private readonly seenReactionEntryIds = new Set<string>();

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
    const llm = new MockLLM();
    const user = new MockUser();
    const fauxProvider = new FauxProvider(llm);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      extensionFactories: [
        (pi) => {
          pi.registerProvider(FAUX_PROVIDER, {
            api: FAUX_MODEL.api,
            baseUrl: FAUX_MODEL.baseUrl,
            apiKey: "test-key",
            streamSimple: (model, context, options) =>
              fauxProvider.stream(model, context, options),
            models: [
              {
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
              },
            ],
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
      model: FAUX_MODEL,
      thinkingLevel: "off" as const,
      noTools: "builtin",
    });

    const harness = new TestHarness(
      llm,
      user,
      session,
      sessionManager,
      new TestUI(),
      fauxProvider,
    );
    await session.bindExtensions({
      uiContext: harness.ui.context,
      commandContextActions: harness.commandContextActions(),
      shutdownHandler: () => {
        // No-op: we don't want extension shutdown to terminate the process.
      },
    });
    return harness;
  }

  dispose(): void {
    this.fauxProvider.unregister();
    this.session.dispose();
  }

  getStatus(): string | undefined {
    return this.ui.status;
  }

  assertBranchHistory(...expected: BranchEntry[]): void {
    assertBranchHistory(this.sessionManager, expected);
  }

  assertSessionContains(...expected: BranchEntry[]): void {
    assertSessionContains(this.sessionManager, expected);
  }

  assertNotifications(...expected: string[]): void {
    const messages = this.ui.notificationLog.map((entry) => entry.message);
    for (const text of expected) {
      assert.ok(
        messages.includes(text),
        `Expected notification log to include: ${text}`,
      );
    }
  }

  assertNotificationEntries(
    expected: Array<{
      message: string;
      level: "error" | "warning" | "info" | undefined;
    }>,
  ): void {
    assert.deepStrictEqual(this.ui.notificationLog, expected);
  }

  assertTaskStatusHistoryIncludes(expected: string | undefined): void {
    assert.ok(
      this.ui.taskStatusHistory.includes(expected),
      `Expected task status history to include ${JSON.stringify(expected)}`,
    );
  }

  async waitForIdle(): Promise<void> {
    await this.scanAndReactLoop();
  }

  registeredToolNames(): string[] {
    return this.session
      .getAllTools()
      .map((tool) => tool.name)
      .sort();
  }

  private commandContextActions() {
    return {
      waitForIdle: async () => {
        await this.scanAndReactLoop();
      },
      navigateTree: async (
        targetId: string,
        options?: Parameters<AgentSession["navigateTree"]>[1],
      ) => {
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

  async prompt(text: string): Promise<void> {
    const knownEntryIds = new Set(
      this.sessionManager.getEntries().map((entry) => entry.id),
    );

    await this.session.prompt(text, {
      expandPromptTemplates: true,
      source: "test" as InputSource,
    });
    await this.session.agent.waitForIdle();
    this.throwIfNewAssistantError(knownEntryIds);
  }

  private async scanAndReactLoop(): Promise<void> {
    await flushMicrotasks();
    await this.session.agent.waitForIdle();

    let reacted: boolean;
    do {
      reacted = false;
      for (const entry of this.sessionManager.getBranch()) {
        if (this.seenReactionEntryIds.has(entry.id)) continue;
        this.seenReactionEntryIds.add(entry.id);

        if (entry.type === "message" && entry.message.role === "assistant") {
          const text = extractTextContent(entry.message.content, "") ?? "";
          for (const action of this.user.matchAssistant(text)) {
            await this.applyUserAction(action);
            reacted = true;
          }
          continue;
        }

        if (!isTaskEntryData(entry)) continue;
        for (const action of this.user.matchQueuedTask(entry.data.prompt)) {
          await this.applyUserAction(action);
          reacted = true;
        }
      }

      if (reacted) {
        await flushMicrotasks();
      }
    } while (reacted);
  }

  private async applyUserAction(action: MockUserAction): Promise<void> {
    switch (action.type) {
      case "user-esc":
        this.cancelNextNav = true;
        return;
      case "user-ctrl-c":
        await this.session.extensionRunner.emit({
          type: "session_shutdown",
          reason: "quit",
        });
        return;
      case "user-prompts":
        await this.prompt(action.text);
        return;
    }
  }

  private throwIfNewAssistantError(knownEntryIds: ReadonlySet<string>): void {
    const assistantError = this.sessionManager.getEntries().find((entry) => {
      if (knownEntryIds.has(entry.id)) return false;
      return (
        entry.type === "message" &&
        entry.message.role === "assistant" &&
        entry.message.stopReason === "error"
      );
    });

    if (
      assistantError?.type === "message" &&
      assistantError.message.role === "assistant"
    ) {
      throw new Error(
        assistantError.message.errorMessage ?? "Assistant turn failed.",
      );
    }
  }
}

function isTaskEntryData(entry: SessionEntry): entry is SessionEntry & {
  type: "custom";
  customType: "task";
  data: { prompt: string; inherit_context: boolean };
} {
  return (
    entry.type === "custom" &&
    entry.customType === "task" &&
    isRecord(entry.data) &&
    typeof entry.data.prompt === "string" &&
    typeof entry.data.inherit_context === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}
