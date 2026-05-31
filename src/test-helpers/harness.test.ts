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
} from "./index.js";
import { ReactionEngine, TestHarness } from "./index.js";

describe("AgentSession-backed TestHarness foundation", () => {
  it("creates a real session and registers push-task through the extension", async (t) => {
    const h = await makeHarness(t);
    assert.ok(h.registeredToolNames().includes("push-task"));
    assert.strictEqual(h.getStatus(), undefined);
  });

  it("uses ReactionEngine prompt rules for h.prompt()", async (t) => {
    const engine = new ReactionEngine();
    engine.onPrompt("main work", responds("working..."));

    const h = await makeHarness(t, engine);
    await h.prompt("main work");
    h.assertBranchHistory(user("main work"), assistant("working..."));
  });

  it("treats slash-prefixed prompts literally by default", async (t) => {
    const engine = new ReactionEngine();
    engine.onPrompt("/start-task", responds("literal slash prompt"));

    const h = await makeHarness(t, engine);
    await h.prompt("/start-task");
    h.assertBranchHistory(
      user("/start-task"),
      assistant("literal slash prompt"),
    );
  });

  it("supports thinking and aborted response descriptors", async (t) => {
    const engine = new ReactionEngine();
    engine.onPrompt("think", thinks("checking context"));
    engine.onPrompt("stop", aborts("Stopped by user."));

    const h = await makeHarness(t, engine);
    await h.prompt("think");
    h.assertBranchHistory(user("think"), assistant(""));

    await h.prompt("stop");
    h.assertSessionContains(
      user("stop"),
      assistant("Stopped by user.", "aborted"),
    );
  });

  it("calls the real push-task tool from a faux provider tool call", async (t) => {
    const engine = new ReactionEngine();
    engine.onPrompt("delegate work", pushTask("subtask", true));

    const h = await makeHarness(t, engine);
    await h.prompt("delegate work");
    h.assertSessionContains(user("delegate work"), task("subtask", true));
    h.assertNotifications(
      "Task stored. Use `/start-task` or `/auto` to start it.",
    );
  });

  it("fails when the faux provider receives an unmatched prompt", async (t) => {
    const h = await makeHarness(t, new ReactionEngine());
    await assert.rejects(
      async () => h.prompt("unmatched prompt"),
      /No reaction engine rule matched provider prompt: unmatched prompt/,
    );
  });

  it("fails loudly when /start-task hits an unmatched provider prompt", async (t) => {
    const h = await makeHarness(t, new ReactionEngine());
    await h.pushTask("Task AAA");
    await assert.rejects(
      async () => h.command("/start-task"),
      /No reaction engine rule matched provider prompt: Task AAA/,
    );
  });

  it("treats empty prompt rules as exact matches", async (t) => {
    const engine = new ReactionEngine();
    engine.onPrompt("", responds(""));

    const h = await makeHarness(t, engine);
    await assert.rejects(
      async () => h.prompt("non-empty prompt"),
      /No reaction engine rule matched provider prompt: non-empty prompt/,
    );
  });

  it("builds one assistant turn from multiple prompt descriptors", async (t) => {
    const engine = new ReactionEngine();
    engine.onPrompt(
      "Analyze X",
      responds("preparing subagent"),
      pushTask("Detailed X analysis"),
    );

    const h = await makeHarness(t, engine);
    await h.prompt("Analyze X");
    h.assertSessionContains(
      user("Analyze X"),
      assistant("preparing subagent", "toolUse"),
      task("Detailed X analysis"),
    );
  });

  it("records notification levels", async (t) => {
    const h = await makeHarness(t, new ReactionEngine());
    await h.command("/start-task");
    h.assertNotificationEntries([
      { message: "No pending task. Use push-task first.", level: "warning" },
    ]);
  });

  it("fires assistant and queued-task reactions once per new entry", async (t) => {
    const engine = new ReactionEngine();
    engine.onPrompt("main work", responds("working..."));
    engine.onAssistant("working...", pushTask("follow-up"));
    engine.onQueuedTask("follow-up", false, responds("queued response"));

    const h = await makeHarness(t, engine);
    await h.prompt("main work");
    await h.waitForIdle();
    await h.waitForIdle();

    h.assertSessionContains(
      user("main work"),
      assistant("working..."),
      task("follow-up"),
      assistant("queued response"),
    );
  });
});

async function makeHarness(
  t: TestContext,
  engine = new ReactionEngine(),
): Promise<TestHarness> {
  const h = await TestHarness.create(engine);
  t.after(() => {
    h.dispose();
  });
  return h;
}
