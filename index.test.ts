import assert from 'node:assert';

import { describe, it } from 'node:test';

import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type Theme,
} from '@earendil-works/pi-coding-agent';

import registerTaskCommands, {
  createPushTaskTool,
  createStartTaskCommand,
  createFinishTaskCommand,
  createAbortTaskCommand,
  createDiscardTaskCommand,
  createAutoCommand,
} from './index.js';

const path: PathFn = (name, fn, ...children) => ({ name, fn, children });


pathSuite('manual workflow', (path) => {
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

describe('automated workflow', () => {
  it('completes push-task -> /auto -> finish-task and injects the branch result', async () => {
    const h = makeHarness();

    h.appendUserMessage('main work');
    h.appendAssistantMessage('working on main...');
    await h.runPushTask('Analyze performance.');
    assert.strictEqual(h.getStatus(), 'pending task: analyze-performance');
    h.assertBranchHistory(
      user('main work'),
      assistant('working on main...'),
      task('Analyze performance.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    await h.runAuto({
      reactions: [[user('Analyze performance'), assistant('Found 3 bottlenecks: ...')]],
    });

    h.assertBranchHistory(
      user('main work'),
      assistant('working on main...'),
      task('Analyze performance.'),
      taskResult('analyze-performance', 'Found 3 bottlenecks: ...'),
      notification('Task finished. Last response attached.'),
    );
    assert.ok(h.isLlmTriggered());
    // Status line should be clean — no stale [auto] prefix remains.
    assert.strictEqual(h.getStatus(), undefined);
  });

  it('returns the branch result to the original leaf for branch-context tasks', async () => {
    const h = makeHarness();

    h.appendUserMessage('main work');
    h.appendAssistantMessage('working...');
    await h.runPushTask('Quick fix.', true);
    assert.strictEqual(h.getStatus(), 'pending task: quick-fix');
    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Quick fix.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    await h.runAuto({
      reactions: [[user('Quick fix'), assistant('Fixed the bug.')]],
    });

    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Quick fix.', true),
      taskResult('quick-fix', 'Fixed the bug.'),
      notification('Task finished. Last response attached.'),
    );
    assert.ok(h.isLlmTriggered());
  });

  it('stops when navigation is cancelled and does not mark the task done', async () => {
    const h = makeHarness();

    h.appendUserMessage('main work');
    await h.runPushTask('Analyze performance.');

    await h.runAuto({
      reactions: [[task('Analyze performance.'), userEsc()]],
    });

    assert.ok(!h.isLlmTriggered());
    h.assertBranchHistory(
      user('main work'),
      task('Analyze performance.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );
  });

  it('notifies and exits when started with no pending tasks', async () => {
    const h = makeHarness();
    await h.runAuto({ reactions: [] });
    h.assertBranchHistory(
      notification('No pending tasks to run.'),
    );
  });

  it('warns and returns when /auto is already running', async () => {
    const h = makeHarness();

    h.appendUserMessage('start');
    await h.runPushTask('first task');

    await h.runAuto({
      reactions: [
        [user('first task'), assistant('done')],
        [assistant('done'), userRunsAuto()],
      ],
    });

    h.assertNotifications('Auto is already running.');
    h.assertBranchHistory(
      user('start'),
      task('first task'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      taskResult('first-task', 'done'),
      notification('Task finished. Last response attached.'),
    );
    assert.ok(h.isLlmTriggered());
    assert.strictEqual(h.getStatus(), undefined);
  });

  it('stops when the last assistant message was aborted', async () => {
    const h = makeHarness();

    h.appendUserMessage('start');
    await h.runPushTask('Implement phase 1.', true);

    await h.runAuto({
      reactions: [
        [user('Implement phase 1'), assistant('Stopped by user.', 'aborted')],
      ],
    });

    assert.ok(!h.isLlmTriggered());
    h.assertBranchHistory(
      user('start'),
      task('Implement phase 1.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      user('Implement phase 1.'),
      assistant('Stopped by user.', 'aborted'),
    );
    assert.strictEqual(h.getStatus(), 'current task: implement-phase-1');
  });

  it('processes a subtask pushed during a task', async () => {
    const h = makeHarness();

    h.appendUserMessage('main work');
    h.appendAssistantMessage('working...');
    await h.runPushTask('parent task');

    await h.runAuto({
      reactions: [
        [user('parent task'), assistant('working on parent...')],
        [assistant('working on parent...'), task('subtask')],
        [user('subtask'), assistant('sub done')],
      ],
    });

    // Parent finishes last. Only original-branch entries appear (subtask
    // entries are on different forks — same pattern as tests #1/#2).
    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('parent task'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      taskResult('parent-task', 'working on parent...'),
      notification('Task finished. Last response attached.'),
    );
  });

  it('continues processing when user queues a steering message during auto', async () => {
    const h = makeHarness();

    h.appendUserMessage('start');
    await h.runPushTask('Quick fix.', true);

    await h.runAuto({
      reactions: [
        [user('Quick fix'), assistant('thinking...')],
        [assistant('thinking...'), user('steer it')],
        [user('steer it'), assistant('adjusted response')],
      ],
    });

    // Auto processes: start task → assistant thinks → user steers →
    // assistant adjusts → finish task with final response.
    // Only original-branch entries appear (same pattern as test #2).
    h.assertBranchHistory(
      user('start'),
      task('Quick fix.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      taskResult('quick-fix', 'adjusted response'),
      notification('Task finished. Last response attached.'),
    );
    assert.ok(h.isLlmTriggered());
  });

  it('stops when session is shut down during auto', async () => {
    const h = makeHarness();

    h.appendUserMessage('start');
    await h.runPushTask('Shutdown task', true);

    await h.runAuto({
      reactions: [
        [user('Shutdown task'), assistant('working...')],
        [assistant('working...'), userCtrlC()],
      ],
    });

    // Auto started task (inherit, no navigation), injected assistant,
    // then session shutdown fired. No navigation back — task-branch
    // entries remain visible. No taskResult — task was never finished.
    assert.ok(!h.isLlmTriggered());
    h.assertBranchHistory(
      user('start'),
      task('Shutdown task', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      user('Shutdown task'),
      assistant('working...'),
    );
    assert.strictEqual(h.getStatus(), 'current task: shutdown-task');
  });
});

// ── Registration ─────────────────────────────────────────────────

describe('registration', () => {
  it('registers the push-task tool and all five task commands', () => {
    const registered: Array<{ type: string; name: string; description?: string }> = [];
    const pi = {
      registerTool: (tool: { name: string; label: string; description: string }) =>
        registered.push({ type: 'tool', name: tool.name, description: tool.description }),
      registerCommand: (name: string, opts: { description: string }) =>
        registered.push({ type: 'command', name, description: opts.description }),
      registerMessageRenderer: () => {},
      on: () => {},
    } as unknown as ExtensionAPI;

    registerTaskCommands(pi);

    assert.deepStrictEqual(registered, [
      { type: 'tool', name: 'push-task', description: 'Store a task prompt for a user-started navigation branch.' },
      { type: 'command', name: 'start-task', description: 'Navigate to a fresh context and inject the active task prompt' },
      { type: 'command', name: 'discard-task', description: 'Discard the active task without executing it' },
      { type: 'command', name: 'finish-task', description: 'Finish the current task and return to the task start point' },
      { type: 'command', name: 'abort-task', description: 'Abort the current task without finishing' },
      { type: 'command', name: 'auto', description: 'Automatically run pushed task branches' },
    ]);
  });
});

const assistant = (content: string, stopReason?: string) => ({
  type: 'message' as const,
  message: {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text: content }],
    ...(stopReason ? { stopReason } : {}),
  }
}) as unknown as Partial<BranchEntry>;

const user = (content: string) => ({
  type: 'message' as const,
  message: { role: 'user' as const, content: [{ type: 'text', text: content }] }
}) as unknown as Partial<BranchEntry>;

const task = (prompt: string, inherit_context = false) => ({
  type: 'custom' as const,
  customType: 'task',
  data: { prompt, inherit_context }
}) as unknown as Partial<BranchEntry>;

const taskResult = (slug: string, content?: string) => ({
  type: 'custom_message' as const,
  customType: 'task-result',
  details: { slug },
  ...(content !== undefined ? { content: [{ type: 'text' as const, text: content }] } : {}),
}) as unknown as Partial<BranchEntry>;

const userEsc = () => ({ type: 'user-esc' as const });

const userCtrlC = () => ({ type: 'user-ctrl-c' as const });

const userRunsAuto = () => ({ type: 'user-runs-auto' as const });

// ── Test harness ─────────────────────────────────────────────────

function makeHarness() {
  // userEsc, userCtrlC, userRunsAuto are referenced through reaction types in
  // runAuto; reference them here to suppress TS6133.
  void userEsc;
  void userCtrlC;
  void userRunsAuto;

  const sm = SessionManager.inMemory();
  // Seed a non-visible root entry so findFreshTargetId can escape past user messages.
  // Pi always inserts thinking_level_change at session creation (main.js:471).
  sm.appendThinkingLevelChange('off');
  const idleWaiters: Array<() => void> = [];
  const sessionShutdownHandlers: Array<() => unknown> = [];
  const triggeredCustomMessages = new Set<string>();
  const triggeredUserMessages = new Set<string>();

  const trackedHints: Array<{ text: string; afterEntryId: string | null }> = [];
  const notificationLog: string[] = [];
  let cancelNextNav = false;
  let taskStatus: string | undefined;


  const pi = {
    appendEntry(customType: string, data?: unknown) {
      sm.appendCustomEntry(customType, data);
    },
    sendUserMessage(content: string | Array<{ type: string; text: string }>) {
      const text = typeof content === 'string' ? content : content.map((b) => b.text).join('');
      sm.appendMessage({ role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() });
      const branch = sm.getBranch();
      const last = branch[branch.length - 1];
      if (last) triggeredUserMessages.add(last.id);
    },
    sendMessage(
      message: { customType: string; content: unknown; display?: boolean; details?: unknown },
      options?: { triggerTurn?: boolean },
    ) {
      sm.appendCustomMessageEntry(
        message.customType,
        message.content as string,
        message.display ?? true,
        message.details,
      );

      if (options?.triggerTurn) {
        const branch = sm.getBranch();
        const last = branch[branch.length - 1];
        if (last) triggeredCustomMessages.add(last.id);
      }
    },
    on(eventName: string, handler: () => unknown) {
      if (eventName === 'session_shutdown') sessionShutdownHandlers.push(handler);
    },
    registerMessageRenderer() {},
    registerTool() {},
    registerCommand() {},
  } as unknown as ExtensionAPI;

  const ctx = {
    hasUI: true,
    waitForIdle: async () => {
      await new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },
    hasPendingMessages: () => false,
    sessionManager: sm,
    ui: {
      notify(message: string) {
        trackedHints.push({ text: message, afterEntryId: sm.getLeafId() });
        notificationLog.push(message);
      },
      setStatus(key: string, value: string | undefined) {
        if (key === 'task') taskStatus = value;
      },
      theme: {
        fg: (_key: string, text: string) => text,
        bg: (_key: string, text: string) => text,
        bold: (text: string) => text,
      } as unknown as Theme,
    },
    navigateTree: async (targetId: string) => {
      if (cancelNextNav) {
        cancelNextNav = false;
        return { cancelled: true };
      }
      sm.branch(targetId);
      return { cancelled: false };
    },
  } as unknown as ExtensionCommandContext & { sessionManager: SessionManager };

  // ── Plumbing helpers ──────────────────────────────────────────

  function isLlmTriggered(): boolean {
    const branch = sm.getBranch();
    if (branch.length === 0) return false;
    // Walk backwards past 'custom' entries (data-only bookkeeping, invisible to LLM)
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry.type === 'custom') continue;
      if (entry.type === 'message' && entry.message.role === 'user') return triggeredUserMessages.has(entry.id);
      if (entry.type === 'message' && entry.message.role === 'assistant') return false;
      if (entry.type === 'custom_message') return triggeredCustomMessages.has(entry.id);
      return false;
    }
    return false;
  }

  function appendUserMessage(text: string): void {
    sm.appendMessage({ role: 'user', content: [{ type: 'text', text }], timestamp: 0 });
  }

  function appendAssistantMessage(text: string, stopReason?: string): void {
    sm.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      timestamp: 0,
      model: 'test',
      provider: 'test',
      ...(stopReason ? { stopReason } : {}),
    } as Parameters<typeof sm.appendMessage>[0]);
  }

  function assertBranchHistory(...expected: Partial<BranchEntry>[]) {
    const entries = sm.getBranch();
    const actual: Partial<BranchEntry>[] = [];
    const consumedHints = new Set<number>();

    for (const entry of entries) {
      // Skip entries invisible to both the user and LLM context.
      const HIDDEN_TYPES = new Set(['thinking_level_change', 'model_change', 'session_info', 'label']);
      const isSkipped =
        HIDDEN_TYPES.has(entry.type) ||
        (entry.type === 'custom' && (entry.customType === 'task-done' || entry.customType === 'task-start'));

      if (!isSkipped) {
        // Strip IDs, internal fields, display, and content for comparison
        const { id: _id, parentId: _pid, timestamp: _ts, display: _dp, data: rawData, details: rawDetails, ...restEntry } = entry as unknown as Record<string, unknown>;

        // Build stripped version excluding fields we always strip
        const stripped: Record<string, unknown> = { ...restEntry };

        // Clean nested message fields
        if (stripped.message && typeof stripped.message === 'object') {
          const { timestamp: _mt, model: _mp, provider: _pp, ...msgRest } = stripped.message as Record<string, unknown>;
          stripped.message = msgRest;
        }

        // Process data: only include non-dynamic keys
        if (rawData && typeof rawData === 'object') {
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rawData as Record<string, unknown>)) {
            if (typeof v !== 'string' || !/^[a-f0-9]{8}$/.test(v)) {
              cleaned[k] = v;
            }
          }
          if (Object.keys(cleaned).length > 0) stripped.data = cleaned;
        }

        // Process details: only include non-dynamic keys
        if (rawDetails && typeof rawDetails === 'object') {
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rawDetails as Record<string, unknown>)) {
            if (typeof v !== 'string' || !/^[a-f0-9]{8}$/.test(v)) {
              cleaned[k] = v;
            }
          }
          if (Object.keys(cleaned).length > 0) stripped.details = cleaned;
        }

        actual.push(stripped as Partial<BranchEntry>);
      }

      // Insert tracked hints with matching afterEntryId after the entry
      for (let i = 0; i < trackedHints.length; i++) {
        if (trackedHints[i].afterEntryId === entry.id) {
          actual.push(notification(trackedHints[i].text));
          consumedHints.add(i);
        }
      }
    }

    // Unclassified hints (afterEntryId === null) go at start
    for (let i = 0; i < trackedHints.length; i++) {
      if (!consumedHints.has(i) && trackedHints[i].afterEntryId === null) {
        actual.unshift(notification(trackedHints[i].text));
        consumedHints.add(i);
      }
    }

    // Remove consumed hints so they don't leak across calls.
    // Also discard orphaned hints (non-null afterEntryId from a different branch).
    const remaining: Array<{ text: string; afterEntryId: string | null }> = [];
    for (let i = 0; i < trackedHints.length; i++) {
      if (!consumedHints.has(i) && trackedHints[i].afterEntryId === null) {
        remaining.push(trackedHints[i]);
      }
    }
    trackedHints.length = 0;
    trackedHints.push(...remaining);

    assert.deepStrictEqual(actual, expected);
  }



  function assertNotifications(...expected: string[]): void {
    for (const text of expected) {
      assert.ok(notificationLog.includes(text), `Expected notification log to include: ${text}`);
    }
  }



  // ── Convenience wrappers (pre-bound to pi / ctx) ───────────────

  async function runPushTask(prompt: string, inherit_context?: boolean) {
    const tool = createPushTaskTool(pi);
    await tool.execute('call-1', { prompt, inherit_context }, undefined, undefined, ctx);
  }

  async function runTaskCommand(command: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<unknown> }) {
    const handlerP = command.handler('', ctx);
    const next = idleWaiters.shift();
    assert.ok(next, 'Expected a pending waitForIdle call.');
    next();
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    await handlerP;
  }

  const runStartTask = () => runTaskCommand(createStartTaskCommand(pi));
  const runFinishTask = () => runTaskCommand(createFinishTaskCommand(pi));
  const runDiscardTask = () => runTaskCommand(createDiscardTaskCommand(pi));
  const runAbortTask = () => runTaskCommand(createAbortTaskCommand());

  // Shared auto handler — created once so closure state (running/stopped)
  // is shared across runAuto and userRunsAuto reaction.
  const autoHandler = createAutoCommand(pi).handler;



  /**
   * Scan branch entries not yet in the seenIds set and apply the first
   * matching reaction for each new entry. Uses entry IDs to track seen
   * state, so it works correctly across navigation (branch length changes).
   */
  function scanAndReact(
    session: SessionManager,
    reactions: Array<[MatchDescriptor, ReactionDescriptor]>,
    seenIds: Set<string>,
  ): void {
    const branch = session.getBranch();
    for (const entry of branch) {
      if (seenIds.has(entry.id)) continue;
      seenIds.add(entry.id);
      for (const [match, reaction] of reactions) {
        if (entryMatches(entry, match)) {
          applyReaction(session, reaction);
          break; // first match wins per entry
        }
      }
    }
  }

  /**
   * Check whether a branch entry matches a match descriptor.
   * Phase 2: supports user() match — user messages whose text contains the pattern.
   */
  function entryMatches(entry: BranchEntry, match: MatchDescriptor): boolean {
    const m = match as Record<string, unknown>;

    // --- message-type matches (user, assistant) ---
    if (m.type === 'message' && m.message && typeof m.message === 'object') {
      const msg = m.message as Record<string, unknown>;
      const matchRole = msg.role as string;

      // Narrow to user/assistant roles which have `content` (excludes BashExecutionMessage etc.)
      if (entry.type === 'message' && (entry.message.role === 'user' || entry.message.role === 'assistant')) {
        if (entry.message.role !== matchRole) return false;
        const matchText = extractContentText(msg.content);
        const entryText = extractContentText(entry.message.content);
        if (matchText && entryText && entryText.includes(matchText)) return true;
      }
      return false;
    }

    // --- custom-type matches (task) ---
    if (m.type === 'custom' && entry.type === 'custom') {
      const matchCustomType = m.customType as string;
      const matchData = m.data as Record<string, unknown> | undefined;

      if (entry.customType !== matchCustomType) return false;

      // If the match has data, check the entry's data fields
      if (matchData) {
        const entryData = entry.data as Record<string, unknown> | undefined;
        if (!entryData) return false;

        // task("prompt") match: data.prompt must contain the pattern
        if (typeof matchData.prompt === 'string') {
          const entryPrompt = entryData.prompt;
          if (typeof entryPrompt !== 'string') return false;
          if (!entryPrompt.includes(matchData.prompt)) return false;
        }

        // task("prompt", inherit) match: inherit_context must match if specified
        if (typeof matchData.inherit_context === 'boolean') {
          if (entryData.inherit_context !== matchData.inherit_context) return false;
        }
      }

      return true;
    }

    return false;
  }

  /**
   * Apply a reaction descriptor to the session.
   * Phase 2: supports assistant() reaction — injects an assistant message.
   */
  function applyReaction(session: SessionManager, reaction: ReactionDescriptor): void {
    const r = reaction as Record<string, unknown>;

    // --- user-esc reaction: cancel next navigation ---
    if (r.type === 'user-esc') {
      cancelNextNav = true;
      return;
    }

    // --- user-ctrl-c reaction: trigger session shutdown ---
    if (r.type === 'user-ctrl-c') {
      for (const handler of sessionShutdownHandlers) {
        handler();
      }
      return;
    }

    // --- user-runs-auto reaction: invoke auto handler reentrantly ---
    if (r.type === 'user-runs-auto') {
      // Invoke the same auto handler from within the active run. The
      // second invocation detects the closure's `running` flag is true,
      // injects "Auto is already running", and returns immediately.
      // Fire-and-forget: the handler is async but the guard check and
      // notification happen synchronously before any await.
      autoHandler('', ctx).catch(() => {});
      return;
    }

    // --- message-type reactions (assistant, user) ---
    if (r.type === 'message' && r.message && typeof r.message === 'object') {
      const msg = r.message as Record<string, unknown>;

      if (msg.role === 'assistant') {
        const text = extractContentText(msg.content) ?? '';
        const stopReason = msg.stopReason as string | undefined;
        session.appendMessage({
          role: 'assistant',
          content: [{ type: 'text', text }],
          timestamp: 0,
          model: 'test',
          provider: 'test',
          ...(stopReason ? { stopReason } : {}),
        } as Parameters<typeof session.appendMessage>[0]);
        return;
      }

      if (msg.role === 'user') {
        const text = extractContentText(msg.content) ?? '';
        session.appendMessage({
          role: 'user',
          content: [{ type: 'text', text }],
          timestamp: 0,
        });
        return;
      }
    }

    // --- custom-type reactions (task) ---
    if (r.type === 'custom' && r.customType === 'task') {
      const data = r.data as Record<string, unknown> | undefined;
      const prompt = typeof data?.prompt === 'string' ? data.prompt : '';
      const inherit_context = data?.inherit_context === true;
      session.appendCustomEntry('task', { prompt, inherit_context });
      return;
    }
  }

  /** Extract plain text from content (string or array of text blocks). */
  function extractContentText(content: unknown): string | null {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const blocks = content as Array<{ type?: string; text?: string }>;
      return blocks
        .filter(b => b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text!)
        .join('');
    }
    return null;
  }

  async function runAuto(config: AutoConfig): Promise<void> {
    const reactions = config.reactions ?? [];
    let settled = false;
    // Start with empty seen set so the first scan covers all pre-existing entries.
    // This is needed for user-esc tests where the task entry exists before auto runs.
    const seenIds = new Set<string>();

    const handlerPromise = autoHandler('', ctx).finally(() => { settled = true; });

    const MAX_STEPS = 100;
    for (let steps = 0; steps < MAX_STEPS && !settled; steps++) {
      await Promise.resolve();

      const waiter = idleWaiters.shift();
      if (waiter) {
        // ── Fixed-point reaction engine ──────────────────────────
        // Run reactions to completion before resolving the idle, so
        // reaction chains (e.g., assistant → user → assistant) all
        // fire before auto's handler gets to respond.
        let dirty: boolean;
        do {
          const lenBefore = sm.getBranch().length;
          scanAndReact(sm, reactions, seenIds);
          dirty = sm.getBranch().length > lenBefore;
        } while (dirty);

        waiter();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
    }

    if (!settled) {
      throw new Error('runAuto did not complete within step cap');
    }

    await handlerPromise;
  }

  function getStatus(): string | undefined {
    return taskStatus;
  }

  return {
    assertBranchHistory,
    assertNotifications,
    isLlmTriggered,
    getStatus,
    appendUserMessage,
    appendAssistantMessage,
    runPushTask,
    runStartTask,
    runFinishTask,
    runDiscardTask,
    runAbortTask,
    runAuto,
  };
}

