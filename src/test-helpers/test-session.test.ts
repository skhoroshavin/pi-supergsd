import assert from "node:assert";

import { describe, it } from "node:test";

import { SessionManager, Theme } from "@earendil-works/pi-coding-agent";

import { TestSession, assistant, assumeCommandContext, notification, task, user } from "./index.js";

describe("TestSession", () => {
  it("shows a notification when it is the last log event", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, "main work");
    sm.appendCustomEntry("task", {
      prompt: "Task AAA",
      inherit_context: false,
    });
    session.context.notify("Task stored. Use `/start-task` or `/auto` to start it.");

    assert.deepStrictEqual(session.entries(), [
      user("main work"),
      task("Task AAA"),
      notification("Task stored. Use `/start-task` or `/auto` to start it."),
    ]);
  });

  it("hides a notification after a later visible entry is appended", () => {
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
      assistant("Great!"),
    ]);
  });

  it("keeps only the last notification for one anchor", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, "main work");
    session.context.notify("first");
    session.context.notify("second");

    assert.deepStrictEqual(session.entries(), [user("main work"), notification("second")]);
  });

  it("omits notifications anchored to entries outside the current branch", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    const rootId = appendUser(sm, "main work");
    appendAssistant(sm, "branch A");
    session.context.notify("branch A note");

    sm.branch(rootId);
    appendAssistant(sm, "branch B");

    assert.deepStrictEqual(session.entries(), [user("main work"), assistant("branch B")]);
  });

  it("accepts notification levels without exposing them in visible assertions", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, "main work");
    session.context.notify("warn once", "warning");

    assert.deepStrictEqual(session.entries(), [user("main work"), notification("warn once")]);
  });

  it("stores plain notification text when given themed output", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, "main work");
    session.context.notify(session.context.theme.fg("warning", "warn once"), "warning");

    assert.deepStrictEqual(session.entries(), [user("main work"), notification("warn once")]);
  });

  it("stores plain task status text when given themed output", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    session.context.setStatus("task", session.context.theme.fg("dim", "pending task: task-aaa"));

    assert.strictEqual(session.status, "pending task: task-aaa");
    assert.deepStrictEqual(session.taskStatusHistory, ["pending task: task-aaa"]);
  });

  it("exposes a real Theme on the UI context", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    assert.ok(session.context.theme instanceof Theme);
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
