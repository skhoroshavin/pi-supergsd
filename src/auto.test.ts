import { describe, it } from "node:test";

import {
  assistant,
  responds,
  pushTask,
  task,
  taskResult,
  user,
  userCtrlC,
  userEsc,
  userPrompts,
  TestHarness,
} from "./test-helpers/index.js";

describe("automated workflow", () => {
  it("completes push-task -> /auto -> finish-task and injects the branch result", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds("working on main..."), pushTask("Analyze performance."));

    // Task-execution
    h.llm.onPrompt("Analyze performance.", responds("Found 3 bottlenecks: ..."));
    h.llm.onPrompt("Found 3 bottlenecks: ...", responds(""));

    // Leaf continuation
    h.llm.onPrompt("working on main...", responds(""));

    try {
      await h.prompt("main work");

      await h.prompt("/auto");

      h.assertSession(
        user("main work"),
        assistant("working on main...", "toolUse"),
        task("Analyze performance."),
        taskResult("analyze-performance", "Found 3 bottlenecks: ..."),
        assistant(""),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });

  it("returns the branch result to the original leaf for branch-context tasks", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds("working..."), pushTask("Quick fix.", true));

    // Task-execution
    h.llm.onPrompt("Quick fix.", responds("Fixed the bug."));
    h.llm.onPrompt("Fixed the bug.", responds(""));

    // Leaf continuation
    h.llm.onPrompt("working...", responds(""));

    try {
      await h.prompt("main work");

      await h.prompt("/auto");

      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Quick fix.", true),
        taskResult("quick-fix", "Fixed the bug."),
        assistant(""),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });

  it("notifies and exits when started with no pending tasks", async () => {
    const h = await TestHarness.create();
    try {
      await h.prompt("/auto");
      h.assertSession();
      h.assertLastNotification("No pending tasks to run.");
    } finally {
      h.dispose();
    }
  });

  it("warns and returns when /auto is already running", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("start", responds(""), pushTask("first task"));

    // Task-execution
    h.llm.onPrompt("first task", responds("done"));
    h.llm.onPrompt("done", responds(""));

    h.user.onAssistant("done", userPrompts("/auto"));
    try {
      await h.prompt("start");

      await h.prompt("/auto");

      h.assertSession(
        user("start"),
        assistant("", "toolUse"),
        task("first task"),
        taskResult("first-task", "done"),
        assistant(""),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });

  it("stops when the last assistant message is rewritten to aborted half-text", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("start", responds(""), pushTask("Implement phase 1.", true));

    h.llm.onPrompt("Implement phase 1.", responds("ABCDEFGHIJ"));
    h.user.onAssistant("FGHI", userEsc());

    try {
      await h.prompt("start");

      await h.prompt("/auto");

      h.assertSession(
        user("start"),
        assistant("", "toolUse"),
        task("Implement phase 1.", true),
        user("Implement phase 1."),
        assistant("ABCDE", "aborted"),
      );
      h.assertStatus("current task: implement-phase-1");
    } finally {
      h.dispose();
    }
  });

  it("processes a subtask pushed during a task", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds("working..."), pushTask("parent task"));

    // Task-execution
    h.llm.onPrompt("parent task", responds("working on parent..."), pushTask("subtask"));
    h.llm.onPrompt("subtask", responds("sub done"));

    // Leaf continuations
    h.llm.onPrompt("sub done", responds(""));
    h.llm.onPrompt("", responds(""));
    h.llm.onPrompt("working on parent...", responds(""));

    try {
      await h.prompt("main work");

      await h.prompt("/auto");

      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("parent task"),
        taskResult("parent-task"),
        assistant(""),
      );
      h.assertStatus();
      h.assertSessionContains(
        user("subtask"),
        assistant("sub done"),
        taskResult("subtask", "sub done"),
      );
    } finally {
      h.dispose();
    }
  });

  it("continues processing when user queues a steering message during auto", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("start", responds(""), pushTask("Quick fix.", true));

    // Task-execution
    h.llm.onPrompt("Quick fix.", responds("thinking..."));
    h.llm.onPrompt("steer it", responds("adjusted response"));

    // Leaf continuations
    h.llm.onPrompt("adjusted response", responds(""));
    h.llm.onPrompt("", responds(""));

    h.user.onAssistant("thinking...", userPrompts("steer it"));
    try {
      await h.prompt("start");

      await h.prompt("/auto");

      h.assertSession(
        user("start"),
        assistant("", "toolUse"),
        task("Quick fix.", true),
        taskResult("quick-fix", "adjusted response"),
        assistant(""),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });

  it("stops when session is shut down during auto", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("start", responds(""), pushTask("Shutdown task", true));

    // Task-execution
    h.llm.onPrompt("Shutdown task", responds("working..."));

    // Leaf continuation (auto re-prompts after detecting Ctrl+C, but task is left open)
    h.llm.onPrompt("", responds(""));

    h.user.onAssistant("working...", userCtrlC());
    try {
      await h.prompt("start");

      await h.prompt("/auto");

      h.assertSession(
        user("start"),
        assistant("", "toolUse"),
        task("Shutdown task", true),
        user("Shutdown task"),
        assistant("working..."),
      );
      h.assertStatus("current task: shutdown-task");
    } finally {
      h.dispose();
    }
  });
});
