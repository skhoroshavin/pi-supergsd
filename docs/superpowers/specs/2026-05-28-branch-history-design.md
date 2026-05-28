# Branch History Test Helper Design

## Problem

The test harness exports too many helpers for inspecting "what happened":
- `getLlmHistory(): string[]` — LLM-visible messages as text
- `getLastTaskResultDetails()` — task result metadata
- `getLastHint()` — UI notifications (with clearing behavior)
- `getStatus()` — task state
- `isLlmTriggered()` — trigger detection

This fragments test assertions across multiple calls and makes it hard to see the full timeline.

## Goal

Replace `getLlmHistory()`, `getLastTaskResultDetails()`, and `getLastHint()` with a single `getBranchHistory()` that returns the complete chronological timeline.

## Design

### Entry Types

Return real `SessionEntry` types plus a notification entry:

```ts
type NotificationEntry = {
  type: 'notification';
  text: string;
  afterEntryId: string | null;
};

type BranchEntry = SessionEntry | NotificationEntry;
```

### Free Helper Functions

Module-level helpers construct minimal entry-like objects for assertions:

```ts
const user = (content: string) => ({
  type: 'message' as const,
  message: { role: 'user' as const, content }
});

const assistant = (content: string) => ({
  type: 'message' as const,
  message: { role: 'assistant' as const, content: [{ type: 'text' as const, text: content }] }
});

const task = (prompt: string, inherit_context = false) => ({
  type: 'custom' as const,
  customType: 'task',
  data: { prompt, inherit_context }
});

const taskResult = (slug: string, content = '') => ({
  type: 'custom_message' as const,
  customType: 'task-result',
  content,
  details: { slug },
  display: true
});

const notification = (text: string) => ({
  type: 'notification' as const,
  text,
  afterEntryId: null as string | null
});
```

### Custom Assertion

`assertBranchHistory(expected)` fetches the current branch history and compares. Structural comparison ignoring session-internal fields (`id`, `parentId`, `timestamp`). For notifications, ignores `afterEntryId` unless explicitly set in expected.

```ts
// Returned from makeHarness(), bound to internal state
function assertBranchHistory(expected: Partial<BranchEntry>[]) {
  const actual = getBranchHistory();
  // Compare structure, ignoring id/parentId/timestamp
  // For notification entries, ignore afterEntryId unless specified
}
```

`getBranchHistory()` is internal only — not exported from harness.

### Notification Tracking (Option C)

Hints are tracked via `ui.notify()` with the current leaf ID:

```ts
const trackedHints: Array<{ text: string; afterEntryId: string | null }> = [];

// In ui.notify
notify(message: string) {
  trackedHints.push({ text: message, afterEntryId: sm.getLeafId() });
}
```

### getBranchHistory Implementation

```ts
function getBranchHistory(): BranchEntry[] {
  const entries = sm.getBranch();
  const result: BranchEntry[] = [];
  const consumedHints = new Set<number>();

  for (const entry of entries) {
    // Skip internal bookkeeping
    if (entry.type === 'custom' && entry.customType === 'task-done') continue;

    result.push(entry);

    // Insert any notifications that belong after this entry
    for (let i = 0; i < trackedHints.length; i++) {
      if (trackedHints[i].afterEntryId === entry.id) {
        result.push({ type: 'notification', text: trackedHints[i].text, afterEntryId: entry.id });
        consumedHints.add(i);
      }
    }
  }

  // Unclassified hints (afterEntryId === null) go at start
  for (let i = 0; i < trackedHints.length; i++) {
    if (!consumedHints.has(i) && trackedHints[i].afterEntryId === null) {
      result.unshift({ type: 'notification', text: trackedHints[i].text, afterEntryId: null });
    }
  }

  return result;
}
```

**Important:** `getBranch()` returns entries from the current leaf. After `runStartTask()` branches, the history reflects the new branch. Tests should assert on the branch state at each point, or call `getBranchHistory()` before branching if they need the original timeline.

### Example Test Usage

```ts
const { appendUserMessage, appendAssistantMessage, assertBranchHistory, runPushTask, runStartTask, runFinishTask } = makeHarness();

appendUserMessage('main work');
appendAssistantMessage('working on main...');
await runPushTask('Analyze performance.');

// Before branching - see full timeline including pending task
assertBranchHistory([
  user('main work'),
  assistant('working on main...'),
  task('Analyze performance.'),
  notification('Task stored. Use `/start-task` or `/auto` to start it.'),
]);

await runStartTask();

// After branching - new branch from task entry
assertBranchHistory([
  user('main work'),
  task('Analyze performance.'),
]);
```

### What Stays

- `getStatus()` — current task state (not history)
- `isLlmTriggered()` — trigger detection (not history)
- `appendUserMessage()`, `appendAssistantMessage()` — test setup
- `runPushTask()`, `runStartTask()`, etc. — command execution

### What Goes

- `getLlmHistory()` — replaced by `assertBranchHistory()`
- `getLastTaskResultDetails()` — replaced by `assertBranchHistory()`
- `getLastHint()` — replaced by `assertBranchHistory()`

## Migration

1. Add types and free helpers at top of test file
2. Add `assertBranchHistory()` helper
3. Add `getBranchHistory()` to harness with notification tracking
4. Remove old helpers from harness return
5. Update each test to use new assertion style

## Decisions

1. `assertBranchHistory` stays inline in test file — can extract later if needed
2. Don't keep `getLlmHistory()` — `getBranchHistory()` replaces it entirely
