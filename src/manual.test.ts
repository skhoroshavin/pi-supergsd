import assert from "node:assert";

import { assistant, node, notification, responds, pushTask, task, taskResult, user } from "./test-helpers/index.js";

import { describe } from "node:test";

describe("manual workflow", () => {
  // ── Non-inherit tree ───────────────────────────────────────────────

  node("push AAA", async (h) => {
    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));
    h.llm.onPrompt("Great!", responds("Great!"));
    h.llm.onPrompt("okay", responds("Great!"));
    h.llm.onPrompt("Task BBB", responds("inner done"));
    h.llm.onPrompt("inner done", responds("Great!"));
    await h.prompt("main work");
    assert.strictEqual(h.getStatus(), "pending task: task-aaa");
    h.assertSession(
      user("main work"),
      assistant("working...", "toolUse"),
      task("Task AAA"),
      notification("Task stored. Use `/start-task` or `/auto` to start it."),
    );
  })
    .children(
      node("discard AAA", async (h) => {
        await h.prompt("/discard-task");
        assert.strictEqual(h.getStatus(), undefined);
        h.assertSession(
          user("main work"),
          assistant("working...", "toolUse"),
          task("Task AAA"),
          notification("Task stored. Use `/start-task` or `/auto` to start it."),
          notification("Task discarded."),
        );
      }),
      node("start AAA", async (h) => {
        await h.prompt("/start-task");
        assert.strictEqual(h.getStatus(), "current task: task-aaa");
        h.assertSession(user("Task AAA"), assistant("Done."));
      }).children(
        node("finish AAA", async (h) => {
          await h.prompt("/finish-task");
          assert.strictEqual(h.getStatus(), undefined);
          h.assertSession(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA"),
            notification("Task stored. Use `/start-task` or `/auto` to start it."),
            notification("Task finished. Last response attached."),
            taskResult("task-aaa", "Done."),
            assistant("Great!"),
          );
        }).children(
          node("start [no task]", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA"),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              notification("Task finished. Last response attached."),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
              notification("No pending task. Use push-task first."),
            );
          }),
          node("discard [no task]", async (h) => {
            await h.prompt("/discard-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA"),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              notification("Task finished. Last response attached."),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
              notification("No pending task to discard."),
            );
          }),
          node("finish [no task]", async (h) => {
            await h.prompt("/finish-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA"),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              notification("Task finished. Last response attached."),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
              notification("Not inside task, nothing to finish."),
            );
          }),
          node("abort [no task]", async (h) => {
            await h.prompt("/abort-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA"),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              notification("Task finished. Last response attached."),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
              notification("Not inside task, nothing to abort."),
            );
          }),
        ),
        node("abort AAA", async (h) => {
          await h.prompt("/abort-task");
          assert.strictEqual(h.getStatus(), "pending task: task-aaa");
          h.assertSession(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA"),
            notification("Task stored. Use `/start-task` or `/auto` to start it."),
            notification("Task aborted. Branch abandoned without summary."),
          );
        }).children(
          node("start AAA", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            h.assertSession(user("Task AAA"), assistant("Done."));
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA"),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                notification("Task aborted. Branch abandoned without summary."),
                notification("Task finished. Last response attached."),
                taskResult("task-aaa", "Done."),
                assistant("Great!"),
              );
            }),
          ),
        ),
        node("push BBB", async (h) => {
          h.llm.onPrompt("some more work", responds("okay"), pushTask("Task BBB"));
          await h.prompt("some more work");
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          h.assertSession(
            user("Task AAA"),
            assistant("Done."),
            user("some more work"),
            assistant("okay", "toolUse"),
            task("Task BBB"),
            notification("Task stored. Use `/start-task` or `/auto` to start it."),
          );
        }).children(
          node("discard BBB", async (h) => {
            await h.prompt("/discard-task");
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            h.assertSession(
              user("Task AAA"),
              assistant("Done."),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB"),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              notification("Task discarded."),
            );
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA"),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                notification("Task finished. Last response attached."),
                taskResult("task-aaa", "okay"),
                assistant("Great!"),
              );
            }),
          ),
          node("start BBB", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            h.assertSession(user("Task BBB"), assistant("inner done"));
          }).children(
            node("finish BBB", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), "current task: task-aaa");
              h.assertSession(
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB"),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                notification("Task finished. Last response attached."),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  notification("Task stored. Use `/start-task` or `/auto` to start it."),
                  notification("Task finished. Last response attached."),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
              }),
            ),
            node("abort BBB", async (h) => {
              await h.prompt("/abort-task");
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              h.assertSession(
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB"),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                notification("Task aborted. Branch abandoned without summary."),
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  notification("Task stored. Use `/start-task` or `/auto` to start it."),
                  notification("Task finished. Last response attached."),
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
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          h.assertSession(
            user("Task AAA"),
            assistant("Done."),
            user("some more work"),
            assistant("okay", "toolUse"),
            task("Task BBB", true),
            notification("Task stored. Use `/start-task` or `/auto` to start it."),
          );
        }).children(
          node("discard BBB [inherit]", async (h) => {
            await h.prompt("/discard-task");
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            h.assertSession(
              user("Task AAA"),
              assistant("Done."),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB", true),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              notification("Task discarded."),
            );
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA"),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                notification("Task finished. Last response attached."),
                taskResult("task-aaa", "okay"),
                assistant("Great!"),
              );
            }),
          ),
          node("start BBB [inherit]", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            h.assertSession(
              user("Task AAA"),
              assistant("Done."),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB", true),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              user("Task BBB"),
              assistant("inner done"),
            );
          }).children(
            node("finish BBB [inherit]", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), "current task: task-aaa");
              h.assertSession(
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB", true),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                notification("Task finished. Last response attached."),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  notification("Task stored. Use `/start-task` or `/auto` to start it."),
                  notification("Task finished. Last response attached."),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
              }),
            ),
            node("abort BBB [inherit]", async (h) => {
              await h.prompt("/abort-task");
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              h.assertSession(
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB", true),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                notification("Task aborted. Branch abandoned without summary."),
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  notification("Task stored. Use `/start-task` or `/auto` to start it."),
                  notification("Task finished. Last response attached."),
                  taskResult("task-aaa", "okay"),
                  assistant("Great!"),
                );
              }),
            ),
          ),
        ),
      ),
    )
    .run();

  // ── Inherit tree ───────────────────────────────────────────────────

  node("push AAA [inherit]", async (h) => {
    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA", true));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));
    h.llm.onPrompt("Great!", responds("Great!"));
    h.llm.onPrompt("okay", responds("Great!"));
    h.llm.onPrompt("Task BBB", responds("inner done"));
    h.llm.onPrompt("inner done", responds("Great!"));
    await h.prompt("main work");
    assert.strictEqual(h.getStatus(), "pending task: task-aaa");
    h.assertSession(
      user("main work"),
      assistant("working...", "toolUse"),
      task("Task AAA", true),
      notification("Task stored. Use `/start-task` or `/auto` to start it."),
    );
  })
    .children(
      node("discard AAA", async (h) => {
        await h.prompt("/discard-task");
        assert.strictEqual(h.getStatus(), undefined);
        h.assertSession(
          user("main work"),
          assistant("working...", "toolUse"),
          task("Task AAA", true),
          notification("Task stored. Use `/start-task` or `/auto` to start it."),
          notification("Task discarded."),
        );
      }),
      node("start AAA", async (h) => {
        await h.prompt("/start-task");
        assert.strictEqual(h.getStatus(), "current task: task-aaa");
        h.assertSession(
          user("main work"),
          assistant("working...", "toolUse"),
          task("Task AAA", true),
          notification("Task stored. Use `/start-task` or `/auto` to start it."),
          user("Task AAA"),
          assistant("Done."),
        );
      }).children(
        node("finish AAA", async (h) => {
          await h.prompt("/finish-task");
          assert.strictEqual(h.getStatus(), undefined);
          h.assertSession(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", true),
            notification("Task stored. Use `/start-task` or `/auto` to start it."),
            notification("Task finished. Last response attached."),
            taskResult("task-aaa", "Done."),
            assistant("Great!"),
          );
        }).children(
          node("start [no task]", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              notification("Task finished. Last response attached."),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
              notification("No pending task. Use push-task first."),
            );
          }),
          node("discard [no task]", async (h) => {
            await h.prompt("/discard-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              notification("Task finished. Last response attached."),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
              notification("No pending task to discard."),
            );
          }),
          node("finish [no task]", async (h) => {
            await h.prompt("/finish-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              notification("Task finished. Last response attached."),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
              notification("Not inside task, nothing to finish."),
            );
          }),
          node("abort [no task]", async (h) => {
            await h.prompt("/abort-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              notification("Task finished. Last response attached."),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
              notification("Not inside task, nothing to abort."),
            );
          }),
        ),
        node("abort AAA", async (h) => {
          await h.prompt("/abort-task");
          assert.strictEqual(h.getStatus(), "pending task: task-aaa");
          h.assertSession(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", true),
            notification("Task stored. Use `/start-task` or `/auto` to start it."),
            notification("Task aborted. Branch abandoned without summary."),
          );
        }).children(
          node("start AAA", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              notification("Task aborted. Branch abandoned without summary."),
              user("Task AAA"),
              assistant("Done."),
            );
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                notification("Task aborted. Branch abandoned without summary."),
                notification("Task finished. Last response attached."),
                taskResult("task-aaa", "Done."),
                assistant("Great!"),
              );
            }),
          ),
        ),
        node("push BBB", async (h) => {
          h.llm.onPrompt("some more work", responds("okay"), pushTask("Task BBB"));
          await h.prompt("some more work");
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          h.assertSession(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", true),
            notification("Task stored. Use `/start-task` or `/auto` to start it."),
            user("Task AAA"),
            assistant("Done."),
            user("some more work"),
            assistant("okay", "toolUse"),
            task("Task BBB"),
            notification("Task stored. Use `/start-task` or `/auto` to start it."),
          );
        }).children(
          node("discard BBB", async (h) => {
            await h.prompt("/discard-task");
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              user("Task AAA"),
              assistant("Done."),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB"),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              notification("Task discarded."),
            );
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                notification("Task finished. Last response attached."),
                taskResult("task-aaa", "okay"),
                assistant("Great!"),
              );
            }),
          ),
          node("start BBB", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            h.assertSession(user("Task BBB"), assistant("inner done"));
          }).children(
            node("finish BBB", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), "current task: task-aaa");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB"),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                notification("Task finished. Last response attached."),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  notification("Task stored. Use `/start-task` or `/auto` to start it."),
                  notification("Task finished. Last response attached."),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
              }),
            ),
            node("abort BBB", async (h) => {
              await h.prompt("/abort-task");
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB"),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                notification("Task aborted. Branch abandoned without summary."),
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  notification("Task stored. Use `/start-task` or `/auto` to start it."),
                  notification("Task finished. Last response attached."),
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
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          h.assertSession(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", true),
            notification("Task stored. Use `/start-task` or `/auto` to start it."),
            user("Task AAA"),
            assistant("Done."),
            user("some more work"),
            assistant("okay", "toolUse"),
            task("Task BBB", true),
            notification("Task stored. Use `/start-task` or `/auto` to start it."),
          );
        }).children(
          node("discard BBB [inherit]", async (h) => {
            await h.prompt("/discard-task");
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              user("Task AAA"),
              assistant("Done."),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB", true),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              notification("Task discarded."),
            );
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                notification("Task finished. Last response attached."),
                taskResult("task-aaa", "okay"),
                assistant("Great!"),
              );
            }),
          ),
          node("start BBB [inherit]", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              user("Task AAA"),
              assistant("Done."),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB", true),
              notification("Task stored. Use `/start-task` or `/auto` to start it."),
              user("Task BBB"),
              assistant("inner done"),
            );
          }).children(
            node("finish BBB [inherit]", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), "current task: task-aaa");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB", true),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                notification("Task finished. Last response attached."),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  notification("Task stored. Use `/start-task` or `/auto` to start it."),
                  notification("Task finished. Last response attached."),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
              }),
            ),
            node("abort BBB [inherit]", async (h) => {
              await h.prompt("/abort-task");
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB", true),
                notification("Task stored. Use `/start-task` or `/auto` to start it."),
                notification("Task aborted. Branch abandoned without summary."),
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  notification("Task stored. Use `/start-task` or `/auto` to start it."),
                  notification("Task finished. Last response attached."),
                  taskResult("task-aaa", "okay"),
                  assistant("Great!"),
                );
              }),
            ),
          ),
        ),
      ),
    )
    .run();

  // ── Standalone no-task leaf nodes ──────────────────────────────────

  node("start [no task]", async (h) => {
    h.llm.onPrompt("main work", responds("working..."));
    await h.prompt("main work");
    await h.prompt("/start-task");
    assert.strictEqual(h.getStatus(), undefined);
    h.assertSession(user("main work"), assistant("working..."), notification("No pending task. Use push-task first."));
  }).run();

  node("discard [no task]", async (h) => {
    h.llm.onPrompt("main work", responds("working..."));
    await h.prompt("main work");
    await h.prompt("/discard-task");
    assert.strictEqual(h.getStatus(), undefined);
    h.assertSession(user("main work"), assistant("working..."), notification("No pending task to discard."));
  }).run();

  node("finish [no task]", async (h) => {
    h.llm.onPrompt("main work", responds("working..."));
    await h.prompt("main work");
    await h.prompt("/finish-task");
    assert.strictEqual(h.getStatus(), undefined);
    h.assertSession(user("main work"), assistant("working..."), notification("Not inside task, nothing to finish."));
  }).run();

  node("abort [no task]", async (h) => {
    h.llm.onPrompt("main work", responds("working..."));
    await h.prompt("main work");
    await h.prompt("/abort-task");
    assert.strictEqual(h.getStatus(), undefined);
    h.assertSession(user("main work"), assistant("working..."), notification("Not inside task, nothing to abort."));
  }).run();
});
