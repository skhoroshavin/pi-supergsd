import { describe, it } from "node:test";

import {
  assistant,
  pushTask,
  responds,
  task,
  taskResult,
  user,
  TestHarness,
} from "./test-helpers/index.js";

describe("model switching on /start-task", () => {
  it("starts task without model arg (existing behavior unchanged)", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task");
      h.assertSession(user("Task AAA"), assistant("Done."));
      h.assertStatus("current task: task-aaa");
    } finally {
      h.dispose();
    }
  });

  it("switches model and restores on finish (substring match)", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [{ id: "cheap-model", name: "Cheap Model" }]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task Cheap");
      h.assertSession(user("Task AAA"), assistant("Done."));
      h.assertStatus("current task: task-aaa");

      await h.prompt("/finish-task");
      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA"),
        taskResult("task-aaa", "Done."),
        assistant("Great!"),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });

  it("switches model via provider/modelId syntax", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [{ id: "cheap-model", name: "Cheap Model" }]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task test-extra/cheap-model");
      h.assertSession(user("Task AAA"), assistant("Done."));
      h.assertStatus("current task: task-aaa");
    } finally {
      h.dispose();
    }
  });

  it("notifies when no model matches", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task nonexistent-model-xyz");

      h.assertSession(user("main work"), assistant("working...", "toolUse"), task("Task AAA"));
      h.assertStatus("pending task: task-aaa");
      h.assertLastNotification('No model matching "nonexistent-model-xyz".');
    } finally {
      h.dispose();
    }
  });

  it("notifies when multiple models match", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [
      { id: "cheap-model-v1", name: "Cheap Model V1" },
      { id: "cheap-model-v2", name: "Cheap Model V2" },
    ]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task cheap-model");

      h.assertSession(user("main work"), assistant("working...", "toolUse"), task("Task AAA"));
      h.assertStatus("pending task: task-aaa");
      h.assertLastNotification(
        "Ambiguous model: matches test-extra/cheap-model-v1, test-extra/cheap-model-v2.",
      );
    } finally {
      h.dispose();
    }
  });

  it("restores original model on nested task finish", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [{ id: "cheap-model", name: "Cheap Model" }]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("outer working..."), pushTask("Task BBB"));
    h.llm.onPrompt("Task BBB", responds("inner done"));
    h.llm.onPrompt("inner done", responds("Great!"));
    h.llm.onPrompt("Great!", responds(""));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task cheap");
      h.assertSession(user("Task AAA"), assistant("outer working...", "toolUse"), task("Task BBB"));

      // Start nested without model switch
      await h.prompt("/start-task");
      h.assertSession(user("Task BBB"), assistant("inner done"));

      // Finish nested — no previousModel on its task-start, stays on cheap
      await h.prompt("/finish-task");
      h.assertSession(
        user("Task AAA"),
        assistant("outer working...", "toolUse"),
        task("Task BBB"),
        taskResult("task-bbb", "inner done"),
        assistant("Great!"),
      );

      // Finish outer — restores to FAUX_MODEL
      await h.prompt("/finish-task");
      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA"),
        taskResult("task-aaa", "Great!"),
        assistant(""),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });

  it("nested tasks with independent model switches", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [
      { id: "model-a", name: "Model A" },
      { id: "model-b", name: "Model B" },
    ]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("outer working..."), pushTask("Task BBB"));
    h.llm.onPrompt("Task BBB", responds("inner done"));
    h.llm.onPrompt("inner done", responds("Great!"));
    h.llm.onPrompt("Great!", responds(""));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task model-a");
      h.assertSession(user("Task AAA"), assistant("outer working...", "toolUse"), task("Task BBB"));

      await h.prompt("/start-task model-b");
      h.assertSession(user("Task BBB"), assistant("inner done"));

      // Finish inner — restores to model-a
      await h.prompt("/finish-task");
      h.assertSession(
        user("Task AAA"),
        assistant("outer working...", "toolUse"),
        task("Task BBB"),
        taskResult("task-bbb", "inner done"),
        assistant("Great!"),
      );

      // Finish outer — restores to FAUX_MODEL
      await h.prompt("/finish-task");
      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA"),
        taskResult("task-aaa", "Great!"),
        assistant(""),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });

  it("warns when previous model unavailable on finish", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [
      { id: "model-a", name: "Model A" },
      { id: "model-b", name: "Model B" },
    ]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("outer working..."), pushTask("Task BBB"));
    h.llm.onPrompt("Task BBB", responds("inner done"));
    h.llm.onPrompt("inner done", responds("Great!"));
    h.llm.onPrompt("Great!", responds(""));

    try {
      await h.prompt("main work");
      // Switch to model-a (previousModel = FAUX_MODEL)
      await h.prompt("/start-task model-a");
      h.assertSession(user("Task AAA"), assistant("outer working...", "toolUse"), task("Task BBB"));

      // Switch to model-b inside (previousModel = test-extra/model-a)
      await h.prompt("/start-task model-b");
      h.assertSession(user("Task BBB"), assistant("inner done"));

      // Unregister provider to make model-a (the inner previousModel) unavailable
      h.modelRegistry.unregisterProvider("test-extra");

      // Finish inner — tries to restore model-a, which is now unavailable
      await h.prompt("/finish-task");
      h.assertSession(
        user("Task AAA"),
        assistant("outer working...", "toolUse"),
        task("Task BBB"),
        taskResult("task-bbb", "inner done"),
        assistant("Great!"),
      );
      h.assertNotification("Previous model test-extra/model-a no longer available.");

      // Finish outer — restores FAUX_MODEL which is still available
      await h.prompt("/finish-task");
      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA"),
        taskResult("task-aaa", "Great!"),
        assistant(""),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });

  it("model switch works with inherit-context tasks", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [{ id: "alt-model", name: "Alt Model" }]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA", true));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task alt");

      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA", true),
        user("Task AAA"),
        assistant("Done."),
      );
      h.assertStatus("current task: task-aaa");

      await h.prompt("/finish-task");
      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA", true),
        taskResult("task-aaa", "Done."),
        assistant("Great!"),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });

  it("restores model on abort-task and leaves task pending", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [{ id: "cheap-model", name: "Cheap Model" }]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task Cheap");
      h.assertSession(user("Task AAA"), assistant("Done."));
      h.assertStatus("current task: task-aaa");

      // Abort switches model back and leaves task pending
      await h.prompt("/abort-task");
      h.assertSession(user("main work"), assistant("working...", "toolUse"), task("Task AAA"));
      h.assertStatus("pending task: task-aaa");
      h.assertLastNotification("Task aborted. Branch abandoned without summary.");

      // Task can be started again (no model arg = FAUX_MODEL, proving restore)
      await h.prompt("/start-task");
      h.assertSession(user("Task AAA"), assistant("Done."));
      h.assertStatus("current task: task-aaa");
    } finally {
      h.dispose();
    }
  });
});

/** Register extra test models with configured auth on the harness model registry. */
function registerTestModels(h: TestHarness, models: Array<{ id: string; name: string }>) {
  h.modelRegistry.registerProvider("test-extra", {
    baseUrl: "memory://test-extra",
    apiKey: "test-key-extra",
    api: "supergsd-test-api",
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      reasoning: false,
      input: ["text"] as const,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 100000,
      maxTokens: 4096,
    })),
  });
}
