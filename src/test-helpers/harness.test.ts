import { describe, it } from "node:test";

import assert from "node:assert";

import {
  responds,
  user,
  assistant,
  aborts,
  thinks,
  pushTask,
  task,
  taskResult,
} from "./index.js";
import { TestHarness, ReactionEngine } from "./index.js";

describe("AgentSession-backed TestHarness foundation", () => {
  it("creates a real session and registers push-task through the extension", async () => {
    const engine = new ReactionEngine();
    const h = await TestHarness.create(engine);
    try {
      assert.ok(h.registeredToolNames().includes("push-task"));
      assert.strictEqual(h.getStatus(), undefined);
    } finally {
      h.dispose();
    }
  });

  it("records a user prompt and deterministic assistant response", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("main work", responds("working..."));
    const h = await TestHarness.create(engine);
    try {
      await h.prompt("main work");
      h.assertBranchHistory(user("main work"), assistant("working..."));
    } finally {
      h.dispose();
    }
  });

  it("treats slash-prefixed prompts literally by default", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("/start-task", responds("literal slash prompt"));
    const h = await TestHarness.create(engine);
    try {
      await h.prompt("/start-task");
      h.assertBranchHistory(
        user("/start-task"),
        assistant("literal slash prompt"),
      );
    } finally {
      h.dispose();
    }
  });

  it("supports thinking and aborted response descriptors", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("think", thinks("checking context"));
    engine.onPrompt("stop", aborts("Stopped by user."));
    const h = await TestHarness.create(engine);
    try {
      await h.prompt("think");
      h.assertBranchHistory(user("think"), assistant(""));

      await h.prompt("stop");
      h.assertSessionContains(
        user("stop"),
        assistant("Stopped by user.", "aborted"),
      );
    } finally {
      h.dispose();
    }
  });

  it("calls the real push-task tool from a faux provider tool call", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("delegate work", pushTask("subtask", true));
    const h = await TestHarness.create(engine);
    try {
      await h.prompt("delegate work");
      h.assertSessionContains(user("delegate work"), task("subtask", true));
      h.assertNotifications(
        "Task stored. Use `/start-task` or `/auto` to start it.",
      );
    } finally {
      h.dispose();
    }
  });

  it("runs /auto with a prompt reaction and attaches the branch result", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("main work", responds("working..."));
    engine.onPrompt(
      "Analyze performance.",
      responds("Found 3 bottlenecks: ..."),
    );
    engine.onPrompt("Found 3 bottlenecks: ...", responds(""));
    const h = await TestHarness.create(engine);
    try {
      await h.prompt("main work");
      await h.pushTask("Analyze performance.");
      await h.command("/auto");
      h.assertSessionContains(
        taskResult("analyze-performance", "Found 3 bottlenecks: ..."),
      );
    } finally {
      h.dispose();
    }
  });

  it("cancels navigation before sending a queued task prompt", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("main work", responds("working..."));
    engine.onQueuedTask("Cancel before navigation.", false, {
      type: "user-esc",
    });
    const h = await TestHarness.create(engine);
    try {
      await h.prompt("main work");
      await h.pushTask("Cancel before navigation.");
      await h.command("/auto");
      h.assertSessionContains(task("Cancel before navigation."));
    } finally {
      h.dispose();
    }
  });

  it("uses ReactionEngine prompt rules for h.prompt()", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("main work", responds("working..."));

    const h = await TestHarness.create(engine);
    try {
      await h.prompt("main work");
      h.assertBranchHistory(user("main work"), assistant("working..."));
    } finally {
      h.dispose();
    }
  });

  it("fails when the faux provider receives an unmatched prompt", async () => {
    const engine = new ReactionEngine();
    const h = await TestHarness.create(engine);
    try {
      await assert.rejects(
        async () => h.prompt("unmatched prompt"),
        /No reaction engine rule matched provider prompt: unmatched prompt/,
      );
    } finally {
      h.dispose();
    }
  });

  it("fails loudly when /start-task hits an unmatched provider prompt", async () => {
    const engine = new ReactionEngine();
    const h = await TestHarness.create(engine);
    try {
      await h.pushTask("Task AAA");
      await assert.rejects(
        async () => h.command("/start-task"),
        /No reaction engine rule matched provider prompt: Task AAA/,
      );
    } finally {
      h.dispose();
    }
  });

  it("treats empty prompt rules as exact matches", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("", responds(""));
    const h = await TestHarness.create(engine);
    try {
      await assert.rejects(
        async () => h.prompt("non-empty prompt"),
        /No reaction engine rule matched provider prompt: non-empty prompt/,
      );
    } finally {
      h.dispose();
    }
  });

  it("builds one assistant turn from multiple prompt descriptors", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt(
      "Analyze X",
      responds("preparing subagent"),
      pushTask("Detailed X analysis"),
    );

    const h = await TestHarness.create(engine);
    try {
      await h.prompt("Analyze X");
      h.assertSessionContains(
        user("Analyze X"),
        assistant("preparing subagent", "toolUse"),
        task("Detailed X analysis"),
      );
    } finally {
      h.dispose();
    }
  });

  it("records notification levels", async () => {
    const engine = new ReactionEngine();
    const h = await TestHarness.create(engine);
    try {
      await h.command("/start-task");
      h.assertNotificationEntries([
        { message: "No pending task. Use push-task first.", level: "warning" },
      ]);
    } finally {
      h.dispose();
    }
  });

  it("fires assistant and queued-task reactions once per new entry", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("main work", responds("working..."));
    engine.onAssistant("working...", pushTask("follow-up"));
    engine.onQueuedTask("follow-up", false, responds("queued response"));

    const h = await TestHarness.create(engine);
    try {
      await h.prompt("main work");
      await h.waitForIdle();
      await h.waitForIdle();

      h.assertSessionContains(
        user("main work"),
        assistant("working..."),
        task("follow-up"),
        assistant("queued response"),
      );
    } finally {
      h.dispose();
    }
  });

  it("uses assistant and queued-task rules during /auto", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("main work", responds("working..."));
    engine.onPrompt(
      "Analyze performance.",
      responds("Found 3 bottlenecks: ..."),
    );
    engine.onPrompt("Found 3 bottlenecks: ...", responds(""));

    const h = await TestHarness.create(engine);
    try {
      await h.prompt("main work");
      await h.pushTask("Analyze performance.");
      await h.command("/auto");
      h.assertSessionContains(
        taskResult("analyze-performance", "Found 3 bottlenecks: ..."),
      );
    } finally {
      h.dispose();
    }
  });

  it("processes a subtask pushed during a task", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("main work", responds("working..."));
    engine.onPrompt("", responds(""));
    engine.onPrompt(
      "parent task",
      responds("working on parent..."),
      pushTask("subtask"),
    );
    engine.onPrompt("subtask", responds("sub done"));
    engine.onPrompt("sub done", responds(""));
    engine.onPrompt("working on parent...", responds(""));

    const h = await TestHarness.create(engine);
    try {
      await h.prompt("main work");
      await h.pushTask("parent task");
      await h.command("/auto");

      h.assertSessionContains(
        user("subtask"),
        assistant("sub done"),
        taskResult("subtask", "sub done"),
      );
    } finally {
      h.dispose();
    }
  });
});
