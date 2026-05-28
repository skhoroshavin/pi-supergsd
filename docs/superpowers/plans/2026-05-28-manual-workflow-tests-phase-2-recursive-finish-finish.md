# Phase 2: Recursive tasks — finish→finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 new manual workflow tests for the recursive push → start → push → start → finish → finish pattern, covering all 4 context combos (fresh/fresh, fresh/inherited, inherited/fresh, inherited/inherited).

**Architecture:** Pure test additions to `index.test.ts`. No source code changes needed. The harness already supports nested task operations — `pendingTask`/`currentTask` walk backward and correctly handle nesting via skip counters. After `finishTask` on the inner task, the outer task remains "current" (its `task-start` entry is deeper in the branch history). The design validates that navigating back from the inner finish returns to the outer task branch with the outer task still active, then the outer finish navigates back to the main branch.

**Tech Stack:** TypeScript, Node 20+, `node:test`, SessionManager (in-memory)

**Roadmap:** [`docs/superpowers/roadmaps/2026-05-28-manual-workflow-tests-roadmap.md`](../roadmaps/2026-05-28-manual-workflow-tests-roadmap.md)

**Phase:** Phase 2: Recursive tasks — finish→finish

---

## File Structure

**Only file modified:**
- `index.test.ts` — add 4 new `it` blocks under `describe('manual workflow')`, after the existing 5 tests (before `describe('automated workflow')`)

**No files created, no files modified outside `index.test.ts`.**

---

### Task 1: Write recursive finish→finish with fresh outer + fresh inner

**Files:**
- Modify: `index.test.ts` — insert after the last existing manual workflow test (abort inherited)

**Context combo:** fresh outer, fresh inner. The outer task navigates to a fresh branch, then the inner task navigates to a separate fresh branch from there. After inner finish, we return to the outer task branch (outer still current). After outer finish, we return to main.

**Expected branch sequence:**
```
main: user('main'), assistant('working...'), task('Outer task.')
  → startTask(outer, fresh): user('Outer task.')
    → pushTask(inner, fresh): user('Outer task.'), task('Inner task.')
      → startTask(inner, fresh): user('Inner task.')
        → assistant: user('Inner task.'), assistant('inner done')
      → finishTask(inner): user('Outer task.'), task('Inner task.'), taskResult('inner-task', 'inner done')
        → (notification: Task stored. ...) [hint after task entry]
        → (notification: Task finished.) [hint after taskResult]
      → assistant: assistant('outer done') on current branch
    → finishTask(outer): user('main'), assistant('working...'), task('Outer task.'), taskResult('outer-task', 'outer done')
      → (notification) after taskResult
```

Wait, let me be more precise about where notifications appear.

The notification ("Task finished. Last response attached.") is tracked as a hint with `afterEntryId` = `sm.getLeafId()` after the finishTask injects its result. The leaf after finishTask navigation would be the taskResult entry... Actually let me think about this.

In finishTask:
```
const result = await ctx.navigateTree(taskStart.data.returnTo, { summarize: false });
if (result.cancelled) return 'cancelled';
// Inject last assistant message after navigation
if (lastAssistantId) {
  pi.sendMessage({ customType: 'task-result', ... }, { triggerTurn: true });
}
// ...
ctx.ui.notify(`Task finished. ${label}`, 'info');
```

So first, navigate to returnTo. Then inject task-result. Then call `ctx.ui.notify(...)`. The notify function does:
```
notify(message: string) {
  trackedHints.push({ text: message, afterEntryId: sm.getLeafId() });
}
```

After inject task-result via `pi.sendMessage`, what's the leaf? `pi.sendMessage` calls `sm.appendCustomMessageEntry(...)`. After that, the leaf is the task-result entry. So the notification hint's afterEntryId = taskResult's ID. That means in assertBranchHistory, the notification is placed after the taskResult. ✓

Now let me also think about where the "Task stored." notification appears.

In push-task tool:
```
pi.appendEntry(TASK_ENTRY_TYPE, { prompt: params.prompt, inherit_context: params.inherit_context ?? false });
if (ctx.hasUI) {
  updateTaskStatus(...);
  ctx.ui.notify('Task stored. Use `/start-task` or `/auto` to start it.', 'info');
}
```

After appendEntry, the leaf is the newly added task entry. So the notification hint's afterEntryId = task entry's ID. ✓

Now, for the fresh/fresh scenario when we're INSIDE the outer task branch and push inner task:

The outer task fresh branch has:
- user('Outer task.') — the initial user message
- task-start(outer) — hidden

When we push inner task:
- After appendEntry: branch = [user('Outer task.'), task-start(outer), task('Inner task.')]
- Leaf = task('Inner task.') — notification hints have afterEntryId = task('Inner task.')
- In assertBranchHistory: task-start is hidden, so we see:
  - user('Outer task.')
  - task('Inner task.')
  - notification('Task stored. ...') [after the task entry]

Then startTask(inner, fresh):
- findFreshTargetId on current branch: first model-visible = user('Outer task.')
  - Actually wait, the current branch here is: [user('Outer task.'), task-start(outer), task('Inner task.')]
  - findPreConversationEntry walks branch: user('Outer task.') is a message entry → returns it
  - freshTargetId = user('Outer task.').parentId (the thinking_level_change parent? no)
  
