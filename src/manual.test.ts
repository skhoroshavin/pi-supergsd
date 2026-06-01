import assert from "node:assert";

import {
  assistant,
  node,
  responds,
  pushTask,
  status,
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
      h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
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
        task("Task AAA"),
        status("pending task: task-aaa"),
      );
    }).children(
      node("discard AAA", async (h) => {
        await h.prompt("/discard-task");
        h.assertSession(
          user("main work"),
          assistant("working...", "toolUse"),
          task("Task AAA"),
          status("pending task: task-aaa"),
          status(),
        );
        assert.strictEqual(h.lastNotification(), "Task discarded.");
      }),
      node("start AAA", async (h) => {
        await h.prompt("/start-task");
        h.assertSession(
          status(),
          user("Task AAA"),
          assistant("Done."),
          status("current task: task-aaa"),
        );
      }).children(
        node("finish AAA", async (h) => {
          await h.prompt("/finish-task");
          h.assertSession(
            status(),
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA"),
            status("pending task: task-aaa"),
            status(),
            taskResult("task-aaa", "Done."),
            assistant("Great!"),
          );
        }).children(
          node("start [no task]", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(
              status(),
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA"),
              status("pending task: task-aaa"),
              status(),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            assert.strictEqual(h.lastNotification(), "No pending task. Use push-task first.");
          }),
          node("discard [no task]", async (h) => {
            await h.prompt("/discard-task");
            h.assertSession(
              status(),
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA"),
              status("pending task: task-aaa"),
              status(),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            assert.strictEqual(h.lastNotification(), "No pending task to discard.");
          }),
          node("finish [no task]", async (h) => {
            await h.prompt("/finish-task");
            h.assertSession(
              status(),
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA"),
              status("pending task: task-aaa"),
              status(),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            assert.strictEqual(h.lastNotification(), "Not inside task, nothing to finish.");
          }),
          node("abort [no task]", async (h) => {
            await h.prompt("/abort-task");
            h.assertSession(
              status(),
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA"),
              status("pending task: task-aaa"),
              status(),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            assert.strictEqual(h.lastNotification(), "Not inside task, nothing to abort.");
          }),
        ),
        node("abort AAA", async (h) => {
          await h.prompt("/abort-task");
          h.assertSession(
            status(),
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA"),
            status("pending task: task-aaa"),
          );
          assert.strictEqual(
            h.lastNotification(),
            "Task aborted. Branch abandoned without summary.",
          );
        }).children(
          node("start AAA", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(
              status(),
              user("Task AAA"),
              assistant("Done."),
              status("current task: task-aaa"),
            );
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                status(),
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA"),
                status("pending task: task-aaa"),
                status(),
                taskResult("task-aaa", "Done."),
                assistant("Great!"),
              );
            }),
          ),
        ),
        node("push BBB", async (h) => {
          h.llm.onPrompt("some more work", responds("okay"), pushTask("Task BBB"));
          await h.prompt("some more work");
          h.assertSession(
            status(),
            user("Task AAA"),
            assistant("Done."),
            status("current task: task-aaa"),
            user("some more work"),
            assistant("okay", "toolUse"),
            task("Task BBB"),
            status("pending task: task-bbb"),
          );
        }).children(
          node("discard BBB", async (h) => {
            await h.prompt("/discard-task");
            h.assertSession(
              status(),
              user("Task AAA"),
              assistant("Done."),
              status("current task: task-aaa"),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB"),
              status("pending task: task-bbb"),
              status("current task: task-aaa"),
            );
            assert.strictEqual(h.lastNotification(), "Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                status(),
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA"),
                status("pending task: task-aaa"),
                status(),
                taskResult("task-aaa", "okay"),
                assistant("Great!"),
              );
            }),
          ),
          node("start BBB", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(
              status(),
              user("Task BBB"),
              assistant("inner done"),
              status("current task: task-bbb"),
            );
          }).children(
            node("finish BBB", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                status(),
                user("Task AAA"),
                assistant("Done."),
                status("current task: task-aaa"),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB"),
                status("pending task: task-bbb"),
                status("current task: task-aaa"),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  status(),
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  status("pending task: task-aaa"),
                  status(),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
              }),
            ),
            node("abort BBB", async (h) => {
              await h.prompt("/abort-task");
              h.assertSession(
                status(),
                user("Task AAA"),
                assistant("Done."),
                status("current task: task-aaa"),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB"),
                status("pending task: task-bbb"),
              );
              assert.strictEqual(
                h.lastNotification(),
                "Task aborted. Branch abandoned without summary.",
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  status(),
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  status("pending task: task-aaa"),
                  status(),
                  taskResult("task-aaa", "okay"),
                  assistant("Great!"),
                );
              }),
            ),
          ),
        ),
        node("push BBB [inherit]", async (h) => {
          h.llm.onPrompt("some more work", responds("okay"), pushTask("Task BBB", true));
          await h.prompt("some more work");
          h.assertSession(
            status(),
            user("Task AAA"),
            assistant("Done."),
            status("current task: task-aaa"),
            user("some more work"),
            assistant("okay", "toolUse"),
            task("Task BBB", true),
            status("pending task: task-bbb"),
          );
        }).children(
          node("discard BBB [inherit]", async (h) => {
            await h.prompt("/discard-task");
            h.assertSession(
              status(),
              user("Task AAA"),
              assistant("Done."),
              status("current task: task-aaa"),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB", true),
              status("pending task: task-bbb"),
              status("current task: task-aaa"),
            );
            assert.strictEqual(h.lastNotification(), "Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                status(),
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA"),
                status("pending task: task-aaa"),
                status(),
                taskResult("task-aaa", "okay"),
                assistant("Great!"),
              );
            }),
          ),
          node("start BBB [inherit]", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(
              status(),
              user("Task AAA"),
              assistant("Done."),
              status("current task: task-aaa"),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB", true),
              status("pending task: task-bbb"),
              user("Task BBB"),
              assistant("inner done"),
              status("current task: task-bbb"),
            );
          }).children(
            node("finish BBB [inherit]", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                status(),
                user("Task AAA"),
                assistant("Done."),
                status("current task: task-aaa"),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB", true),
                status("pending task: task-bbb"),
                status("current task: task-aaa"),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  status(),
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  status("pending task: task-aaa"),
                  status(),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
              }),
            ),
            node("abort BBB [inherit]", async (h) => {
              await h.prompt("/abort-task");
              h.assertSession(
                status(),
                user("Task AAA"),
                assistant("Done."),
                status("current task: task-aaa"),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB", true),
                status("pending task: task-bbb"),
              );
              assert.strictEqual(
                h.lastNotification(),
                "Task aborted. Branch abandoned without summary.",
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  status(),
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  status("pending task: task-aaa"),
                  status(),
                  taskResult("task-aaa", "okay"),
                  assistant("Great!"),
                );
              }),
            ),
          ),
        ),
      ),
    ),
    // ── Inherit-context tree ──────────────────────────────────────────
    node("push AAA [inherit]", async (h) => {
      h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA", true));
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
        task("Task AAA", true),
        status("pending task: task-aaa"),
      );
    }).children(
      node("discard AAA", async (h) => {
        await h.prompt("/discard-task");
        h.assertSession(
          user("main work"),
          assistant("working...", "toolUse"),
          task("Task AAA", true),
          status("pending task: task-aaa"),
          status(),
        );
        assert.strictEqual(h.lastNotification(), "Task discarded.");
      }),
      node("start AAA", async (h) => {
        await h.prompt("/start-task");
        h.assertSession(
          user("main work"),
          assistant("working...", "toolUse"),
          task("Task AAA", true),
          status("pending task: task-aaa"),
          user("Task AAA"),
          assistant("Done."),
          status("current task: task-aaa"),
        );
      }).children(
        node("finish AAA", async (h) => {
          await h.prompt("/finish-task");
          h.assertSession(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", true),
            status("pending task: task-aaa"),
            status(),
            taskResult("task-aaa", "Done."),
            assistant("Great!"),
          );
        }).children(
          node("start [no task]", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              status("pending task: task-aaa"),
              status(),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            assert.strictEqual(h.lastNotification(), "No pending task. Use push-task first.");
          }),
          node("discard [no task]", async (h) => {
            await h.prompt("/discard-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              status("pending task: task-aaa"),
              status(),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            assert.strictEqual(h.lastNotification(), "No pending task to discard.");
          }),
          node("finish [no task]", async (h) => {
            await h.prompt("/finish-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              status("pending task: task-aaa"),
              status(),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            assert.strictEqual(h.lastNotification(), "Not inside task, nothing to finish.");
          }),
          node("abort [no task]", async (h) => {
            await h.prompt("/abort-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              status("pending task: task-aaa"),
              status(),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            assert.strictEqual(h.lastNotification(), "Not inside task, nothing to abort.");
          }),
        ),
        node("abort AAA", async (h) => {
          await h.prompt("/abort-task");
          h.assertSession(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", true),
            status("pending task: task-aaa"),
          );
          assert.strictEqual(
            h.lastNotification(),
            "Task aborted. Branch abandoned without summary.",
          );
        }).children(
          node("start AAA", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              status("pending task: task-aaa"),
              user("Task AAA"),
              assistant("Done."),
              status("current task: task-aaa"),
            );
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                status("pending task: task-aaa"),
                status(),
                taskResult("task-aaa", "Done."),
                assistant("Great!"),
              );
            }),
          ),
        ),
        node("push BBB", async (h) => {
          h.llm.onPrompt("some more work", responds("okay"), pushTask("Task BBB"));
          await h.prompt("some more work");
          h.assertSession(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", true),
            status("pending task: task-aaa"),
            user("Task AAA"),
            assistant("Done."),
            status("current task: task-aaa"),
            user("some more work"),
            assistant("okay", "toolUse"),
            task("Task BBB"),
            status("pending task: task-bbb"),
          );
        }).children(
          node("discard BBB", async (h) => {
            await h.prompt("/discard-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              status("pending task: task-aaa"),
              user("Task AAA"),
              assistant("Done."),
              status("current task: task-aaa"),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB"),
              status("pending task: task-bbb"),
              status("current task: task-aaa"),
            );
            assert.strictEqual(h.lastNotification(), "Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                status("pending task: task-aaa"),
                status(),
                taskResult("task-aaa", "okay"),
                assistant("Great!"),
              );
            }),
          ),
          node("start BBB", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(
              status(),
              user("Task BBB"),
              assistant("inner done"),
              status("current task: task-bbb"),
            );
          }).children(
            node("finish BBB", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                status(),
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                status("pending task: task-aaa"),
                user("Task AAA"),
                assistant("Done."),
                status("current task: task-aaa"),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB"),
                status("pending task: task-bbb"),
                status("current task: task-aaa"),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  status(),
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  status("pending task: task-aaa"),
                  status(),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
              }),
            ),
            node("abort BBB", async (h) => {
              await h.prompt("/abort-task");
              h.assertSession(
                status(),
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                status("pending task: task-aaa"),
                user("Task AAA"),
                assistant("Done."),
                status("current task: task-aaa"),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB"),
                status("pending task: task-bbb"),
              );
              assert.strictEqual(
                h.lastNotification(),
                "Task aborted. Branch abandoned without summary.",
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  status(),
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  status("pending task: task-aaa"),
                  status(),
                  taskResult("task-aaa", "okay"),
                  assistant("Great!"),
                );
              }),
            ),
          ),
        ),
        node("push BBB [inherit]", async (h) => {
          h.llm.onPrompt("some more work", responds("okay"), pushTask("Task BBB", true));
          await h.prompt("some more work");
          h.assertSession(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", true),
            status("pending task: task-aaa"),
            user("Task AAA"),
            assistant("Done."),
            status("current task: task-aaa"),
            user("some more work"),
            assistant("okay", "toolUse"),
            task("Task BBB", true),
            status("pending task: task-bbb"),
          );
        }).children(
          node("discard BBB [inherit]", async (h) => {
            await h.prompt("/discard-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              status("pending task: task-aaa"),
              user("Task AAA"),
              assistant("Done."),
              status("current task: task-aaa"),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB", true),
              status("pending task: task-bbb"),
              status("current task: task-aaa"),
            );
            assert.strictEqual(h.lastNotification(), "Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                status("pending task: task-aaa"),
                status(),
                taskResult("task-aaa", "okay"),
                assistant("Great!"),
              );
            }),
          ),
          node("start BBB [inherit]", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              status("pending task: task-aaa"),
              user("Task AAA"),
              assistant("Done."),
              status("current task: task-aaa"),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB", true),
              status("pending task: task-bbb"),
              user("Task BBB"),
              assistant("inner done"),
              status("current task: task-bbb"),
            );
          }).children(
            node("finish BBB [inherit]", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                status("pending task: task-aaa"),
                user("Task AAA"),
                assistant("Done."),
                status("current task: task-aaa"),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB", true),
                status("pending task: task-bbb"),
                status("current task: task-aaa"),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  status("pending task: task-aaa"),
                  status(),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
              }),
            ),
            node("abort BBB [inherit]", async (h) => {
              await h.prompt("/abort-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                status("pending task: task-aaa"),
                user("Task AAA"),
                assistant("Done."),
                status("current task: task-aaa"),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB", true),
                status("pending task: task-bbb"),
              );
              assert.strictEqual(
                h.lastNotification(),
                "Task aborted. Branch abandoned without summary.",
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  status("pending task: task-aaa"),
                  status(),
                  taskResult("task-aaa", "okay"),
                  assistant("Great!"),
                );
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
      assert.strictEqual(h.lastNotification(), "No pending task. Use push-task first.");
    }),
    node("discard [no task]", async (h) => {
      h.llm.onPrompt("main work", responds("working..."));
      await h.prompt("main work");
      await h.prompt("/discard-task");
      h.assertSession(user("main work"), assistant("working..."));
      assert.strictEqual(h.lastNotification(), "No pending task to discard.");
    }),
    node("finish [no task]", async (h) => {
      h.llm.onPrompt("main work", responds("working..."));
      await h.prompt("main work");
      await h.prompt("/finish-task");
      h.assertSession(user("main work"), assistant("working..."));
      assert.strictEqual(h.lastNotification(), "Not inside task, nothing to finish.");
    }),
    node("abort [no task]", async (h) => {
      h.llm.onPrompt("main work", responds("working..."));
      await h.prompt("main work");
      await h.prompt("/abort-task");
      h.assertSession(user("main work"), assistant("working..."));
      assert.strictEqual(h.lastNotification(), "Not inside task, nothing to abort.");
    }),
  );
});
