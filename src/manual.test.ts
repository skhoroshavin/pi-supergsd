import assert from 'node:assert';

import {
  toolPushTask,
  cmdStartTask,
  cmdFinishTask,
  cmdAbortTask,
  cmdDiscardTask,
  cmdAuto,
} from './index.js';

import {
  assistant,
  notification,
  pathSuite,
  task,
  taskResult,
  user,
} from './test-helpers/index.js';

const implementation = {
  createPushTaskTool: toolPushTask,
  createStartTaskCommand: cmdStartTask,
  createFinishTaskCommand: cmdFinishTask,
  createAbortTaskCommand: cmdAbortTask,
  createDiscardTaskCommand: cmdDiscardTask,
  createAutoCommand: cmdAuto,
};

pathSuite('manual workflow', implementation, (path) => {
    return [
        path('push AAA', async (h) => {
            h.appendUserMessage('main work');
            h.appendAssistantMessage('working...');
            await h.runPushTask('Task AAA');
            assert.strictEqual(h.getStatus(), 'pending task: task-aaa');
            assert.ok(!h.isLlmTriggered());
            h.assertBranchHistory(
                user('main work'),
                assistant('working...'),
                task('Task AAA'),
                notification('Task stored. Use `/start-task` or `/auto` to start it.'),
            );
        },
            path('discard AAA', async (h) => {
                await h.runDiscardTask();
                assert.strictEqual(h.getStatus(), undefined);
                assert.ok(!h.isLlmTriggered());
                h.assertBranchHistory(
                    user('main work'),
                    assistant('working...'),
                    task('Task AAA'),
                    notification('Task discarded.'),
                );
            }),
            path('start AAA', async (h) => {
                    await h.runStartTask();
                    assert.strictEqual(h.getStatus(), 'current task: task-aaa');
                    assert.ok(h.isLlmTriggered());
                    h.assertBranchHistory(
                        user('Task AAA'),
                    );
                },
                path('finish AAA', async (h) => {
                    h.appendAssistantMessage('Done.');
                    await h.runFinishTask();
                    assert.strictEqual(h.getStatus(), undefined);
                    assert.ok(h.isLlmTriggered());
                    h.assertBranchHistory(
                        user('main work'),
                        assistant('working...'),
                        task('Task AAA'),
                        taskResult('task-aaa', 'Done.'),
                        notification('Task finished. Last response attached.'),
                    );
                },
                path('start AAA [no task]', async (h) => {
                    await h.runStartTask();
                    assert.strictEqual(h.getStatus(), undefined);
                    assert.ok(h.isLlmTriggered());
                    h.assertBranchHistory(
                        user('main work'),
                        assistant('working...'),
                        task('Task AAA'),
                        taskResult('task-aaa', 'Done.'),
                        notification('No pending task. Use push-task first.'),
                    );
                }),
                path('discard AAA [no task]', async (h) => {
                    await h.runDiscardTask();
                    assert.strictEqual(h.getStatus(), undefined);
                    assert.ok(h.isLlmTriggered());
                    h.assertBranchHistory(
                        user('main work'),
                        assistant('working...'),
                        task('Task AAA'),
                        taskResult('task-aaa', 'Done.'),
                        notification('No pending task to discard.'),
                    );
                }),
                path('finish AAA [no task]', async (h) => {
                    await h.runFinishTask();
                    assert.strictEqual(h.getStatus(), undefined);
                    assert.ok(h.isLlmTriggered());
                    h.assertBranchHistory(
                        user('main work'),
                        assistant('working...'),
                        task('Task AAA'),
                        taskResult('task-aaa', 'Done.'),
                        notification('Not inside task, nothing to finish.'),
                    );
                }),
                path('abort AAA [no task]', async (h) => {
                    await h.runAbortTask();
                    assert.strictEqual(h.getStatus(), undefined);
                    assert.ok(h.isLlmTriggered());
                    h.assertBranchHistory(
                        user('main work'),
                        assistant('working...'),
                        task('Task AAA'),
                        taskResult('task-aaa', 'Done.'),
                        notification('Not inside task, nothing to abort.'),
                    );
                }),
                ),
                path('abort AAA', async (h) => {
                        h.appendAssistantMessage('Partial...');
                        await h.runAbortTask();
                        assert.strictEqual(h.getStatus(), 'pending task: task-aaa');
                        assert.ok(!h.isLlmTriggered());
                        h.assertBranchHistory(
                            user('main work'),
                            assistant('working...'),
                            task('Task AAA'),
                            notification('Task aborted. Branch abandoned without summary.'),
                        );
                    },
                    path('start AAA', async (h) => {
                            await h.runStartTask();
                            assert.strictEqual(h.getStatus(), 'current task: task-aaa');
                            assert.ok(h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('Task AAA'),
                            );
                        },
                        path('finish AAA', async (h) => {
                            h.appendAssistantMessage('Done.');
                            await h.runFinishTask();
                            assert.strictEqual(h.getStatus(), undefined);
                            assert.ok(h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('main work'),
                                assistant('working...'),
                                task('Task AAA'),
                                taskResult('task-aaa', 'Done.'),
                                notification('Task finished. Last response attached.'),
                            );
                        }),
                    ),
                ),
                path('push BBB', async (h) => {
                        h.appendAssistantMessage('some more work');
                        await h.runPushTask('Task BBB');
                        assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
                        assert.ok(!h.isLlmTriggered());
                        h.assertBranchHistory(
                            user('Task AAA'),
                            assistant('some more work'),
                            task('Task BBB'),
                            notification('Task stored. Use `/start-task` or `/auto` to start it.'),
                        );
                    },
                    path('discard BBB', async (h) => {
                            await h.runDiscardTask();
                            assert.strictEqual(h.getStatus(), 'current task: task-aaa');
                            assert.ok(!h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('Task AAA'),
                                assistant('some more work'),
                                task('Task BBB'),
                                notification('Task discarded.'),
                            );
                        },
                        path('finish AAA', async (h) => {
                            h.appendAssistantMessage('Done.');
                            await h.runFinishTask();
                            assert.strictEqual(h.getStatus(), undefined);
                            assert.ok(h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('main work'),
                                assistant('working...'),
                                task('Task AAA'),
                                taskResult('task-aaa', 'Done.'),
                                notification('Task finished. Last response attached.'),
                            );
                        }),
                    ),
                    path('start BBB', async (h) => {
                            await h.runStartTask();
                            assert.strictEqual(h.getStatus(), 'current task: task-bbb');
                            assert.ok(h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('Task BBB'),
                            );
                        },
                        path('finish BBB', async (h) => {
                                h.appendAssistantMessage('inner done');
                                await h.runFinishTask();
                                assert.strictEqual(h.getStatus(), 'current task: task-aaa');
                                assert.ok(h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('Task AAA'),
                                    assistant('some more work'),
                                    task('Task BBB'),
                                    taskResult('task-bbb', 'inner done'),
                                    notification('Task finished. Last response attached.'),
                                );
                            },
                            path('finish AAA', async (h) => {
                                h.appendAssistantMessage('Done.');
                                await h.runFinishTask();
                                assert.strictEqual(h.getStatus(), undefined);
                                assert.ok(h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('main work'),
                                    assistant('working...'),
                                    task('Task AAA'),
                                    taskResult('task-aaa', 'Done.'),
                                    notification('Task finished. Last response attached.'),
                                );
                            }),
                        ),
                        path('abort BBB', async (h) => {
                                h.appendAssistantMessage('partial inner');
                                await h.runAbortTask();
                                assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
                                assert.ok(!h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('Task AAA'),
                                    assistant('some more work'),
                                    task('Task BBB'),
                                    notification('Task aborted. Branch abandoned without summary.'),
                                );
                            },
                            path('finish AAA', async (h) => {
                                h.appendAssistantMessage('Done.');
                                await h.runFinishTask();
                                assert.strictEqual(h.getStatus(), undefined);
                                assert.ok(h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('main work'),
                                    assistant('working...'),
                                    task('Task AAA'),
                                    taskResult('task-aaa', 'Done.'),
                                    notification('Task finished. Last response attached.'),
                                );
                            }),
                        ),
                    ),
                ),
                path('push BBB [inherit]', async (h) => {
                        h.appendAssistantMessage('some more work');
                        await h.runPushTask('Task BBB', true);
                        assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
                        assert.ok(!h.isLlmTriggered());
                        h.assertBranchHistory(
                            user('Task AAA'),
                            assistant('some more work'),
                            task('Task BBB', true),
                            notification('Task stored. Use `/start-task` or `/auto` to start it.'),
                        );
                    },
                    path('discard BBB [inherit]', async (h) => {
                            await h.runDiscardTask();
                            assert.strictEqual(h.getStatus(), 'current task: task-aaa');
                            assert.ok(!h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('Task AAA'),
                                assistant('some more work'),
                                task('Task BBB', true),
                                notification('Task discarded.'),
                            );
                        },
                        path('finish AAA', async (h) => {
                            h.appendAssistantMessage('Done.');
                            await h.runFinishTask();
                            assert.strictEqual(h.getStatus(), undefined);
                            assert.ok(h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('main work'),
                                assistant('working...'),
                                task('Task AAA'),
                                taskResult('task-aaa', 'Done.'),
                                notification('Task finished. Last response attached.'),
                            );
                        }),
                    ),
                    path('start BBB [inherit]', async (h) => {
                            await h.runStartTask();
                            assert.strictEqual(h.getStatus(), 'current task: task-bbb');
                            assert.ok(h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('Task AAA'),
                                assistant('some more work'),
                                task('Task BBB', true),
                                user('Task BBB'),
                            );
                        },
                        path('finish BBB [inherit]', async (h) => {
                                h.appendAssistantMessage('inner done');
                                await h.runFinishTask();
                                assert.strictEqual(h.getStatus(), 'current task: task-aaa');
                                assert.ok(h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('Task AAA'),
                                    assistant('some more work'),
                                    task('Task BBB', true),
                                    taskResult('task-bbb', 'inner done'),
                                    notification('Task finished. Last response attached.'),
                                );
                            },
                            path('finish AAA', async (h) => {
                                h.appendAssistantMessage('Done.');
                                await h.runFinishTask();
                                assert.strictEqual(h.getStatus(), undefined);
                                assert.ok(h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('main work'),
                                    assistant('working...'),
                                    task('Task AAA'),
                                    taskResult('task-aaa', 'Done.'),
                                    notification('Task finished. Last response attached.'),
                                );
                            }),
                        ),
                        path('abort BBB [inherit]', async (h) => {
                                h.appendAssistantMessage('partial inner');
                                await h.runAbortTask();
                                assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
                                assert.ok(!h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('Task AAA'),
                                    assistant('some more work'),
                                    task('Task BBB', true),
                                    notification('Task aborted. Branch abandoned without summary.'),
                                );
                            },
                            path('finish AAA', async (h) => {
                                h.appendAssistantMessage('Done.');
                                await h.runFinishTask();
                                assert.strictEqual(h.getStatus(), undefined);
                                assert.ok(h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('main work'),
                                    assistant('working...'),
                                    task('Task AAA'),
                                    taskResult('task-aaa', 'Done.'),
                                    notification('Task finished. Last response attached.'),
                                );
                            }),
                        ),
                    ),
                ),
            ),
        ),
        path('push AAA [inherit]', async (h) => {
            h.appendUserMessage('main work');
            h.appendAssistantMessage('working...');
            await h.runPushTask('Task AAA', true);
                assert.strictEqual(h.getStatus(), 'pending task: task-aaa');
                assert.ok(!h.isLlmTriggered());
                h.assertBranchHistory(
                    user('main work'),
                    assistant('working...'),
                    task('Task AAA', true),
                    notification('Task stored. Use `/start-task` or `/auto` to start it.'),
                );
        },
            path('discard AAA', async (h) => {
                await h.runDiscardTask();
                assert.strictEqual(h.getStatus(), undefined);
                assert.ok(!h.isLlmTriggered());
                h.assertBranchHistory(
                    user('main work'),
                    assistant('working...'),
                    task('Task AAA', true),
                    notification('Task discarded.'),
                );
            }),
            path('start AAA', async (h) => {
                    await h.runStartTask();
                    assert.strictEqual(h.getStatus(), 'current task: task-aaa');
                    assert.ok(h.isLlmTriggered());
                    h.assertBranchHistory(
                        user('main work'),
                        assistant('working...'),
                        task('Task AAA', true),
                        user('Task AAA'),
                    );
                },
                path('finish AAA', async (h) => {
                    h.appendAssistantMessage('Done.');
                    await h.runFinishTask();
                    assert.strictEqual(h.getStatus(), undefined);
                    assert.ok(h.isLlmTriggered());
                    h.assertBranchHistory(
                        user('main work'),
                        assistant('working...'),
                        task('Task AAA', true),
                        taskResult('task-aaa', 'Done.'),
                        notification('Task finished. Last response attached.'),
                    );
                },
                path('start AAA [no task]', async (h) => {
                    await h.runStartTask();
                    assert.strictEqual(h.getStatus(), undefined);
                    assert.ok(h.isLlmTriggered());
                    h.assertBranchHistory(
                        user('main work'),
                        assistant('working...'),
                        task('Task AAA', true),
                        taskResult('task-aaa', 'Done.'),
                        notification('No pending task. Use push-task first.'),
                    );
                }),
                path('discard AAA [no task]', async (h) => {
                    await h.runDiscardTask();
                    assert.strictEqual(h.getStatus(), undefined);
                    assert.ok(h.isLlmTriggered());
                    h.assertBranchHistory(
                        user('main work'),
                        assistant('working...'),
                        task('Task AAA', true),
                        taskResult('task-aaa', 'Done.'),
                        notification('No pending task to discard.'),
                    );
                }),
                path('finish AAA [no task]', async (h) => {
                    await h.runFinishTask();
                    assert.strictEqual(h.getStatus(), undefined);
                    assert.ok(h.isLlmTriggered());
                    h.assertBranchHistory(
                        user('main work'),
                        assistant('working...'),
                        task('Task AAA', true),
                        taskResult('task-aaa', 'Done.'),
                        notification('Not inside task, nothing to finish.'),
                    );
                }),
                path('abort AAA [no task]', async (h) => {
                    await h.runAbortTask();
                    assert.strictEqual(h.getStatus(), undefined);
                    assert.ok(h.isLlmTriggered());
                    h.assertBranchHistory(
                        user('main work'),
                        assistant('working...'),
                        task('Task AAA', true),
                        taskResult('task-aaa', 'Done.'),
                        notification('Not inside task, nothing to abort.'),
                    );
                }),
                ),
                path('abort AAA', async (h) => {
                        h.appendAssistantMessage('Partial...');
                        await h.runAbortTask();
                        assert.strictEqual(h.getStatus(), 'pending task: task-aaa');
                        assert.ok(!h.isLlmTriggered());
                        h.assertBranchHistory(
                            user('main work'),
                            assistant('working...'),
                            task('Task AAA', true),
                            notification('Task aborted. Branch abandoned without summary.'),
                        );
                    },
                    path('start AAA', async (h) => {
                            await h.runStartTask();
                            assert.strictEqual(h.getStatus(), 'current task: task-aaa');
                            assert.ok(h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('main work'),
                                assistant('working...'),
                                task('Task AAA', true),
                                user('Task AAA'),
                            );
                        },
                        path('finish AAA', async (h) => {
                            h.appendAssistantMessage('Done.');
                            await h.runFinishTask();
                            assert.strictEqual(h.getStatus(), undefined);
                            assert.ok(h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('main work'),
                                assistant('working...'),
                                task('Task AAA', true),
                                taskResult('task-aaa', 'Done.'),
                                notification('Task finished. Last response attached.'),
                            );
                        }),
                    ),
                ),
                path('push BBB', async (h) => {
                        h.appendAssistantMessage('some more work');
                        await h.runPushTask('Task BBB');
                        assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
                        assert.ok(!h.isLlmTriggered());
                        h.assertBranchHistory(
                            user('main work'),
                            assistant('working...'),
                            task('Task AAA', true),
                            user('Task AAA'),
                            assistant('some more work'),
                            task('Task BBB'),
                            notification('Task stored. Use `/start-task` or `/auto` to start it.'),
                        );
                    },
                    path('discard BBB', async (h) => {
                            await h.runDiscardTask();
                            assert.strictEqual(h.getStatus(), 'current task: task-aaa');
                            assert.ok(!h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('main work'),
                                assistant('working...'),
                                task('Task AAA', true),
                                user('Task AAA'),
                                assistant('some more work'),
                                task('Task BBB'),
                                notification('Task discarded.'),
                            );
                        },
                        path('finish AAA', async (h) => {
                            h.appendAssistantMessage('Done.');
                            await h.runFinishTask();
                            assert.strictEqual(h.getStatus(), undefined);
                            assert.ok(h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('main work'),
                                assistant('working...'),
                                task('Task AAA', true),
                                taskResult('task-aaa', 'Done.'),
                                notification('Task finished. Last response attached.'),
                            );
                        }),
                    ),
                    path('start BBB', async (h) => {
                            await h.runStartTask();
                            assert.strictEqual(h.getStatus(), 'current task: task-bbb');
                            assert.ok(h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('Task BBB'),
                            );
                        },
                        path('finish BBB', async (h) => {
                                h.appendAssistantMessage('inner done');
                                await h.runFinishTask();
                                assert.strictEqual(h.getStatus(), 'current task: task-aaa');
                                assert.ok(h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('main work'),
                                    assistant('working...'),
                                    task('Task AAA', true),
                                    user('Task AAA'),
                                    assistant('some more work'),
                                    task('Task BBB'),
                                    taskResult('task-bbb', 'inner done'),
                                    notification('Task finished. Last response attached.'),
                                );
                            },
                            path('finish AAA', async (h) => {
                                h.appendAssistantMessage('Done.');
                                await h.runFinishTask();
                                assert.strictEqual(h.getStatus(), undefined);
                                assert.ok(h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('main work'),
                                    assistant('working...'),
                                    task('Task AAA', true),
                                    taskResult('task-aaa', 'Done.'),
                                    notification('Task finished. Last response attached.'),
                                );
                            }),
                        ),
                        path('abort BBB', async (h) => {
                                h.appendAssistantMessage('partial inner');
                                await h.runAbortTask();
                                assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
                                assert.ok(!h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('main work'),
                                    assistant('working...'),
                                    task('Task AAA', true),
                                    user('Task AAA'),
                                    assistant('some more work'),
                                    task('Task BBB'),
                                    notification('Task aborted. Branch abandoned without summary.'),
                                );
                            },
                            path('finish AAA', async (h) => {
                                h.appendAssistantMessage('Done.');
                                await h.runFinishTask();
                                assert.strictEqual(h.getStatus(), undefined);
                                assert.ok(h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('main work'),
                                    assistant('working...'),
                                    task('Task AAA', true),
                                    taskResult('task-aaa', 'Done.'),
                                    notification('Task finished. Last response attached.'),
                                );
                            }),
                        ),
                    ),
                ),
                path('push BBB [inherit]', async (h) => {
                        h.appendAssistantMessage('some more work');
                        await h.runPushTask('Task BBB', true);
                        assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
                        assert.ok(!h.isLlmTriggered());
                        h.assertBranchHistory(
                            user('main work'),
                            assistant('working...'),
                            task('Task AAA', true),
                            user('Task AAA'),
                            assistant('some more work'),
                            task('Task BBB', true),
                            notification('Task stored. Use `/start-task` or `/auto` to start it.'),
                        );
                    },
                    path('discard BBB [inherit]', async (h) => {
                            await h.runDiscardTask();
                            assert.strictEqual(h.getStatus(), 'current task: task-aaa');
                            assert.ok(!h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('main work'),
                                assistant('working...'),
                                task('Task AAA', true),
                                user('Task AAA'),
                                assistant('some more work'),
                                task('Task BBB', true),
                                notification('Task discarded.'),
                            );
                        },
                        path('finish AAA', async (h) => {
                            h.appendAssistantMessage('Done.');
                            await h.runFinishTask();
                            assert.strictEqual(h.getStatus(), undefined);
                            assert.ok(h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('main work'),
                                assistant('working...'),
                                task('Task AAA', true),
                                taskResult('task-aaa', 'Done.'),
                                notification('Task finished. Last response attached.'),
                            );
                        }),
                    ),
                    path('start BBB [inherit]', async (h) => {
                            await h.runStartTask();
                            assert.strictEqual(h.getStatus(), 'current task: task-bbb');
                            assert.ok(h.isLlmTriggered());
                            h.assertBranchHistory(
                                user('main work'),
                                assistant('working...'),
                                task('Task AAA', true),
                                user('Task AAA'),
                                assistant('some more work'),
                                task('Task BBB', true),
                                user('Task BBB'),
                            );
                        },
                        path('finish BBB [inherit]', async (h) => {
                                h.appendAssistantMessage('inner done');
                                await h.runFinishTask();
                                assert.strictEqual(h.getStatus(), 'current task: task-aaa');
                                assert.ok(h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('main work'),
                                    assistant('working...'),
                                    task('Task AAA', true),
                                    user('Task AAA'),
                                    assistant('some more work'),
                                    task('Task BBB', true),
                                    taskResult('task-bbb', 'inner done'),
                                    notification('Task finished. Last response attached.'),
                                );
                            },
                            path('finish AAA', async (h) => {
                                h.appendAssistantMessage('Done.');
                                await h.runFinishTask();
                                assert.strictEqual(h.getStatus(), undefined);
                                assert.ok(h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('main work'),
                                    assistant('working...'),
                                    task('Task AAA', true),
                                    taskResult('task-aaa', 'Done.'),
                                    notification('Task finished. Last response attached.'),
                                );
                            }),
                        ),
                        path('abort BBB [inherit]', async (h) => {
                                h.appendAssistantMessage('partial inner');
                                await h.runAbortTask();
                                assert.strictEqual(h.getStatus(), 'pending task: task-bbb');
                                assert.ok(!h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('main work'),
                                    assistant('working...'),
                                    task('Task AAA', true),
                                    user('Task AAA'),
                                    assistant('some more work'),
                                    task('Task BBB', true),
                                    notification('Task aborted. Branch abandoned without summary.'),
                                );
                            },
                            path('finish AAA', async (h) => {
                                h.appendAssistantMessage('Done.');
                                await h.runFinishTask();
                                assert.strictEqual(h.getStatus(), undefined);
                                assert.ok(h.isLlmTriggered());
                                h.assertBranchHistory(
                                    user('main work'),
                                    assistant('working...'),
                                    task('Task AAA', true),
                                    taskResult('task-aaa', 'Done.'),
                                    notification('Task finished. Last response attached.'),
                                );
                            }),
                        ),
                    ),
                ),
            ),
        ),
        path('start AAA [no task]', async (h) => {
        h.appendUserMessage('main work');
        h.appendAssistantMessage('working...');
        await h.runStartTask();
        assert.strictEqual(h.getStatus(), undefined);
        assert.ok(!h.isLlmTriggered());
        h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            notification('No pending task. Use push-task first.'),
        );
    }),
        path('discard AAA [no task]', async (h) => {
        h.appendUserMessage('main work');
        h.appendAssistantMessage('working...');
        await h.runDiscardTask();
        assert.strictEqual(h.getStatus(), undefined);
        assert.ok(!h.isLlmTriggered());
        h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            notification('No pending task to discard.'),
        );
    }),
        path('finish AAA [no task]', async (h) => {
        h.appendUserMessage('main work');
        h.appendAssistantMessage('working...');
        await h.runFinishTask();
        assert.strictEqual(h.getStatus(), undefined);
        assert.ok(!h.isLlmTriggered());
        h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            notification('Not inside task, nothing to finish.'),
        );
    }),
        path('abort AAA [no task]', async (h) => {
        h.appendUserMessage('main work');
        h.appendAssistantMessage('working...');
        await h.runAbortTask();
        assert.strictEqual(h.getStatus(), undefined);
        assert.ok(!h.isLlmTriggered());
        h.assertBranchHistory(
            user('main work'),
            assistant('working...'),
            notification('Not inside task, nothing to abort.'),
        );
    }),
    ];
});
