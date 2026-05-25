# Move task tooling to pi-supergsd — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `push-task`, `/start-task`, `/discard-task` and add `/finish-task`, `/abort-task` from pi-navigator into pi-supergsd, making task workflow self-contained.

**Architecture:** pi-supergsd gains a flat `index.ts` + `index.test.ts` following pi-navigator's pattern. Task-specific code is ported with renames (`checkpoint` → `task-start`, `/return` → `/finish-task`, `/cancel` → `/abort-task`). pi-navigator drops all task code and task consumption from `/return`/`/cancel`. Skill patches drop `push-task` conditionals. No shared dependency — entry type strings (`'task-start'` vs `'checkpoint'`) are the only implicit contract.

**Tech Stack:** TypeScript (ES modules, Node 20+), Pi SDK (`@earendil-works/pi-coding-agent`), TypeBox, Node built-in test runner, tsx

**Roadmap:** None

**Phase:** Single-plan implementation

---

### Task 1: Remove task code from pi-navigator `index.ts`

**Files:**
- Modify: `../pi-navigator/index.ts`

Remove from `registerNavigationCommands`:
- `pi.registerTool(createPushTaskTool(pi));`
- `pi.registerCommand('start-task', createStartTaskCommand(pi));`
- `pi.registerCommand('discard-task', createDiscardTaskCommand(pi));`

Remove export on these functions (make them non-existent):
- `createPushTaskTool` — entire function + `pushTaskParameters` constant
- `createStartTaskCommand` — entire function
- `createDiscardTaskCommand` — entire function

Remove task consumption from `createCancelCommand` (lines after `navigateTree` up to and including task-done append and notification):
```typescript
      if (findActiveTask(ctx.sessionManager)) {
        pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
      }

      ctx.ui.notify('Cancelled. Branch abandoned without summary.', 'info');
```
Replace with just:
```typescript
      ctx.ui.notify('Cancelled. Branch abandoned without summary.', 'info');
```

Remove task consumption from `createReturnCommand` (lines after `navigateTree` result check):
```typescript
      if (findActiveTask(ctx.sessionManager)) {
        pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
      }
```

Remove the task block entirely — keep only the injection + notification code after it.

Remove all task-related exports and types:
- `findActiveTask` function
- `TASK_ENTRY_TYPE` constant + export
- `TASK_DONE_ENTRY_TYPE` constant + export
- `TaskData` interface + export

Remove unused imports from the top:
- After removing `createPushTaskTool`, check if `defineTool` and `ToolDefinition` are still needed (they are used by `createReturnCommand` for `sendMessage` — keep them)
- `Type` is only used by `pushTaskParameters` — remove `import { Type } from 'typebox'` if no longer needed

- [ ] **Step 1: Remove task registrations from `registerNavigationCommands`**

```typescript
export default function registerNavigationCommands(pi: ExtensionAPI): void {
  pi.registerCommand('start-branch', createStartBranchCommand(pi));
  pi.registerCommand('start-fresh', createStartFreshCommand(pi));
  pi.registerCommand('return', createReturnCommand(pi));
  pi.registerCommand('cancel', createCancelCommand(pi));
  pi.registerCommand('undo', createUndoCommand());
}
```

- [ ] **Step 2: Remove `createPushTaskTool` and `pushTaskParameters`**

Delete the entire `createPushTaskTool` function and the `pushTaskParameters` constant at the bottom of the file.

- [ ] **Step 3: Remove `createStartTaskCommand`**

Delete the entire `createStartTaskCommand` function.

- [ ] **Step 4: Remove `createDiscardTaskCommand`**

Delete the entire `createDiscardTaskCommand` function.

- [ ] **Step 5: Remove task consumption from `createCancelCommand`**

Replace:
```typescript
      if (findActiveTask(ctx.sessionManager)) {
        pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
      }

      ctx.ui.notify('Cancelled. Branch abandoned without summary.', 'info');
```
With:
```typescript
      ctx.ui.notify('Cancelled. Branch abandoned without summary.', 'info');
```

- [ ] **Step 6: Remove task consumption from `createReturnCommand`**

Delete these lines:
```typescript
      if (findActiveTask(ctx.sessionManager)) {
        pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
      }
```

- [ ] **Step 7: Remove task types and `findActiveTask`**

Delete:
- `findActiveTask` function
- `export const TASK_ENTRY_TYPE = 'task';`
- `export const TASK_DONE_ENTRY_TYPE = 'task-done';`
- `export interface TaskData { prompt: string; context: 'fresh' | 'branch'; }`

- [ ] **Step 8: Remove unused imports**

