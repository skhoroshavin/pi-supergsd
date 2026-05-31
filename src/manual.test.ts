import assert from "node:assert";

import {
  assistant,
  notification,
  node,
  task,
  taskResult,
  user,
} from "./test-helpers/index.js";

import { describe } from "node:test";

describe("manual workflow", () => {
  node("push AAA", async (h) => {
    h.appendUserMessage("main work");
    h.appendAssistantMessage("working...");
    await h.runPushTask("Task AAA");
    assert.strictEqual(h.getStatus(), "pending task: task-aaa");
    assert.ok(!h.isLlmTriggered());
    h.assertBranchHistory(
      user("main work"),
      assistant("working..."),
      task("Task AAA"),
      notification("Task stored. Use `/start-task` or `/auto` to start it."),
    );
  })
    .children(
      node("discard AAA", async (h) => {
        await h.runDiscardTask();
        assert.strictEqual(h.getStatus(), undefined);
        assert.ok(!h.isLlmTriggered());
        h.assertBranchHistory(
          user("main work"),
          assistant("working..."),
          task("Task AAA"),
          notification("Task discarded."),
        );
      }),
      node("start AAA", async (h) => {
        await h.runStartTask();
        assert.strictEqual(h.getStatus(), "current task: task-aaa");
        assert.ok(h.isLlmTriggered());
        h.assertBranchHistory(user("Task AAA"));
      }).children(
        node("finish AAA", async (h) => {
          h.appendAssistantMessage("Done.");
          await h.runFinishTask();
          assert.strictEqual(h.getStatus(), undefined);
          assert.ok(h.isLlmTriggered());
          h.assertBranchHistory(
            user("main work"),
            assistant("working..."),
            task("Task AAA"),
            taskResult("task-aaa", "Done."),
            notification("Task finished. Last response attached."),
          );
        }).children(
          node("start [no task]", async (h) => {
            await h.runStartTask();
            assert.strictEqual(h.getStatus(), undefined);
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
              notification("No pending task. Use push-task first."),
            );
          }),
          node("discard [no task]", async (h) => {
            await h.runDiscardTask();
            assert.strictEqual(h.getStatus(), undefined);
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
              notification("No pending task to discard."),
            );
          }),
          node("finish [no task]", async (h) => {
            await h.runFinishTask();
            assert.strictEqual(h.getStatus(), undefined);
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
              notification("Not inside task, nothing to finish."),
            );
          }),
          node("abort [no task]", async (h) => {
            await h.runAbortTask();
            assert.strictEqual(h.getStatus(), undefined);
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
              notification("Not inside task, nothing to abort."),
            );
          }),
        ),
        node("abort AAA", async (h) => {
          h.appendAssistantMessage("Partial...");
          await h.runAbortTask();
          assert.strictEqual(h.getStatus(), "pending task: task-aaa");
          assert.ok(!h.isLlmTriggered());
          h.assertBranchHistory(
            user("main work"),
            assistant("working..."),
            task("Task AAA"),
            notification("Task aborted. Branch abandoned without summary."),
          );
        }).children(
          node("start AAA", async (h) => {
            await h.runStartTask();
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(user("Task AAA"));
          }).children(
            node("finish AAA", async (h) => {
              h.appendAssistantMessage("Done.");
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                task("Task AAA"),
                taskResult("task-aaa", "Done."),
                notification("Task finished. Last response attached."),
              );
            }),
          ),
        ),
        node("push BBB", async (h) => {
          h.appendAssistantMessage("some more work");
          await h.runPushTask("Task BBB");
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          assert.ok(!h.isLlmTriggered());
          h.assertBranchHistory(
            user("Task AAA"),
            assistant("some more work"),
            task("Task BBB"),
            notification(
              "Task stored. Use `/start-task` or `/auto` to start it.",
            ),
          );
        }).children(
          node("discard BBB", async (h) => {
            await h.runDiscardTask();
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            assert.ok(!h.isLlmTriggered());
            h.assertBranchHistory(
              user("Task AAA"),
              assistant("some more work"),
              task("Task BBB"),
              notification("Task discarded."),
            );
          }).children(
            node("finish AAA", async (h) => {
              h.appendAssistantMessage("Done.");
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                task("Task AAA"),
                taskResult("task-aaa", "Done."),
                notification("Task finished. Last response attached."),
              );
            }),
          ),
          node("start BBB", async (h) => {
            await h.runStartTask();
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(user("Task BBB"));
          }).children(
            node("finish BBB", async (h) => {
              h.appendAssistantMessage("inner done");
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), "current task: task-aaa");
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user("Task AAA"),
                assistant("some more work"),
                task("Task BBB"),
                taskResult("task-bbb", "inner done"),
                notification("Task finished. Last response attached."),
              );
            }).children(
              node("finish AAA", async (h) => {
                h.appendAssistantMessage("Done.");
                await h.runFinishTask();
                assert.strictEqual(h.getStatus(), undefined);
                assert.ok(h.isLlmTriggered());
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  task("Task AAA"),
                  taskResult("task-aaa", "Done."),
                  notification("Task finished. Last response attached."),
                );
              }),
            ),
            node("abort BBB", async (h) => {
              h.appendAssistantMessage("partial inner");
              await h.runAbortTask();
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              assert.ok(!h.isLlmTriggered());
              h.assertBranchHistory(
                user("Task AAA"),
                assistant("some more work"),
                task("Task BBB"),
                notification("Task aborted. Branch abandoned without summary."),
              );
            }).children(
              node("finish AAA", async (h) => {
                h.appendAssistantMessage("Done.");
                await h.runFinishTask();
                assert.strictEqual(h.getStatus(), undefined);
                assert.ok(h.isLlmTriggered());
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  task("Task AAA"),
                  taskResult("task-aaa", "Done."),
                  notification("Task finished. Last response attached."),
                );
              }),
            ),
          ),
        ),
        node("push BBB [inherit]", async (h) => {
          h.appendAssistantMessage("some more work");
          await h.runPushTask("Task BBB", true);
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          assert.ok(!h.isLlmTriggered());
          h.assertBranchHistory(
            user("Task AAA"),
            assistant("some more work"),
            task("Task BBB", true),
            notification(
              "Task stored. Use `/start-task` or `/auto` to start it.",
            ),
          );
        }).children(
          node("discard BBB [inherit]", async (h) => {
            await h.runDiscardTask();
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            assert.ok(!h.isLlmTriggered());
            h.assertBranchHistory(
              user("Task AAA"),
              assistant("some more work"),
              task("Task BBB", true),
              notification("Task discarded."),
            );
          }).children(
            node("finish AAA", async (h) => {
              h.appendAssistantMessage("Done.");
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                task("Task AAA"),
                taskResult("task-aaa", "Done."),
                notification("Task finished. Last response attached."),
              );
            }),
          ),
          node("start BBB [inherit]", async (h) => {
            await h.runStartTask();
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user("Task AAA"),
              assistant("some more work"),
              task("Task BBB", true),
              user("Task BBB"),
            );
          }).children(
            node("finish BBB [inherit]", async (h) => {
              h.appendAssistantMessage("inner done");
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), "current task: task-aaa");
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user("Task AAA"),
                assistant("some more work"),
                task("Task BBB", true),
                taskResult("task-bbb", "inner done"),
                notification("Task finished. Last response attached."),
              );
            }).children(
              node("finish AAA", async (h) => {
                h.appendAssistantMessage("Done.");
                await h.runFinishTask();
                assert.strictEqual(h.getStatus(), undefined);
                assert.ok(h.isLlmTriggered());
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  task("Task AAA"),
                  taskResult("task-aaa", "Done."),
                  notification("Task finished. Last response attached."),
                );
              }),
            ),
            node("abort BBB [inherit]", async (h) => {
              h.appendAssistantMessage("partial inner");
              await h.runAbortTask();
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              assert.ok(!h.isLlmTriggered());
              h.assertBranchHistory(
                user("Task AAA"),
                assistant("some more work"),
                task("Task BBB", true),
                notification("Task aborted. Branch abandoned without summary."),
              );
            }).children(
              node("finish AAA", async (h) => {
                h.appendAssistantMessage("Done.");
                await h.runFinishTask();
                assert.strictEqual(h.getStatus(), undefined);
                assert.ok(h.isLlmTriggered());
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  task("Task AAA"),
                  taskResult("task-aaa", "Done."),
                  notification("Task finished. Last response attached."),
                );
              }),
            ),
          ),
        ),
      ),
    )
    .run();

  node("push AAA [inherit]", async (h) => {
    h.appendUserMessage("main work");
    h.appendAssistantMessage("working...");
    await h.runPushTask("Task AAA", true);
    assert.strictEqual(h.getStatus(), "pending task: task-aaa");
    assert.ok(!h.isLlmTriggered());
    h.assertBranchHistory(
      user("main work"),
      assistant("working..."),
      task("Task AAA", true),
      notification("Task stored. Use `/start-task` or `/auto` to start it."),
    );
  })
    .children(
      node("discard AAA", async (h) => {
        await h.runDiscardTask();
        assert.strictEqual(h.getStatus(), undefined);
        assert.ok(!h.isLlmTriggered());
        h.assertBranchHistory(
          user("main work"),
          assistant("working..."),
          task("Task AAA", true),
          notification("Task discarded."),
        );
      }),
      node("start AAA", async (h) => {
        await h.runStartTask();
        assert.strictEqual(h.getStatus(), "current task: task-aaa");
        assert.ok(h.isLlmTriggered());
        h.assertBranchHistory(
          user("main work"),
          assistant("working..."),
          task("Task AAA", true),
          user("Task AAA"),
        );
      }).children(
        node("finish AAA", async (h) => {
          h.appendAssistantMessage("Done.");
          await h.runFinishTask();
          assert.strictEqual(h.getStatus(), undefined);
          assert.ok(h.isLlmTriggered());
          h.assertBranchHistory(
            user("main work"),
            assistant("working..."),
            task("Task AAA", true),
            taskResult("task-aaa", "Done."),
            notification("Task finished. Last response attached."),
          );
        }).children(
          node("start [no task]", async (h) => {
            await h.runStartTask();
            assert.strictEqual(h.getStatus(), undefined);
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
              notification("No pending task. Use push-task first."),
            );
          }),
          node("discard [no task]", async (h) => {
            await h.runDiscardTask();
            assert.strictEqual(h.getStatus(), undefined);
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
              notification("No pending task to discard."),
            );
          }),
          node("finish [no task]", async (h) => {
            await h.runFinishTask();
            assert.strictEqual(h.getStatus(), undefined);
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
              notification("Not inside task, nothing to finish."),
            );
          }),
          node("abort [no task]", async (h) => {
            await h.runAbortTask();
            assert.strictEqual(h.getStatus(), undefined);
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
              notification("Not inside task, nothing to abort."),
            );
          }),
        ),
        node("abort AAA", async (h) => {
          h.appendAssistantMessage("Partial...");
          await h.runAbortTask();
          assert.strictEqual(h.getStatus(), "pending task: task-aaa");
          assert.ok(!h.isLlmTriggered());
          h.assertBranchHistory(
            user("main work"),
            assistant("working..."),
            task("Task AAA", true),
            notification("Task aborted. Branch abandoned without summary."),
          );
        }).children(
          node("start AAA", async (h) => {
            await h.runStartTask();
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              task("Task AAA", true),
              user("Task AAA"),
            );
          }).children(
            node("finish AAA", async (h) => {
              h.appendAssistantMessage("Done.");
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                task("Task AAA", true),
                taskResult("task-aaa", "Done."),
                notification("Task finished. Last response attached."),
              );
            }),
          ),
        ),
        node("push BBB", async (h) => {
          h.appendAssistantMessage("some more work");
          await h.runPushTask("Task BBB");
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          assert.ok(!h.isLlmTriggered());
          h.assertBranchHistory(
            user("main work"),
            assistant("working..."),
            task("Task AAA", true),
            user("Task AAA"),
            assistant("some more work"),
            task("Task BBB"),
            notification(
              "Task stored. Use `/start-task` or `/auto` to start it.",
            ),
          );
        }).children(
          node("discard BBB", async (h) => {
            await h.runDiscardTask();
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            assert.ok(!h.isLlmTriggered());
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              task("Task AAA", true),
              user("Task AAA"),
              assistant("some more work"),
              task("Task BBB"),
              notification("Task discarded."),
            );
          }).children(
            node("finish AAA", async (h) => {
              h.appendAssistantMessage("Done.");
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                task("Task AAA", true),
                taskResult("task-aaa", "Done."),
                notification("Task finished. Last response attached."),
              );
            }),
          ),
          node("start BBB", async (h) => {
            await h.runStartTask();
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(user("Task BBB"));
          }).children(
            node("finish BBB", async (h) => {
              h.appendAssistantMessage("inner done");
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), "current task: task-aaa");
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("some more work"),
                task("Task BBB"),
                taskResult("task-bbb", "inner done"),
                notification("Task finished. Last response attached."),
              );
            }).children(
              node("finish AAA", async (h) => {
                h.appendAssistantMessage("Done.");
                await h.runFinishTask();
                assert.strictEqual(h.getStatus(), undefined);
                assert.ok(h.isLlmTriggered());
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  task("Task AAA", true),
                  taskResult("task-aaa", "Done."),
                  notification("Task finished. Last response attached."),
                );
              }),
            ),
            node("abort BBB", async (h) => {
              h.appendAssistantMessage("partial inner");
              await h.runAbortTask();
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              assert.ok(!h.isLlmTriggered());
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("some more work"),
                task("Task BBB"),
                notification("Task aborted. Branch abandoned without summary."),
              );
            }).children(
              node("finish AAA", async (h) => {
                h.appendAssistantMessage("Done.");
                await h.runFinishTask();
                assert.strictEqual(h.getStatus(), undefined);
                assert.ok(h.isLlmTriggered());
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  task("Task AAA", true),
                  taskResult("task-aaa", "Done."),
                  notification("Task finished. Last response attached."),
                );
              }),
            ),
          ),
        ),
        node("push BBB [inherit]", async (h) => {
          h.appendAssistantMessage("some more work");
          await h.runPushTask("Task BBB", true);
          assert.strictEqual(h.getStatus(), "pending task: task-bbb");
          assert.ok(!h.isLlmTriggered());
          h.assertBranchHistory(
            user("main work"),
            assistant("working..."),
            task("Task AAA", true),
            user("Task AAA"),
            assistant("some more work"),
            task("Task BBB", true),
            notification(
              "Task stored. Use `/start-task` or `/auto` to start it.",
            ),
          );
        }).children(
          node("discard BBB [inherit]", async (h) => {
            await h.runDiscardTask();
            assert.strictEqual(h.getStatus(), "current task: task-aaa");
            assert.ok(!h.isLlmTriggered());
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              task("Task AAA", true),
              user("Task AAA"),
              assistant("some more work"),
              task("Task BBB", true),
              notification("Task discarded."),
            );
          }).children(
            node("finish AAA", async (h) => {
              h.appendAssistantMessage("Done.");
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), undefined);
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                task("Task AAA", true),
                taskResult("task-aaa", "Done."),
                notification("Task finished. Last response attached."),
              );
            }),
          ),
          node("start BBB [inherit]", async (h) => {
            await h.runStartTask();
            assert.strictEqual(h.getStatus(), "current task: task-bbb");
            assert.ok(h.isLlmTriggered());
            h.assertBranchHistory(
              user("main work"),
              assistant("working..."),
              task("Task AAA", true),
              user("Task AAA"),
              assistant("some more work"),
              task("Task BBB", true),
              user("Task BBB"),
            );
          }).children(
            node("finish BBB [inherit]", async (h) => {
              h.appendAssistantMessage("inner done");
              await h.runFinishTask();
              assert.strictEqual(h.getStatus(), "current task: task-aaa");
              assert.ok(h.isLlmTriggered());
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("some more work"),
                task("Task BBB", true),
                taskResult("task-bbb", "inner done"),
                notification("Task finished. Last response attached."),
              );
            }).children(
              node("finish AAA", async (h) => {
                h.appendAssistantMessage("Done.");
                await h.runFinishTask();
                assert.strictEqual(h.getStatus(), undefined);
                assert.ok(h.isLlmTriggered());
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  task("Task AAA", true),
                  taskResult("task-aaa", "Done."),
                  notification("Task finished. Last response attached."),
                );
              }),
            ),
            node("abort BBB [inherit]", async (h) => {
              h.appendAssistantMessage("partial inner");
              await h.runAbortTask();
              assert.strictEqual(h.getStatus(), "pending task: task-bbb");
              assert.ok(!h.isLlmTriggered());
              h.assertBranchHistory(
                user("main work"),
                assistant("working..."),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("some more work"),
                task("Task BBB", true),
                notification("Task aborted. Branch abandoned without summary."),
              );
            }).children(
              node("finish AAA", async (h) => {
                h.appendAssistantMessage("Done.");
                await h.runFinishTask();
                assert.strictEqual(h.getStatus(), undefined);
                assert.ok(h.isLlmTriggered());
                h.assertBranchHistory(
                  user("main work"),
                  assistant("working..."),
                  task("Task AAA", true),
                  taskResult("task-aaa", "Done."),
                  notification("Task finished. Last response attached."),
                );
              }),
            ),
          ),
        ),
      ),
    )
    .run();

  node("start [no task]", async (h) => {
    h.appendUserMessage("main work");
    h.appendAssistantMessage("working...");
    await h.runStartTask();
    assert.strictEqual(h.getStatus(), undefined);
    assert.ok(!h.isLlmTriggered());
    h.assertBranchHistory(
      user("main work"),
      assistant("working..."),
      notification("No pending task. Use push-task first."),
    );
  }).run();

  node("discard [no task]", async (h) => {
    h.appendUserMessage("main work");
    h.appendAssistantMessage("working...");
    await h.runDiscardTask();
    assert.strictEqual(h.getStatus(), undefined);
    assert.ok(!h.isLlmTriggered());
    h.assertBranchHistory(
      user("main work"),
      assistant("working..."),
      notification("No pending task to discard."),
    );
  }).run();

  node("finish [no task]", async (h) => {
    h.appendUserMessage("main work");
    h.appendAssistantMessage("working...");
    await h.runFinishTask();
    assert.strictEqual(h.getStatus(), undefined);
    assert.ok(!h.isLlmTriggered());
    h.assertBranchHistory(
      user("main work"),
      assistant("working..."),
      notification("Not inside task, nothing to finish."),
    );
  }).run();

  node("abort [no task]", async (h) => {
    h.appendUserMessage("main work");
    h.appendAssistantMessage("working...");
    await h.runAbortTask();
    assert.strictEqual(h.getStatus(), undefined);
    assert.ok(!h.isLlmTriggered());
    h.assertBranchHistory(
      user("main work"),
      assistant("working..."),
      notification("Not inside task, nothing to abort."),
    );
  }).run();
});
