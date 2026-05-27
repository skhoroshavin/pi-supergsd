# Push-task QoL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quality-of-life improvements to the push-task tool: rename `context` to `inherit_context`, add custom tool rendering with prompt preview, status line, and slug-based result label.

**Architecture:** All changes confined to `index.ts` (implementation + rendering), `index.test.ts` (harness + assertions), and `README.md` (docs). Uses Pi's `renderCall`/`renderResult` for tool card display, `ctx.ui.setStatus()` for status line, and `pi.registerMessageRenderer()` for the task-result message label. A shared `makeSlug()` helper cleans prompts for compact display.

**Tech Stack:** TypeScript, TypeBox schemas, Pi TUI components (`Text`, `Box`), Node test runner.

**Roadmap:** None

**Phase:** Single-plan implementation

---

### Task 1: Update test harness for parameter rename

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Update `runPushTask` signature**

In the `makeHarness()` function (around line 280), change the `runPushTask` helper:

```typescript
// Before:
async function runPushTask(prompt: string, context?: 'fresh' | 'branch') {
  const tool = createPushTaskTool(pi);
  const result = await tool.execute('call-1', { prompt, context }, undefined, undefined, ctx);
  ...
}

// After:
async function runPushTask(prompt: string, inherit_context?: boolean) {
  const tool = createPushTaskTool(pi);
  const result = await tool.execute('call-1', { prompt, inherit_context }, undefined, undefined, ctx);
  ...
}
```

- [ ] **Step 2: Update all call sites**

Find every call to `runPushTask` that passes a second argument and change from string to boolean:

| Before | After |
|--------|-------|
| `runPushTask('prompt', 'branch')` | `runPushTask('prompt', true)` |
| `runPushTask('prompt', 'fresh')` | `runPushTask('prompt', false)` |

For calls with no second argument (defaults to `'fresh'` before, `false` after): no change needed.

Run: `rg "runPushTask" index.test.ts` to find all call sites.

- [ ] **Step 3: Add `setStatus` capture to mock `ui`**

In `makeHarness()`, the `ui` mock currently only has `notify`. Add `setStatus` tracking:

```typescript
// In the hints/setup section, add:
let taskStatus: string | undefined;

// In the `ui` mock (around line 230), add:
ui: {
  notify(message: string) {
    hints.push({ text: message });
  },
  setStatus(key: string, value: string | undefined) {
    if (key === 'task') taskStatus = value;
  },
  theme: {} as Theme,
},
```

Import `Theme` from pi:
```typescript
import { ..., type Theme } from '@earendil-works/pi-coding-agent';
```

- [ ] **Step 4: Add `getStatus()` helper**

In the returned harness object, add:

```typescript
function getStatus(): string | undefined {
  return taskStatus;
}
```

And add `getStatus` to the returned object.

- [ ] **Step 5: Commit**

```bash
git add index.test.ts
git commit -m "test: rename context→inherit_context, add getStatus() harness helper"
```

---

### Task 2: Add status assertions to existing tests

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Add status assertion after push-task in fresh-context start-task test**

In `'completes /start-task → work → /finish-task with last-response injection'`, after `await runPushTask('Analyze performance.');`:

```typescript
assert.strictEqual(getStatus(), 'pending task: Analyze-performance');
```

- [ ] **Step 2: Add status assertion after start-task**

In the same test, after `await runStartTask();`:

```typescript
assert.strictEqual(getStatus(), 'current task: Analyze-performance');
```

- [ ] **Step 3: Add status assertion after finish-task**

After `await runFinishTask();`:

```typescript
assert.strictEqual(getStatus(), undefined);
```

- [ ] **Step 4: Add status assertions to branch-context test**

In `'completes /start-task branch → work → /finish-task with last-response injection'`:

After `await runPushTask('Quick fix.', true);`:
```typescript
assert.strictEqual(getStatus(), 'pending task: Quick-fix');
```

After `await runStartTask();`:
```typescript
assert.strictEqual(getStatus(), 'current task: Quick-fix');
```

After `await runFinishTask();`:
```typescript
assert.strictEqual(getStatus(), undefined);
```

- [ ] **Step 5: Add status assertions to auto tests**

In `'completes push-task -> /auto -> finish-task...'`, after `await runPushTask('Analyze performance.');`:
```typescript
assert.strictEqual(getStatus(), 'pending task: Analyze-performance');
```

In `'returns the branch result to the original leaf...'`, after `await runPushTask('Quick fix.', true);`:
```typescript
assert.strictEqual(getStatus(), 'pending task: Quick-fix');
```