Remove `import { Type } from 'typebox';` if no longer referenced.
Remove `defineTool` and `ToolDefinition` from the pi-coding-agent import if no longer used (they still are — `createReturnCommand` doesn't use them directly, but check). Actually `defineTool` and `ToolDefinition` were only for `createPushTaskTool`. Remove them.

- [ ] **Step 9: Run lint + typecheck**

```bash
cd ../pi-navigator && npm run lint && npx tsc --noEmit
```

Expected: clean output.

- [ ] **Step 10: Commit**

```bash
cd ../pi-navigator && git add index.ts && git commit -m "refactor: remove task tooling (moved to pi-supergsd)"
```

---

### Task 2: Remove task tests from pi-navigator `index.test.ts`

**Files:**
- Modify: `../pi-navigator/index.test.ts`

- [ ] **Step 1: Remove task-related imports**

Remove from import block:
- `createPushTaskTool`, `createStartTaskCommand`, `createDiscardTaskCommand`
- `TASK_DONE_ENTRY_TYPE`, `TASK_ENTRY_TYPE`, `type TaskData`

Keep: `CHECKPOINT_ENTRY_TYPE`, `type CheckpointData`

Result:
```typescript
import registerNavigationCommands, {
  createStartBranchCommand,
  createReturnCommand,
  createStartFreshCommand,
  createCancelCommand,
  createUndoCommand,
} from './index.js';

import {
  CHECKPOINT_ENTRY_TYPE,
  type CheckpointData,
} from './index.js';
```

- [ ] **Step 2: Remove task test suites**

Delete entire blocks:
- `describe('createPushTaskTool', () => { ... });` (~lines 25-45)
- `describe('createStartTaskCommand', () => { ... });` (~lines with start-task tests)
- `describe('createDiscardTaskCommand', () => { ... });` (~lines with discard-task tests)

- [ ] **Step 3: Remove task assertions from `createCancelCommand` tests**

In `describe('createCancelCommand', ...)`:
- Remove test `'navigates back without summary and appends task-done'` — this test asserts task-done is appended
- Remove test `'does not append task-done when navigation is cancelled'` — task-specific
- Keep: `'notifies without navigating when no checkpoint exists'`

In the remaining cancel test, remove the `assertNoCheckpoint` call that checks for task types:
The test `'notifies without navigating when no checkpoint exists'` uses `assertNoCheckpoint` which checks for checkpoint entries, not task entries — keep it.

- [ ] **Step 4: Remove task assertions from `createReturnCommand` tests**

Remove tests that assert task consumption:
- `'navigates to the checkpoint return target and appends task-done'` — remove or rewrite without task assertion
- `'does not append task-done when tree navigation is cancelled'` — remove
- `'supports a complete start-task → work → return roundtrip'` — remove entirely

Rewrite `'navigates to the checkpoint return target and appends task-done'` to just verify navigation without task consumption:
```typescript
  it('navigates to the checkpoint return target', async () => {
    const { pi, ctx, sm, navigations } = makeHarness();
    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    sm.appendMessage(assistantMessage('Ready.'));
    const leafId = sm.getLeafId()!;
    sm.branch(leafId);
    sm.appendCustomEntry(CHECKPOINT_ENTRY_TYPE, { returnTo: leafId });
    sm.appendMessage({ role: 'user', content: 'work', timestamp: 0 });
    sm.appendMessage(assistantMessage('Done.'));

    const cmd = createReturnCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(navigations.length, 1);
    assert.strictEqual(navigations[0].targetId, leafId);
    assert.strictEqual((navigations[0].opts as { summarize?: boolean })?.summarize, true);
  });
```

- [ ] **Step 5: Remove task-related integration tests**

Delete:
- `describe('integration: nested /start-task', ...)`
- `describe('integration: /start-task fresh context', ...)`
- `describe('integration: /start-task branch context', ...)`
- The `'task called twice - second task is the active one'` test
- The `'after clearing second task, first task becomes active'` test
- The `'/undo from a /start-task branch goes to the injected task message'` test

- [ ] **Step 6: Remove task-related test helpers**

Delete:
- `assertActiveTask` function
- `assertNoActiveTask` function
- `getActiveTask` function

- [ ] **Step 7: Update registration test**

In `describe('registration', ...)`, update expected array to remove task registrations:
```typescript
assert.deepStrictEqual(registered, [
  { type: 'command', name: 'start-branch', description: 'Start a focused branch from the current position' },
  { type: 'command', name: 'start-fresh', description: 'Start a focused branch in a fresh context' },
  { type: 'command', name: 'return', description: 'Return to the checkpoint for the current task branch' },
  { type: 'command', name: 'cancel', description: 'Return without summarizing the current task branch' },
  { type: 'command', name: 'undo', description: 'Jump to the previous user message to re-prompt' },
]);
```

- [ ] **Step 8: Run tests**

```bash
cd ../pi-navigator && npm test
```

Expected: all remaining tests pass.

- [ ] **Step 9: Commit**

```bash
cd ../pi-navigator && git add index.test.ts && git commit -m "test: remove task-related tests (moved to pi-supergsd)"
```

---

### Task 3: Create pi-supergsd `index.ts`

**Files:**
- Create: `index.ts`

Write the complete file. Ported from pi-navigator with renames:
- `CHECKPOINT_ENTRY_TYPE` → `TASK_START_ENTRY_TYPE` (`'task-start'`)
- `CheckpointData` → `TaskStartData`
- `findCheckpoint` → `findTaskStart`
- `createReturnCommand` → `createFinishTaskCommand` (command: `/finish-task`)
- `createCancelCommand` → `createAbortTaskCommand` (command: `/abort-task`)
- Default export: `registerTaskCommands`

Keep unchanged from pi-navigator (just copied):
- `TASK_ENTRY_TYPE`, `TASK_DONE_ENTRY_TYPE`, `TaskData`, `findActiveTask`
- `createPushTaskTool`, `pushTaskParameters`
- `createStartTaskCommand`
- `createDiscardTaskCommand`
- `findFreshTargetId`, `findPreConversationEntry`, `ReadonlySessionLike`
- `isAssistantMessageEntry` + thinking-block filter
- Import of `defineTool`, `ToolDefinition`, `Type`, plus all Pi SDK types

Notification wording updates:
- `'No return point.'` → `'No task start point.'` (in both finish-task and abort-task)
- Command descriptions adapted for task context

- [ ] **Step 1: Write complete `index.ts`**

Full file content:

```typescript
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type RegisteredCommand,
  type SessionEntry,
  type SessionMessageEntry,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';

import { Type } from 'typebox';

export default function registerTaskCommands(pi: ExtensionAPI): void {
  pi.registerTool(createPushTaskTool(pi));
  pi.registerCommand('start-task', createStartTaskCommand(pi));
  pi.registerCommand('discard-task', createDiscardTaskCommand(pi));
  pi.registerCommand('finish-task', createFinishTaskCommand(pi));
  pi.registerCommand('abort-task', createAbortTaskCommand(pi));
}

export function createPushTaskTool(pi: ExtensionAPI): ToolDefinition {
  return defineTool({
    name: 'push-task',
    label: 'Push Task',
    description: 'Store a task prompt for a user-started navigation branch.',
    promptSnippet: 'Store a focused task prompt for a user-started navigation branch.',
    promptGuidelines: [
      'Use push-task when a skill needs the user to start a focused branch workflow with /start-task.',
    ],
    parameters: pushTaskParameters,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) {
        throw new Error('Task storage aborted.');
      }

      pi.appendEntry(TASK_ENTRY_TYPE, { prompt: params.prompt, context: params.context ?? 'fresh' });

      return {
        content: [{ type: 'text', text: 'Task stored. Run `/start-task` to begin.' }],
        details: {},
      };
    },
  });
}

export function createStartTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Start the active task as a subagent',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();

      const activeTask = findActiveTask(ctx.sessionManager);
      if (!activeTask) {
        ctx.ui.notify('No pending task. Use push-task first.', 'warning');
        return;
      }

      const taskContext = activeTask.data.context ?? 'fresh';

      if (taskContext === 'fresh') {
        const departureLeafId = ctx.sessionManager.getLeafId()!;
        const freshTargetId = findFreshTargetId(ctx.sessionManager);
        if (!freshTargetId) {
          ctx.ui.notify('No starting point found on current branch.', 'warning');
          return;
        }

        const result = await ctx.navigateTree(freshTargetId, { summarize: false });
        if (result.cancelled) return;

        pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: departureLeafId, handoff: 'last-response' });
      } else {
        // Branch context — same as /start-branch
        pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: ctx.sessionManager.getLeafId()!, handoff: 'last-response' });
      }

      pi.sendUserMessage(activeTask.data.prompt);
    },
  };
}

export function createDiscardTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Discard the active task without executing it',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();

      const activeTask = findActiveTask(ctx.sessionManager);
      if (!activeTask) {
        ctx.ui.notify('No pending task.', 'warning');
        return;
      }

      pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});

      ctx.ui.notify('Task discarded.', 'info');
    },
  };
}

export function createFinishTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Finish the current task and return to the task start point',
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();

      const taskStart = findTaskStart(ctx.sessionManager);
      if (!taskStart) {
        ctx.ui.notify('No task start point.', 'warning');
        return;
      }

      // Parse override from args
      let handoff = taskStart.data.handoff ?? 'summary';
      const trimmed = args.trim();
      if (trimmed === 'last' || trimmed === 'last-response') {
        handoff = 'last-response';
      } else if (trimmed === 'summary') {
        handoff = 'summary';
      }

      // Capture last assistant message content before navigation (for last-response mode)
      let lastAssistantContent: unknown;
      let lastAssistantId: string | undefined;
      if (handoff === 'last-response') {
        const branch = ctx.sessionManager.getBranch();
        for (let i = branch.length - 1; i >= 0; i--) {
          const entry = branch[i];
          if (isAssistantMessageEntry(entry)) {
            const rawContent = entry.message.content;
            // Filter to only text blocks — thinking and toolCall blocks are not
            // valid for custom_message content and cause provider errors (e.g.,
            // DeepSeek rejects unrecognized content block variants).
            if (Array.isArray(rawContent)) {
              lastAssistantContent = rawContent.filter(
                (block): block is { type: 'text'; text: string } =>
                  typeof block === 'object' && block !== null && 'type' in block && block.type === 'text',
              );
            } else {
              lastAssistantContent = rawContent;
            }
            lastAssistantId = entry.id;
            break;
          }
        }
      }

      const result = await ctx.navigateTree(taskStart.data.returnTo, {
        summarize: handoff === 'summary',
      });
      if (result.cancelled) return;

      // Inject last assistant message after navigation
      if (handoff === 'last-response' && lastAssistantId) {
        pi.sendMessage({
          customType: 'branch-result',
          // Content is filtered to only TextContent blocks (or original string)
          content: lastAssistantContent as unknown as string,
          display: true,
          details: { sourceEntryId: lastAssistantId },
        }, { triggerTurn: true });
      }

      if (findActiveTask(ctx.sessionManager)) {
        pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
      }

      const injected = handoff === 'last-response' && !!lastAssistantId;
      const label = injected ? 'Last response attached.' : handoff === 'last-response' ? 'No last response to attach.' : 'Branch summary attached.';
      ctx.ui.notify(`Task finished. ${label}`, 'info');
    },
  };
}

export function createAbortTaskCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Abort the current task without finishing',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();

      const taskStart = findTaskStart(ctx.sessionManager);

      if (!taskStart) {
        ctx.ui.notify('No task start point.', 'warning');
        return;
      }

      const result = await ctx.navigateTree(taskStart.data.returnTo, { summarize: false });
      if (result.cancelled) return;

      if (findActiveTask(ctx.sessionManager)) {
        pi.appendEntry(TASK_DONE_ENTRY_TYPE, {});
      }

      ctx.ui.notify('Task aborted. Branch abandoned without summary.', 'info');
    },
  };
}

/** Type guard: is the entry an assistant message with content? */
function isAssistantMessageEntry(entry: SessionEntry): entry is SessionMessageEntry & { message: { role: 'assistant' } } {
  return entry.type === 'message' && entry.message.role === 'assistant';
}

// ── Lookup utilities ──────────────────────────────────────────────

export function findActiveTask(
  session: ReadonlySessionLike,
): (SessionEntry & { data: TaskData }) | null {
  const entries = session.getEntries();
  const byId = new Map<string, SessionEntry>(entries.map((e) => [e.id, e]));
  let skip = 0;
  const leafId = session.getLeafId();
  let current = leafId ? byId.get(leafId) : undefined;

  while (current) {
    if (current.type === 'custom' && current.customType === TASK_DONE_ENTRY_TYPE) {
      skip++;
    } else if (current.type === 'custom' && current.customType === TASK_ENTRY_TYPE) {
      if (skip === 0) return current as SessionEntry & { data: TaskData };
      skip--;
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return null;
}

export const TASK_ENTRY_TYPE = 'task';

export const TASK_DONE_ENTRY_TYPE = 'task-done';

export interface TaskData {
  prompt: string;
  context: 'fresh' | 'branch';
}

export function findTaskStart(
  session: ReadonlySessionLike,
): (SessionEntry & { data: TaskStartData }) | null {
  const entries = session.getEntries();
  const byId = new Map<string, SessionEntry>(entries.map((e) => [e.id, e]));
  const leafId = session.getLeafId();
  let current = leafId ? byId.get(leafId) : undefined;

  while (current) {
    if (current.type === 'custom' && current.customType === TASK_START_ENTRY_TYPE) {
      return current as SessionEntry & { data: TaskStartData };
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return null;
}

export const TASK_START_ENTRY_TYPE = 'task-start';

export interface TaskStartData {
  returnTo: string;
  handoff?: 'summary' | 'last-response';
}

/**
 * Find the target ID for navigating to a fresh context.
 * Returns the parent of the first model-visible entry, or the branch root as fallback.
 * Returns null if no valid target is found.
 */
function findFreshTargetId(session: ReadonlySessionLike): string | null {
  const branch = session.getBranch();
  if (branch.length === 0) return null;

  const firstVisible = findPreConversationEntry(session);
  if (firstVisible) {
    return firstVisible.parentId ?? firstVisible.id;
  }

  // Fallback: use branch root's parent (or the root itself if no parent)
  return branch[0].parentId ?? branch[0].id;
}

/**
 * Find the first model-visible entry on the current branch (closest to root).
 *
 * "Model-visible" means the entry participates in LLM context via buildSessionContext:
 * messages (user/assistant), compaction summaries, branch summaries, and custom messages.
 * Entries like thinking_level_change, model_change, custom (data-only), label, and
 * session_info are NOT visible — Pi may insert them before the conversation begins.
 *
 * Returns null if the branch has no model-visible entries (e.g., only non-visible setup
 * entries) or if there is no leaf.
 */
function findPreConversationEntry(
  session: ReadonlySessionLike,
): SessionEntry | null {
  const leafId = session.getLeafId();
  if (!leafId) return null;

  const branch = session.getBranch();
  for (const entry of branch) {
    if (
      entry.type === 'message' ||
      entry.type === 'compaction' ||
      entry.type === 'branch_summary' ||
      entry.type === 'custom_message'
    ) {
      return entry;
    }
  }

  return null;
}

/**
 * Minimal read-only session interface needed by lookup functions.
 * Compatible with both ReadonlySessionManager (from ExtensionCommandContext)
 * and SessionManager (full mutable version).
 */
export interface ReadonlySessionLike {
  getEntries(): SessionEntry[];
  getLeafId(): string | null;
  getBranch(): SessionEntry[];
}

type CommandOptions = Omit<RegisteredCommand, 'name' | 'sourceInfo'>;

const pushTaskParameters = Type.Object({
  prompt: Type.String({ description: 'Full prompt for the task, including all context and instructions.' }),
  context: Type.Optional(Type.Union([
    Type.Literal('fresh'),
    Type.Literal('branch'),
  ], { description: 'Context mode: "fresh" (clean slate, default) or "branch" (current branch).' })),
});
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: clean output (no lint errors).

- [ ] **Step 3: Commit**

```bash
git add index.ts && git commit -m "feat: add task tooling (push-task, start-task, finish-task, abort-task, discard-task)"
```

---

### Task 4: Create pi-supergsd `index.test.ts`

**Files:**
- Create: `index.test.ts`

Port task-related tests from pi-navigator's `index.test.ts`, adapted for renamed identifiers. Use the same `makeHarness` infrastructure.

Test suites to port:
1. `describe('createPushTaskTool', ...)` — identical, unchanged
2. `describe('createStartTaskCommand', ...)` — replace `CHECKPOINT_ENTRY_TYPE` → `TASK_START_ENTRY_TYPE`, `assertCheckpoint` → `assertTaskStart`, `getCheckpoint` → `getTaskStart`
3. `describe('createDiscardTaskCommand', ...)` — identical, unchanged
4. `describe('createFinishTaskCommand', ...)` — ported from `createReturnCommand`, but only task-related tests (handoff modes, last-response injection, thinking-block filtering, task consumption). Use `TASK_START_ENTRY_TYPE`, `assertTaskStart`, `getTaskStart`. Command name: `finish-task`.
5. `describe('createAbortTaskCommand', ...)` — ported from `createCancelCommand` task tests. Command name: `abort-task`.
6. Task integration tests (start-task → work → finish-task roundtrips, stacked tasks)
7. Registration test: 1 tool + 4 commands

Not ported: user-driven navigation tests (`createStartBranchCommand`, `createStartFreshCommand`, `createUndoCommand`), non-task return/cancel tests.

- [ ] **Step 1: Write complete `index.test.ts`**

Full test file content (adapted from pi-navigator with renames applied throughout):

```typescript
import assert from 'node:assert';

import { describe, it } from 'node:test';

import { SessionManager, type CustomEntry, type ExtensionAPI, type ExtensionCommandContext } from '@earendil-works/pi-coding-agent';

import registerTaskCommands, {
  createPushTaskTool,
  createStartTaskCommand,
  createFinishTaskCommand,
  createAbortTaskCommand,
  createDiscardTaskCommand,
} from './index.js';

import {
  TASK_START_ENTRY_TYPE,
  TASK_DONE_ENTRY_TYPE,
  TASK_ENTRY_TYPE,
  type TaskStartData,
  type TaskData,
} from './index.js';

describe('createPushTaskTool', () => {
  it('pushes a task entry, and returns instruction text', async () => {
    const { pi, ctx, sm } = makeHarness();
    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });

    const tool = createPushTaskTool(pi);
    assert.strictEqual(tool.name, 'push-task');
    await tool.execute('call-1', { prompt: 'Review the spec.' }, undefined, undefined, ctx);

    const task = assertActiveTask(ctx.sessionManager);
    assert.strictEqual(task.prompt, 'Review the spec.');
    assert.strictEqual(task.context, 'fresh');
  });

  it('pushes a task entry with explicit context "branch"', async () => {
    const { pi, ctx, sm } = makeHarness();
    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });

    const tool = createPushTaskTool(pi);
    await tool.execute('call-1', { prompt: 'Quick fix.', context: 'branch' }, undefined, undefined, ctx);

    const task = assertActiveTask(ctx.sessionManager);
    assert.strictEqual(task.prompt, 'Quick fix.');
    assert.strictEqual(task.context, 'branch');
  });
});

