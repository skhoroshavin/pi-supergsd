import assert from "node:assert";

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

describe("stable prompt across push-task / return", () => {
  it("restores the exact overseer system prompt on the first returned request", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds("working..."), pushTask("AAA", "some prompt"));
    h.llm.onPrompt("some prompt", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      // 1. Establish the overseer prompt state (last overseer request before push).
      await h.prompt("main work");
      const overseerPrompt = h.lastRequestSystemPrompt();
      assert.ok(overseerPrompt, "expected an overseer request to have been made");

      // 2. Push + start the task (navigates to a fresh context).
      await h.prompt("/start-task");
      h.assertSession(user("some prompt"), assistant("Done."));
      h.assertStatus("current task: AAA");

      // 3. Mutate task-local prompt-construction state that would drift a
      //    rebuilt prompt (tool selection changes the base system prompt).
      h.setActiveTools([]);
      const driftedPrompt = h.currentSystemPrompt();
      assert.notStrictEqual(
        driftedPrompt,
        overseerPrompt,
        "precondition: the drifted rebuild must differ from the overseer prompt",
      );

      // 4. Return to the overseer. The first returned request must reuse the
      //    captured overseer prefix, not the drifted rebuild.
      await h.prompt("/finish-task");
      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("AAA", "some prompt"),
        taskResult("AAA", "Done."),
        assistant("Great!"),
      );

      const returnPrompt = h.lastRequestSystemPrompt();
      assert.ok(returnPrompt, "expected a returned request to have been made");
      assert.strictEqual(
        returnPrompt,
        overseerPrompt,
        "first returned request must reuse the exact pre-push overseer system prompt",
      );
      assert.notStrictEqual(
        returnPrompt,
        driftedPrompt,
        "first returned request must not use the drifted task-local rebuild",
      );
    } finally {
      h.dispose();
    }
  });

  it("does not freeze the overseer prompt after the one-shot restore", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds("working..."), pushTask("AAA", "some prompt"));
    h.llm.onPrompt("some prompt", responds("Done."));
    h.llm.onPrompt("Done.", responds("after"));
    h.llm.onPrompt("follow-up", responds(""));

    try {
      await h.prompt("main work");
      const overseerPrompt = h.lastRequestSystemPrompt();

      await h.prompt("/start-task");
      h.setActiveTools([]);
      const currentBase = h.currentSystemPrompt();

      // The restore is one-shot: only the first returned request replays the
      // captured prefix.
      await h.prompt("/finish-task");
      assert.strictEqual(h.lastRequestSystemPrompt(), overseerPrompt, "first return restores");

      // A later overseer start re-captures current state — it is NOT pinned
      // to the pre-push snapshot.
      await h.prompt("follow-up");
      assert.strictEqual(
        h.lastRequestSystemPrompt(),
        currentBase,
        "subsequent start uses the current state, not the frozen snapshot",
      );
      assert.notStrictEqual(h.lastRequestSystemPrompt(), overseerPrompt, "not pinned to snapshot");
    } finally {
      h.dispose();
    }
  });

  it("leaves prompt construction unchanged when no task is pushed", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("plain", responds("hi"));

    try {
      await h.prompt("plain");
      const first = h.lastRequestSystemPrompt();

      // No task: every start simply captures/uses the current state, no
      // restore is armed, so the prompt is stable and unchanged.
      await h.prompt("plain again");
      assert.strictEqual(h.lastRequestSystemPrompt(), first, "no-task flow is unchanged");
    } finally {
      h.dispose();
    }
  });
});
