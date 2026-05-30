import assert from 'node:assert';

import type { SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent';

import { extractTextContent } from '../text-content.js';
import type { BranchEntry } from './descriptors.js';

export function assertBranchHistory(
  sessionManager: SessionManager,
  expected: BranchEntry[],
): void {
  const actual = sessionManager.getBranch()
    .map(stripVisibleEntry)
    .filter((entry): entry is BranchEntry => entry !== null);

  assert.deepStrictEqual(actual, expected);
}

export function assertSessionContains(
  sessionManager: SessionManager,
  expected: BranchEntry[],
): void {
  const actual = sessionManager.getEntries()
    .map(stripVisibleEntry)
    .filter((entry): entry is BranchEntry => entry !== null);

  for (const expectedEntry of expected) {
    assert.ok(
      actual.some(entry => entriesEqual(entry, expectedEntry)),
      `Expected session to contain entry: ${JSON.stringify(expectedEntry)}`,
    );
  }
}

function stripVisibleEntry(entry: SessionEntry): BranchEntry | null {
  if (isHiddenEntry(entry)) return null;

  if (entry.type === 'message') {
    if (entry.message.role === 'user') {
      return {
        type: 'message',
        message: { role: 'user', content: [{ type: 'text', text: extractTextContent(entry.message.content, '') ?? '' }] },
      };
    }

    if (entry.message.role === 'assistant') {
      return {
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: extractTextContent(entry.message.content, '') ?? '' }],
          ...(entry.message.stopReason && entry.message.stopReason !== 'stop'
            ? { stopReason: entry.message.stopReason }
            : {}),
        },
      };
    }

    return null;
  }

  if (entry.type === 'custom') {
    if (entry.customType !== 'task') return null;
    const data = readTaskData(entry.data);
    return data ? { type: 'custom', customType: 'task', data } : null;
  }

  if (entry.type === 'custom_message') {
    if (entry.customType !== 'task-result') return null;
    const slug = readTaskResultSlug(entry.details);
    if (!slug) return null;
    const text = extractTextContent(entry.content, '') ?? '';
    return {
      type: 'custom_message',
      customType: 'task-result',
      details: { slug },
      ...(text !== '' ? { content: [{ type: 'text', text }] } : {}),
    };
  }

  return null;
}

function isHiddenEntry(entry: SessionEntry): boolean {
  switch (entry.type) {
    case 'thinking_level_change':
    case 'model_change':
    case 'session_info':
    case 'label':
      return true;
    case 'custom':
      return entry.customType === 'task-done' || entry.customType === 'task-start';
    default:
      return false;
  }
}

function readTaskData(data: unknown): { prompt: string; inherit_context: boolean } | null {
  if (!isRecord(data)) return null;
  if (typeof data.prompt !== 'string' || typeof data.inherit_context !== 'boolean') return null;
  return { prompt: data.prompt, inherit_context: data.inherit_context };
}

function readTaskResultSlug(details: unknown): string | null {
  return isRecord(details) && typeof details.slug === 'string' ? details.slug : null;
}

function entriesEqual(actual: BranchEntry, expected: BranchEntry): boolean {
  try {
    assert.deepStrictEqual(actual, expected);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