describe('createStartTaskCommand', () => {
  it('notifies when there is no pending task', async () => {
    const { pi, ctx, notifications } = makeHarness();
    ctx.sessionManager.appendMessage({ role: 'user', content: 'hello', timestamp: 0 });

    const cmd = createStartTaskCommand(pi);
    await cmd.handler('', ctx);

    assertLastNotification(notifications, 'warning', 'No pending task. Use push-task first.');
  });

  it('navigates to fresh context and injects task prompt with handoff "last-response"', async () => {
    const { pi, ctx, sentMessages, navigations } = makeHarness();

    const rootUserMsgId = ctx.sessionManager.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    ctx.sessionManager.appendMessage(assistantMessage('working...'));
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Review spec for issues.' });
    const departureLeafId = ctx.sessionManager.getLeafId()!;

    const cmd = createStartTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(navigations.length, 1);
    assert.strictEqual(navigations[0].targetId, rootUserMsgId);
    assert.strictEqual((navigations[0].opts as { summarize?: boolean })?.summarize, false);

    const taskStart = assertTaskStart(ctx.sessionManager, 'last-response');
    assert.strictEqual(taskStart.returnTo, departureLeafId);

    assert.deepStrictEqual(sentMessages, ['Review spec for issues.']);
  });

  it('stays on branch and creates task start with handoff "last-response"', async () => {
    const { pi, ctx, sentMessages, navigations } = makeHarness();

    ctx.sessionManager.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Quick fix.', context: 'branch' });
    const leafBefore = ctx.sessionManager.getLeafId()!;

    const cmd = createStartTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(navigations.length, 0);

    const taskStart = assertTaskStart(ctx.sessionManager, 'last-response');
    assert.strictEqual(taskStart.returnTo, leafBefore);

    assert.deepStrictEqual(sentMessages, ['Quick fix.']);
  });

  it('defaults to fresh context when task has no explicit context', async () => {
    const { pi, ctx, navigations } = makeHarness();

    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Default context task.' });

    const cmd = createStartTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(navigations.length, 1);
    const taskStart = assertTaskStart(ctx.sessionManager, 'last-response');
    assert.ok(taskStart);
  });
});

