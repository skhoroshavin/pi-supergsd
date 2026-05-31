import assert from "node:assert";

import { describe, it } from "node:test";

import { SessionManager, type Theme } from "@earendil-works/pi-coding-agent";

import { cmdAuto } from "./index.js";

import {
  aborts,
  assistant,
  assumeCommandContext,
  responds,
  pushTask,
  task,
  taskResult,
  user,
  userCtrlC,
  userRunsAuto,
  TestHarness,
  ReactionEngine,
} from "./test-helpers/index.js";

describe("automated workflow", () => {
  it("completes push-task -> /auto -> finish-task and injects the branch result", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("main work", responds("working on main..."));
    engine.onPrompt(
      "Analyze performance.",
      responds("Found 3 bottlenecks: ..."),
    );
    engine.onPrompt("Found 3 bottlenecks: ...", responds(""));
    const h = await TestHarness.create(engine);
    try {
      await h.prompt("main work");
      await h.pushTask("Analyze performance.");
      assert.strictEqual(h.getStatus(), "pending task: analyze-performance");

      await h.command("/auto");

      h.assertTaskStatusHistoryIncludes(
        "[auto] pending task: analyze-performance",
      );
      h.assertSessionContains(
        user("main work"),
        assistant("working on main..."),
        task("Analyze performance."),
        taskResult("analyze-performance", "Found 3 bottlenecks: ..."),
      );
      h.assertNotifications("Task finished. Last response attached.");
      assert.strictEqual(h.getStatus(), undefined);
    } finally {
      h.dispose();
    }
  });

  it("returns the branch result to the original leaf for branch-context tasks", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("main work", responds("working..."));
    engine.onPrompt("Quick fix.", responds("Fixed the bug."));
    engine.onPrompt("Fixed the bug.", responds(""));
    engine.onPrompt("working...", responds(""));
    const h = await TestHarness.create(engine);
    try {
      await h.prompt("main work");
      await h.pushTask("Quick fix.", true);
      assert.strictEqual(h.getStatus(), "pending task: quick-fix");

      await h.command("/auto");

      h.assertSessionContains(
        user("main work"),
        assistant("working..."),
        task("Quick fix.", true),
        taskResult("quick-fix", "Fixed the bug."),
      );
      h.assertNotifications("Task finished. Last response attached.");
    } finally {
      h.dispose();
    }
  });

  it("stops when navigation is cancelled and does not mark the task done", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("main work", responds(""));
    engine.onQueuedTask("Analyze performance.", false, { type: "user-esc" });
    const h = await TestHarness.create(engine);
    try {
      await h.prompt("main work");
      await h.pushTask("Analyze performance.");

      await h.command("/auto");

      h.assertSessionContains(
        user("main work"),
        assistant(""),
        task("Analyze performance."),
      );
    } finally {
      h.dispose();
    }
  });

  it("notifies and exits when started with no pending tasks", async () => {
    const engine = new ReactionEngine();
    const h = await TestHarness.create(engine);
    try {
      await h.command("/auto");
      h.assertNotifications("No pending tasks to run.");
    } finally {
      h.dispose();
    }
  });

  it("still enters the auto loop after a prior session shutdown event", async () => {
    const sm = SessionManager.inMemory();
    sm.appendThinkingLevelChange("off");

    const idleWaiters: Array<() => void> = [];
    const sessionShutdownHandlers: Array<() => unknown> = [];
    const notifications: string[] = [];

    const pi = {
      appendEntry() {},
      sendUserMessage() {},
      sendMessage() {},
      on(eventName: string, handler: () => unknown) {
        if (eventName === "session_shutdown")
          sessionShutdownHandlers.push(handler);
      },
    } satisfies Parameters<typeof cmdAuto>[0];

    const ctx = assumeCommandContext({
      hasUI: true,
      waitForIdle: async () => {
        await new Promise<void>((resolve) => {
          idleWaiters.push(resolve);
        });
      },
      hasPendingMessages: () => false,
      sessionManager: sm,
      ui: {
        notify(message: string) {
          notifications.push(message);
        },
        setStatus() {},
        theme: {
          fg: (_key: string, text: string) => text,
          bg: (_key: string, text: string) => text,
          bold: (text: string) => text,
        } satisfies Pick<Theme, "fg" | "bg" | "bold">,
      },
      navigateTree: async () => ({ cancelled: false }),
    });

    const auto = cmdAuto(pi);
    for (const handler of sessionShutdownHandlers) {
      await handler();
    }

    let settled = false;
    const autoPromise = auto.handler("", ctx).finally(() => {
      settled = true;
    });

    await Promise.resolve();

    assert.strictEqual(idleWaiters.length, 1);
    assert.strictEqual(settled, false);

    const waiter = idleWaiters.shift();
    assert.ok(waiter);
    waiter();

    await autoPromise;
    assert.deepStrictEqual(notifications, ["No pending tasks to run."]);
  });

  it("warns and returns when /auto is already running", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("start", responds(""));
    engine.onPrompt("first task", responds("done"));
    engine.onPrompt("done", responds(""));
    engine.onAssistant("done", userRunsAuto());
    const h = await TestHarness.create(engine);
    try {
      await h.prompt("start");
      await h.pushTask("first task");

      await h.command("/auto");

      h.assertNotifications("Auto is already running.");
      h.assertSessionContains(
        user("start"),
        assistant(""),
        task("first task"),
        taskResult("first-task", "done"),
      );
      assert.strictEqual(h.getStatus(), undefined);
    } finally {
      h.dispose();
    }
  });

  it("stops when the last assistant message was aborted", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("start", responds(""));
    engine.onPrompt("", responds(""));
    engine.onPrompt("Implement phase 1.", aborts("Stopped by user."));
    const h = await TestHarness.create(engine);
    try {
      await h.prompt("start");
      await h.pushTask("Implement phase 1.", true);

      await h.command("/auto");

      h.assertSessionContains(
        user("start"),
        assistant(""),
        task("Implement phase 1.", true),
        user("Implement phase 1."),
        assistant("Stopped by user.", "aborted"),
      );
      assert.strictEqual(h.getStatus(), "current task: implement-phase-1");
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
      h.assertSessionContains(
        user("main work"),
        assistant("working..."),
        task("parent task"),
      );
      h.assertNotifications("Task finished. Last response attached.");
    } finally {
      h.dispose();
    }
  });

  it("continues processing when user queues a steering message during auto", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("start", responds(""));
    engine.onPrompt("", responds(""));
    engine.onPrompt("Quick fix.", responds("thinking..."));
    engine.onAssistant("thinking...", {
      type: "user-append",
      text: "steer it",
    });
    engine.onPrompt("steer it", responds("adjusted response"));
    engine.onPrompt("adjusted response", responds(""));
    const h = await TestHarness.create(engine);
    try {
      await h.prompt("start");
      await h.pushTask("Quick fix.", true);

      await h.command("/auto");

      h.assertSessionContains(
        user("start"),
        assistant(""),
        task("Quick fix.", true),
        taskResult("quick-fix", "adjusted response"),
      );
      h.assertNotifications("Task finished. Last response attached.");
    } finally {
      h.dispose();
    }
  });

  it("stops when session is shut down during auto", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("start", responds(""));
    engine.onPrompt("", responds(""));
    engine.onPrompt("Shutdown task", responds("working..."));
    engine.onAssistant("working...", userCtrlC());
    const h = await TestHarness.create(engine);
    try {
      await h.prompt("start");
      await h.pushTask("Shutdown task", true);

      await h.command("/auto");

      h.assertSessionContains(
        user("start"),
        assistant(""),
        task("Shutdown task", true),
        user("Shutdown task"),
        assistant("working..."),
      );
      assert.strictEqual(h.getStatus(), "current task: shutdown-task");
    } finally {
      h.dispose();
    }
  });
});
