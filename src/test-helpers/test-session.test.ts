import assert from "node:assert";

import { describe, it } from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import {
  TestSession,
  assistant,
  assumeCommandContext,
  notification,
  task,
  user,
} from "./index.js";

describe("TestSession", () => {
  it("places a notification immediately after its visible anchor", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, "main work");
    sm.appendCustomEntry("task", {
      prompt: "Task AAA",
      inherit_context: false,
    });
    session.context.notify(
      "Task stored. Use `/start-task` or `/auto` to start it.",
    );

    assert.deepStrictEqual(session.entries(), [
      user("main work"),
      task("Task AAA"),
      notification("Task stored. Use `/start-task` or `/auto` to start it."),
    ]);
  });

  it("keeps notifications anchored to hidden entries in the right visible slot", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, "Task AAA");
    appendAssistant(sm, "Done.");
    sm.appendCustomEntry("task-done", {});
    session.context.notify("Task finished. Last response attached.");
    appendAssistant(sm, "Great!");

    assert.deepStrictEqual(session.entries(), [
      user("Task AAA"),
      assistant("Done."),
      notification("Task finished. Last response attached."),
      assistant("Great!"),
    ]);
  });

  it("preserves emission order for multiple notifications on one anchor", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, "main work");
    session.context.notify("first");
    session.context.notify("second");

    assert.deepStrictEqual(session.entries(), [
      user("main work"),
      notification("first"),
      notification("second"),
    ]);
  });

  it("omits notifications anchored to entries outside the current branch", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    const rootId = appendUser(sm, "main work");
    appendAssistant(sm, "branch A");
    session.context.notify("branch A note");

    sm.branch(rootId);
    appendAssistant(sm, "branch B");

    assert.deepStrictEqual(session.entries(), [
      user("main work"),
      assistant("branch B"),
    ]);
  });

  it("prepends null-anchor notifications before branch content", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    session.context.notify("bootstrap");
    appendUser(sm, "main work");

    assert.deepStrictEqual(session.entries(), [
      notification("bootstrap"),
      user("main work"),
    ]);
  });

  it("accepts notification levels without exposing them in visible assertions", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, "main work");
    session.context.notify("warn once", "warning");

    assert.deepStrictEqual(session.entries(), [
      user("main work"),
      notification("warn once"),
    ]);
  });

  it("keeps assumeCommandContext available from the new module", () => {
    const value = {
      hasUI: true,
      navigateTree: async () => ({ cancelled: false }),
    };
    assert.strictEqual(assumeCommandContext(value), value);
  });
});

function appendUser(sm: SessionManager, value: string): string {
  return sm.appendMessage({
    role: "user",
    content: text(value),
    timestamp: 0,
  });
}

function appendAssistant(
  sm: SessionManager,
  value: string,
  stopReason: "stop" | "toolUse" | "aborted" = "stop",
): string {
  return sm.appendMessage({
    role: "assistant",
    content: text(value),
    stopReason,
    timestamp: 0,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
}

const text = (value: string) => [{ type: "text" as const, text: value }];