describe('createDiscardTaskCommand', () => {
  it('notifies when there is no pending task', async () => {
    const { pi, ctx, notifications } = makeHarness();
    ctx.sessionManager.appendMessage({ role: 'user', content: 'hello', timestamp: 0 });

    const cmd = createDiscardTaskCommand(pi);
    await cmd.handler('', ctx);

    assertLastNotification(notifications, 'warning', 'No pending task.');
  });

  it('appends task-done to consume the active task', async () => {
    const { pi, ctx } = makeHarness();
    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'first task' });
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'second task' });

    const cmd = createDiscardTaskCommand(pi);
    await cmd.handler('', ctx);

    const entries = ctx.sessionManager.getEntries();
    const lastEntry = entries[entries.length - 1];
    assert.strictEqual(lastEntry.type, 'custom');
    assert.strictEqual((lastEntry as CustomEntry).customType, TASK_DONE_ENTRY_TYPE);

    const task = assertActiveTask(ctx.sessionManager);
    assert.strictEqual(task.prompt, 'first task');
  });

  it('clears the only pending task so no task remains', async () => {
    const { pi, ctx } = makeHarness();
    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'only task' });

    const cmd = createDiscardTaskCommand(pi);
    await cmd.handler('', ctx);

    assertNoActiveTask(ctx.sessionManager);
  });
});

