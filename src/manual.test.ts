import assert from "node:assert";

import {
  assistant,
  node,
  responds,
  pushTask,
  task,
  taskResult,
  user,
} from "./test-helpers/index.js";

import { describe } from "node:test";

describe("manual workflow", () => {
  node("push AAA", async (h) => {
    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));
    h.llm.onPrompt("some more work", responds("Great!"));
    h.llm.onPrompt("Great!", responds("Great!"));
    h.llm.onPrompt("Task BBB", responds("inner done"));
    h.llm.onPrompt("inner done", responds("Great!"));
    await h.prompt("main work");
    assert.strictEqual(h.getStatus(), "pending task: task-aaa");
    h.assertBranchHistory(
      user("main work"),
      assistant("working...", "toolUse"),
      task("Task AAA"),
    );
    h.assertNotifications(
      "Task stored. Use `/start-task` or `/auto` to start it.",
    );
  })
    .children(
      node("discard AAA", async (h) => {
        await h.prompt("/discard-task");
        assert.strictEqual(h.getStatus(), undefined);
        h.assertBranchHistory(
          user("main work"),
          assistant("working...", "toolUse"),
          task("Task AAA"),
        );
        h.assertNotifications("Task discarded.");
      }),
      node("start AAA", async (h) => {
        await h.prompt("/start-task");
        assert.strictEqual(h.getStatus(), "current task: task-aaa");
        h.assertBranchHistory(user("Task AAA"), assistant("Done."));
      }).children(
        node("finish AAA", async (h) => {
          await h.prompt("/finish-task");
          assert.strictEqual(h.getStatus(), undefined);
          h.assertBranchHistory(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA"),
            taskResult("task-aaa", "Done."),
            assistant("Great!"),
          );
          h.assertNotifications("Task finished. Last response attached.");
        }).children(
          node("start [no task]", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            h.assertNotifications("No pending task. Use push-task first.");
          }),
          node("discard [no task]", async (h) => {
            await h.prompt("/discard-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            h.assertNotifications("No pending task to discard.");
          }),
          node("finish [no task]", async (h) => {
            await h.prompt("/finish-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            h.assertNotifications("Not inside task, nothing to finish.");
          }),
          node("abort [no task]", async (h) => {
            await h.prompt("/abort-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            h.assertNotifications("Not inside task, nothing to abort.");
          }),
        ),
        node("abort AAA", async (h) => {
          await h.prompt("/abort-task");
          assert.strictEqual(h.getStatus(), "pending task: task-aaa");
          h.assertBranchHistory(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA"),
          );
          h.assertNotifications(
            "Task aborted. Branch abandoned without summary.",
          );
        }).children(
          node("start AAA", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            h.assertBranchHistory(user("Task AAA"), assistant("Done."));
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA"),
                taskResult("task-aaa", "Done."),
                assistant("Great!"),
              );
              h.assertNotifications("Task finished. Last response attached.");
            }),
          ),
        ),
        node("push BBB", async (h) => {
          h.llm.onPrompt(
            "continue AAA",
            responds("some more work"),
            pushTask("Task BBB"),
          );
          await h.prompt("continue AAA");
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          h.assertBranchHistory(
            user("Task AAA"),
            assistant("Done."),
            user("continue AAA"),
            assistant("some more work", "toolUse"),
            task("Task BBB"),
          );
          h.assertNotifications(
            "Task stored. Use `/start-task` or `/auto` to start it.",
          );
        }).children(
          node("discard BBB", async (h) => {
            await h.prompt("/discard-task");
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            h.assertBranchHistory(
              user("Task AAA"),
              assistant("Done."),
              user("continue AAA"),
              assistant("some more work", "toolUse"),
              task("Task BBB"),
            );
            h.assertNotifications("Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA"),
                taskResult("task-aaa", "some more work"),
                assistant("Great!"),
              );
              h.assertNotifications("Task finished. Last response attached.");
            }),
          ),
          node("start BBB", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            h.assertBranchHistory(user("Task BBB"), assistant("inner done"));
          }).children(
            node("finish BBB", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), "current task: task-aaa");
              h.assertBranchHistory(
                user("Task AAA"),
                assistant("Done."),
                user("continue AAA"),
                assistant("some more work", "toolUse"),
                task("Task BBB"),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
              h.assertNotifications("Task finished. Last response attached.");
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
                h.assertNotifications("Task finished. Last response attached.");
              }),
            ),
            node("abort BBB", async (h) => {
              await h.prompt("/abort-task");
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              h.assertBranchHistory(
                user("Task AAA"),
                assistant("Done."),
                user("continue AAA"),
                assistant("some more work", "toolUse"),
                task("Task BBB"),
              );
              h.assertNotifications(
                "Task aborted. Branch abandoned without summary.",
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  taskResult("task-aaa", "some more work"),
                  assistant("Great!"),
                );
                h.assertNotifications("Task finished. Last response attached.");
              }),
            ),
          ),
        ),
        node("push BBB [inherit]", async (h) => {
          h.llm.onPrompt(
            "continue AAA [inherit]",
            responds("some more work"),
            pushTask("Task BBB", true),
          );
          await h.prompt("continue AAA [inherit]");
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          h.assertBranchHistory(
            user("Task AAA"),
            assistant("Done."),
            user("continue AAA [inherit]"),
            assistant("some more work", "toolUse"),
            task("Task BBB", true),
          );
          h.assertNotifications(
            "Task stored. Use `/start-task` or `/auto` to start it.",
          );
        }).children(
          node("discard BBB [inherit]", async (h) => {
            await h.prompt("/discard-task");
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            h.assertBranchHistory(
              user("Task AAA"),
              assistant("Done."),
              user("continue AAA [inherit]"),
              assistant("some more work", "toolUse"),
              task("Task BBB", true),
            );
            h.assertNotifications("Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA"),
                taskResult("task-aaa", "some more work"),
                assistant("Great!"),
              );
              h.assertNotifications("Task finished. Last response attached.");
            }),
          ),
          node("start BBB [inherit]", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            h.assertBranchHistory(
              user("Task AAA"),
              assistant("Done."),
              user("continue AAA [inherit]"),
              assistant("some more work", "toolUse"),
              task("Task BBB", true),
              user("Task BBB"),
              assistant("inner done"),
            );
          }).children(
            node("finish BBB [inherit]", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), "current task: task-aaa");
              h.assertBranchHistory(
                user("Task AAA"),
                assistant("Done."),
                user("continue AAA [inherit]"),
                assistant("some more work", "toolUse"),
                task("Task BBB", true),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
              h.assertNotifications("Task finished. Last response attached.");
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
                h.assertNotifications("Task finished. Last response attached.");
              }),
            ),
            node("abort BBB [inherit]", async (h) => {
              await h.prompt("/abort-task");
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              h.assertBranchHistory(
                user("Task AAA"),
                assistant("Done."),
                user("continue AAA [inherit]"),
                assistant("some more work", "toolUse"),
                task("Task BBB", true),
              );
              h.assertNotifications(
                "Task aborted. Branch abandoned without summary.",
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  taskResult("task-aaa", "some more work"),
                  assistant("Great!"),
                );
                h.assertNotifications("Task finished. Last response attached.");
              }),
            ),
          ),
        ),
      ),
    )
    .run();

  node("push AAA [inherit]", async (h) => {
    h.llm.onPrompt(
      "main work",
      responds("working..."),
      pushTask("Task AAA", true),
    );
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));
    h.llm.onPrompt("some more work", responds("Great!"));
    h.llm.onPrompt("Great!", responds("Great!"));
    h.llm.onPrompt("Task BBB", responds("inner done"));
    h.llm.onPrompt("inner done", responds("Great!"));
    await h.prompt("main work");
    assert.strictEqual(h.getStatus(), "pending task: task-aaa");
    h.assertBranchHistory(
      user("main work"),
      assistant("working...", "toolUse"),
      task("Task AAA", true),
    );
    h.assertNotifications(
      "Task stored. Use `/start-task` or `/auto` to start it.",
    );
  })
    .children(
      node("discard AAA", async (h) => {
        await h.prompt("/discard-task");
        assert.strictEqual(h.getStatus(), undefined);
        h.assertBranchHistory(
          user("main work"),
          assistant("working...", "toolUse"),
          task("Task AAA", true),
        );
        h.assertNotifications("Task discarded.");
      }),
      node("start AAA", async (h) => {
        await h.prompt("/start-task");
        assert.strictEqual(h.getStatus(), "current task: task-aaa");
        h.assertBranchHistory(
          user("main work"),
          assistant("working...", "toolUse"),
          task("Task AAA", true),
          user("Task AAA"),
          assistant("Done."),
        );
      }).children(
        node("finish AAA", async (h) => {
          await h.prompt("/finish-task");
          assert.strictEqual(h.getStatus(), undefined);
          h.assertBranchHistory(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", true),
            taskResult("task-aaa", "Done."),
            assistant("Great!"),
          );
          h.assertNotifications("Task finished. Last response attached.");
        }).children(
          node("start [no task]", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            h.assertNotifications("No pending task. Use push-task first.");
          }),
          node("discard [no task]", async (h) => {
            await h.prompt("/discard-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            h.assertNotifications("No pending task to discard.");
          }),
          node("finish [no task]", async (h) => {
            await h.prompt("/finish-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            h.assertNotifications("Not inside task, nothing to finish.");
          }),
          node("abort [no task]", async (h) => {
            await h.prompt("/abort-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            h.assertNotifications("Not inside task, nothing to abort.");
          }),
        ),
        node("abort AAA", async (h) => {
          await h.prompt("/abort-task");
          assert.strictEqual(h.getStatus(), "pending task: task-aaa");
          h.assertBranchHistory(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", true),
          );
          h.assertNotifications(
            "Task aborted. Branch abandoned without summary.",
          );
        }).children(
          node("start AAA", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            h.assertBranchHistory(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              user("Task AAA"),
              assistant("Done."),
            );
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                taskResult("task-aaa", "Done."),
                assistant("Great!"),
              );
              h.assertNotifications("Task finished. Last response attached.");
            }),
          ),
        ),
        node("push BBB", async (h) => {
          h.llm.onPrompt(
            "continue AAA",
            responds("some more work"),
            pushTask("Task BBB"),
          );
          await h.prompt("continue AAA");
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          h.assertBranchHistory(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", true),
            user("Task AAA"),
            assistant("Done."),
            user("continue AAA"),
            assistant("some more work", "toolUse"),
            task("Task BBB"),
          );
          h.assertNotifications(
            "Task stored. Use `/start-task` or `/auto` to start it.",
          );
        }).children(
          node("discard BBB", async (h) => {
            await h.prompt("/discard-task");
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            h.assertBranchHistory(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              user("Task AAA"),
              assistant("Done."),
              user("continue AAA"),
              assistant("some more work", "toolUse"),
              task("Task BBB"),
            );
            h.assertNotifications("Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                taskResult("task-aaa", "some more work"),
                assistant("Great!"),
              );
              h.assertNotifications("Task finished. Last response attached.");
            }),
          ),
          node("start BBB", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            h.assertBranchHistory(user("Task BBB"), assistant("inner done"));
          }).children(
            node("finish BBB", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), "current task: task-aaa");
              h.assertBranchHistory(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("Done."),
                user("continue AAA"),
                assistant("some more work", "toolUse"),
                task("Task BBB"),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
              h.assertNotifications("Task finished. Last response attached.");
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
                h.assertNotifications("Task finished. Last response attached.");
              }),
            ),
            node("abort BBB", async (h) => {
              await h.prompt("/abort-task");
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              h.assertBranchHistory(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("Done."),
                user("continue AAA"),
                assistant("some more work", "toolUse"),
                task("Task BBB"),
              );
              h.assertNotifications(
                "Task aborted. Branch abandoned without summary.",
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  taskResult("task-aaa", "some more work"),
                  assistant("Great!"),
                );
                h.assertNotifications("Task finished. Last response attached.");
              }),
            ),
          ),
        ),
        node("push BBB [inherit]", async (h) => {
          h.llm.onPrompt(
            "continue AAA [inherit]",
            responds("some more work"),
            pushTask("Task BBB", true),
          );
          await h.prompt("continue AAA [inherit]");
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          h.assertBranchHistory(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", true),
            user("Task AAA"),
            assistant("Done."),
            user("continue AAA [inherit]"),
            assistant("some more work", "toolUse"),
            task("Task BBB", true),
          );
          h.assertNotifications(
            "Task stored. Use `/start-task` or `/auto` to start it.",
          );
        }).children(
          node("discard BBB [inherit]", async (h) => {
            await h.prompt("/discard-task");
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            h.assertBranchHistory(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              user("Task AAA"),
              assistant("Done."),
              user("continue AAA [inherit]"),
              assistant("some more work", "toolUse"),
              task("Task BBB", true),
            );
            h.assertNotifications("Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                taskResult("task-aaa", "some more work"),
                assistant("Great!"),
              );
              h.assertNotifications("Task finished. Last response attached.");
            }),
          ),
          node("start BBB [inherit]", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            h.assertBranchHistory(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              user("Task AAA"),
              assistant("Done."),
              user("continue AAA [inherit]"),
              assistant("some more work", "toolUse"),
              task("Task BBB", true),
              user("Task BBB"),
              assistant("inner done"),
            );
          }).children(
            node("finish BBB [inherit]", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), "current task: task-aaa");
              h.assertBranchHistory(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("Done."),
                user("continue AAA [inherit]"),
                assistant("some more work", "toolUse"),
                task("Task BBB", true),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
              h.assertNotifications("Task finished. Last response attached.");
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
                h.assertNotifications("Task finished. Last response attached.");
              }),
            ),
            node("abort BBB [inherit]", async (h) => {
              await h.prompt("/abort-task");
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              h.assertBranchHistory(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("Done."),
                user("continue AAA [inherit]"),
                assistant("some more work", "toolUse"),
                task("Task BBB", true),
              );
              h.assertNotifications(
                "Task aborted. Branch abandoned without summary.",
              );
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  taskResult("task-aaa", "some more work"),
                  assistant("Great!"),
                );
                h.assertNotifications("Task finished. Last response attached.");
              }),
            ),
          ),
        ),
      ),
    )
    .run();

  node("start [no task]", async (h) => {
    h.llm.onPrompt("main work", responds("working..."));
    await h.prompt("main work");
    await h.prompt("/start-task");
    assert.strictEqual(h.getStatus(), undefined);
    h.assertBranchHistory(user("main work"), assistant("working..."));
    h.assertNotifications("No pending task. Use push-task first.");
  }).run();

  node("discard [no task]", async (h) => {
    h.llm.onPrompt("main work", responds("working..."));
    await h.prompt("main work");
    await h.prompt("/discard-task");
    assert.strictEqual(h.getStatus(), undefined);
    h.assertBranchHistory(user("main work"), assistant("working..."));
    h.assertNotifications("No pending task to discard.");
  }).run();

  node("finish [no task]", async (h) => {
    h.llm.onPrompt("main work", responds("working..."));
    await h.prompt("main work");
    await h.prompt("/finish-task");
    assert.strictEqual(h.getStatus(), undefined);
    h.assertBranchHistory(user("main work"), assistant("working..."));
    h.assertNotifications("Not inside task, nothing to finish.");
  }).run();

  node("abort [no task]", async (h) => {
    h.llm.onPrompt("main work", responds("working..."));
    await h.prompt("main work");
    await h.prompt("/abort-task");
    assert.strictEqual(h.getStatus(), undefined);
    h.assertBranchHistory(user("main work"), assistant("working..."));
    h.assertNotifications("Not inside task, nothing to abort.");
  }).run();
});
