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
      h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
      h.llm.onPrompt("Task AAA", responds("Done."));
      h.llm.onPrompt("Done.", responds("Great!"));
      h.llm.onPrompt("Great!", responds("Great!"));
      h.llm.onPrompt("okay", responds("Great!"));
      h.llm.onPrompt("Task BBB", responds("inner done"));
      h.llm.onPrompt("inner done", responds("Great!"));
      await h.prompt("main work");
      h.assertSession(user("main work"), assistant("working...", "toolUse"), task("Task AAA"));
      h.assertStatus("pending task: task-aaa");
    }).children(
      node("discard AAA", async (h) => {
        await h.prompt("/discard-task");
        h.assertSession(user("main work"), assistant("working...", "toolUse"), task("Task AAA"));
        h.assertStatus();
        h.assertLastNotification("Task discarded.");
      }),
      node("start AAA", async (h) => {
        await h.prompt("/start-task");
        h.assertSession(user("Task AAA"), assistant("Done."));
        h.assertStatus("current task: task-aaa");
      }).children(
        node("finish AAA", async (h) => {
          await h.prompt("/finish-task");
          h.assertSession(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA"),
            taskResult("task-aaa", "Done."),
            assistant("Great!"),
          );
          h.assertStatus();
        }).children(
          node("start [no task]", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
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
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
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
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
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
              task("Task AAA"),
              taskResult("task-aaa", "Done."),
              assistant("Great!"),
            );
            h.assertStatus();
            h.assertLastNotification("Not inside task, nothing to abort.");
          }),
        ),
        node("abort AAA", async (h) => {
          await h.prompt("/abort-task");
          h.assertSession(user("main work"), assistant("working...", "toolUse"), task("Task AAA"));
          h.assertStatus("pending task: task-aaa");
          h.assertLastNotification("Task aborted. Branch abandoned without summary.");
        }).children(
          node("start AAA", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(user("Task AAA"), assistant("Done."));
            h.assertStatus("current task: task-aaa");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA"),
                taskResult("task-aaa", "Done."),
                assistant("Great!"),
              );
              h.assertStatus();
            }),
          ),
        ),
        node("push BBB", async (h) => {
          h.llm.onPrompt("some more work", responds("okay"), pushTask("Task BBB"));
          await h.prompt("some more work");
          h.assertSession(
            user("Task AAA"),
            assistant("Done."),
            user("some more work"),
            assistant("okay", "toolUse"),
            task("Task BBB"),
          );
          h.assertStatus("pending task: task-bbb");
        }).children(
          node("discard BBB", async (h) => {
            await h.prompt("/discard-task");
            h.assertSession(
              user("Task AAA"),
              assistant("Done."),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB"),
            );
            h.assertStatus("current task: task-aaa");
            h.assertLastNotification("Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA"),
                taskResult("task-aaa", "okay"),
                assistant("Great!"),
              );
              h.assertStatus();
            }),
          ),
          node("start BBB", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(user("Task BBB"), assistant("inner done"));
            h.assertStatus("current task: task-bbb");
          }).children(
            node("finish BBB", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB"),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
              h.assertStatus("current task: task-aaa");
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  taskResult("task-aaa", "Great!"),
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
                task("Task BBB"),
              );
              h.assertStatus("pending task: task-bbb");
              h.assertLastNotification("Task aborted. Branch abandoned without summary.");
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  taskResult("task-aaa", "okay"),
                  assistant("Great!"),
                );
                h.assertStatus();
              }),
            ),
          ),
        ),
        node("push BBB [inherit]", async (h) => {
          h.llm.onPrompt("some more work", responds("okay"), pushTask("Task BBB", true));
          await h.prompt("some more work");
          h.assertSession(
            user("Task AAA"),
            assistant("Done."),
            user("some more work"),
            assistant("okay", "toolUse"),
            task("Task BBB", true),
          );
          h.assertStatus("pending task: task-bbb");
        }).children(
          node("discard BBB [inherit]", async (h) => {
            await h.prompt("/discard-task");
            h.assertSession(
              user("Task AAA"),
              assistant("Done."),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB", true),
            );
            h.assertStatus("current task: task-aaa");
            h.assertLastNotification("Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA"),
                taskResult("task-aaa", "okay"),
                assistant("Great!"),
              );
              h.assertStatus();
            }),
          ),
          node("start BBB [inherit]", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(
              user("Task AAA"),
              assistant("Done."),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB", true),
              user("Task BBB"),
              assistant("inner done"),
            );
            h.assertStatus("current task: task-bbb");
          }).children(
            node("finish BBB [inherit]", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB", true),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
              h.assertStatus("current task: task-aaa");
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
                h.assertStatus();
              }),
            ),
            node("abort BBB [inherit]", async (h) => {
              await h.prompt("/abort-task");
              h.assertSession(
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB", true),
              );
              h.assertStatus("pending task: task-bbb");
              h.assertLastNotification("Task aborted. Branch abandoned without summary.");
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA"),
                  taskResult("task-aaa", "okay"),
                  assistant("Great!"),
                );
                h.assertStatus();
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
      );
      h.assertStatus("pending task: task-aaa");
    }).children(
      node("discard AAA", async (h) => {
        await h.prompt("/discard-task");
        h.assertSession(
          user("main work"),
          assistant("working...", "toolUse"),
          task("Task AAA", true),
        );
        h.assertStatus();
        h.assertLastNotification("Task discarded.");
      }),
      node("start AAA", async (h) => {
        await h.prompt("/start-task");
        h.assertSession(
          user("main work"),
          assistant("working...", "toolUse"),
          task("Task AAA", true),
          user("Task AAA"),
          assistant("Done."),
        );
        h.assertStatus("current task: task-aaa");
      }).children(
        node("finish AAA", async (h) => {
          await h.prompt("/finish-task");
          h.assertSession(
            user("main work"),
            assistant("working...", "toolUse"),
            task("Task AAA", true),
            taskResult("task-aaa", "Done."),
            assistant("Great!"),
          );
          h.assertStatus();
        }).children(
          node("start [no task]", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
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
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
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
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
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
              task("Task AAA", true),
              taskResult("task-aaa", "Done."),
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
            task("Task AAA", true),
          );
          h.assertStatus("pending task: task-aaa");
          h.assertLastNotification("Task aborted. Branch abandoned without summary.");
        }).children(
          node("start AAA", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              user("Task AAA"),
              assistant("Done."),
            );
            h.assertStatus("current task: task-aaa");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                taskResult("task-aaa", "Done."),
                assistant("Great!"),
              );
              h.assertStatus();
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
            user("Task AAA"),
            assistant("Done."),
            user("some more work"),
            assistant("okay", "toolUse"),
            task("Task BBB"),
          );
          h.assertStatus("pending task: task-bbb");
        }).children(
          node("discard BBB", async (h) => {
            await h.prompt("/discard-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              user("Task AAA"),
              assistant("Done."),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB"),
            );
            h.assertStatus("current task: task-aaa");
            h.assertLastNotification("Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                taskResult("task-aaa", "okay"),
                assistant("Great!"),
              );
              h.assertStatus();
            }),
          ),
          node("start BBB", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(user("Task BBB"), assistant("inner done"));
            h.assertStatus("current task: task-bbb");
          }).children(
            node("finish BBB", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB"),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
              h.assertStatus("current task: task-aaa");
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
                h.assertStatus();
              }),
            ),
            node("abort BBB", async (h) => {
              await h.prompt("/abort-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB"),
              );
              h.assertStatus("pending task: task-bbb");
              h.assertLastNotification("Task aborted. Branch abandoned without summary.");
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  taskResult("task-aaa", "okay"),
                  assistant("Great!"),
                );
                h.assertStatus();
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
            user("Task AAA"),
            assistant("Done."),
            user("some more work"),
            assistant("okay", "toolUse"),
            task("Task BBB", true),
          );
          h.assertStatus("pending task: task-bbb");
        }).children(
          node("discard BBB [inherit]", async (h) => {
            await h.prompt("/discard-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              user("Task AAA"),
              assistant("Done."),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB", true),
            );
            h.assertStatus("current task: task-aaa");
            h.assertLastNotification("Task discarded.");
          }).children(
            node("finish AAA", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                taskResult("task-aaa", "okay"),
                assistant("Great!"),
              );
              h.assertStatus();
            }),
          ),
          node("start BBB [inherit]", async (h) => {
            await h.prompt("/start-task");
            h.assertSession(
              user("main work"),
              assistant("working...", "toolUse"),
              task("Task AAA", true),
              user("Task AAA"),
              assistant("Done."),
              user("some more work"),
              assistant("okay", "toolUse"),
              task("Task BBB", true),
              user("Task BBB"),
              assistant("inner done"),
            );
            h.assertStatus("current task: task-bbb");
          }).children(
            node("finish BBB [inherit]", async (h) => {
              await h.prompt("/finish-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB", true),
                taskResult("task-bbb", "inner done"),
                assistant("Great!"),
              );
              h.assertStatus("current task: task-aaa");
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  taskResult("task-aaa", "Great!"),
                  assistant("Great!"),
                );
                h.assertStatus();
              }),
            ),
            node("abort BBB [inherit]", async (h) => {
              await h.prompt("/abort-task");
              h.assertSession(
                user("main work"),
                assistant("working...", "toolUse"),
                task("Task AAA", true),
                user("Task AAA"),
                assistant("Done."),
                user("some more work"),
                assistant("okay", "toolUse"),
                task("Task BBB", true),
              );
              h.assertStatus("pending task: task-bbb");
              h.assertLastNotification("Task aborted. Branch abandoned without summary.");
            }).children(
              node("finish AAA", async (h) => {
                await h.prompt("/finish-task");
                h.assertSession(
                  user("main work"),
                  assistant("working...", "toolUse"),
                  task("Task AAA", true),
                  taskResult("task-aaa", "okay"),
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