- [ ] **Step 6: Add status assertion to discard test**

In the discard test, after `await runDiscardTask();`:
```typescript
assert.strictEqual(getStatus(), undefined);
```

- [ ] **Step 7: Add status assertion to abort test**

In the abort test, after `await runAbortTask();`:
```typescript
assert.strictEqual(getStatus(), undefined);
```

- [ ] **Step 8: Run tests — expect failures**

```bash
npx tsx --test index.test.ts
```

Expected: status assertions fail (no `setStatus` calls yet), parameter tests may fail if `createPushTaskTool` signature changed.

- [ ] **Step 9: Commit**

```bash
git add index.test.ts
git commit -m "test: add status line assertions at critical points"
```

---

### Task 3: Parameter rename in `index.ts`

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Update `pushTaskParameters` schema**

Replace the current `context` parameter (lines ~265-269):

```typescript
// Before:
const pushTaskParameters = Type.Object({
  prompt: Type.String({ description: 'Full prompt for the task, including all context and instructions.' }),
  context: Type.Optional(Type.Union([
    Type.Literal('fresh'),
    Type.Literal('branch'),
  ], { description: 'Context mode: "fresh" (clean slate, default) or "branch" (current branch).' })),
});

// After:
const pushTaskParameters = Type.Object({
  prompt: Type.String({ description: 'Full prompt for the task, including all context and instructions.' }),
  inherit_context: Type.Optional(Type.Boolean({
    default: false,
    description: 'Whether to inherit the current branch context instead of starting fresh.',
  })),
});
```

- [ ] **Step 2: Update `TaskData` interface**

```typescript
// Before:
interface TaskData {
  prompt: string;
  context: 'fresh' | 'branch';
}

// After:
interface TaskData {
  prompt: string;
  inherit_context: boolean;
}
```

- [ ] **Step 3: Update `execute()` in `createPushTaskTool`**

```typescript
// Before:
pi.appendEntry(TASK_ENTRY_TYPE, { prompt: params.prompt, context: params.context ?? 'fresh' });

// After:
pi.appendEntry(TASK_ENTRY_TYPE, { prompt: params.prompt, inherit_context: params.inherit_context ?? false });
```

Also add `details` to the return:

```typescript
// Before:
return {
  content: [{ type: 'text', text: 'Task stored. Use `/start-task` or `/auto` to start it.' }],
  details: {},
  terminate: true,
};

// After:
return {
  content: [{ type: 'text', text: 'Task stored. Use `/start-task` or `/auto` to start it.' }],
  details: { prompt: params.prompt, inherit_context: params.inherit_context ?? false },
  terminate: true,
};
```

- [ ] **Step 4: Update `startTask()` logic**

```typescript
// Before:
const taskContext = activeTask.data.context ?? 'fresh';
if (taskContext === 'fresh') {

// After:
const inheritContext = activeTask.data.inherit_context ?? false;
if (!inheritContext) {
```

- [ ] **Step 5: Run tests — parameter rename tests should pass, status tests still fail**

```bash
npx tsx --test index.test.ts
```

Expected: parameter rename assertions pass. Status line assertions still fail (no `setStatus` calls).

- [ ] **Step 6: Commit**

```bash
git add index.ts index.test.ts
git commit -m "feat: rename context param to inherit_context (boolean, default false)"
```

---

### Task 4: Add `makeSlug()` helper + status line hooks

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Add `makeSlug()` function**

Add after the `autoState` variable (end of file):

```typescript
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could', 'i', 'you', 'he',
  'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my',
  'your', 'his', 'its', 'our', 'their', 'this', 'that', 'these', 'those',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'under', 'and', 'but', 'or', 'nor', 'not', 'so', 'if',
  'than', 'too', 'very', 'just', 'now', 'then', 'also', 'here', 'there',
  'when', 'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'up',
  'out', 'about', 'over', 'again', 'while',
]);

function makeSlug(prompt: string): string {
  const words = prompt.split(/\s+/).filter(w => !STOPWORDS.has(w.toLowerCase()));
  if (words.length === 0) return '<no description>';

  let result = words[0]!;
  for (let i = 1; i < Math.min(words.length, 7); i++) {
    const next = `-${words[i]}`;
    if ((result + next).length <= 40 || result.length <= 40 - next.length) {
      result += next;
    } else {
      break;
    }
  }
  return result;
}
```

The loop logic: add words until the next word (with dash) would start beyond position 40. A word that starts at position ≤40 is included even if it extends past 40.

- [ ] **Step 2: Add `updateTaskStatus()` function**