Let me think about branches more carefully. After startTask(outer, fresh):
- We navigated from main to freshTarget (the parent of the first visible entry on main = parent of user('main'))
- The fresh branch has: [parent-of-user('main'), user('Outer task.'), task-start(outer)]
- Leaf = task-start(outer) (or user('Outer task.') if task-start is after)

Hmm wait, `appendEntry` was called for task-start. The entries are in order. After navigation and sendUserMessage:

1. `sm.branch(targetId)` - branches to the fresh target. The new branch inherits entries up to targetId.
2. `pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: departureLeafId })` - adds task-start as a custom entry
3. `pi.sendUserMessage(activeTask.data.prompt)` - adds user message

So the fresh branch after startTask(outer): [entries_up_to_targetId, task-start(outer), user('Outer task.')]

In assertBranchHistory, we skip task-start (hidden) and the entries before user('main').parentId. The visible entries are just: user('Outer task.'). ✓

Then we push inner task. The branch is now:
[entries_up_to_targetId, task-start(outer), user('Outer task.'), task('Inner task.')]

assertBranchHistory skips hidden: user('Outer task.'), task('Inner task.'), notification ✓

Then startTask(inner, fresh):
- departureLeafId = getLeafId() on current branch = task('Inner task.').id
- findFreshTargetId on current branch: findPreConversationEntry returns user('Outer task.')
  - freshTargetId = user('Outer task.').parentId

Wait, what is user('Outer task.').parentId? It's the ID of the preceding entry. Since after branching to fresh target, the entries include the common root entries and then the new ones. The parentId of user('Outer task.') would be task-start(outer).id? Or maybe the parent of the target entry?

Hmm, I think I need to understand the SessionManager's branch() behavior better. When you call sm.branch(targetId), it creates a new branch based on that target. Entries after targetId are new. The parentId of the first new entry (task-start) would be targetId. The parentId of user('Outer task.') would be task-start.

But for findFreshTargetId: it returns the parentId of the first visible entry. The first visible entry is user('Outer task.'). user('Outer task.').parentId = task-start(outer).id (or some internal ID). So freshTargetId = task-start(outer).id or task-start(outer).parentId.

Actually, findFreshTargetId is:
```
const firstVisible = findPreConversationEntry(session);
if (firstVisible) {
  return firstVisible.parentId ?? firstVisible.id;
}
```

So it returns firstVisible.parentId. If parentId is null, it returns firstVisible.id instead.

user('Outer task.').parentId = the previous entry's ID. In the fresh branch, the previous entry before user('Outer task.') is task-start(outer). So parentId = task-start(outer).id.

So startTask(inner) navigates to task-start(outer).id, which effectively puts us at the same level as user('Outer task.'). Wait, that's a sibling branch of user('Outer task.').

Actually, I think the branch/entry model works like a tree. Each entry has a parentId. sm.branch(targetId) starts a new branch at that entry, meaning subsequent entries have that targetId as their parent.

For the fresh branch after outer startTask:
- targetId = freshTargetId = parent of user('main') on the main branch
- First new entry: task-start (parentId = targetId)
- Second new entry: user('Outer task.') (parentId = task-start.id)

The full branch path from root to leaf: root → ... → targetId → task-start → user('Outer task.')

findFreshTargetId for inner startTask:
- Current branch leaf = task('Inner task.') (after pushTask)
- getBranch() returns all entries from root to leaf
- findPreConversationEntry walks entries and finds user('Outer task.') as first visible
- Returns user('Outer task.').parentId = task-start(outer).id

So inner startTask navigates to task-start(outer).id. Then it sends user('Inner task.') with parentId = task-start(outer).id... wait, no. After navigation, the branch's leaf IS task-start(outer). Then sendUserMessage creates user('Inner task.') as a child of task-start(outer).

So the inner task's branch path: root → ... → targetId → task-start(outer) → user('Inner task.')

This is a SIBLING of user('Outer task.'), not a child. Both user('Outer task.') and user('Inner task.') have the same parent (task-start(outer)).

So after inner startTask, the branch from getBranch() is: [entries up to task-start(outer), task-start(inner), user('Inner task.')] ... wait no.

Actually I think sm.branch(targetId) just changes the current focus of the session. After branching to task-start(outer), the leaf of the current branch is task-start(outer). Then sendUserMessage adds user('Inner task.') after it. But task-start(inner) is also added...

Wait, startTask does:
```
pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: departureLeafId });
// or for fresh:
// pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: departureLeafId });
```

Both fresh and inherited startTask append task-start. Then:
```
pi.sendUserMessage(activeTask.data.prompt);
```

For fresh:
```
const departureLeafId = session.getLeafId()!;
const freshTargetId = findFreshTargetId(session);
const result = await ctx.navigateTree(freshTargetId);
pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: departureLeafId });
pi.sendUserMessage(activeTask.data.prompt);
```

After branch to freshTargetId, the branch's leaf is the entry at freshTargetId. Then task-start is appended (parentId = freshTargetId). Then user message (parentId = task-start id).

So the branch for inner start(outer=fresh, inner=fresh) after both tasks:
- Navigation to task-start(outer).id (freshTargetId for inner)
- Append task-start(inner) (parent = task-start(outer).id)
- Send user("Inner task.") (parent = task-start(inner).id)

