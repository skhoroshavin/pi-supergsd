import assert from "node:assert";

import { describe, it, type TestContext } from "node:test";

import {
  aborts,
  assistant,
  pushTask,
  responds,
  task,
  thinks,
  user,
  userCtrlC,
  userEsc,
  userPrompts,
  TestHarness,
} from "./index.js";

describe("AgentSession-backed TestHarness foundation", () => {
  it("creates a real session and registers push-task through the extension", async (t) => {
    const h = await makeHarness(t);
    assert.ok(h.registeredToolNames().includes("push-task"));
    assert.strictEqual(h.getStatus(), undefined);
  });

  it("uses MockLLM prompt rules for h.prompt()", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt("main work", responds("working..."));

    await h.prompt("main work");
    h.assertBranchHistory(user("main work"), assistant("working..."));
  });

  it("slash-prefixed prompts go through the real slash pipeline", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt("/start-task", responds("literal slash prompt"));

    await h.prompt("/start-task");

    h.assertNotificationEntries([
      { message: "No pending task. Use push-task first.", level: "warning" },
    ]);
  });

  it("supports thinking and aborted response descriptors", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt("think", thinks("checking context"));
    h.llm.onPrompt("stop", aborts("Stopped by user."));

    await h.prompt("think");
    h.assertBranchHistory(user("think"), assistant(""));

    await h.prompt("stop");
    h.assertSessionContains(
      user("stop"),
      assistant("Stopped by user.", "aborted"),
    );
  });

  it("calls the real push-task tool from a faux provider tool call", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt("delegate work", pushTask("subtask", true));

    await h.prompt("delegate work");
    h.assertSessionContains(user("delegate work"), task("subtask", true));
    h.assertNotifications(
      "Task stored. Use `/start-task` or `/auto` to start it.",
    );
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
    h.llm.onPrompt("queue AAA", pushTask("Task AAA"));

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
      pushTask("Detailed X analysis"),
    );

    await h.prompt("Analyze X");
    h.assertSessionContains(
      user("Analyze X"),
      assistant("preparing subagent", "toolUse"),
      task("Detailed X analysis"),
    );
  });

  it("records notification levels", async (t) => {
    const h = await makeHarness(t);
    await h.prompt("/start-task");
    h.assertNotificationEntries([
      { message: "No pending task. Use push-task first.", level: "warning" },
    ]);
  });

  it("fires assistant and queued-task user actions once per new entry", async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt("main work", responds("working..."));
    h.user.onAssistant("working...", userPrompts("queue follow-up"));
    h.llm.onPrompt("queue follow-up", pushTask("follow-up"));
    h.user.onQueuedTask("follow-up", userPrompts("answer follow-up"));
    h.llm.onPrompt("answer follow-up", responds("queued response"));

    await h.prompt("main work");
    await h.waitForIdle();
    await h.waitForIdle();

    h.assertSessionContains(
      user("main work"),
      assistant("working..."),
      user("queue follow-up"),
      assistant("", "toolUse"),
      task("follow-up"),
      user("answer follow-up"),
      assistant("queued response"),
    );
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