// ── Auto test types ─────────────────────────────────────────────

/** Entry kinds that can appear in a reaction pair's match slot. */
type MatchDescriptor =
  | Partial<BranchEntry>   // user(), assistant(), task() helpers produce these
  ;

/** Entry kinds that can appear in a reaction pair's reaction slot. */
type ReactionDescriptor =
  | Partial<BranchEntry>                        // assistant(), user(), task() helpers produce these
  | { type: 'user-esc' }                       // userEsc()
  | { type: 'user-ctrl-c' }                    // userCtrlC()
  | { type: 'user-runs-auto' }                 // userRunsAuto()
  ;

interface AutoConfig {
  reactions?: Array<[MatchDescriptor, ReactionDescriptor]>;
}


const notification = (text: string) => ({
  type: 'notification' as const,
  text,
  afterEntryId: null as string | null
}) as unknown as Partial<BranchEntry>;

type BranchEntry = import('@earendil-works/pi-coding-agent').SessionEntry | NotificationEntry;

// ── Branch history helpers ──────────────────────────────────────

type NotificationEntry = {
  type: 'notification';
  text: string;
  afterEntryId: string | null;
};

// ── pathSuite test helper ───────────────────────────────────────

interface PathNode {
    name: string;
    fn?: (h: ReturnType<typeof makeHarness>) => Promise<void> | void;
    children: PathNode[];
}

type PathFn = (
    name: string,
    fn?: (h: ReturnType<typeof makeHarness>) => Promise<void> | void,
    ...children: PathNode[]
) => PathNode;

function pathSuite(
    description: string,
    fn: (path: PathFn) => PathNode | PathNode[],
): void {
    describe(description, () => {
        const roots = fn(path);
        const rootsArray = Array.isArray(roots) ? roots : [roots];

        function registerTests(node: PathNode, ancestors: PathNode[]): void {
            const chain = [...ancestors, node];
            const name = chain.map(n => n.name).join(' → ');

            it(name, async () => {
                const h = makeHarness();
                for (const ancestor of chain) {
                    if (ancestor.fn) {
                        await ancestor.fn(h);
                    }
                }
            });

            for (const child of node.children) {
                registerTests(child, chain);
            }
        }

        for (const root of rootsArray) {
            registerTests(root, []);
        }
    });
}