describe('createFinishTaskCommand', () => {
  it('notifies without navigating when there is no task start on the current branch', async () => {
    const { pi, ctx, sm, notifications } = makeHarness();
    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Implement phase 1.' });

    const cmd = createFinishTaskCommand(pi);
    await cmd.handler('', ctx);

    assertLastNotification(notifications, 'warning', 'No task start point.');
  });

  it('navigates to the task start return target and appends task-done', async () => {
    const { pi, ctx, sm, navigations } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Implement phase 1.' });
    sm.appendMessage(assistantMessage('Ready.'));

    const leafId = sm.getLeafId()!;
    sm.branch(leafId);
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: leafId });
    sm.appendMessage({ role: 'user', content: 'Implement phase 1.', timestamp: 0 });
    sm.appendMessage(assistantMessage('Done.'));

    const cmd = createFinishTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(navigations.length, 1);
    assert.strictEqual(navigations[0].targetId, leafId);
    assert.strictEqual((navigations[0].opts as { summarize?: boolean })?.summarize, true);

    const entries = ctx.sessionManager.getEntries();
    const lastEntry = entries[entries.length - 1];
    assert.strictEqual(lastEntry.type, 'custom');
    assert.strictEqual((lastEntry as CustomEntry).customType, TASK_DONE_ENTRY_TYPE);

    assertNoActiveTask(ctx.sessionManager);
  });

  it('does not append task-done when tree navigation is cancelled', async () => {
    const { pi, ctx, sm, setCancelNextNav } = makeHarness();
    setCancelNextNav(true);

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    const rootId = sm.getLeafId()!;
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Implement phase 1.' });
    const taskId = sm.getLeafId()!;
    sm.branch(taskId);
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: rootId });

    const entriesBefore = ctx.sessionManager.getEntries().length;

    const cmd = createFinishTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(ctx.sessionManager.getEntries().length, entriesBefore);
  });

  it('supports a complete start-task → work → finish-task roundtrip', async () => {
    const { pi, ctx, sm, sentMessages, sentCustomMessages } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });

    pi.appendEntry(TASK_ENTRY_TYPE, { prompt: 'Write tests first.' });

    const startCmd = createStartTaskCommand(pi);
    await startCmd.handler('', ctx);
    assert.deepStrictEqual(sentMessages, ['Write tests first.']);

    sm.appendMessage(assistantMessage('Tests and implementation are complete.'));

    const finishCmd = createFinishTaskCommand(pi);
    await finishCmd.handler('', ctx);

    assert.strictEqual(sentCustomMessages.length, 1);

    assertNoActiveTask(ctx.sessionManager);
  });

  it('injects last assistant message when task start has handoff "last-response"', async () => {
    const { pi, ctx, sm, sentCustomMessages, notifications } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    sm.appendMessage(assistantMessage('Here is my analysis...'));

    const leafId = sm.getLeafId()!;
    sm.branch(leafId);
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: leafId, handoff: 'last-response' });
    sm.appendMessage({ role: 'user', content: 'work', timestamp: 0 });
    sm.appendMessage(assistantMessage('Working on it...'));

    const cmd = createFinishTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(sentCustomMessages[0].customType, 'branch-result');
    assert.strictEqual((sentCustomMessages[0].options as { triggerTurn?: boolean } | undefined)?.triggerTurn, true);

    assertLastNotification(notifications, 'info', 'Task finished. Last response attached.');
  });

  it('overrides task start handoff with "/finish-task last"', async () => {
    const { pi, ctx, sm, sentCustomMessages } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    sm.appendMessage(assistantMessage('Summary of work...'));
    const leafId = sm.getLeafId()!;
    sm.branch(leafId);
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: leafId, handoff: 'summary' });
    sm.appendMessage({ role: 'user', content: 'work', timestamp: 0 });
    sm.appendMessage(assistantMessage('Final answer.'));

    const cmd = createFinishTaskCommand(pi);
    await cmd.handler('last', ctx);

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(sentCustomMessages[0].customType, 'branch-result');
  });

  it('overrides task start handoff with "/finish-task summary"', async () => {
    const { pi, ctx, sm, sentCustomMessages, navigations } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    const leafId = sm.getLeafId()!;
    sm.branch(leafId);
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: leafId, handoff: 'last-response' });
    sm.appendMessage({ role: 'user', content: 'work', timestamp: 0 });
    sm.appendMessage(assistantMessage('Final answer.'));

    const cmd = createFinishTaskCommand(pi);
    await cmd.handler('summary', ctx);

    assert.strictEqual(navigations.length, 1);
    assert.strictEqual((navigations[0].opts as { summarize?: boolean })?.summarize, true);

    assert.strictEqual(sentCustomMessages.length, 0);
  });

  it('filters out thinking blocks from injected last-response content', async () => {
    const { pi, ctx, sm, sentCustomMessages } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    sm.appendMessage({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Internal reasoning...' },
        { type: 'text', text: 'Public response.' },
      ],
      timestamp: 0,
      model: 'test',
      provider: 'test',
    } as Parameters<SessionManager['appendMessage']>[0]);

    const leafId = sm.getLeafId()!;
    sm.branch(leafId);
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: leafId, handoff: 'last-response' });
    sm.appendMessage({ role: 'user', content: 'task work', timestamp: 0 });
    sm.appendMessage({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Processing...' },
        { type: 'text', text: 'Task result here.' },
      ],
      timestamp: 0,
      model: 'test',
      provider: 'test',
    } as Parameters<SessionManager['appendMessage']>[0]);

    const cmd = createFinishTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(sentCustomMessages.length, 1);
    const content = sentCustomMessages[0].content as Array<{ type: string; text: string }>;
    assert.strictEqual(content.length, 1);
    assert.strictEqual(content[0].type, 'text');
    assert.strictEqual(content[0].text, 'Task result here.');
  });

  it('navigates without injecting when no assistant message exists on branch', async () => {
    const { pi, ctx, sm, sentCustomMessages, notifications } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    const leafId = sm.getLeafId()!;
    sm.branch(leafId);
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: leafId, handoff: 'last-response' });

    const cmd = createFinishTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(sentCustomMessages.length, 0);
    assertLastNotification(notifications, 'info', 'Task finished. No last response to attach.');
  });
});

