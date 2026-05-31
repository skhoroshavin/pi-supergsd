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
} from "@earendil-works/pi-coding-agent";

// eslint-disable-next-line unslop/import-control -- extension factory not available via src test-helpers import chain
import registerSuperGsd from "../../index.js";
import { updateTaskStatus } from "../index.js";
import { assertBranchHistory, assertSessionContains } from "./assertions.js";
import type { BranchEntry, ResponseDescriptor } from "./descriptors.js";
import { extractTextContent } from "../text-content.js";
import { FAUX_MODEL, FAUX_PROVIDER, FauxProvider } from "./faux-provider.js";
import { ReactionEngine } from "./reaction-engine.js";
import { TestUI } from "./ui.js";

export class TestHarness {
  private constructor(
    readonly engine: ReactionEngine,
    private readonly session: AgentSession,
    private readonly sessionManager: SessionManager,
    private readonly ui: TestUI,
  ) {
    this.cancelNextNav = false;
  }

  private cancelNextNav: boolean;
  private readonly seenReactionEntryIds = new Set<string>();

  async pushTask(prompt_: string, inherit_context = false): Promise<void> {
    this.sessionManager.appendCustomEntry("task", {
      prompt: prompt_,
      inherit_context,
    });
    updateTaskStatus(
      this.sessionManager as Parameters<typeof updateTaskStatus>[0],
      (key, value) => {
        if (key === "task") this.ui.setStatus(key, value);
      },
      this.ui.theme,
    );
    this.ui.notify(
      "Task stored. Use `/start-task` or `/auto` to start it.",
      "info",
    );
    await this.session.agent.waitForIdle();
  }

  static async create(engine: ReactionEngine): Promise<TestHarness> {
    const cwd = process.cwd();
    const agentDir = getAgentDir();
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    const sessionManager = SessionManager.inMemory(cwd);
    const fauxProvider = new FauxProvider(engine);
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline types don't match pi-ai ProviderConfig
            streamSimple: fauxProvider.stream as any,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline types don't match pi-ai Model<any>
      model: FAUX_MODEL as any,
      thinkingLevel: "off" as const,
      noTools: "builtin",
    });

    const ui = new TestUI();
    const harness = new TestHarness(engine, session, sessionManager, ui);
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
    const messages = this.ui.notifications().map((n) => n.message);
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
    assert.deepStrictEqual(this.ui.notifications(), expected);
  }

  assertTaskStatusHistoryIncludes(expected: string | undefined): void {
    assert.ok(
      this.ui.taskStatuses().includes(expected),
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

  modelName(): string | undefined {
    const model = this.session.model;
    return model ? `${model.provider}/${model.id}` : undefined;
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
          for (const reaction of this.engine.matchAssistant(text)) {
            await this.applyReaction(reaction);
            reacted = true;
          }
          continue;
        }

        if (entry.type === "custom" && entry.customType === "task") {
          const data = entry.data as
            | { prompt: string; inherit_context: boolean }
            | undefined;
          if (!data) continue;
          for (const reaction of this.engine.matchQueuedTask(
            data.prompt,
            data.inherit_context,
          )) {
            await this.applyReaction(reaction);
            reacted = true;
          }
        }
      }

      if (reacted) {
        await flushMicrotasks();
      }
    } while (reacted);
  }

  private async applyReaction(
    reaction:
      | ResponseDescriptor
      | import("./descriptors.js").ControlReactionDescriptor,
  ): Promise<void> {
    if (reaction.type === "user-esc") {
      this.cancelNextNav = true;
      return;
    }
    if (reaction.type === "user-ctrl-c") {
      await this.triggerSessionShutdown();
      return;
    }
    if (reaction.type === "user-runs-auto") {
      await this.command("/auto");
      return;
    }
    if (reaction.type === "user-append") {
      await this.prompt(reaction.text);
      return;
    }
    if (reaction.type === "response:text") {
      this.appendSyntheticAssistantMessage(reaction.text);
      return;
    }
    if (reaction.type === "response:thinking") {
      this.appendSyntheticAssistantMessage(reaction.text);
      return;
    }
    if (reaction.type === "response:aborted") {
      this.appendSyntheticAssistantMessage(reaction.text, "aborted");
      return;
    }
    this.appendSyntheticTask(reaction.prompt, reaction.inherit_context);
  }

  async prompt(text: string): Promise<void> {
    await this.sendPrompt(text, false);
  }

  async command(text: string): Promise<void> {
    await this.sendPrompt(text, true);
  }

  async triggerSessionShutdown(): Promise<void> {
    await this.session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "quit",
    });
  }

  private appendSyntheticAssistantMessage(
    text: string,
    stopReason: "stop" | "aborted" = "stop",
  ): void {
    this.sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text" as const, text }],
      api: FAUX_MODEL.api,
      provider: FAUX_PROVIDER,
      model: FAUX_MODEL.id,
      usage: FAUX_TEST_USAGE,
      stopReason,
      timestamp: Date.now(),
    } as never);
  }

  private appendSyntheticTask(prompt_: string, inherit_context: boolean): void {
    this.sessionManager.appendCustomEntry("task", {
      prompt: prompt_,
      inherit_context,
    });
  }

  private async sendPrompt(
    text: string,
    expandPromptTemplates: boolean,
  ): Promise<void> {
    const knownEntryIds = new Set(
      this.sessionManager.getEntries().map((entry) => entry.id),
    );
    await this.session.prompt(text, {
      expandPromptTemplates,
      source: "test" as InputSource,
    });
    await this.session.agent.waitForIdle();
    this.throwIfNewAssistantError(knownEntryIds);
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

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

const FAUX_TEST_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
