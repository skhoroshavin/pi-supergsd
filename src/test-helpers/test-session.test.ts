import assert from "node:assert";

import { describe, it } from "node:test";

import { SessionManager, Theme } from "@earendil-works/pi-coding-agent";

import { TestSession, assistant, assumeCommandContext, task, user } from "./index.js";

describe("TestSession", () => {
  it("projects durable session entries without status", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, "main work");
    sm.appendCustomEntry("task", {
      prompt: "Task AAA",
      inherit_context: false,
    });
    session.context.setStatus("task", "pending task: task-aaa");
    appendAssistant(sm, "queued");

    assert.deepStrictEqual(session.entries(), [
      user("main work"),
      task("Task AAA"),
      assistant("queued"),
    ]);
    assert.strictEqual(session.lastStatus, "pending task: task-aaa");
  });

  it("tracks lastStatus when task status clears", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, "Task AAA");
    session.context.setStatus("task", "current task: task-aaa");
    appendAssistant(sm, "Done.");
    session.context.setStatus("task", undefined);

    assert.deepStrictEqual(session.entries(), [user("Task AAA"), assistant("Done.")]);
    assert.strictEqual(session.lastStatus, undefined);
  });

  it("ignores non-task status keys", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, "main work");
    session.context.setStatus("other", "ignored");
    session.context.setStatus("task", "pending task: task-aaa");

    assert.deepStrictEqual(session.entries(), [user("main work")]);
    assert.strictEqual(session.lastStatus, "pending task: task-aaa");
  });

  it("normalizes ANSI styling in stored task statuses and notifications", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    session.context.setStatus("task", session.context.theme.fg("dim", "pending task: task-aaa"));
    session.context.notify(session.context.theme.fg("warning", "warn once"), "warning");

    assert.deepStrictEqual(session.entries(), []);
    assert.strictEqual(session.lastStatus, "pending task: task-aaa");
    assert.strictEqual(session.lastNotification, "warn once");
  });

  it("keeps notifications out of visible session assertions", () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, "main work");
    session.context.notify("Task stored. Use `/start-task` or `/auto` to start it.");

    assert.deepStrictEqual(session.entries(), [user("main work")]);
    assert.strictEqual(
      session.lastNotification,
      "Task stored. Use `/start-task` or `/auto` to start it.",
    );
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
