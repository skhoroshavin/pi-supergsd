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
      h.assertModel("supergsd-test/deterministic");
      await h.prompt("/start-task");
      h.assertModel("supergsd-test/deterministic");
      h.assertSession(user("Task AAA"), assistant("Done."));
      h.assertStatus("current task: task-aaa");
    } finally {
      h.dispose();
    }
  });

  it("switches model and restores on finish (substring match)", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [{ id: "other-model", name: "Other Model" }]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      await h.prompt("main work");
      h.assertModel("supergsd-test/deterministic");
      await h.prompt("/start-task Other");
      h.assertModel("supergsd-test/other-model");
      h.assertSession(user("Task AAA"), assistant("Done."));
      h.assertStatus("current task: task-aaa");

      await h.prompt("/finish-task");
      h.assertModel("supergsd-test/deterministic");
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
    registerTestModels(h, [{ id: "other-model", name: "Other Model" }]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      await h.prompt("main work");
      h.assertModel("supergsd-test/deterministic");
      await h.prompt("/start-task supergsd-test/other-model");
      h.assertModel("supergsd-test/other-model");
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
      h.assertModel("supergsd-test/deterministic");
      await h.prompt("/start-task nonexistent-model-xyz");

      h.assertModel("supergsd-test/deterministic");
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
      { id: "other-model-v1", name: "Other Model V1" },
      { id: "other-model-v2", name: "Other Model V2" },
    ]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));

    try {
      await h.prompt("main work");
      h.assertModel("supergsd-test/deterministic");
      await h.prompt("/start-task other-model");

      h.assertModel("supergsd-test/deterministic");
      h.assertSession(user("main work"), assistant("working...", "toolUse"), task("Task AAA"));
      h.assertStatus("pending task: task-aaa");
      h.assertLastNotification(
        "Ambiguous model: matches supergsd-test/other-model-v1, supergsd-test/other-model-v2.",
      );
    } finally {
      h.dispose();
    }
  });

  it("restores original model on nested task finish", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [{ id: "other-model", name: "Other Model" }]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("outer working..."), pushTask("Task BBB"));
    h.llm.onPrompt("Task BBB", responds("inner done"));
    h.llm.onPrompt("inner done", responds("Great!"));
    h.llm.onPrompt("Great!", responds(""));

    try {
      await h.prompt("main work");
      h.assertModel("supergsd-test/deterministic");
      await h.prompt("/start-task other");
      h.assertModel("supergsd-test/other-model");
      h.assertSession(user("Task AAA"), assistant("outer working...", "toolUse"), task("Task BBB"));

      // Start nested without model switch — stays on other-model
      await h.prompt("/start-task");
      h.assertModel("supergsd-test/other-model");
      h.assertSession(user("Task BBB"), assistant("inner done"));

      // Finish nested — no previousModel on its task-start, stays on other-model
      await h.prompt("/finish-task");
      h.assertModel("supergsd-test/other-model");
      h.assertSession(
        user("Task AAA"),
        assistant("outer working...", "toolUse"),
        task("Task BBB"),
        taskResult("task-bbb", "inner done"),
        assistant("Great!"),
      );

      // Finish outer — restores to deterministic
      await h.prompt("/finish-task");
      h.assertModel("supergsd-test/deterministic");
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
      h.assertModel("supergsd-test/deterministic");
      await h.prompt("/start-task model-a");
      h.assertModel("supergsd-test/model-a");
      h.assertSession(user("Task AAA"), assistant("outer working...", "toolUse"), task("Task BBB"));

      await h.prompt("/start-task model-b");
      h.assertModel("supergsd-test/model-b");
      h.assertSession(user("Task BBB"), assistant("inner done"));

      // Finish inner — restores to model-a
      await h.prompt("/finish-task");
      h.assertModel("supergsd-test/model-a");
      h.assertSession(
        user("Task AAA"),
        assistant("outer working...", "toolUse"),
        task("Task BBB"),
        taskResult("task-bbb", "inner done"),
        assistant("Great!"),
      );

      // Finish outer — restores to deterministic
      await h.prompt("/finish-task");
      h.assertModel("supergsd-test/deterministic");
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
      // Switch to model-a (previousModel = deterministic)
      await h.prompt("/start-task model-a");
      h.assertModel("supergsd-test/model-a");
      h.assertSession(user("Task AAA"), assistant("outer working...", "toolUse"), task("Task BBB"));

      // Switch to model-b inside (previousModel = model-a)
      await h.prompt("/start-task model-b");
      h.assertModel("supergsd-test/model-b");
      h.assertSession(user("Task BBB"), assistant("inner done"));

      // Re-register without model-a to make it unavailable
      h.modelRegistry.registerProvider("supergsd-test", {
        baseUrl: "memory://supergsd-test",
        apiKey: "test-key",
        api: "supergsd-test-api",
        models: [
          modelSpec("deterministic", "Deterministic Test Model", true),
          modelSpec("model-b", "Model B", false),
        ],
      });

      // Finish inner — tries to restore model-a, which is now unavailable
      await h.prompt("/finish-task");
      // Model stays on model-b (restore failed, active model unchanged)
      h.assertModel("supergsd-test/model-b");
      h.assertSession(
        user("Task AAA"),
        assistant("outer working...", "toolUse"),
        task("Task BBB"),
        taskResult("task-bbb", "inner done"),
        assistant("Great!"),
      );
      h.assertLastNotification("Previous model supergsd-test/model-a no longer available.");

      // Finish outer — restores deterministic which is still available
      await h.prompt("/finish-task");
      h.assertModel("supergsd-test/deterministic");
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

  it("restores model on abort-task and leaves task pending", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [{ id: "other-model", name: "Other Model" }]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      await h.prompt("main work");
      h.assertModel("supergsd-test/deterministic");
      await h.prompt("/start-task other");
      h.assertModel("supergsd-test/other-model");
      h.assertSession(user("Task AAA"), assistant("Done."));
      h.assertStatus("current task: task-aaa");

      // Abort switches model back and leaves task pending
      await h.prompt("/abort-task");
      h.assertModel("supergsd-test/deterministic");
      h.assertSession(user("main work"), assistant("working...", "toolUse"), task("Task AAA"));
      h.assertStatus("pending task: task-aaa");
      h.assertLastNotification("Task aborted. Branch abandoned without summary.");

      // Task can be started again (no model arg = deterministic, proving restore)
      await h.prompt("/start-task");
      h.assertModel("supergsd-test/deterministic");
      h.assertSession(user("Task AAA"), assistant("Done."));
      h.assertStatus("current task: task-aaa");
    } finally {
      h.dispose();
    }
  });
});

/** Register extra test models under the supergsd-test provider. */
function registerTestModels(h: TestHarness, models: Array<{ id: string; name: string }>) {
  h.modelRegistry.registerProvider("supergsd-test", {
    baseUrl: "memory://supergsd-test",
    apiKey: "test-key",
    api: "supergsd-test-api",
    models: [
      modelSpec("deterministic", "Deterministic Test Model", true),
      ...models.map((m) => modelSpec(m.id, m.name, false)),
    ],
  });
}

function modelSpec(id: string, name: string, reasoning: boolean) {
  return {
    id,
    name,
    reasoning,
    input: ["text"] as Array<"text" | "image">,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100000,
    maxTokens: 4096,
  };
}
