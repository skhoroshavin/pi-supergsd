import { describe, it } from "node:test";

import {
  assistant,
  assistantAborted,
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
  it("always starts queued tasks from fresh context", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds("working..."), pushTask("Quick fix", "Quick fix."));

    h.llm.onPrompt("Quick fix.", responds("Fixed the bug."));
    h.llm.onPrompt("Fixed the bug.", responds(""));
    h.llm.onPrompt("working...", responds(""));

    try {
      await h.prompt("main work");
      await h.prompt("/auto");

      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Quick fix", "Quick fix."),
        taskResult("Quick fix", "Fixed the bug."),
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
    h.llm.onPrompt("start", responds(""), pushTask("First task", "first task"));

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
        task("First task", "first task"),
        taskResult("First task", "done"),
        assistant(""),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });

  it("stops when the last assistant message is aborted to empty text", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("start", responds(""), pushTask("Implement phase 1", "Implement phase 1."));

    h.llm.onPrompt("Implement phase 1.", responds("ABCDEFGHIJ"));
    h.user.onAssistant("FGHI", userEsc());

    try {
      await h.prompt("start");

      await h.prompt("/auto");

      h.assertSession(user("Implement phase 1."), assistantAborted());
      h.assertStatus("current task: Implement phase 1");
    } finally {
      h.dispose();
    }
  });

  it("processes a subtask pushed during a task", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds("working..."), pushTask("Parent task", "parent task"));

    // Task-execution
    h.llm.onPrompt("parent task", responds("working on parent..."), pushTask("Subtask", "subtask"));
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
        task("Parent task", "parent task"),
        taskResult("Parent task"),
        assistant(""),
      );
      h.assertStatus();
      h.assertSessionContains(
        user("subtask"),
        assistant("sub done"),
        taskResult("Subtask", "sub done"),
      );
    } finally {
      h.dispose();
    }
  });

  it("continues processing when user queues a steering message during auto", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("start", responds(""), pushTask("Quick fix", "Quick fix."));

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
        task("Quick fix", "Quick fix."),
        taskResult("Quick fix", "adjusted response"),
        assistant(""),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });

  it("stops when session is shut down during auto", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("start", responds(""), pushTask("Shutdown task", "Shutdown task"));

    // Task-execution
    h.llm.onPrompt("Shutdown task", responds("working..."));

    // Leaf continuation (auto re-prompts after detecting Ctrl+C, but task is left open)
    h.llm.onPrompt("", responds(""));

    h.user.onAssistant("working...", userCtrlC());
    try {
      await h.prompt("start");

      await h.prompt("/auto");

      h.assertSession(user("Shutdown task"), assistant("working..."));
      h.assertStatus("current task: Shutdown task");
    } finally {
      h.dispose();
    }
  });
});
