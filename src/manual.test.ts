import assert from "node:assert";

import {
  assistant,
  node,
  responds,
  pushTask,
  task,
  taskResult,
  user,
  TestHarness,
} from "./test-helpers/index.js";

import { describe } from "node:test";

describe("manual workflow", () => {
  node("push AAA", async (h) => {
    h.llm.onPrompt("main work", responds("working..."));
    h.llm.onPrompt("queue AAA", pushTask("Task AAA"));
    await h.prompt("main work");
    await h.prompt("queue AAA");
    assert.strictEqual(h.getStatus(), "pending task: task-aaa");
    h.assertBranchHistory(
      user("main work"),
      assistant("working..."),
      user("queue AAA"),
      assistant("", "toolUse"),
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
          assistant("working..."),
          user("queue AAA"),
          assistant("", "toolUse"),
          task("Task AAA"),
        );
        h.assertNotifications("Task discarded.");
      }),
      node("start AAA", async (h) => {
        onTaskResponse(h, "Task AAA", "Done.");
        await h.prompt("/start-task");
        assert.strictEqual(h.getStatus(), "current task: task-aaa");
        h.assertBranchHistory(user("Task AAA"), assistant("Done."));
      }).children(
        node("finish AAA", async (h) => {
          await h.prompt("/finish-task");
          assert.strictEqual(h.getStatus(), undefined);
          h.assertBranchHistory(
            user("main work"),
            assistant("working..."),
            user("queue AAA"),
            assistant("", "toolUse"),
            task("Task AAA"),
            taskResult("task-aaa", "Done."),
            assistant(""),
          );
          h.assertNotifications("Task finished. Last response attached.");
        }).children(
          node("start [no task]", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              user("queue AAA"),
              assistant("", "toolUse"),
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
              assistant(""),
            );
            h.assertNotifications("No pending task. Use push-task first.");
          }),
          node("discard [no task]", async (h) => {
            await h.prompt("/discard-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              user("queue AAA"),
              assistant("", "toolUse"),
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
              assistant(""),
            );
            h.assertNotifications("No pending task to discard.");
          }),
          node("finish [no task]", async (h) => {
            await h.prompt("/finish-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              user("queue AAA"),
              assistant("", "toolUse"),
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
              assistant(""),
            );
            h.assertNotifications("Not inside task, nothing to finish.");
          }),
          node("abort [no task]", async (h) => {
            await h.prompt("/abort-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              user("queue AAA"),
              assistant("", "toolUse"),
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
              assistant(""),
            );
            h.assertNotifications("Not inside task, nothing to abort.");
          }),
        ),
        node("abort AAA", async (h) => {
          await h.prompt("/abort-task");
          assert.strictEqual(h.getStatus(), "pending task: task-aaa");
          h.assertBranchHistory(
            user("main work"),
            assistant("working..."),
            user("queue AAA"),
            assistant("", "toolUse"),
            task("Task AAA"),
          );
          h.assertNotifications(
            "Task aborted. Branch abandoned without summary.",
          );
        }).children(
          node("start AAA", async (h) => {
            onTaskResponse(h, "Task AAA", "Done.");
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            h.assertBranchHistory(user("Task AAA"), assistant("Done."));
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                user("queue AAA"),
                assistant("", "toolUse"),
                task("Task AAA"),
                taskResult("task-aaa", "Done."),
                assistant(""),
              );
              h.assertNotifications("Task finished. Last response attached.");
            }),
          ),
        ),
        node("push BBB", async (h) => {
          h.llm.onPrompt("queue BBB", pushTask("Task BBB"));
          await h.prompt("queue BBB");
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          h.assertBranchHistory(
            user("Task AAA"),
            assistant("Done."),
            user("queue BBB"),
            assistant("", "toolUse"),
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
              user("queue BBB"),
              assistant("", "toolUse"),
              task("Task BBB"),
            );
            h.assertNotifications("Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              expectBlankPrompt(h);
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                user("queue AAA"),
                assistant("", "toolUse"),
                task("Task AAA"),
                taskResult("task-aaa"),
                assistant(""),
              );
              h.assertNotifications("Task finished. Last response attached.");
            }),
          ),
          node("start BBB", async (h) => {
            onTaskResponse(h, "Task BBB", "inner done");
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
                user("queue BBB"),
                assistant("", "toolUse"),
                task("Task BBB"),
                taskResult("task-bbb", "inner done"),
                assistant(""),
              );
              h.assertNotifications("Task finished. Last response attached.");
            }).children(
              node("finish AAA", async (h) => {
                expectBlankPrompt(h);
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  user("queue AAA"),
                  assistant("", "toolUse"),
                  task("Task AAA"),
                  taskResult("task-aaa"),
                  assistant(""),
                );
                h.assertNotifications(
                  "Task finished. Last response attached.",
                );
              }),
            ),
            node("abort BBB", async (h) => {
              await h.prompt("/abort-task");
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              h.assertBranchHistory(
                user("Task AAA"),
                assistant("Done."),
                user("queue BBB"),
                assistant("", "toolUse"),
                task("Task BBB"),
              );
              h.assertNotifications(
                "Task aborted. Branch abandoned without summary.",
              );
            }).children(
              node("finish AAA", async (h) => {
                expectBlankPrompt(h);
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  user("queue AAA"),
                  assistant("", "toolUse"),
                  task("Task AAA"),
                  taskResult("task-aaa"),
                  assistant(""),
                );
                h.assertNotifications(
                  "Task finished. Last response attached.",
                );
              }),
            ),
          ),
        ),
        node("push BBB [inherit]", async (h) => {
          h.llm.onPrompt(
            "queue BBB [inherit]",
            pushTask("Task BBB", true),
          );
          await h.prompt("queue BBB [inherit]");
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          h.assertBranchHistory(
            user("Task AAA"),
            assistant("Done."),
            user("queue BBB [inherit]"),
            assistant("", "toolUse"),
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
              user("queue BBB [inherit]"),
              assistant("", "toolUse"),
              task("Task BBB", true),
            );
            h.assertNotifications("Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              expectBlankPrompt(h);
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                user("queue AAA"),
                assistant("", "toolUse"),
                task("Task AAA"),
                taskResult("task-aaa"),
                assistant(""),
              );
              h.assertNotifications(
                "Task finished. Last response attached.",
              );
            }),
          ),
          node("start BBB [inherit]", async (h) => {
            onTaskResponse(h, "Task BBB", "inner done");
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            h.assertBranchHistory(
              user("Task AAA"),
              assistant("Done."),
              user("queue BBB [inherit]"),
              assistant("", "toolUse"),
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
                user("queue BBB [inherit]"),
                assistant("", "toolUse"),
                task("Task BBB", true),
                taskResult("task-bbb", "inner done"),
                assistant(""),
              );
              h.assertNotifications(
                "Task finished. Last response attached.",
              );
            }).children(
              node("finish AAA", async (h) => {
                expectBlankPrompt(h);
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  user("queue AAA"),
                  assistant("", "toolUse"),
                  task("Task AAA"),
                  taskResult("task-aaa"),
                  assistant(""),
                );
                h.assertNotifications(
                  "Task finished. Last response attached.",
                );
              }),
            ),
            node("abort BBB [inherit]", async (h) => {
              await h.prompt("/abort-task");
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              h.assertBranchHistory(
                user("Task AAA"),
                assistant("Done."),
                user("queue BBB [inherit]"),
                assistant("", "toolUse"),
                task("Task BBB", true),
              );
              h.assertNotifications(
                "Task aborted. Branch abandoned without summary.",
              );
            }).children(
              node("finish AAA", async (h) => {
                expectBlankPrompt(h);
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  user("queue AAA"),
                  assistant("", "toolUse"),
                  task("Task AAA"),
                  taskResult("task-aaa"),
                  assistant(""),
                );
                h.assertNotifications(
                  "Task finished. Last response attached.",
                );
              }),
            ),
          ),
        ),
      ),
    )
    .run();

  node("push AAA [inherit]", async (h) => {
    h.llm.onPrompt("main work", responds("working..."));
    h.llm.onPrompt("queue AAA [inherit]", pushTask("Task AAA", true));
    await h.prompt("main work");
    await h.prompt("queue AAA [inherit]");
    assert.strictEqual(h.getStatus(), "pending task: task-aaa");
    h.assertBranchHistory(
      user("main work"),
      assistant("working..."),
      user("queue AAA [inherit]"),
      assistant("", "toolUse"),
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
          assistant("working..."),
          user("queue AAA [inherit]"),
          assistant("", "toolUse"),
          task("Task AAA", true),
        );
        h.assertNotifications("Task discarded.");
      }),
      node("start AAA", async (h) => {
        onTaskResponse(h, "Task AAA", "Done.");
        await h.prompt("/start-task");
        assert.strictEqual(h.getStatus(), "current task: task-aaa");
        h.assertBranchHistory(
          user("main work"),
          assistant("working..."),
          user("queue AAA [inherit]"),
          assistant("", "toolUse"),
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
            assistant("working..."),
            user("queue AAA [inherit]"),
            assistant("", "toolUse"),
            task("Task AAA", true),
            taskResult("task-aaa", "Done."),
            assistant(""),
          );
          h.assertNotifications("Task finished. Last response attached.");
        }).children(
          node("start [no task]", async (h) => {
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              user("queue AAA [inherit]"),
              assistant("", "toolUse"),
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
              assistant(""),
            );
            h.assertNotifications("No pending task. Use push-task first.");
          }),
          node("discard [no task]", async (h) => {
            await h.prompt("/discard-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              user("queue AAA [inherit]"),
              assistant("", "toolUse"),
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
              assistant(""),
            );
            h.assertNotifications("No pending task to discard.");
          }),
          node("finish [no task]", async (h) => {
            await h.prompt("/finish-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              user("queue AAA [inherit]"),
              assistant("", "toolUse"),
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
              assistant(""),
            );
            h.assertNotifications("Not inside task, nothing to finish.");
          }),
          node("abort [no task]", async (h) => {
            await h.prompt("/abort-task");
            assert.strictEqual(h.getStatus(), undefined);
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              user("queue AAA [inherit]"),
              assistant("", "toolUse"),
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
              assistant(""),
            );
            h.assertNotifications("Not inside task, nothing to abort.");
          }),
        ),
        node("abort AAA", async (h) => {
          await h.prompt("/abort-task");
          assert.strictEqual(h.getStatus(), "pending task: task-aaa");
          h.assertBranchHistory(
            user("main work"),
            assistant("working..."),
            user("queue AAA [inherit]"),
            assistant("", "toolUse"),
            task("Task AAA", true),
          );
          h.assertNotifications(
            "Task aborted. Branch abandoned without summary.",
          );
        }).children(
          node("start AAA", async (h) => {
            onTaskResponse(h, "Task AAA", "Done.");
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              user("queue AAA [inherit]"),
              assistant("", "toolUse"),
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
                assistant("working..."),
                user("queue AAA [inherit]"),
                assistant("", "toolUse"),
                task("Task AAA", true),
                taskResult("task-aaa", "Done."),
                assistant(""),
              );
              h.assertNotifications(
                "Task finished. Last response attached.",
              );
            }),
          ),
        ),
        node("push BBB", async (h) => {
          h.llm.onPrompt("queue BBB", pushTask("Task BBB"));
          await h.prompt("queue BBB");
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          h.assertBranchHistory(
            user("main work"),
            assistant("working..."),
            user("queue AAA [inherit]"),
            assistant("", "toolUse"),
            task("Task AAA", true),
            user("Task AAA"),
            assistant("Done."),
            user("queue BBB"),
            assistant("", "toolUse"),
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
              assistant("working..."),
              user("queue AAA [inherit]"),
              assistant("", "toolUse"),
              task("Task AAA", true),
              user("Task AAA"),
              assistant("Done."),
              user("queue BBB"),
              assistant("", "toolUse"),
              task("Task BBB"),
            );
            h.assertNotifications("Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              expectBlankPrompt(h);
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                user("queue AAA [inherit]"),
                assistant("", "toolUse"),
                task("Task AAA", true),
                taskResult("task-aaa"),
                assistant(""),
              );
              h.assertNotifications(
                "Task finished. Last response attached.",
              );
            }),
          ),
          node("start BBB", async (h) => {
            onTaskResponse(h, "Task BBB", "inner done");
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            h.assertBranchHistory(user("Task BBB"), assistant("inner done"));
          }).children(
            node("finish BBB", async (h) => {
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), "current task: task-aaa");
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                user("queue AAA [inherit]"),
                assistant("", "toolUse"),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("Done."),
                user("queue BBB"),
                assistant("", "toolUse"),
                task("Task BBB"),
                taskResult("task-bbb", "inner done"),
                assistant(""),
              );
              h.assertNotifications(
                "Task finished. Last response attached.",
              );
            }).children(
              node("finish AAA", async (h) => {
                expectBlankPrompt(h);
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  user("queue AAA [inherit]"),
                  assistant("", "toolUse"),
                  task("Task AAA", true),
                  taskResult("task-aaa"),
                  assistant(""),
                );
                h.assertNotifications(
                  "Task finished. Last response attached.",
                );
              }),
            ),
            node("abort BBB", async (h) => {
              await h.prompt("/abort-task");
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                user("queue AAA [inherit]"),
                assistant("", "toolUse"),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("Done."),
                user("queue BBB"),
                assistant("", "toolUse"),
                task("Task BBB"),
              );
              h.assertNotifications(
                "Task aborted. Branch abandoned without summary.",
              );
            }).children(
              node("finish AAA", async (h) => {
                expectBlankPrompt(h);
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  user("queue AAA [inherit]"),
                  assistant("", "toolUse"),
                  task("Task AAA", true),
                  taskResult("task-aaa"),
                  assistant(""),
                );
                h.assertNotifications(
                  "Task finished. Last response attached.",
                );
              }),
            ),
          ),
        ),
        node("push BBB [inherit]", async (h) => {
          h.llm.onPrompt(
            "queue BBB [inherit]",
            pushTask("Task BBB", true),
          );
          await h.prompt("queue BBB [inherit]");
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          h.assertBranchHistory(
            user("main work"),
            assistant("working..."),
            user("queue AAA [inherit]"),
            assistant("", "toolUse"),
            task("Task AAA", true),
            user("Task AAA"),
            assistant("Done."),
            user("queue BBB [inherit]"),
            assistant("", "toolUse"),
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
              assistant("working..."),
              user("queue AAA [inherit]"),
              assistant("", "toolUse"),
              task("Task AAA", true),
              user("Task AAA"),
              assistant("Done."),
              user("queue BBB [inherit]"),
              assistant("", "toolUse"),
              task("Task BBB", true),
            );
            h.assertNotifications("Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              expectBlankPrompt(h);
              await h.prompt("/finish-task");
              assert.strictEqual(h.getStatus(), undefined);
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                user("queue AAA [inherit]"),
                assistant("", "toolUse"),
                task("Task AAA", true),
                taskResult("task-aaa"),
                assistant(""),
              );
              h.assertNotifications(
                "Task finished. Last response attached.",
              );
            }),
          ),
          node("start BBB [inherit]", async (h) => {
            onTaskResponse(h, "Task BBB", "inner done");
            await h.prompt("/start-task");
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              user("queue AAA [inherit]"),
              assistant("", "toolUse"),
              task("Task AAA", true),
              user("Task AAA"),
              assistant("Done."),
              user("queue BBB [inherit]"),
              assistant("", "toolUse"),
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
                assistant("working..."),
                user("queue AAA [inherit]"),
                assistant("", "toolUse"),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("Done."),
                user("queue BBB [inherit]"),
                assistant("", "toolUse"),
                task("Task BBB", true),
                taskResult("task-bbb", "inner done"),
                assistant(""),
              );
              h.assertNotifications(
                "Task finished. Last response attached.",
              );
            }).children(
              node("finish AAA", async (h) => {
                expectBlankPrompt(h);
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  user("queue AAA [inherit]"),
                  assistant("", "toolUse"),
                  task("Task AAA", true),
                  taskResult("task-aaa"),
                  assistant(""),
                );
                h.assertNotifications(
                  "Task finished. Last response attached.",
                );
              }),
            ),
            node("abort BBB [inherit]", async (h) => {
              await h.prompt("/abort-task");
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                user("queue AAA [inherit]"),
                assistant("", "toolUse"),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("Done."),
                user("queue BBB [inherit]"),
                assistant("", "toolUse"),
                task("Task BBB", true),
              );
              h.assertNotifications(
                "Task aborted. Branch abandoned without summary.",
              );
            }).children(
              node("finish AAA", async (h) => {
                expectBlankPrompt(h);
                await h.prompt("/finish-task");
                assert.strictEqual(h.getStatus(), undefined);
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  user("queue AAA [inherit]"),
                  assistant("", "toolUse"),
                  task("Task AAA", true),
                  taskResult("task-aaa"),
                  assistant(""),
                );
                h.assertNotifications(
                  "Task finished. Last response attached.",
                );
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

// Helper: register a prompt rule for a task response and the follow-up turn
// triggered when /finish-task replays that response onto the parent branch.
function onTaskResponse(
  h: TestHarness,
  taskPrompt: string,
  response: string,
): void {
  h.llm.onPrompt(taskPrompt, responds(response));
  h.llm.onPrompt(response, responds(""));
}

function expectBlankPrompt(h: TestHarness): void {
  h.llm.onPrompt("", responds(""));
}
