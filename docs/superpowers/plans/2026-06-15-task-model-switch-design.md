# Task Model Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/start-task` gains an optional model pattern argument. When given and unambiguous, the model switches before the task prompt is sent. `/finish-task` restores the original model.

**Architecture:** Extend `TaskStartData` with optional `previousModel`, add model resolution + autocompletion helpers in `src/index.ts`, update `cmdStartTask` to parse the optional arg and switch models, and update `finishTask` to restore the model when present. Model registry access comes through `ctx.modelRegistry` (already on `ExtensionCommandContext`); `setModel` is picked from `ExtensionAPI`.

**Tech Stack:** TypeScript, Node.js built-in test runner, pi SDK (`ExtensionAPI.setModel`, `ModelRegistry`, `ExtensionCommandContext.model`)

**Roadmap:** None

**Phase:** Single-plan implementation

---

## File structure

| File | Change |
|------|--------|
| `src/index.ts` | `TaskCommandAPI` (+`setModel`), `TaskStartData` (+`previousModel`), `isTaskStartData`, `cmdStartTask` (+args parsing, model resolution, `getArgumentCompletions`), `startTask` (+model switch block), `finishTask` (+model restore), helpers `resolveModelPattern` and `getModelCompletions`, module-level `modelRegistry` + `setModelRegistry()` |
| `index.ts` | Import and call `setModelRegistry` in `session_start` handler |
| `src/test-helpers/harness.ts` | Expose `modelRegistry` getter |
| `src/model-switch.test.ts` | New — integration tests for resolution, switching, restore, edge cases |

---

### Task 1: Expose modelRegistry on TestHarness

**Files:**
- Modify: `src/test-helpers/harness.ts`

- [ ] **Step 1: Add public getter**

In the `TestHarness` class, after the `private handledSessionEntryIds` field, add:

```typescript
get modelRegistry(): ModelRegistry {
  return this.session.modelRegistry;
}
```

`ModelRegistry` is already imported at the top of the file. No import changes needed.

- [ ] **Step 2: Verify harness still works**

