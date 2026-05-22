import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { superpowersUpdate, superpowersGetSkill, superpowersGetFile } from './source.js';

describe('source', () => {
  before(async () => {
    // Use a test-specific cache dir to avoid clobbering the default
    process.env.PI_SUPERGSD_CACHE_DIR = '/tmp/pi-supergsd-test-cache';
    await superpowersUpdate();
  });

  it('update does not throw', async () => {
    await assert.doesNotReject(superpowersUpdate());
  });

  it('getSkill returns non-empty array for known skill', () => {
    const files = superpowersGetSkill('brainstorming');
    assert.ok(files.length > 0, 'Expected non-empty file list');
    assert.ok(files.every(f => typeof f === 'string'), 'Expected all items to be strings');
    assert.ok(files.every(f => f.startsWith('skills/brainstorming/')), 'Expected repo-relative paths');
  });

  it('getFile returns non-empty string for known file', () => {
    const files = superpowersGetSkill('brainstorming');
    assert.ok(files.length > 0, 'Need at least one file to test');
    const content = superpowersGetFile(files[0]);
    assert.ok(typeof content === 'string' && content.length > 0, 'Expected non-empty string');
  });
});