```typescript
function updateTaskStatus(
  session: ReadonlySessionLike,
  setStatus: (key: string, value: string | undefined) => void,
  theme: { fg: (key: string, text: string) => string },
): void {
  const pending = pendingTask(session);
  if (pending) {
    const slug = makeSlug(pending.data.prompt);
    setStatus('task', theme.fg('dim', `pending task: ${slug}`));
    return;
  }

  const current = currentTask(session);
  if (current) {
    // Walk forward from task-start to find the next user message
    const branch = session.getBranch();
    let found = false;
    for (const entry of branch) {
      if (found && entry.type === 'message' && entry.message.role === 'user') {
        const prompt = typeof entry.message.content === 'string'
          ? entry.message.content
          : Array.isArray(entry.message.content)
            ? entry.message.content.find((b: { type: string }) => b.type === 'text')?.text ?? ''
            : '';
        const slug = makeSlug(prompt);
        setStatus('task', theme.fg('dim', `current task: ${slug}`));
        return;
      }
      if (entry.type === 'custom' && entry.customType === TASK_START_ENTRY_TYPE) {
        found = true;
      }
    }
    return;
  }

  setStatus('task', undefined);
}
```

Note: this function accesses `entry.message.content` which could be string or array. Handle both.

- [ ] **Step 3: Register status hooks in `registerTaskCommands`**

Near the top of `registerTaskCommands()`, after the existing `session_shutdown` handler:

```typescript
pi.on('session_start', async (_event, ctx) => {
  updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
});

pi.on('turn_end', async (_event, ctx) => {
  updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
});

pi.on('session_tree', async (_event, ctx) => {
  updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
});
```

- [ ] **Step 4: Add direct `updateTaskStatus` calls to command handlers**

For immediate status updates (and test coverage — the mock `pi.on` only fires events explicitly), add direct calls after each state change:

In `startTask()`, after `pi.sendUserMessage(...)`:
```typescript
if (ctx.hasUI) {
  updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
}
```

In `finishTask()`, after `pi.appendEntry(TASK_DONE_ENTRY_TYPE, {})`:
```typescript
if (ctx.hasUI) {
  updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
}
```

In `discardTask()`, after `pi.appendEntry(TASK_DONE_ENTRY_TYPE, {})`:
```typescript
if (ctx.hasUI) {
  updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
}
```

In `abortTask()`, after `pi.appendEntry(TASK_DONE_ENTRY_TYPE, {})`:
```typescript
if (ctx.hasUI) {
  updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
}
```

- [ ] **Step 5: Trigger status update after push-task execution**

In `createPushTaskTool()`, add `ctx` to the execute signature and call `updateTaskStatus` after storing the task:

```typescript
async execute(_toolCallId, params, signal, _onUpdate, ctx) {
  if (signal?.aborted) {
    throw new Error('Task storage aborted.');
  }

  pi.appendEntry(TASK_ENTRY_TYPE, { prompt: params.prompt, inherit_context: params.inherit_context ?? false });

  // Update status after prompt is stored
  if (ctx.hasUI) {
    updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
  }

  return {
    content: [{ type: 'text', text: 'Task stored. Use `/start-task` or `/auto` to start it.' }],
    details: { prompt: params.prompt, inherit_context: params.inherit_context ?? false },
    terminate: true,
  };
},
```

- [ ] **Step 6: Run tests — status assertions should now pass**

```bash
npx tsx --test index.test.ts
```

Expected: all tests pass, including status line assertions.

- [ ] **Step 7: Commit**

```bash
git add index.ts
git commit -m "feat: add makeSlug() helper and task status line"
```

---

### Task 5: Custom tool rendering (renderCall / renderResult)

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Add imports**

Add to top of `index.ts`:

```typescript
import { Text } from '@earendil-works/pi-tui';
```

- [ ] **Step 2: Add `renderCall` to tool definition**

In `createPushTaskTool()`, add after the `promptGuidelines`:

```typescript
renderCall(args, theme, context) {
  const header = theme.fg('toolTitle', theme.bold('push-task'))
    + (args.inherit_context ? ' ' + theme.fg('warning', '[inherit]') : '');

  const promptLines = (args.prompt as string).split('\n');
  const maxLines = context.expanded ? promptLines.length : 7;
  const displayLines = promptLines.slice(0, maxLines)
    .map(l => theme.fg('dim', l.trimEnd() || ' '));

  if (!context.expanded && promptLines.length > 7) {
    displayLines.push(theme.fg('muted', '...'));
  }

  return new Text([header, ...displayLines].join('\n'), 0, 0);
},
```

