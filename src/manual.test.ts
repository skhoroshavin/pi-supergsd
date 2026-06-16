import {
  assistant,
  node,
  responds,
  pushTask,
  TestNode,
  task,
  taskResult,
  user,
} from "./test-helpers/index.js";

import { describe } from "node:test";

describe("manual workflow", () => {
  TestNode.run(
    // ── Non-inherit tree ────────────────────────────────────────────────
    node("push AAA", async (h) => {
      h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA", "Task AAA"));
      h.llm.onPrompt("Task AAA", responds("Done."));
      h.llm.onPrompt("Done.", responds("Great!"));
      h.llm.onPrompt("Great!", responds("Great!"));
      h.llm.onPrompt("okay", responds("Great!"));
      h.llm.onPrompt("Task BBB", responds("inner done"));
      h.llm.onPrompt("inner done", responds("Great!"));
      await h.prompt("main work");
      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA", "Task AAA"),
      );
      h.assertStatus("pending task: Task AAA");
    }).children(
      node("discard AAA", async (h) => {
        await h.prompt("/discard-task");
        h.assertSession(
          user("main work"),
          assistant("working...", "toolUse"),
          task("Task AAA", "Task AAA"),
        );
        h.assertStatus();
        h.assertLastNotification("Task discarded.");
      }),
      node("start AAA", async (h) => {
        await h.prompt("/start-task");
        h.assertSession(user("Task AAA"), assistant("Done."));
        h.assertStatus("current task: Task AAA");
      }).children(
        node("finish AAA", async (h) => {
          await h.prompt("/finish-task");
          h.assertSession(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", "Task AAA"),
            taskResult("Task AAA", "Done."),
            assistant("Great!"),
          );
          h.assertStatus();
        }).children(
          node("start [no task]", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", "Task AAA"),
              taskResult("Task AAA", "Done."),
              assistant("Great!"),
            );
            h.assertStatus();
            h.assertLastNotification("No pending task. Use push-task first.");
          }),
          node("discard [no task]", async (h) => {
            await h.prompt("/discard-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", "Task AAA"),
              taskResult("Task AAA", "Done."),
              assistant("Great!"),
            );
            h.assertStatus();
            h.assertLastNotification("No pending task to discard.");
          }),
          node("finish [no task]", async (h) => {
            await h.prompt("/finish-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", "Task AAA"),
              taskResult("Task AAA", "Done."),
              assistant("Great!"),
            );
            h.assertStatus();
            h.assertLastNotification("Not inside task, nothing to finish.");
          }),
          node("abort [no task]", async (h) => {
            await h.prompt("/abort-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", "Task AAA"),
              taskResult("Task AAA", "Done."),
              assistant("Great!"),
            );
            h.assertStatus();
            h.assertLastNotification("Not inside task, nothing to abort.");
          }),
        ),
        node("abort AAA", async (h) => {
          await h.prompt("/abort-task");
          h.assertSession(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", "Task AAA"),
          );
          h.assertStatus("pending task: Task AAA");
          h.assertLastNotification("Task aborted. Branch abandoned without summary.");
        }).children(
          node("start AAA", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(user("Task AAA"), assistant("Done."));
            h.assertStatus("current task: Task AAA");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", "Task AAA"),
                taskResult("Task AAA", "Done."),
                assistant("Great!"),
              );
              h.assertStatus();
            }),
          ),
        ),
        node("push BBB", async (h) => {
          h.llm.onPrompt("some more work", responds("okay"), pushTask("Task BBB", "Task BBB"));
          await h.prompt("some more work");
          h.assertSession(
            user("Task AAA"),
            assistant("Done."),
            user("some more work"),
            assistant("okay", "toolUse"),
            task("Task BBB", "Task BBB"),
          );
          h.assertStatus("pending task: Task BBB");
        }).children(
          node("discard BBB", async (h) => {
            await h.prompt("/discard-task");
            h.assertSession(
              user("Task AAA"),
              assistant("Done."),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB", "Task BBB"),
            );
            h.assertStatus("current task: Task AAA");
            h.assertLastNotification("Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", "Task AAA"),
                taskResult("Task AAA", "okay"),
                assistant("Great!"),
              );
              h.assertStatus();
            }),
          ),
          node("start BBB", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(user("Task BBB"), assistant("inner done"));
            h.assertStatus("current task: Task BBB");
          }).children(
            node("finish BBB", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB", "Task BBB"),
                taskResult("Task BBB", "inner done"),
                assistant("Great!"),
              );
              h.assertStatus("current task: Task AAA");
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", "Task AAA"),
                  taskResult("Task AAA", "Great!"),
                  assistant("Great!"),
                );
                h.assertStatus();
              }),
            ),
            node("abort BBB", async (h) => {
              await h.prompt("/abort-task");
              h.assertSession(
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB", "Task BBB"),
              );
              h.assertStatus("pending task: Task BBB");
              h.assertLastNotification("Task aborted. Branch abandoned without summary.");
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", "Task AAA"),
                  taskResult("Task AAA", "okay"),
                  assistant("Great!"),
                );
                h.assertStatus();
              }),
            ),
          ),
        ),
      ),
    ),

    // ── Top-level no-task commands ─────────────────────────────────
    node("start [no task]", async (h) => {
      h.llm.onPrompt("main work", responds("working..."));
      await h.prompt("main work");
      await h.prompt("/start-task");
      h.assertSession(user("main work"), assistant("working..."));
      h.assertStatus();
      h.assertLastNotification("No pending task. Use push-task first.");
    }),
    node("discard [no task]", async (h) => {
      h.llm.onPrompt("main work", responds("working..."));
      await h.prompt("main work");
      await h.prompt("/discard-task");
      h.assertSession(user("main work"), assistant("working..."));
      h.assertStatus();
      h.assertLastNotification("No pending task to discard.");
    }),
    node("finish [no task]", async (h) => {
      h.llm.onPrompt("main work", responds("working..."));
      await h.prompt("main work");
      await h.prompt("/finish-task");
      h.assertSession(user("main work"), assistant("working..."));
      h.assertStatus();
      h.assertLastNotification("Not inside task, nothing to finish.");
    }),
    node("abort [no task]", async (h) => {
      h.llm.onPrompt("main work", responds("working..."));
      await h.prompt("main work");
      await h.prompt("/abort-task");
      h.assertSession(user("main work"), assistant("working..."));
      h.assertStatus();
      h.assertLastNotification("Not inside task, nothing to abort.");
    }),
  );
});