describe('createAbortTaskCommand', () => {
  it('notifies without navigating when no task start exists', async () => {
    const { pi, ctx, notifications } = makeHarness();
    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });

    const cmd = createAbortTaskCommand(pi);
    await cmd.handler('', ctx);

    assertLastNotification(notifications, 'warning', 'No task start point.');
    assertNoTaskStart(ctx.sessionManager);
  });

  it('navigates back without summary and appends task-done', async () => {
    const { pi, ctx, navigations } = makeHarness();

    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Implement phase 1.' });
    ctx.sessionManager.appendMessage(assistantMessage('Ready.'));

    const leafId = ctx.sessionManager.getLeafId()!;
    ctx.sessionManager.branch(leafId);
    ctx.sessionManager.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: leafId });
    ctx.sessionManager.appendMessage({ role: 'user', content: 'task work', timestamp: 0 });
    ctx.sessionManager.appendMessage(assistantMessage('Working...'));

    const cmd = createAbortTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(navigations.length, 1);
    assert.strictEqual(navigations[0].targetId, leafId);
    assert.strictEqual((navigations[0].opts as { summarize?: boolean })?.summarize, false);

    const entries = ctx.sessionManager.getEntries();
    const lastEntry = entries[entries.length - 1];
    assert.strictEqual(lastEntry.type, 'custom');
    assert.strictEqual((lastEntry as CustomEntry).customType, TASK_DONE_ENTRY_TYPE);
  });

  it('does not append task-done when navigation is cancelled', async () => {
    const { pi, ctx, setCancelNextNav } = makeHarness();
    setCancelNextNav(true);

    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Implement phase 1.' });
    const leafId = ctx.sessionManager.getLeafId()!;
    ctx.sessionManager.branch(leafId);
    ctx.sessionManager.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: leafId });

    const entriesBefore = ctx.sessionManager.getEntries().length;

    const cmd = createAbortTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(ctx.sessionManager.getEntries().length, entriesBefore);
  });
});

describe('registration', () => {
  it('registers the push-task tool and all four task commands', () => {
    const registered: Array<{ type: string; name: string; description?: string }> = [];
    const pi = {
      registerTool: (tool: { name: string; label: string; description: string }) =>
        registered.push({ type: 'tool', name: tool.name, description: tool.description }),
      registerCommand: (name: string, opts: { description: string }) =>
        registered.push({ type: 'command', name, description: opts.description }),
      on: () => {},
    } as unknown as ExtensionAPI;

    registerTaskCommands(pi);

    assert.deepStrictEqual(registered, [
      { type: 'tool', name: 'push-task', description: 'Store a task prompt for a user-started navigation branch.' },
      { type: 'command', name: 'start-task', description: 'Start the active task as a subagent' },
      { type: 'command', name: 'discard-task', description: 'Discard the active task without executing it' },
      { type: 'command', name: 'finish-task', description: 'Finish the current task and return to the task start point' },
      { type: 'command', name: 'abort-task', description: 'Abort the current task without finishing' },
    ]);
  });
});