Run: `npx tsx --test src/test-helpers/harness.test.ts`
Expected: all 12 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/test-helpers/harness.ts
git commit -m "test: expose modelRegistry getter on TestHarness"
```

---

### Task 2: Update data model (TaskStartData + validator)

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add previousModel to TaskStartData**

Find the interface (near end of file):

```typescript
interface TaskStartData {
  returnTo: string;
}
```

Replace with:

```typescript
interface TaskStartData {
  returnTo: string;
  previousModel?: { provider: string; modelId: string };
}
```

- [ ] **Step 2: Update isTaskStartData validator**

Find:

```typescript
function isTaskStartData(value: unknown): value is TaskStartData {
  return isRecord(value) && typeof value.returnTo === "string";
}
```

Replace with:

```typescript
function isTaskStartData(value: unknown): value is TaskStartData {
  if (!isRecord(value) || typeof value.returnTo !== "string") return false;
  if (value.previousModel !== undefined) {
    return (
      isRecord(value.previousModel) &&
      typeof value.previousModel.provider === "string" &&
      typeof value.previousModel.modelId === "string"
    );
  }
  return true;
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors (validator change is backward-compatible, interface change adds optional field only)

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add optional previousModel to TaskStartData"
```

---

### Task 3: Add model resolution and autocompletion helpers

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add imports for new types**

In the existing `@earendil-works/pi-coding-agent` import, add `type ModelRegistry`:

```typescript
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type MessageRenderer,
  type ModelRegistry,
  type RegisteredCommand,
  type SessionEntry,
  type SessionMessageEntry,
  type Skill,
  type Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
```

Add a new import line for `Model` and `AutocompleteItem`:

```typescript
import type { Model } from "@earendil-works/pi-ai";
```

In the existing `@earendil-works/pi-tui` import, add `AutocompleteItem`:

```typescript
import { Box, Text, type AutocompleteItem } from "@earendil-works/pi-tui";
```

- [ ] **Step 2: Add module-level modelRegistry variable and setter**

After the existing `let skillsExternallySet = false;` (~last line of file), add:

```typescript
let modelRegistry: ModelRegistry | undefined;

export function setModelRegistry(mr: ModelRegistry): void {
  modelRegistry = mr;
}
```

- [ ] **Step 3: Add resolveModelPattern helper**

After the `resolveSkillRefs` function (before `pushTaskParameters`), add:

```typescript
/**
 * Resolve a model pattern to a single model, null (no match), or "ambiguous".
 *
 * Matching order:
 * 1. If pattern contains "/": split as provider/modelId, try exact lookup.
 *    Falls through to substring matching even if the exact lookup fails.
 * 2. Substring, case-insensitive match against each available model's
 *    id, name, and provider/id.
 */
function resolveModelPattern(
  pattern: string,
  registry: ModelRegistry,
): Model<any> | "ambiguous" | null {
  if (pattern.includes("/")) {
    const slashIdx = pattern.indexOf("/");
    const provider = pattern.slice(0, slashIdx);
    const modelId = pattern.slice(slashIdx + 1);
    const found = registry.find(provider, modelId);
    if (found) return found;
  }

  const available = registry.getAvailable();
  const lowerPattern = pattern.toLowerCase();
  const matches = available.filter((m) => {
    if (m.id.toLowerCase().includes(lowerPattern)) return true;
    if (m.name.toLowerCase().includes(lowerPattern)) return true;
    if (`${m.provider}/${m.id}`.toLowerCase().includes(lowerPattern)) return true;
    return false;
  });

  if (matches.length === 0) return null;
  if (matches.length > 1) return "ambiguous";
  return matches[0];
}
```

- [ ] **Step 4: Add getModelCompletions helper**

After `resolveModelPattern`, add:

```typescript
/**
 * Autocompletion for /start-task model argument.
 * Filters available models by case-insensitive substring match against
 * id, name, and provider/id. Returns up to 20 items.
 */
function getModelCompletions(
  argumentPrefix: string,
  registry: ModelRegistry,
): AutocompleteItem[] {
  const available = registry.getAvailable();
  const lowerPrefix = argumentPrefix.toLowerCase();
  const matched = available.filter((m) => {
    if (m.id.toLowerCase().includes(lowerPrefix)) return true;
    if (m.name.toLowerCase().includes(lowerPrefix)) return true;
    if (`${m.provider}/${m.id}`.toLowerCase().includes(lowerPrefix)) return true;
    return false;
  });

  return matched.slice(0, 20).map((m) => ({
    value: `${m.provider}/${m.id}`,
    label: m.name,
    description: `${m.provider}/${m.id}`,
  }));
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: add model resolution and autocompletion helpers"
```

---

### Task 4: Update cmdStartTask + startTask for model switching

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Widen TaskCommandAPI to include setModel**

Find:

```typescript
type TaskCommandAPI = Pick<ExtensionAPI, "appendEntry" | "sendMessage" | "sendUserMessage">;
```

Replace with:

```typescript
type TaskCommandAPI = Pick<ExtensionAPI, "appendEntry" | "sendMessage" | "sendUserMessage" | "setModel">;
```

(`AutoCommandAPI` extends `TaskCommandAPI`, inherits `setModel` automatically.)

- [ ] **Step 2: Add modelArg to TaskActionOptions**

Find:

```typescript
type TaskActionOptions = {
  statusPrefix?: string;
};
```

Replace with:

```typescript
type TaskActionOptions = {
  statusPrefix?: string;
  modelArg?: string;
};
```

- [ ] **Step 3: Update cmdStartTask with args parsing and autocompletion**

Find:

```typescript
export function cmdStartTask(pi: TaskCommandAPI): CommandOptions {
  return {
    description: "Navigate to a fresh context and inject the active task prompt",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      await startTask(pi, ctx);
    },
  };
}
```

Replace with:

```typescript
export function cmdStartTask(pi: TaskCommandAPI): CommandOptions {
  return {
    description: "Navigate to a fresh context and inject the active task prompt",
    getArgumentCompletions: (argumentPrefix: string) => {
      if (!modelRegistry) return null;
      return getModelCompletions(argumentPrefix, modelRegistry);
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      const modelArg = args.trim() || undefined;
      await startTask(pi, ctx, { modelArg });
    },
  };
}
```

- [ ] **Step 4: Update startTask to resolve model and switch before task begins**

Replace the `startTask` function with the version below. The model switching block is inserted after the active-task check and before the inherit/non-inherit navigation logic. Key changes:

- Model resolution + switching happens before navigation
- `departureLeafId` is hoisted so both branches use it consistently
- `previousModel` is included in the `task-start` entry data when present

Current startTask:

```typescript
async function startTask(
  pi: TaskCommandAPI,
  ctx: ExtensionCommandContext,
  options: TaskActionOptions = {},
): Promise<TaskActionResult> {
  const activeTask = pendingTask(ctx.sessionManager);
  if (!activeTask) {
    ctx.ui.notify("No pending task. Use push-task first.", "warning");
    return;
  }

  const inheritContext = activeTask.data.inherit_context;

  if (!inheritContext) {
    const departureLeafId = ctx.sessionManager.getLeafId()!;
    const freshTargetId = findFreshTargetId(ctx.sessionManager);
    if (!freshTargetId) {
      ctx.ui.notify("No starting point found on current branch.", "warning");
      return;
    }

    const result = await ctx.navigateTree(freshTargetId, { summarize: false });
    if (result.cancelled) return "cancelled";

    pi.appendEntry(TASK_START_ENTRY_TYPE, { returnTo: departureLeafId });
  } else {
    pi.appendEntry(TASK_START_ENTRY_TYPE, {
      returnTo: ctx.sessionManager.getLeafId()!,
    });
  }

  pi.sendUserMessage(activeTask.data.prompt);

  refreshTaskStatus(ctx, { prefix: options.statusPrefix });
}
```

Replace with:

```typescript
async function startTask(
  pi: TaskCommandAPI,
  ctx: ExtensionCommandContext,
  options: TaskActionOptions = {},
): Promise<TaskActionResult> {
  const activeTask = pendingTask(ctx.sessionManager);
  if (!activeTask) {
    ctx.ui.notify("No pending task. Use push-task first.", "warning");
    return;
  }

  // ── Model switching ─────────────────────────────────────────────
  let previousModel: TaskStartData["previousModel"];
  if (options.modelArg) {
    const matched = resolveModelPattern(options.modelArg, ctx.modelRegistry);
    if (matched === null) {
      ctx.ui.notify(`No model matching "${options.modelArg}".`, "warning");
      return;
    }
    if (matched === "ambiguous") {
      const available = ctx.modelRegistry.getAvailable();
      const lower = options.modelArg.toLowerCase();
      const names = available
        .filter((m) => {
          if (m.id.toLowerCase().includes(lower)) return true;
          if (m.name.toLowerCase().includes(lower)) return true;
          if (`${m.provider}/${m.id}`.toLowerCase().includes(lower)) return true;
          return false;
        })
        .map((m) => `${m.provider}/${m.id}`)
        .join(", ");
      ctx.ui.notify(`Ambiguous model: matches ${names}.`, "warning");
      return;
    }

    const currentModel = ctx.model;
    if (currentModel) {
      previousModel = { provider: currentModel.provider, modelId: currentModel.id };
    }

    const switched = await pi.setModel(matched);
    if (!switched) {
      ctx.ui.notify(
        `No API key configured for ${matched.provider}/${matched.id}.`,
        "warning",
      );
      return;
    }
  }

  // ── Task start ──────────────────────────────────────────────────
  const inheritContext = activeTask.data.inherit_context;

  let departureLeafId: string;
  if (!inheritContext) {
    departureLeafId = ctx.sessionManager.getLeafId()!;
    const freshTargetId = findFreshTargetId(ctx.sessionManager);
    if (!freshTargetId) {
      ctx.ui.notify("No starting point found on current branch.", "warning");
      return;
    }

    const result = await ctx.navigateTree(freshTargetId, { summarize: false });
    if (result.cancelled) return "cancelled";
  } else {
    departureLeafId = ctx.sessionManager.getLeafId()!;
  }

  const startEntryData: TaskStartData = { returnTo: departureLeafId };
  if (previousModel) {
    startEntryData.previousModel = previousModel;
  }
  pi.appendEntry(TASK_START_ENTRY_TYPE, startEntryData);

  pi.sendUserMessage(activeTask.data.prompt);

  refreshTaskStatus(ctx, { prefix: options.statusPrefix });
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Run existing tests to verify no regressions**

Run: `npx tsx --test 'src/*.test.ts'`
Expected: all existing tests pass (model arg is optional, no-arg path unchanged)

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat: add model switching to /start-task with autocompletion"
```

---

### Task 5: Update finishTask for model restoration

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add model restore logic after navigation**

In `finishTask`, find the navigation result check:

```typescript
  const result = await ctx.navigateTree(taskStart.data.returnTo, {
    summarize: false,
  });
  if (result.cancelled) return "cancelled";

  // Inject last assistant message after navigation
```

Insert model restoration between the cancellation check and the message injection:

```typescript
  const result = await ctx.navigateTree(taskStart.data.returnTo, {
    summarize: false,
  });
  if (result.cancelled) return "cancelled";

  // ── Model restoration ───────────────────────────────────────────
  if (taskStart.data.previousModel) {
    const { provider, modelId } = taskStart.data.previousModel;
    const restoredModel = ctx.modelRegistry.find(provider, modelId);
    if (restoredModel) {
      await pi.setModel(restoredModel);
    } else {
      ctx.ui.notify(
        `Previous model ${provider}/${modelId} no longer available.`,
        "warning",
      );
    }
  }

  // Inject last assistant message after navigation
```

This goes after navigation (so we're back on the parent branch) and before the task-result message injection. Restoring the model does not trigger a turn — `setModel` saves to session/settings.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run existing tests**

Run: `npx tsx --test 'src/*.test.ts'`
Expected: all existing tests pass (previousModel is undefined on existing task-start entries, so the if-block is skipped)

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: restore previous model on /finish-task"
```

---

### Task 6: Wire modelRegistry in index.ts

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Import setModelRegistry and call in session_start**

Update the import from `./src/index.js`:

```typescript
import {
  cmdAbortTask,
  cmdAuto,
  cmdDiscardTask,
  cmdFinishTask,
  toolPushTask,
  cmdStartTask,
  rendererTaskResult,
  setSkillsFromEvent,
  setModelRegistry,
  updateTaskStatus,
} from "./src/index.js";
```

Update the `session_start` handler to set the model registry before updating status:

```typescript
  pi.on("session_start", async (_event, ctx) => {
    setModelRegistry(ctx.modelRegistry);
    updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme);
  });
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add index.ts
git commit -m "feat: wire modelRegistry to autocompletion via session_start"
```

---

### Task 7: Write model-switch tests

**Files:**
- Create: `src/model-switch.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/model-switch.test.ts`:

```typescript
import { describe, it } from "node:test";

import {
  assistant,
  pushTask,
  responds,
  task,
  taskResult,
  user,
  TestHarness,
} from "./test-helpers/index.js";

/** Register extra test models with configured auth on the harness model registry. */
function registerTestModels(h: TestHarness, models: Array<{ id: string; name: string }>) {
  h.modelRegistry.registerProvider("test-extra", {
    baseUrl: "memory://test-extra",
    apiKey: "test-key-extra",
    api: "supergsd-test-api",
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      reasoning: false,
      input: ["text"] as const,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 100000,
      maxTokens: 4096,
    })),
  });
}

describe("model switching on /start-task", () => {
  it("starts task without model arg (existing behavior unchanged)", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task");
      h.assertSession(user("Task AAA"), assistant("Done."));
      h.assertStatus("current task: task-aaa");
    } finally {
      h.dispose();
    }
  });

  it("switches model and restores on finish (substring match)", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [{ id: "cheap-model", name: "Cheap Model" }]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task Cheap");
      h.assertSession(user("Task AAA"), assistant("Done."));
      h.assertStatus("current task: task-aaa");

      await h.prompt("/finish-task");
      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA"),
        taskResult("task-aaa", "Done."),
        assistant("Great!"),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });

  it("switches model via provider/modelId syntax", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [{ id: "cheap-model", name: "Cheap Model" }]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task test-extra/cheap-model");
      h.assertSession(user("Task AAA"), assistant("Done."));
      h.assertStatus("current task: task-aaa");
    } finally {
      h.dispose();
    }
  });

  it("notifies when no model matches", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task nonexistent-model-xyz");

      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA"),
      );
      h.assertStatus("pending task: task-aaa");
      h.assertLastNotification('No model matching "nonexistent-model-xyz".');
    } finally {
      h.dispose();
    }
  });

  it("notifies when multiple models match", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [
      { id: "cheap-model-v1", name: "Cheap Model V1" },
      { id: "cheap-model-v2", name: "Cheap Model V2" },
    ]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task cheap-model");

      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA"),
      );
      h.assertStatus("pending task: task-aaa");
      h.assertLastNotification(
        "Ambiguous model: matches test-extra/cheap-model-v1, test-extra/cheap-model-v2.",
      );
    } finally {
      h.dispose();
    }
  });

  it("restores original model on nested task finish", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [{ id: "cheap-model", name: "Cheap Model" }]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("outer working..."), pushTask("Task BBB"));
    h.llm.onPrompt("Task BBB", responds("inner done"));
    h.llm.onPrompt("inner done", responds("Great!"));
    h.llm.onPrompt("Great!", responds(""));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task cheap");
      h.assertSession(
        user("Task AAA"),
        assistant("outer working...", "toolUse"),
        task("Task BBB"),
      );

      // Start nested without model switch
      await h.prompt("/start-task");
      h.assertSession(user("Task BBB"), assistant("inner done"));

      // Finish nested — no previousModel on its task-start, stays on cheap
      await h.prompt("/finish-task");
      h.assertSession(
        user("Task AAA"),
        assistant("outer working...", "toolUse"),
        task("Task BBB"),
        taskResult("task-bbb", "inner done"),
        assistant("Great!"),
      );

      // Finish outer — restores to FAUX_MODEL
      await h.prompt("/finish-task");
      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA"),
        taskResult("task-aaa", "Great!"),
        assistant(""),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });

  it("nested tasks with independent model switches", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [
      { id: "model-a", name: "Model A" },
      { id: "model-b", name: "Model B" },
    ]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("outer working..."), pushTask("Task BBB"));
    h.llm.onPrompt("Task BBB", responds("inner done"));
    h.llm.onPrompt("inner done", responds("Great!"));
    h.llm.onPrompt("Great!", responds(""));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task model-a");
      h.assertSession(
        user("Task AAA"),
        assistant("outer working...", "toolUse"),
        task("Task BBB"),
      );

      await h.prompt("/start-task model-b");
      h.assertSession(user("Task BBB"), assistant("inner done"));

      // Finish inner — restores to model-a
      await h.prompt("/finish-task");
      h.assertSession(
        user("Task AAA"),
        assistant("outer working...", "toolUse"),
        task("Task BBB"),
        taskResult("task-bbb", "inner done"),
        assistant("Great!"),
      );

      // Finish outer — restores to FAUX_MODEL
      await h.prompt("/finish-task");
      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA"),
        taskResult("task-aaa", "Great!"),
        assistant(""),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });

  it("warns when previous model unavailable on finish", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [{ id: "volatile-model", name: "Volatile Model" }]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA"));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task volatile");
      h.assertSession(user("Task AAA"), assistant("Done."));
      h.assertStatus("current task: task-aaa");

      // Unregister provider between start and finish to make model unavailable
      h.modelRegistry.unregisterProvider("test-extra");

      await h.prompt("/finish-task");
      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA"),
        taskResult("task-aaa", "Done."),
        assistant("Great!"),
      );
      h.assertStatus();
      h.assertLastNotification(
        "Previous model test-extra/volatile-model no longer available.",
      );
    } finally {
      h.dispose();
    }
  });

  it("model switch works with inherit-context tasks", async () => {
    const h = await TestHarness.create();
    registerTestModels(h, [{ id: "alt-model", name: "Alt Model" }]);

    h.llm.onPrompt("main work", responds("working..."), pushTask("Task AAA", true));
    h.llm.onPrompt("Task AAA", responds("Done."));
    h.llm.onPrompt("Done.", responds("Great!"));

    try {
      await h.prompt("main work");
      await h.prompt("/start-task alt");

      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA", true),
        user("Task AAA"),
        assistant("Done."),
      );
      h.assertStatus("current task: task-aaa");

      await h.prompt("/finish-task");
      h.assertSession(
        user("main work"),
        assistant("working...", "toolUse"),
        task("Task AAA", true),
        taskResult("task-aaa", "Done."),
        assistant("Great!"),
      );
      h.assertStatus();
    } finally {
      h.dispose();
    }
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `npx tsx --test src/model-switch.test.ts`
Expected: 8 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/model-switch.test.ts
git commit -m "test: add model-switch integration tests"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run fix**

```bash
npm run fix
```

- [ ] **Step 2: Run full verify**

```bash
npm run verify
```

Expected: `tsc --noEmit` passes, ESLint passes, all tests pass (existing + new), updater passes, Prettier check passes.

- [ ] **Step 3: Commit any fix-generated changes**

```bash
git add -A && git commit -m "chore: auto-fix formatting and lint"
```

---

## Spec coverage check

| Spec requirement | Covered by |
|---|---|
| `/start-task [model-pattern]` | Task 4 |
| `/finish-task` model restore | Task 5 |
| Model resolution (provider/id then substring) | Task 3 (`resolveModelPattern`) |
| 0 matches → notify | Task 4 (startTask), Task 7 test |
| >1 match → notify ambiguous | Task 4 (startTask), Task 7 test |
| 1 match → switch + record previousModel | Task 4 (startTask), Task 7 test |
| `pi.setModel()` failure → notify | Task 4 (if block) |
| `getArgumentCompletions` autocompletion | Task 3 (`getModelCompletions`), Task 4 (command), Task 6 (wire modelRegistry) |
| Nested tasks stack independently | Task 7 test |
| User changes model during task (ignored on finish) | Task 5 design (reads from checkpoint, not `ctx.model`) |
| Inherit-context tasks | Task 7 test |
| Previous model unavailable on finish | Task 5, Task 7 test |
| `TaskStartData` extended | Task 2 |
| `isTaskStartData` updated | Task 2 |
