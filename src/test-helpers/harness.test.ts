import assert from "node:assert";

import { describe, it, type TestContext } from "node:test";

import {
  assistant,
  assistantAborted,
  pushTask,
  responds,
  task,
  thinks,
  user,
  userEsc,
  userPrompts,
  TestHarness,
} from "./index.js";

describe("AgentSession-backed TestHarness foundation", () => {
  it("creates a real session and registers push-task through the extension", async (t) => {
    const h = await makeHarness(t);
    assert.ok(h.registeredToolNames().includes("push-task"));
    h.assertLastNotification(undefined);
  });

  it("uses MockLLM prompt rules for h.prompt()", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt("main work", responds("working..."));

    await h.prompt("main work");
    h.assertSession(user("main work"), assistant("working..."));
  });

  it("slash-prefixed prompts go through the real slash pipeline", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt("/start-task", responds("literal slash prompt"));

    await h.prompt("/start-task");

    h.assertSession();
    h.assertLastNotification("No pending task. Use push-task first.");
  });

  it("supports thinking blocks", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt("think", thinks("checking context"));

    await h.prompt("think");
    h.assertSession(user("think"), assistant(""));
  });

  it("calls the real push-task tool from a faux provider tool call", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt("delegate work", pushTask("Subtask", "subtask"));

    await h.prompt("delegate work");
    h.assertSession(user("delegate work"), assistant("", "toolUse"), task("Subtask", "subtask"));
    h.assertStatus("pending task: Subtask");
    h.assertLastNotification("Task stored. Use `/start-task` or `/auto` to start it.");
  });

  it("fails when the faux provider receives an unmatched prompt", async (t) => {
    const h = await makeHarness(t);
    await assert.rejects(
      async () => h.prompt("unmatched prompt"),
      /No MockLLM rule matched provider prompt: unmatched prompt/,
    );
  });

  it("fails loudly when /start-task hits an unmatched provider prompt", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt("queue AAA", pushTask("Task AAA", "Task AAA"));

    await h.prompt("queue AAA");
    await assert.rejects(
      async () => h.prompt("/start-task"),
      /No MockLLM rule matched provider prompt: Task AAA/,
    );
  });

  it("treats empty prompt rules as exact matches", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt("", responds(""));

    await assert.rejects(
      async () => h.prompt("non-empty prompt"),
      /No MockLLM rule matched provider prompt: non-empty prompt/,
    );
  });

  it("builds one assistant turn from multiple prompt descriptors", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt(
      "Analyze X",
      responds("preparing subagent"),
      pushTask("Detailed X analysis", "Detailed X analysis"),
    );

    await h.prompt("Analyze X");
    h.assertSession(
      user("Analyze X"),
      assistant("preparing subagent", "toolUse"),
      task("Detailed X analysis", "Detailed X analysis"),
    );
    h.assertStatus("pending task: Detailed X analysis");
    h.assertLastNotification("Task stored. Use `/start-task` or `/auto` to start it.");
  });

  it("assertSessionContains still scans durable whole-session entries across branches", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA", "Task AAA"));
    h.llm.onPrompt("Task AAA", responds("Done."));

    await h.prompt("main work");
    await h.prompt("/start-task");

    h.assertSession(user("Task AAA"), assistant("Done."));
    h.assertStatus("current task: Task AAA");
    h.assertSessionContains(
      user("main work"),
      assistant("working...", "toolUse"),
      task("Task AAA", "Task AAA"),
    );
  });

  it("fires assistant and queued-task user actions once per new entry", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt("main work", responds("working..."));
    h.user.onAssistant("working...", userPrompts("queue follow-up"));
    h.llm.onPrompt("queue follow-up", pushTask("Follow-up", "follow-up"));
    h.user.onQueuedTask("follow-up", userPrompts("answer follow-up"));
    h.llm.onPrompt("answer follow-up", responds("queued response"));

    await h.prompt("main work");
    await h.waitForIdle();

    h.assertSession(
      user("main work"),
      assistant("working..."),
      user("queue follow-up"),
      assistant("", "toolUse"),
      task("Follow-up", "follow-up"),
      user("answer follow-up"),
      assistant("queued response"),
    );
    h.assertStatus("pending task: Follow-up");
  });
});

describe("userEsc assistant-only semantics", () => {
  it("replaces the assistant message with empty text and marks it aborted", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt("mixed text", thinks("hidden"), responds("ABCDEFGH"));
    h.user.onAssistant("CDEF", userEsc());

    await h.prompt("mixed text");

    h.assertSession(user("mixed text"), assistantAborted());
  });
});

if (false as boolean) {
  const h = {} as TestHarness;

  // @ts-expect-error MockLLM only accepts LLM descriptors.
  h.llm.onPrompt("bad", userPrompts("/auto"));

  // @ts-expect-error MockUser only accepts user actions.
  h.user.onAssistant("bad", responds("nope"));
}

async function makeHarness(t: TestContext): Promise<TestHarness> {
  const h = await TestHarness.create();
  t.after(() => {
    h.dispose();
  });
  return h;
}