describe('integration: /start-task fresh context', () => {
  it('completes /start-task → work → /finish-task with last-response injection', async () => {
    const { pi, ctx, sentMessages, sentCustomMessages, notifications } = makeHarness();

    ctx.sessionManager.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    ctx.sessionManager.appendMessage(assistantMessage('working on main...'));

    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Analyze performance.' });

    const startCmd = createStartTaskCommand(pi);
    await startCmd.handler('', ctx);

    assert.deepStrictEqual(sentMessages, ['Analyze performance.']);

    ctx.sessionManager.appendMessage(assistantMessage('Found 3 bottlenecks: ...'));

    const finishCmd = createFinishTaskCommand(pi);
    await finishCmd.handler('', ctx);

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(sentCustomMessages[0].customType, 'branch-result');
    const content = sentCustomMessages[0].content as Array<{ text: string }>;
    assert.strictEqual(content[0].text, 'Found 3 bottlenecks: ...');

    assertLastNotification(notifications, 'info', 'Task finished. Last response attached.');

    assertNoActiveTask(ctx.sessionManager);
  });
});

describe('integration: /start-task branch context', () => {
  it('completes /start-task branch → work → /finish-task with last-response injection', async () => {
    const { pi, ctx, sentMessages, sentCustomMessages } = makeHarness();

    ctx.sessionManager.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    ctx.sessionManager.appendMessage(assistantMessage('working...'));

    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Quick fix.', context: 'branch' });

    const startCmd = createStartTaskCommand(pi);
    await startCmd.handler('', ctx);

    assert.deepStrictEqual(sentMessages, ['Quick fix.']);

    ctx.sessionManager.appendMessage(assistantMessage('Fixed the bug.'));

    const finishCmd = createFinishTaskCommand(pi);
    await finishCmd.handler('', ctx);

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(sentCustomMessages[0].customType, 'branch-result');
    const content2 = sentCustomMessages[0].content as Array<{ text: string }>;
    assert.strictEqual(content2[0].text, 'Fixed the bug.');
  });
});

describe('task stacking', () => {
  it('task called twice - second task is the active one (closest to leaf)', async () => {
    const { pi, ctx } = makeHarness();
    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    pi.appendEntry(TASK_ENTRY_TYPE, { prompt: 'first task' });
    pi.appendEntry(TASK_ENTRY_TYPE, { prompt: 'second task' });

    const task = assertActiveTask(ctx.sessionManager);
    assert.strictEqual(task.prompt, 'second task');
  });

  it('after clearing second task, first task becomes active', async () => {
    const { pi, ctx } = makeHarness();
    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    pi.appendEntry(TASK_ENTRY_TYPE, { prompt: 'first task' });
    pi.appendEntry(TASK_ENTRY_TYPE, { prompt: 'second task' });

    const discardCmd = createDiscardTaskCommand(pi);
    await discardCmd.handler('', ctx);

    const task = assertActiveTask(ctx.sessionManager);
    assert.strictEqual(task.prompt, 'first task');
  });
});

// ── Test harness ─────────────────────────────────────────────────

function makeHarness() {
  const sm = SessionManager.inMemory();
  const sentMessages: string[] = [];
  const sentCustomMessages: Array<{ customType: string; content: unknown; options?: unknown }> = [];
  const notifications: Array<{ message: string; type?: string }> = [];
  const navigations: Array<{ targetId: string; opts?: unknown }> = [];
  let cancelNextNav = false;

  const pi = {
    appendEntry(customType: string, data?: unknown) {
      sm.appendCustomEntry(customType, data);
    },
    sendUserMessage(content: string | Array<{ type: string; text: string }>) {
      const text = typeof content === 'string' ? content : content.map((b) => b.text).join('');
      sm.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
      sentMessages.push(text);
    },
    sendMessage(message: { customType: string; content: unknown; display?: boolean; details?: unknown }, options?: { triggerTurn?: boolean }) {
      sentCustomMessages.push({ customType: message.customType, content: message.content, options });
      sm.appendCustomMessageEntry(message.customType, message.content as string, message.display ?? true, message.details);
    },
  } as unknown as ExtensionAPI;

  const ctx = {
    waitForIdle: async () => {},
    sessionManager: sm,
    ui: {
      notify(message: string, type?: string) {
        notifications.push({ message, type });
      },
    },
    navigateTree: async (targetId: string, opts?: unknown) => {
      navigations.push({ targetId, opts });
      if (cancelNextNav) {
        return { cancelled: true };
      }
      sm.branch(targetId);
      return { cancelled: false };
    },
  } as unknown as ExtensionCommandContext & { sessionManager: SessionManager };

  return {
    sm,
    pi,
    ctx,
    sentMessages,
    sentCustomMessages,
    notifications,
    navigations,
    setCancelNextNav(v: boolean) {
      cancelNextNav = v;
    },
  };
}

function assistantMessage(text: string): AppendMessageInput {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 0,
    model: 'test',
    provider: 'test',
  } as AppendMessageInput;
}

type AppendMessageInput = Parameters<SessionManager['appendMessage']>[0];

// ── Assertion helpers ────────────────────────────────────────────

function assertTaskStart(sm: SessionManager, expectedHandoff?: TaskStartData['handoff']): TaskStartData {
  const ts = getTaskStart(sm);
  assert.ok(ts, 'Expected task start, found none.');
  if (expectedHandoff) {
    assert.strictEqual(ts.handoff, expectedHandoff);
  }
  return ts;
}

function assertNoTaskStart(sm: SessionManager): void {
  const ts = getTaskStart(sm);
  assert.strictEqual(ts, null, `Expected no task start, but found one: ${JSON.stringify(ts)}`);
}

function getTaskStart(sm: SessionManager): TaskStartData | null {
  const branch = sm.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (e.type === 'custom' && e.customType === TASK_START_ENTRY_TYPE) {
      return e.data as TaskStartData;
    }
  }
  return null;
}

function assertActiveTask(sm: SessionManager): TaskData {
  const task = getActiveTask(sm);
  assert.ok(task, 'Expected active task, found none.');
  return task;
}

function assertNoActiveTask(sm: SessionManager): void {
  const task = getActiveTask(sm);
  assert.strictEqual(task, null, `Expected no active task, but found: ${JSON.stringify(task)}`);
}