The full branch from root: root → ... → freshTargetId(outer) → task-start(outer) → [branch here] ... wait, but we navigated back to task-start(outer) which means the entry path up to task-start(outer) is preserved, and we branch from there.

Actually, I think the key insight is that sm.branch(targetId) preserves the history up to targetId and discards entries after it (they remain in the tree but aren't on the current branch). Then new entries are appended.

So after outer startTask, the branch was: root → ... → freshTargetId → task-start(outer) → user('Outer task.') → task-start(inner-push) → task('Inner task.')

Wait no, after startTask adds task-start and user, the branch is: freshTargetId → task-start(outer) → user('Outer task.'). Then pushTask appends task('Inner task.'). So: freshTargetId → task-start(outer) → user('Outer task.') → task('Inner task.').

Now inner startTask navigates to freshTargetId for inner = task-start(outer).id. After branch, the leaf is task-start(outer). Then task-start(inner) is appended (parent = task-start(outer)). Then user('Inner task.') (parent = task-start(inner)).

So the branch becomes: freshTargetId → task-start(outer) → task-start(inner) → user('Inner task.').

Note: user('Outer task.') and task('Inner task.') are no longer on the current branch (they were after the branch point and were discarded).

So getBranch() returns: [freshTargetId, task-start(outer), task-start(inner), user('Inner task.')]

assertBranchHistory: skips task-start entries, skips entries before freshTargetId
→ user('Inner task.') ✓

Then appendAssistantMessage('inner done'):
Branch: [freshTargetId, task-start(outer), task-start(inner), user('Inner task.'), assistant('inner done')]

Now finishTask for inner:
currentTask(session): walks backward from branch end
- assistant('inner done') → skip
- user('Inner task.') → skip
- task-start(inner) → returns it (customType === 'task-start') ✓

returnTo = task-start(inner).data.returnTo = departureLeafId from when inner was started.

What was departureLeafId? It was the leaf at the time of startTask, after pushTask. The branch was: freshTargetId → task-start(outer) → user('Outer task.') → task('Inner task.') [leaf = task('Inner task.')]. But wait, we navigated to freshTargetId, so departureLeafId was set BEFORE navigation:

```
const departureLeafId = ctx.sessionManager.getLeafId()!;
```

getLeafId on the branch before navigation: freshTargetId → task-start(outer) → user('Outer task.') → task('Inner task.')
Leaf = task('Inner task.').id

So returnTo = task('Inner task.').id.

navigateTree(returnTo): branches to task('Inner task.').id. After branch, the leaf is task('Inner task.').

But wait, task('Inner task.') is on the OLD branch (the one we navigated away from). Can we navigate TO it? Yes, because it's in the tree even if it's not on the current branch.

After navigation, the branch is: freshTargetId → task-start(outer) → user('Outer task.') → task('Inner task.')
But task('Inner task.')'s parent is user('Outer task.'). And user('Outer task.')'s parent is task-start(outer). And task-start(outer)'s parent is freshTargetId. And freshTargetId is... well, it's the root common ancestor.

Actually, I realize the branch from root to task('Inner task.') includes all these entries. So getBranch() after navigating to returnTo gives us all entries up to task('Inner task.'):
[..., freshTargetId, task-start(outer), user('Outer task.'), task('Inner task.')]

Then task-result is injected: pi.sendMessage triggers appendCustomMessageEntry, which appends after the leaf:
[..., task-start(outer), user('Outer task.'), task('Inner task.'), task-result('inner-task', 'inner done')]

Then pendingTask checks:
Walking backward: task-result → skip, task('Inner task.') with skip=0 → returns it! ✓
So task-done is appended: [..., task('Inner task.'), task-result, task-done]

Then assertBranchHistory:
- Skipping task-start and task-done: user('Outer task.'), task('Inner task.'), taskResult('inner-task', 'inner done')
- Notification after taskResult: notification('Task finished...')
✓

status: pendingTask returns null (task-done skip=1, task entry skip--, task-start(outer) → null). currentTask: walks backward, past task-start(outer) → returns it. So status = 'current task: outer-task'. ✓

Then appendAssistantMessage('outer done'):
Branch: [..., task('Inner task.'), task-result, task-done, assistant('outer done')]

finishTask for outer:
currentTask: finds task-start(outer). returnTo = departureLeafId from outer start = leaf BEFORE outer started = from main branch, the leaf was task('Outer task.').id (after pushTask on main).

Wait, actually let me re-check. Outer startTask was:
```
const departureLeafId = ctx.sessionManager.getLeafId()!;
```
Before outer start, the main branch had: [thinking_level_change, user('main'), assistant('working...'), task('Outer task.')]
Leaf = task('Outer task.').id

So returnTo = task('Outer task.').id.

navigateTree to task('Outer task.') on the main branch. After navigation:
Branch: [thinking_level_change, user('main'), assistant('working...'), task('Outer task.')]

Then inject task-result for outer:
[thinking_level_change, user('main'), assistant('working...'), task('Outer task.'), task-result('outer-task', 'outer done')]

pendingTask: walks backward, hits no task entries (task('Outer task.') was not marked as done, but there's no task-start on this branch... wait, there IS a task-start? No, task-start was only on the fresh branch. On the main branch, we have task('Outer task.') without task-start.)

pendingTask: walking backward on [thinking_level_change, user('main'), assistant('working...'), task('Outer task.'), task-result]:
- task-result → skip
- task('Outer task.') with skip=0 → returns it! ✓

So task-done is appended:
[..., task('Outer task.'), task-result, task-done]

status: pendingTask returns null (task-done skip, task-entry skip--). currentTask: no task-start → null. So status = undefined. ✓

assertBranchHistory:
- Skipping task-start and task-done: user('main'), assistant('working...'), task('Outer task.'), taskResult('outer-task', 'outer done')
- Notification after taskResult: notification('Task finished...')
✓

Great, the trace matches expectations. Now let me also handle the notification for the push of inner task. The "Task stored" notification's afterEntryId = task('Inner task.'). In assertBranchHistory, after the task entry, the notification appears.

But wait, after the outer startTask, the task-start(outer) entry is hidden. But the notification for pushTask did have afterEntryId = task('Inner task.'). But on the inner task fresh branch, there's no task('Inner task.') entry (it was on the outer task branch that we navigated away from). So when we navigate back to returnTo (= task('Inner task.').id), the branch includes that entry.

OK, I think I've traced enough. Let me write the plan now.

Let me write it concisely with complete test code for each task.

Actually, wait. I need to double check one thing about `assertBranchHistory` and the notifications. When we navigate back to returnTo, the `trackedHints` from the fresh branch are no longer on the same branch. But trackedHints are stored globally in the harness, not on the branch. So when assertBranchHistory runs after navigating back, it processes all remaining trackedHints.

The trackedHints from the fresh branch had afterEntryId set to entries on the fresh branch. But those entries aren't on the current branch anymore (after navigation). So they won't match any entry's ID.

In assertBranchHistory:
```
// Unclassified hints (afterEntryId === null) go at start
for (let i = 0; i < trackedHints.length; i++) {
  if (!consumedHints.has(i) && trackedHints[i].afterEntryId === null) {
    actual.unshift(notification(trackedHints[i].text));
    consumedHints.add(i);
  }
}
// ...
const remaining: Array<{ text: string; afterEntryId: string | null }> = [];
for (let i = 0; i < trackedHints.length; i++) {
  if (!consumedHints.has(i) && trackedHints[i].afterEntryId === null) {
    remaining.push(trackedHints[i]);
  }
}
```

So hints with non-null afterEntryId that don't match any entry on the current branch are simply discarded in the `remaining` loop (they aren't re-added). This is the "orphaned hints" cleanup.

So the "Task stored" notification from pushing inner task (which had afterEntryId = task('Inner task.') on the outer branch) would be orphaned when we navigate to the fresh inner branch. But then when we navigate back to returnTo (which includes task('Inner task.')), those hints would still be orphaned (they were already discarded in the previous assertBranchHistory call).

Hmm, so what does this mean for the test? It means that when we check assertBranchHistory after inner startTask (fresh), the "Task stored" notification for the inner task push is no longer visible (it's on the discarded outer task branch), and the fresh inner branch only has `user('Inner task.')`. ✓ That's fine.

And when we navigate back to returnTo for inner finishTask, the trackedHints from the outer task branch have already been consumed or discarded. The hint for "Task stored" from pushTask was consumed in the assertBranchHistory call after pushTask, before we navigated away. So it's gone. The notification for "Task finished" from inner finishTask has afterEntryId = taskResult('inner-task').id. Since the branch after navigation includes that entry, the hint will match. ✓

OK I'm confident the assertions are correct. Let me write the plan now.

Actually one more thing: for the inherited outer, fresh inner case, after startTask(outer, inherited), the branch is:

```
[thinking_level_change, user('main'), assistant('working...'), task('Outer task.', true), task-start(outer), user('Outer task.')]
```

assertBranchHistory: skip thinking_level_change and task-start:
- user('main'), assistant('working...'), task('Outer task.', true), user('Outer task.') ✓

Then pushTask('Inner task.', false):
- Append task('Inner task.')
- Branch: [..., task-start(outer), user('Outer task.'), task('Inner task.')]
- assertBranchHistory: user('main'), assistant('working...'), task('Outer task.', true), user('Outer task.'), task('Inner task.'), notification ✓

Then startTask(inner, fresh):
- departureLeafId = leaf before navigation = task('Inner task.').id
  Wait, is task('Inner task.') stored as a custom entry? Yes, pi.appendEntry adds a custom entry. So the leaf is task('Inner task.').id.
  
  Actually wait, there's also the notification. trackHints has afterEntryId = task('Inner task.').id. But notifications aren't entries, they're tracked separately. The actual entry is just task('Inner task.').

- findFreshTargetId on current branch: first visible = user('main')
  freshTargetId = user('main').parentId = thinking_level_change.id (or whatever precedes user('main'))

- Navigate to freshTargetId
- After branch, leaf = thinking_level_change or the entry preceding user('main')
- Append task-start(inner) (with returnTo = departureLeafId = task('Inner task.').id)
  Wait, but the departureLeafId was captured BEFORE navigation. But there's a subtlety: for inherited context, the returnTo is set differently than for fresh. Let me re-read startTask:

```
const inheritContext = activeTask.data.inherit_context ?? false;

if (!inheritContext) {
  // fresh: navigate away first, then returnTo = original leaf
  const departureLeafId = ctx.sessionManager.getLeafId()!;
  const freshTargetId = findFreshTargetId(ctx.sessionManager);
  if (!freshTargetId) { ... }
  const result = await ctx.navigateTree(freshTargetId, { summarize: false });
  if (result.cancelled) return 'cancelled';
  pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: departureLeafId });
} else {
  // inherited: don't navigate, returnTo = current leaf
  pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: ctx.sessionManager.getLeafId()! });
}
```

For inherited, returnTo = current leaf (before task-start, before user message).
For fresh, departureLeafId = leaf before navigation, then navigate, then task-start with returnTo = departureLeafId.

Wait, but the function always does `pi.sendUserMessage(activeTask.data.prompt)` at the end. So for inherited:
1. Append task-start with returnTo = current leaf (which is task('Inner task.').id or whatever)
   Actually, for inner startTask, the returnTo depends on whether inner context is inherited or fresh.

Let me just be more careful. For each of the 4 combos:

**Combo 1: fresh outer, fresh inner**
- Outer start: fresh. departureLeafId = task('Outer task.').id (on main). Navigate to freshTarget. returnTo = departureLeafId.
- Inner start: fresh. departureLeafId = task('Inner task.').id (on outer branch). Navigate to freshTarget (parent of user('Outer task.')). returnTo = departureLeafId.

**Combo 2: fresh outer, inherited inner**
- Outer start: fresh. Same as above.
- Inner start: inherited. returnTo = current leaf = task('Inner task.').id (on outer branch). No navigation.

**Combo 3: inherited outer, fresh inner**
- Outer start: inherited. returnTo = current leaf = task('Outer task.', true).id (on main). No navigation.
- Inner start: fresh. departureLeafId = task('Inner task.').id (on main branch after outer push+start). Navigate to freshTarget (parent of user('main')). returnTo = departureLeafId.

**Combo 4: inherited outer, inherited inner**
- Outer start: inherited. returnTo = task('Outer task.', true).id.
- Inner start: inherited. returnTo = current leaf = task('Inner task.', true).id (on main branch after outer push+start). No navigation.

OK now I need to verify one thing: for combo 3 (inherited outer, fresh inner), after outer start with inherited context, we have:
```
[thinking_level_change, user('main'), assistant('working...'), task('Outer task.', true), task-start(outer), user('Outer task.')]
```

After pushTask('Inner task.', false):
```
[..., user('Outer task.'), task('Inner task.')]
  → leaf = task('Inner task.').id
```

Inner start (fresh): departureLeafId = task('Inner task.').id. Navigate to freshTarget (parent of user('main')). returnTo = departureLeafId.

After navigation + task-start + user('Inner task.'):
Branch: [thinking_level_change, task-start(inner), user('Inner task.')]  (or [thinking_level_change's parent → ... wait]

Hmm, what's the freshTarget for inner start? findFreshTargetId on the current branch:
Current branch: [thinking_level_change, user('main'), assistant('working...'), task('Outer task.', true), task-start(outer), user('Outer task.'), task('Inner task.')]

findPreConversationEntry: walks entries. First model-visible: user('main') (or thinking_level_change is skipped).

user('main').parentId? In the main branch, before any tasks:
AppendUserMessage adds user('main') (parentId = thinking_level_change.id, which is after sm.appendThinkingLevelChange).

So freshTargetId = user('main').parentId = thinking_level_change.id.

After sm.branch(thinking_level_change.id), the branch has: [thinking_level_change]
Wait, but it branches to thinking_level_change.id. The leaf is thinking_level_change. Then task-start(inner) is appended (parent = thinking_level_change.id). Then user('Inner task.') (parent = task-start(inner).id).

Branch: [thinking_level_change, task-start(inner), user('Inner task.')]

assertBranchHistory: skip thinking_level_change, skip task-start → user('Inner task.') ✓

Then inner finishTask: currentTask finds task-start(inner). returnTo = departureLeafId = task('Inner task.').id. Navigate to task('Inner task.'). After navigation:

The branch includes: [thinking_level_change, user('main'), assistant('working...'), task('Outer task.', true), task-start(outer), user('Outer task.'), task('Inner task.')]

Wait, does it? Let me think about the tree structure. task('Inner task.') was on the previous branch (the outer task branch). Its parentId = user('Outer task.').id. And user('Outer task.').parentId = task-start(outer).id. And task-start(outer).parentId = user('main').parentId... wait no.

After outer start(inherited), the entries are on the same branch:
1. thinking_level_change
2. user('main') (parent = thinking_level_change.id)
3. assistant('working...') (parent = user('main').id)
4. task('Outer task.', true) (parent = assistant('working...').id)
5. task-start(outer) (parent = task('Outer task.', true).id)
6. user('Outer task.') (parent = task-start(outer).id)
7. task('Inner task.') (parent = user('Outer task.').id)

So the path from root to task('Inner task.') goes through all these entries.

When we navigate to freshTarget = thinking_level_change.id and start inner task:
8. task-start(inner) (parent = thinking_level_change.id)
9. user('Inner task.') (parent = task-start(inner).id)

Note: entries 5-7 are no longer on the current branch (they were "abandoned" when we branched at thinking_level_change). They still exist in the tree but getBranch() would stop at thinking_level_change and show entries 8-9.

Now when we navigate back to returnTo = task('Inner task.').id (entry 7), the branch becomes entries 1-7 again. getBranch() returns [thinking_level_change, user('main'), ..., task('Inner task.')].

Then task-result is appended: [..., task('Inner task.'), task-result]

PendingTask: walks backward, hits task('Inner task.') with skip=0 → returns it. Task-done appended. ✓

This all works because the returnTo is the leaf of the original outer task branch (task('Inner task.')), and we can navigate back to it since it's a node in the tree.

Great, the full trace verifies all 4 combos work correctly. Now let me write the actual plan.

One more thing: I need to think about whether assertBranchHistory after inner finishTask should also be checking for `isLlmTriggered()`. Looking at the pattern in the existing abort test:

```
await runFinishTask();
assert.strictEqual(getStatus(), undefined);
assertBranchHistory(
  user('main work'),
  assistant('working...'),
  task('Quick fix.'),
  taskResult('quick-fix', 'Fixed the bug.'),
  notification('Task finished. Last response attached.'),
);
assert.ok(isLlmTriggered());
```

Yes, finishTask triggers the LLM (via the triggerTurn flag on sendMessage). So after inner finishTask:
```
assert.ok(isLlmTriggered());
```
And after outer finishTask:
```
assert.ok(isLlmTriggered());
```

But wait, after inner finishTask, when we're back on the outer task branch, isLlmTriggered walks backward and should find the task-result entry (which is in triggeredCustomMessages). Since we navigated to the returnTo which is on the same tree path, the task-result should be the last entry and should register as triggered. ✓

And before the outer finishTask, we appended assistant('outer done'). isLlmTriggered at that point would walk backward and see assistant → return false. ✓

OK, I'm confident. Let me write the plan.<｜end▁of▁thinking｜>Now I have all the context. Let me write the plan with complete test code.

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="write">
<｜｜DSML｜｜parameter name="content" string="true"># Phase 2: Recursive tasks — finish→finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 new manual workflow tests for the recursive push → start → push → start → finish → finish pattern, covering all 4 outer/inner context combos.

**Architecture:** Pure test additions to `index.test.ts`. No source code changes. The harness already supports nested task operations — `pendingTask`/`currentTask` walk backward and correctly handle nesting via skip counters. After inner `finishTask` navigates back to the outer task branch, the outer task remains "current" (its `task-start` is deeper in the branch history). Then outer `finishTask` navigates back to the main branch with the outer task result. The design validates: (1) inner task-result is injected at the outer task branch, (2) outer is still active after inner finishes, (3) both results appear on the main branch after outer finishes.

**Tech Stack:** TypeScript, Node 20+, `node:test`, SessionManager (in-memory)

**Roadmap:** [`docs/superpowers/roadmaps/2026-05-28-manual-workflow-tests-roadmap.md`](../roadmaps/2026-05-28-manual-workflow-tests-roadmap.md)

**Phase:** Phase 2: Recursive tasks — finish→finish

---

## File Structure

**Only file modified:**
- `index.test.ts` — add 4 new `it` blocks under `describe('manual workflow')`, after the last existing test in that block (before `describe('automated workflow')`)

**No files created, no files modified outside `index.test.ts`.**

---

### Task 1: Write recursive finish→finish — fresh outer, fresh inner

**Files:**
- Modify: `index.test.ts` — insert after the abort-inherited test, before `describe('automated workflow')`

**Branch history map:**
```
main branch:     user('main'), assistant('working...'), task('Outer task.')
  → startTask(outer, fresh): navigate to fresh context → user('Outer task.')
    → pushTask(inner, fresh): user('Outer task.'), task('Inner task.')
      → startTask(inner, fresh): navigate to fresh context → user('Inner task.')
        → appendAssistant('inner done')
      → finishTask(inner): navigate back to outer branch → user('Outer task.'), task('Inner task.'), taskResult('inner-task', 'inner done')
        → current task: outer-task, pending: none (inner was pending, now task-done'd)
      → appendAssistant('outer done')
    → finishTask(outer): navigate back to main → user('main'), assistant('working...'), task('Outer task.'), taskResult('outer-task', 'outer done')
```

- [ ] **Step 1: Write the test**

Insert the following block before `describe('automated workflow', ...)`:

```typescript
  it('recursive finish→finish — fresh outer, fresh inner', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    // ── Push outer task (fresh context) on main branch ──
    appendUserMessage('main');
    appendAssistantMessage('working...');
    await runPushTask('Outer task.');
    assert.strictEqual(getStatus(), 'pending task: outer-task');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // ── Start outer task (fresh context — navigate to fresh branch) ──
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(isLlmTriggered());
    // Fresh branch: only the task prompt user message
    assertBranchHistory(
      user('Outer task.'),
    );

    // ── Push inner task (fresh context) from within outer task ──
    await runPushTask('Inner task.');
    assert.strictEqual(getStatus(), 'pending task: inner-task');
    assertBranchHistory(
      user('Outer task.'),
      task('Inner task.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // ── Start inner task (fresh context — navigate to fresh branch) ──
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: inner-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('Inner task.'),
    );

    // ── Work on inner task ──
    appendAssistantMessage('inner done');

    // ── Finish inner task → navigate back to outer task branch ──
    await runFinishTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('Outer task.'),
      task('Inner task.'),
      taskResult('inner-task', 'inner done'),
      notification('Task finished. Last response attached.'),
    );

    // ── Work on outer task ──
    appendAssistantMessage('outer done');

    // ── Finish outer task → navigate back to main branch ──
    await runFinishTask();
    assert.strictEqual(getStatus(), undefined);
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.'),
      taskResult('outer-task', 'outer done'),
      notification('Task finished. Last response attached.'),
    );
  });
```

- [ ] **Step 2: Run just this test to verify it passes**

Run: `node --test index.test.ts --test-name-pattern="fresh outer, fresh inner"`

Expected: `pass`

- [ ] **Step 3: Run full test suite to check regressions**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: recursive finish→finish fresh/fresh"
```

---

### Task 2: Write recursive finish→finish — fresh outer, inherited inner

**Files:**
- Modify: `index.test.ts` — insert after the fresh/fresh test from Task 1

Outer task starts with fresh context; inner task inherits context (no navigation, `returnTo` = leaf at push time, appends `task-start` + user message on the same branch).

**Branch history map:**
```
main branch:     user('main'), assistant('working...'), task('Outer task.')
  → startTask(outer, fresh): navigate to fresh context → user('Outer task.')
    → pushTask(inner, inherited): user('Outer task.'), task('Inner task.', true)
      → startTask(inner, inherited): no navigation → task-start, user('Inner task.')
        Branch: user('Outer task.'), task('Inner task.', true), user('Inner task.')
        → appendAssistant('inner done')
      → finishTask(inner): navigate to returnTo (task('Inner task.')) → append task-result
        Branch: user('Outer task.'), task('Inner task.', true), taskResult('inner-task', 'inner done')
        → current task: outer-task
      → appendAssistant('outer done')
    → finishTask(outer): navigate back to main → user('main'), assistant('working...'), task('Outer task.'), taskResult('outer-task', 'outer done')
```

- [ ] **Step 1: Write the test**

Insert after the fresh/fresh test:

```typescript
  it('recursive finish→finish — fresh outer, inherited inner', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    // ── Push outer task (fresh) on main ──
    appendUserMessage('main');
    appendAssistantMessage('working...');
    await runPushTask('Outer task.');
    assert.strictEqual(getStatus(), 'pending task: outer-task');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // ── Start outer task (fresh) ──
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('Outer task.'),
    );

    // ── Push inner task (inherited) from within outer task ──
    await runPushTask('Inner task.', true);
    assert.strictEqual(getStatus(), 'pending task: inner-task');
    assertBranchHistory(
      user('Outer task.'),
      task('Inner task.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // ── Start inner task (inherited — no navigation) ──
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: inner-task');
    assert.ok(isLlmTriggered());
    // Inherited: prior context preserved on same branch
    assertBranchHistory(
      user('Outer task.'),
      task('Inner task.', true),
      user('Inner task.'),
    );

    // ── Work on inner task ──
    appendAssistantMessage('inner done');

    // ── Finish inner task → navigate back to outer task branch ──
    await runFinishTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('Outer task.'),
      task('Inner task.', true),
      taskResult('inner-task', 'inner done'),
      notification('Task finished. Last response attached.'),
    );

    // ── Work on outer task ──
    appendAssistantMessage('outer done');

    // ── Finish outer task → navigate back to main ──
    await runFinishTask();
    assert.strictEqual(getStatus(), undefined);
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.'),
      taskResult('outer-task', 'outer done'),
      notification('Task finished. Last response attached.'),
    );
  });
```

- [ ] **Step 2: Run the test**

Run: `node --test index.test.ts --test-name-pattern="fresh outer, inherited inner"`

Expected: `pass`

- [ ] **Step 3: Full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: recursive finish→finish fresh/inherited"
```

---

### Task 3: Write recursive finish→finish — inherited outer, fresh inner

**Files:**
- Modify: `index.test.ts` — insert after the fresh/inherited test from Task 2

Outer task starts with inherited context (stays on main branch). Inner task starts fresh (navigates to fresh context from main).

**Branch history map:**
```
main branch:     user('main'), assistant('working...'), task('Outer task.', true)
  → startTask(outer, inherited): no navigation → task-start, user('Outer task.')
    Branch: user('main'), assistant('working...'), task('Outer task.', true), user('Outer task.')
    → pushTask(inner, fresh): ... , user('Outer task.'), task('Inner task.')
      → startTask(inner, fresh): navigate to fresh context → user('Inner task.')
        → appendAssistant('inner done')
      → finishTask(inner): navigate back to returnTo (task('Inner task.') on main) → append task-result
        Branch: user('main'), assistant('working...'), task('Outer task.', true), user('Outer task.'), task('Inner task.'), taskResult('inner-task', 'inner done')
        → current task: outer-task
      → appendAssistant('outer done')
    → finishTask(outer): navigate to returnTo (task('Outer task.', true) on main) → taskResult('outer-task', 'outer done')
```

- [ ] **Step 1: Write the test**

Insert after the fresh/inherited test:

```typescript
  it('recursive finish→finish — inherited outer, fresh inner', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    // ── Push outer task (inherited) on main ──
    appendUserMessage('main');
    appendAssistantMessage('working...');
    await runPushTask('Outer task.', true);
    assert.strictEqual(getStatus(), 'pending task: outer-task');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // ── Start outer task (inherited — no navigation) ──
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
    );

    // ── Push inner task (fresh) from within outer task ──
    await runPushTask('Inner task.');
    assert.strictEqual(getStatus(), 'pending task: inner-task');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
      task('Inner task.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // ── Start inner task (fresh — navigate to fresh branch) ──
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: inner-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('Inner task.'),
    );

    // ── Work on inner task ──
    appendAssistantMessage('inner done');

    // ── Finish inner task → navigate back to returnTo on main branch ──
    await runFinishTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
      task('Inner task.'),
      taskResult('inner-task', 'inner done'),
      notification('Task finished. Last response attached.'),
    );

    // ── Work on outer task ──
    appendAssistantMessage('outer done');

    // ── Finish outer task → navigate back to returnTo on main ──
    await runFinishTask();
    assert.strictEqual(getStatus(), undefined);
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      taskResult('outer-task', 'outer done'),
      notification('Task finished. Last response attached.'),
    );
  });
```

- [ ] **Step 2: Run the test**

Run: `node --test index.test.ts --test-name-pattern="inherited outer, fresh inner"`

Expected: `pass`

- [ ] **Step 3: Full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: recursive finish→finish inherited/fresh"
```

---

### Task 4: Write recursive finish→finish — inherited outer, inherited inner

**Files:**
- Modify: `index.test.ts` — insert after the inherited/fresh test from Task 3

Both tasks use inherited context — everything stays on the main branch, no navigation except the finishTask returns.

**Branch history map:**
```
main branch:     user('main'), assistant('working...'), task('Outer task.', true)
  → startTask(outer, inherited): task-start, user('Outer task.')
    Branch: user('main'), assistant('working...'), task('Outer task.', true), user('Outer task.')
    → pushTask(inner, inherited): ... , user('Outer task.'), task('Inner task.', true)
      → startTask(inner, inherited): task-start, user('Inner task.')
        Branch: ..., user('Outer task.'), task('Inner task.', true), user('Inner task.')
        → appendAssistant('inner done')
      → finishTask(inner): navigate to returnTo (task('Inner task.', true)) → task-result
        Branch: ..., user('Outer task.'), task('Inner task.', true), taskResult('inner-task', 'inner done')
        → current task: outer-task
      → appendAssistant('outer done')
    → finishTask(outer): navigate to returnTo (task('Outer task.', true)) → task-result
      Branch: user('main'), assistant('working...'), task('Outer task.', true), taskResult('outer-task', 'outer done')
```

- [ ] **Step 1: Write the test**

Insert after the inherited/fresh test:

```typescript
  it('recursive finish→finish — inherited outer, inherited inner', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    // ── Push outer task (inherited) on main ──
    appendUserMessage('main');
    appendAssistantMessage('working...');
    await runPushTask('Outer task.', true);
    assert.strictEqual(getStatus(), 'pending task: outer-task');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // ── Start outer task (inherited — no navigation) ──
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
    );

    // ── Push inner task (inherited) from within outer task ──
    await runPushTask('Inner task.', true);
    assert.strictEqual(getStatus(), 'pending task: inner-task');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
      task('Inner task.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // ── Start inner task (inherited — no navigation) ──
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: inner-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
      task('Inner task.', true),
      user('Inner task.'),
    );

    // ── Work on inner task ──
    appendAssistantMessage('inner done');

    // ── Finish inner task → navigate back to returnTo ──
    await runFinishTask();
    assert.strictEqual(getStatus(), 'current task: outer-task');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      user('Outer task.'),
      task('Inner task.', true),
      taskResult('inner-task', 'inner done'),
      notification('Task finished. Last response attached.'),
    );

    // ── Work on outer task ──
    appendAssistantMessage('outer done');

    // ── Finish outer task → navigate back to returnTo ──
    await runFinishTask();
    assert.strictEqual(getStatus(), undefined);
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Outer task.', true),
      taskResult('outer-task', 'outer done'),
      notification('Task finished. Last response attached.'),
    );
  });
```

- [ ] **Step 2: Run the test**

Run: `node --test index.test.ts --test-name-pattern="inherited outer, inherited inner"`

Expected: `pass`

- [ ] **Step 3: Full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: recursive finish→finish inherited/inherited"
```

---

### Task 5: Full verification gate

- [ ] **Step 1: Run the verification gate**

Run: `npm run verify`

This runs lint → tsc → test → updater → skill drift → pack. Expected: all pass.

- [ ] **Step 2: If any failures, fix them** (shouldn't need source changes — likely assertion adjustments if a behavior detail differs from expectations)

- [ ] **Step 3: Final commit with meaningful message**

```bash
git add index.test.ts
git commit -m "test: Phase 2 — recursive finish→finish all 4 context combos"
```
