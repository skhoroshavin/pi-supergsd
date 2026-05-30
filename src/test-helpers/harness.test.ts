import { describe, it } from 'node:test';

import assert from 'node:assert';

import {
  responds,
  user,
  assistant,
  aborts,
  thinks,
  pushTask,
  task,
} from './index.js';
import { TestHarness } from './index.js';

describe('AgentSession-backed TestHarness foundation', () => {
  it('creates a real session and registers push-task through the extension', async () => {
    const h = await TestHarness.create();
    try {
      assert.ok(h.registeredToolNames().includes('push-task'));
      assert.strictEqual(h.getStatus(), undefined);
    } finally {
      h.dispose();
    }
  });

  it('records a user prompt and deterministic assistant response', async () => {
    const h = await TestHarness.create();
    try {
      await h.prompt('main work', responds('working...'));
      h.assertBranchHistory(
        user('main work'),
        assistant('working...'),
      );
    } finally {
      h.dispose();
    }
  });

  it('rejects unused faux responses', async () => {
    const h = await TestHarness.create();
    try {
      await assert.rejects(
        async () => h.prompt('main work', responds('used'), responds('unused')),
        /left unused faux responses queued/,
      );
    } finally {
      h.dispose();
    }
  });

  it('supports thinking and aborted response descriptors', async () => {
    const h = await TestHarness.create();
    try {
      await h.prompt('think', thinks('checking context'));
      h.assertBranchHistory(
        user('think'),
        assistant(''),
      );

      await h.prompt('stop', aborts('Stopped by user.'));
      h.assertSessionContains(
        user('stop'),
        assistant('Stopped by user.', 'aborted'),
      );
    } finally {
      h.dispose();
    }
  });

  it('calls the real push-task tool from a faux provider tool call', async () => {
    const h = await TestHarness.create();
    try {
      await h.prompt('delegate work', pushTask('subtask', true));
      h.assertSessionContains(
        user('delegate work'),
        task('subtask', true),
      );
      h.assertNotifications('Task stored. Use `/start-task` or `/auto` to start it.');
    } finally {
      h.dispose();
    }
  });
});