function getActiveTask(sm: SessionManager): TaskData | null {
  const branch = sm.getBranch();
  let skip = 0;
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (e.type === 'custom' && e.customType === TASK_DONE_ENTRY_TYPE) {
      skip++;
    } else if (e.type === 'custom' && e.customType === TASK_ENTRY_TYPE) {
      if (skip === 0) return e.data as TaskData;
      skip--;
    }
  }
  return null;
}

function assertLastNotification(
  notifications: Notification[],
  type?: string,
  expectedMessage?: string,
): Notification {
  const n = getLastNotification(notifications, type);
  assert.ok(n, `Expected notification${type ? ` of type '${type}'` : ''}, found none.`);
  if (expectedMessage !== undefined) {
    assert.strictEqual(n.message, expectedMessage);
  }
  return n;
}

function getLastNotification(
  notifications: Notification[],
  type?: string,
): Notification | null {
  for (let i = notifications.length - 1; i >= 0; i--) {
    if (type === undefined || notifications[i].type === type) {
      return notifications[i];
    }
  }
  return null;
}

interface Notification {
  message: string;
  type?: string;
}
```

- [ ] **Step 2: Run tests watch to verify they pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add index.test.ts && git commit -m "test: add task tooling tests"
```

---

### Task 5: Update pi-supergsd config files

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `eslint.config.js`

- [ ] **Step 1: Update `package.json`**

Add `peerDependencies`, `pi.extensions`, and update `files`:

```json
{
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  },
  "pi": {
    "skills": [
      "./skills"
    ],
    "extensions": [
      "./index.ts"
    ]
  },
  "files": [
    "index.ts",
    "skills",
    "README.md",
    "LICENSE"
  ]
}
```

(Show only changed fields; the rest of package.json is unchanged.)

- [ ] **Step 2: Update `tsconfig.json`**

Add `"index.ts"`, `"index.test.ts"` to includes:

```json
"include": ["index.ts", "index.test.ts", "updater/**/*.ts", "scripts/**/*.ts"]
```

- [ ] **Step 3: Update `eslint.config.js`**

The `ignores` list currently excludes `skills/**`. The new `index.ts` and `index.test.ts` are at root and should not be excluded. No change needed — they're not in any ignored directory.

- [ ] **Step 4: Run lint + typecheck**

```bash
npm run lint && npx tsc --noEmit
```

Expected: clean output.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json && git commit -m "config: add extension entry point and peer dependencies for task tooling"
```

---

### Task 6: Update skill patches to remove push-task conditionals

**Files:**
- Modify: `updater/skills/brainstorming.json`
- Modify: `updater/skills/writing-plans.json`
- Modify: `updater/skills/requesting-code-review.json`
- Modify: `updater/skills/writing-skills.json`

For each file, replace conditional `push-task` patches with unconditional versions. Key changes:
- Remove `**If the push-task tool is available:**` header
- Remove `**Otherwise:**` fallback lines
- Update `/return` → `/finish-task`

- [ ] **Step 1: Update `updater/skills/brainstorming.json`**

In the SKILL.md file's patches array, find the patch where `find` contains `"7. **Spec self-review** — quick inline check"`. In that patch's `replace`, drop the conditional wrapper and change `/return` to `/finish-task`.

**Change in replace text:**
- Delete `**If the \`push-task\` tool is available:**\n`
- Delete `\n**Otherwise:**\nRun the Spec Self-Review checklist inline (see below.)`
- Change `/return` to `/finish-task` (in step 3)

- [ ] **Step 2: Update `updater/skills/writing-plans.json`**

In the SKILL.md file's patches array, find the patch where `find` contains `"## Self-Review"`. In that patch's `replace`:
- Delete `**If the \`push-task\` tool is available:**\n`
- Delete `\n**Otherwise:**\nRun the Self-Review checklist inline.`
- Change `/return` to `/finish-task`

- [ ] **Step 3: Update `updater/skills/requesting-code-review.json`**

In the SKILL.md file, two patches reference push-task:

Patch 1: `find` contains `"**2. Dispatch code reviewer subagent"`. In the `replace`:
- Delete `**If the \`push-task\` tool is available:**\n`
- Delete `\n**Otherwise:**\nUse the code-reviewer.md template for your review process.`
- Change `/return` to `/finish-task`

Patch 2: `find` contains `"[Dispatch code reviewer subagent]"`. In the `replace`:
- Change `/return` to `/finish-task` (in the `[After /return, review output]` line)

- [ ] **Step 4: Update `updater/skills/writing-skills.json`**

In the SKILL.md file, three patches have conditionals:

Patch 1 (RED section): `find` contains `"### RED: Write Failing Test (Baseline)"`:
- Delete `**If the \`push-task\` tool is available:**\n`
- Delete the `**Otherwise:**` fallback (from `\n**Otherwise:**\nRun...` up to the end of the replace)
- Change `/return` to `/finish-task`

Patch 2 (GREEN section): `find` contains `"Run same scenarios WITH skill"`:
- Similar: remove conditional, change `/return` to `/finish-task`

Patch 3 (REFACTOR section): `find` contains `"### REFACTOR: Close Loopholes"`:
- Similar: remove conditional, change `/return` to `/finish-task`

- [ ] **Step 5: Run updater**

```bash
npm run updater
```

Expected: updater exits zero, skills regenerated without conditionals.

- [ ] **Step 6: Verify generated skills have no conditionals**

```bash
grep -r "If the .push-task. tool is available" skills/ || echo "No conditionals found — good"
```

Expected: "No conditionals found — good"

- [ ] **Step 7: Commit**

```bash
git add updater/skills/ skills/ && git commit -m "refactor(skills): remove push-task conditionals; update /return to /finish-task"
```

---

### Task 7: Verify both projects

- [ ] **Step 1: Verify pi-navigator**

```bash
cd ../pi-navigator && npm run verify
```

Expected: clean exit zero.

- [ ] **Step 2: Verify pi-supergsd**

```bash
npm run verify
```

Expected: clean exit zero. `git diff --exit-code -- skills` passes because updater already ran and output was committed.

- [ ] **Step 3: Commit any final changes**

```bash
git add -A && git commit -m "chore: final verification pass"
```
