import { describe, it } from 'node:test';

import assert from 'node:assert';

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
});
