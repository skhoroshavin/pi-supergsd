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
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, releaseNextIdle, flushMicrotasks, runPushTask, runAuto } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working on main...');
    await runPushTask('Analyze performance.');
    assert.strictEqual(getStatus(), 'pending task: analyze-performance');
    assertBranchHistory(
      user('main work'),
      assistant('working on main...'),
      task('Analyze performance.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();
    // Auto started the task (fresh context)
    assertBranchHistory(
      user('Analyze performance.'),
    );

    appendAssistantMessage('Found 3 bottlenecks: ...');

    await releaseNextIdle();
    await releaseNextIdle();
    await running;
    assertBranchHistory(
      user('main work'),
      assistant('working on main...'),
      task('Analyze performance.'),
      taskResult('analyze-performance', 'Found 3 bottlenecks: ...'),
      notification('Task finished. Last response attached.'),
    );
    assert.ok(isLlmTriggered());
  });

  it('returns the branch result to the original leaf for branch-context tasks', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, releaseNextIdle, flushMicrotasks, runPushTask, runAuto } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working...');
    await runPushTask('Quick fix.', true);
    assert.strictEqual(getStatus(), 'pending task: quick-fix');
    assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Quick fix.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();
    // Auto started the task (branch context, inherit_context=true)
    assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Quick fix.', true),
      user('Quick fix.'),
    );

    appendAssistantMessage('Fixed the bug.');

    await releaseNextIdle();
    await releaseNextIdle();
    await running;
    assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Quick fix.', true),
      taskResult('quick-fix', 'Fixed the bug.'),
      notification('Task finished. Last response attached.'),
    );
    assert.ok(isLlmTriggered());
  });

  it('stops when navigation is cancelled and does not mark the task done', async () => {
    const { appendUserMessage, assertBranchHistory, isLlmTriggered, setCancelNextNav, releaseNextIdle, flushMicrotasks, runPushTask, runAuto } =
      makeHarness();

    appendUserMessage('main work');
    await runPushTask('Analyze performance.');

    setCancelNextNav(true);

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();
    await running;
    assert.ok(!isLlmTriggered());
    // Navigation was cancelled, so no task-start was added
    assertBranchHistory(
      user('main work'),
      task('Analyze performance.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );
  });

  it('waits when started with no task, then starts work after a later push-task', async () => {
    const { appendAssistantMessage, assertBranchHistory, releaseNextIdle, flushMicrotasks, runPushTask, runAuto } =
      makeHarness();

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();

    await runPushTask('Review spec.');

    await releaseNextIdle();
    // Auto started the task (fresh context — task entry on sibling branch not visible)
    assertBranchHistory(
      user('Review spec.'),
    );

    appendAssistantMessage('Done.');

    await releaseNextIdle();
    await releaseNextIdle();
    await running;
  });

  it('warns and returns when /auto is already running', async () => {
    const { assertBranchHistory, releaseNextIdle, flushMicrotasks, emitSessionShutdown, runAuto } =
      makeHarness();

    const firstRun = runAuto();
    await flushMicrotasks();

    await runAuto();
    assertBranchHistory(notification('Auto is already running.'));

    await emitSessionShutdown();
    await releaseNextIdle();
    await firstRun;
  });

  it('stops when the last assistant message was aborted', async () => {
    const { appendUserMessage, appendAssistantMessage, isLlmTriggered, releaseNextIdle, flushMicrotasks, runPushTask, runStartTask, runAuto } =
      makeHarness();

    appendUserMessage('start');
    await runPushTask('Implement phase 1.', true);

    await runStartTask();

    appendAssistantMessage('Stopped by user.', 'aborted');

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();
    await running;
    assert.ok(!isLlmTriggered());
  });

  it('keeps waiting while follow-up work is pending after finishTask', async () => {
    const { appendUserMessage, appendAssistantMessage, isLlmTriggered, setPendingMessages, releaseNextIdle, flushMicrotasks, runPushTask, runStartTask, runAuto } =
      makeHarness();

    appendUserMessage('start');
    await runPushTask('Quick fix.', true);

    await runStartTask();

    appendAssistantMessage('Fixed the bug.');

    let resolved = false;
    const running = runAuto().then(() => {
      resolved = true;
    });

    await flushMicrotasks();
    setPendingMessages(true);
    await releaseNextIdle();
    await releaseNextIdle();
    assert.ok(isLlmTriggered());
    assert.strictEqual(resolved, false);

    setPendingMessages(false);
    await releaseNextIdle();
    await running;
    assert.strictEqual(resolved, true);
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

const assistant = (content: string) => ({
  type: 'message' as const,
  message: { role: 'assistant' as const, content: [{ type: 'text' as const, text: content }] }
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

// ── Test harness ─────────────────────────────────────────────────

function makeHarness() {
  const sm = SessionManager.inMemory();
  // Seed a non-visible root entry so findFreshTargetId can escape past user messages.
  // Pi always inserts thinking_level_change at session creation (main.js:471).
  sm.appendThinkingLevelChange('off');
  const idleWaiters: Array<() => void> = [];
  const sessionShutdownHandlers: Array<() => unknown> = [];
  const triggeredCustomMessages = new Set<string>();
  const triggeredUserMessages = new Set<string>();

  const trackedHints: Array<{ text: string; afterEntryId: string | null }> = [];
  let cancelNextNav = false;
  let pendingMessages = false;
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
    hasPendingMessages: () => pendingMessages,
    sessionManager: sm,
    ui: {
      notify(message: string) {
        trackedHints.push({ text: message, afterEntryId: sm.getLeafId() });
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
          const { timestamp: _mt, model: _mp, provider: _pp, stopReason: _sr, ...msgRest } = stripped.message as Record<string, unknown>;
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



  async function releaseNextIdle() {
    const next = idleWaiters.shift();
    assert.ok(next, 'Expected a pending waitForIdle call.');
    next();
    // Drain microtasks so anything awaiting the released idle can proceed.
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }

  async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
  }

  async function emitSessionShutdown() {
    for (const handler of sessionShutdownHandlers) {
      await handler();
    }
  }

  function setPendingMessages(value: boolean) {
    pendingMessages = value;
  }

  function setCancelNextNav(v: boolean) {
    cancelNextNav = v;
  }

  // ── Convenience wrappers (pre-bound to pi / ctx) ───────────────

  async function runPushTask(prompt: string, inherit_context?: boolean) {
    const tool = createPushTaskTool(pi);
    await tool.execute('call-1', { prompt, inherit_context }, undefined, undefined, ctx);
  }

  async function runTaskCommand(command: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<unknown> }) {
    const handlerP = command.handler('', ctx);
    await releaseNextIdle();
    await handlerP;
  }

  const runStartTask = () => runTaskCommand(createStartTaskCommand(pi));
  const runFinishTask = () => runTaskCommand(createFinishTaskCommand(pi));
  const runDiscardTask = () => runTaskCommand(createDiscardTaskCommand(pi));
  const runAbortTask = () => runTaskCommand(createAbortTaskCommand());

  // Auto-register commands so the shutdown handler is set up
  registerTaskCommands(pi);

  function runAuto(): Promise<void> {
    return createAutoCommand(pi).handler('', ctx) as Promise<void>;
  }

  function getStatus(): string | undefined {
    return taskStatus;
  }

  return {
    assertBranchHistory,
    isLlmTriggered,
    getStatus,
    appendUserMessage,
    appendAssistantMessage,
    releaseNextIdle,
    flushMicrotasks,
    emitSessionShutdown,
    setPendingMessages,
    setCancelNextNav,
    runPushTask,
    runStartTask,
    runFinishTask,
    runDiscardTask,
    runAbortTask,
    runAuto,
  };
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
