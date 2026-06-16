import { describe, it } from "node:test";

import { assistant, responds, taskResult, user, TestHarness } from "./test-helpers/index.js";

describe("legacy session compatibility", () => {
  it("starts and finishes a legacy task without title", async () => {
    const h = await TestHarness.create();
    h.appendCustomEntry("task", { prompt: "legacy prompt", inherit_context: false });
    h.llm.onPrompt("legacy prompt", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      await h.prompt("/start-task");
      h.assertStatus("current task: untitled");
      h.assertSession(user("legacy prompt"), assistant("Done."));

      await h.prompt("/finish-task");
      h.assertStatus();
      h.assertSession(taskResult("untitled", "Done."), assistant("Great!"));
    } finally {
      h.dispose();
    }
  });
});