- [ ] **Step 3: Add `renderResult` to tool definition**

```typescript
renderResult(result, { expanded }, theme, _context) {
  const details = result.details as { prompt: string; inherit_context: boolean };

  const header = theme.fg('toolTitle', theme.bold('push-task'))
    + (details.inherit_context ? ' ' + theme.fg('warning', '[inherit]') : '');

  const promptLines = details.prompt.split('\n');
  const maxLines = expanded ? promptLines.length : 7;
  const displayLines = promptLines.slice(0, maxLines)
    .map(l => theme.fg('dim', l.trimEnd() || ' '));

  if (!expanded && promptLines.length > 7) {
    displayLines.push(theme.fg('muted', '...'));
  }

  return new Text([header, ...displayLines].join('\n'), 0, 0);
},
```

- [ ] **Step 4: Run tests**

```bash
npx tsx --test index.test.ts
```

Expected: all tests still pass. Tool rendering doesn't affect test behavior.

- [ ] **Step 5: Commit**

```bash
git add index.ts
git commit -m "feat: add renderCall/renderResult with prompt preview"
```

---

### Task 6: Task-result message renderer with slug label

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Add import**

```typescript
import { Box, Text } from '@earendil-works/pi-tui';
```

(Merge with existing `Text` import from Task 5.)

- [ ] **Step 2: Register message renderer**

In `registerTaskCommands()`, add after registering the tool:

```typescript
pi.registerMessageRenderer('task-result', (message, { expanded: _expanded }, theme) => {
  const details = message.details as { slug?: string; sourceEntryId?: string } | undefined;
  const label = details?.slug
    ? theme.fg('customMessageLabel', `${details.slug} result:`)
    : theme.fg('customMessageLabel', 'result:');
  const box = new Box(1, 1, (t: string) => theme.bg('customMessageBg', t));
  box.addChild(new Text(`${label}\n${message.content}`, 0, 0));
  return box;
});
```

- [ ] **Step 3: Update `finishTask()` to use new customType + slug**

In `finishTask()`, find the code that sends the branch-result message (~lines 165-175). Change `customType: 'branch-result'` to `customType: 'task-result'`.

Add slug lookup before the `pi.sendMessage()` call:

```typescript
// Before navigating back:
// Compute slug from the task that started this branch
const taskStart = currentTask(ctx.sessionManager);
let slug: string | undefined;
if (taskStart) {
  const branch = ctx.sessionManager.getBranch();
  let lookingForTask = false;
  // Walk backward from the end (or from task-start's position) to find the task entry
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === 'custom' && entry.customType === TASK_START_ENTRY_TYPE) {
      lookingForTask = true;
      continue;
    }
    if (lookingForTask && entry.type === 'custom' && entry.customType === TASK_ENTRY_TYPE) {
      slug = makeSlug((entry.data as TaskData).prompt);
      break;
    }
  }
}
```

Then in the `pi.sendMessage()` call:

```typescript
pi.sendMessage({
  customType: 'task-result',
  content: lastAssistantContent as unknown as string,
  display: true,
  details: { sourceEntryId: lastAssistantId, slug },
}, { triggerTurn: true });
```

- [ ] **Step 4: Run tests**

```bash
npx tsx --test index.test.ts
```

Expected: all tests pass. Message renderer isn't tested directly (it's TUI rendering), but the customType change and slug computation don't break existing assertions.

- [ ] **Step 5: Commit**

```bash
git add index.ts
git commit -m "feat: task-result message with slug label"
```

---

### Task 7: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update parameter description**

Find the section "### `push-task` tool" and update:

```markdown
### `push-task` tool

Queues a task with `inherit_context` defaulting to `false` (fresh session). Set `inherit_context: true` to continue on the current branch. The task sits pending — nothing runs until you start it.
```

- [ ] **Step 2: Update usage example**

Find the code block showing `context: "fresh"` and update:

```markdown
LLM:     [calls push-task({ prompt: "Review the implementation
         against the plan. Check correctness, edge cases,
         and test coverage.", inherit_context: true })]
```

(Choose `inherit_context: true` for a more interesting example — the review runs on the current branch.)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README for inherit_context param rename"
```

---

### Task 8: Full verification gate

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Updater**

```bash
npm run updater
```

Expected: no changes (no skill patches modified). This also confirms no drift.

- [ ] **Step 5: Verify no skill drift**

```bash
git diff --stat
```

Expected: no unexpected changes.

- [ ] **Step 6: Fix + verify**

```bash
npm run fix
npm run verify
```

Expected: all gates pass.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: final verification — all gates green"
```
