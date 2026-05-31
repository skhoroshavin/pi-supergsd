# Reaction Engine & Review Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the queue-only faux provider plus `/auto`-only reaction scanner with a reusable `ReactionEngine`, simplify the harness API around it, migrate tests to the new engine-driven flow, and close the deferred code-review items.

**Architecture:** Keep `faux-provider.ts` and `reaction-engine.ts` separate. `ReactionEngine` owns rule registration and matching; `FauxProvider` owns provider streaming and queries `ReactionEngine` for prompt responses. `TestHarness` becomes a thinner shell that injects the engine, delegates real command behavior to slash commands where possible, and only keeps a small `pushTask()` helper because `push-task` is a tool, not a slash command.

**Tech Stack:** TypeScript ES modules, Node 20 test runner, Pi `AgentSession`, extension command handling, custom faux provider stream.

**Roadmap:** None

**Phase:** Single-plan implementation

---

## File Structure

- **Create:** `src/test-helpers/reaction-engine.ts`
  - Mutable rule registry for `onPrompt()`, `onAssistant()`, `onQueuedTask()`
  - Exposes pure matching methods; does not stream and does not dequeue rules
- **Modify:** `src/test-helpers/faux-provider.ts`
  - Replace `FauxResponseQueue` with `FauxProvider`
  - Build one assistant turn from `engine.matchPrompt(...)`
  - Replace polling `result()` with promise-based completion
- **Modify:** `src/test-helpers/harness.ts`
  - `TestHarness.create(engine)` takes the engine as its only required input
  - Remove `prompt(...responses)` and `runAuto(...)`
  - Replace most task workflow helpers with real slash-command prompts; keep only `pushTask()` helper
  - Scan assistant/queued-task rules during `waitForIdle`
- **Modify:** `src/test-helpers/descriptors.ts`
  - Remove old `AutoConfig`, `MatchDescriptor`, `ReactionDescriptor` surface used only by `runAuto()`
  - Keep entry/assertion helpers and response/control descriptor builders
- **Modify:** `src/test-helpers/index.ts`
  - Export `ReactionEngine`
  - Stop exporting obsolete matcher helpers (`prompt`, `queuedTask`) if no longer needed
- **Modify:** `src/test-helpers/ui.ts`
  - Capture notification level alongside text
- **Delete:** `src/test-helpers/reactions.ts`
  - Matching logic moves into `reaction-engine.ts`
- **Modify:** `src/test-helpers/harness.test.ts`
  - Add engine-driven tests for prompt matching, multi-block assistant turns, no-match failure, subtask auto flow
- **Modify:** `src/manual.test.ts`
  - Construct `ReactionEngine` in each test tree root and migrate to `h.prompt(...)` + `h.pushTask(...)`
- **Modify:** `src/auto.test.ts`
  - Replace `runAuto()` and explicit reaction arrays with `ReactionEngine`
  - Restore the skipped subtask test
- **Modify:** `src/text-content.ts`
  - Keep `makeSlug` re-export if still needed after harness cleanup; remove it if no longer used

---

### Task 1: Introduce `ReactionEngine` and move matching logic into it

**Files:**
- Create: `src/test-helpers/reaction-engine.ts`
- Modify: `src/test-helpers/descriptors.ts`
- Modify: `src/test-helpers/index.ts`
- Test: `src/test-helpers/harness.test.ts`

- [ ] **Step 1: Add the first failing harness test for engine-backed prompt responses**

Add this test near the top of `src/test-helpers/harness.test.ts`:

```ts
import { ReactionEngine } from './index.js';

it('uses ReactionEngine prompt rules for h.prompt()', async () => {
  const engine = new ReactionEngine();
  engine.onPrompt('main work', responds('working...'));

  const h = await TestHarness.create(engine);
  try {
    await h.prompt('main work');
    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
    );
  } finally {
    h.dispose();
  }
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npx tsx --test src/test-helpers/harness.test.ts --test-name-pattern "uses ReactionEngine prompt rules"
```

Expected: FAIL because `ReactionEngine` is not exported and `TestHarness.create()` still takes no argument.

- [ ] **Step 3: Create `src/test-helpers/reaction-engine.ts` with the new rule registry**

Write this file:

```ts
import type {
  ControlReactionDescriptor,
  ResponseDescriptor,
} from './descriptors.js';

export class ReactionEngine {
  private readonly promptRules: PromptRule[] = [];
  private readonly assistantRules: SessionRule[] = [];
  private readonly queuedTaskRules: QueuedTaskRule[] = [];

  onPrompt(text: string, ...responses: ResponseDescriptor[]): void {
    this.promptRules.push({ text, responses });
  }

  onAssistant(
    text: string,
    ...reactions: Array<ResponseDescriptor | ControlReactionDescriptor>
  ): void {
    this.assistantRules.push({ text, reactions });
  }

  onQueuedTask(
    prompt: string,
    inheritContext: boolean | undefined,
    ...reactions: Array<ResponseDescriptor | ControlReactionDescriptor>
  ): void {
    this.queuedTaskRules.push({ prompt, inheritContext, reactions });
  }

  matchPrompt(text: string): ResponseDescriptor[] {
    const matched = this.promptRules.find(rule => text.includes(rule.text));
    return matched ? [...matched.responses] : [];
  }

  matchAssistant(text: string): Array<ResponseDescriptor | ControlReactionDescriptor> {
    const matched = this.assistantRules.find(rule => text.includes(rule.text));
    return matched ? [...matched.reactions] : [];
  }

  matchQueuedTask(
    prompt: string,
    inheritContext: boolean,
  ): Array<ResponseDescriptor | ControlReactionDescriptor> {
    const matched = this.queuedTaskRules.find(rule => {
      if (!prompt.includes(rule.prompt)) return false;
      return rule.inheritContext === undefined || rule.inheritContext === inheritContext;
    });
    return matched ? [...matched.reactions] : [];
  }
}

type PromptRule = {
  text: string;
  responses: ResponseDescriptor[];
};

type SessionRule = {
  text: string;
  reactions: Array<ResponseDescriptor | ControlReactionDescriptor>;
};

type QueuedTaskRule = {
  prompt: string;
  inheritContext: boolean | undefined;
  reactions: Array<ResponseDescriptor | ControlReactionDescriptor>;
};
```

- [ ] **Step 4: Export `ReactionEngine` and trim obsolete matcher exports**

Update `src/test-helpers/index.ts` to:

```ts
export {
  aborts,
  assistant,
  pushTask,
  responds,
  task,
  taskResult,
  thinks,
  user,
  userCtrlC,
  userEsc,
  userRunsAuto,
  notification,
  assumeCommandContext,
} from './descriptors.js';

export { ReactionEngine } from './reaction-engine.js';
export { TestHarness } from './harness.js';

export { node } from './test-tree.js';
```

- [ ] **Step 5: Remove obsolete `AutoConfig` and matcher types from `descriptors.ts`**

Replace the top of `src/test-helpers/descriptors.ts`:

```ts
export interface AutoConfig {
  reactions?: Array<[MatchDescriptor, ReactionDescriptor | ResponseDescriptor | ResponseDescriptor[]]>;
}

export type MatchDescriptor = PromptMatch | QueuedTaskMatch | UserEntry | AssistantEntry;
export type PromptMatch = { type: 'match:prompt'; text: string };
export type QueuedTaskMatch = {
  type: 'match:queued-task';
  prompt: string;
  inherit_context: boolean;
};
export type ReactionDescriptor = ControlReactionDescriptor | ResponseDescriptor | ResponseDescriptor[];
```

with:

```ts
export type ControlReactionDescriptor =
  | { type: 'user-esc' }
  | { type: 'user-ctrl-c' }
  | { type: 'user-runs-auto' }
  | { type: 'user-append'; text: string };

export type ResponseDescriptor =
  | RespondsDescriptor
  | ThinksDescriptor
  | AbortsDescriptor
  | PushTaskDescriptor;
```

Then remove the `prompt` and `queuedTask` builders from the export block and file body.

- [ ] **Step 6: Type-check the structural changes**

Run:

```bash
npx tsc --noEmit
```

Expected: FAIL in `harness.ts`, `auto.test.ts`, and any remaining imports of `prompt`, `queuedTask`, `AutoConfig`, or `ReactionDescriptor` from old locations.

- [ ] **Step 7: Commit the new engine scaffold**

```bash
git add src/test-helpers/reaction-engine.ts src/test-helpers/descriptors.ts src/test-helpers/index.ts src/test-helpers/harness.test.ts
git commit -m "test: add reaction engine scaffold"
```

Expected: commit succeeds once the repo type-checks again in later tasks; if not yet possible, skip commit now and commit at Task 2.

### Task 2: Rebuild `faux-provider.ts` around `ReactionEngine`

**Files:**
- Modify: `src/test-helpers/faux-provider.ts`
- Modify: `src/test-helpers/harness.test.ts`

- [ ] **Step 1: Add the failing test for multi-block prompt responses**

Append this test in `src/test-helpers/harness.test.ts`:

```ts
it('builds one assistant turn from multiple prompt descriptors', async () => {
  const engine = new ReactionEngine();
  engine.onPrompt(
    'Analyze X',
    responds('preparing subagent'),
    pushTask('Detailed X analysis'),
  );

  const h = await TestHarness.create(engine);
  try {
    await h.prompt('Analyze X');
    h.assertSessionContains(
      user('Analyze X'),
      assistant('preparing subagent', 'toolUse'),
      task('Detailed X analysis'),
    );
  } finally {
    h.dispose();
  }
});
```

- [ ] **Step 2: Run the focused harness tests and confirm they fail for the right reason**

Run:

```bash
npx tsx --test src/test-helpers/harness.test.ts --test-name-pattern "ReactionEngine|multiple prompt descriptors"
```

Expected: FAIL because `FauxResponseQueue` only supports one queued descriptor per provider call.

- [ ] **Step 3: Replace `FauxResponseQueue` with `FauxProvider`**

Replace the class declaration and constructor-facing API in `src/test-helpers/faux-provider.ts` with:

```ts
import { ReactionEngine } from './reaction-engine.js';

export class FauxProvider {
  constructor(private readonly engine: ReactionEngine) {}

  stream = (_model: Model, context: Context): FauxEventStream => {
    const stream = new FauxEventStream();
    const lastUser = [...context.messages].reverse().find(message => message.role === 'user');
    const promptText = lastUser ? readUserText(lastUser.content) : '';
    const responses = this.engine.matchPrompt(promptText);

    queueMicrotask(() => {
      if (responses.length === 0) {
        const error = makeAssistantMessage(
          [],
          'error',
          `No reaction engine rule matched provider prompt: ${JSON.stringify(promptText)}`,
        );
        stream.push({ type: 'error', reason: 'error', error });
        stream.end(error);
        return;
      }

      emitPromptResponses(stream, responses);
    });

    return stream;
  };
}
```

- [ ] **Step 4: Replace one-descriptor streaming with one-turn streaming**

Replace `emitDescriptor(...)` with:

```ts
function emitPromptResponses(
  stream: FauxEventStream,
  responses: ResponseDescriptor[],
): void {
  if (responses.length === 1 && responses[0].type === 'response:aborted') {
    const descriptor = responses[0];
    const message = makeAssistantMessage(
      [{ type: 'text', text: descriptor.text }],
      'aborted',
      'Aborted by test descriptor',
    );
    stream.push({ type: 'start', partial: message });
    stream.push({ type: 'error', reason: 'aborted', error: message });
    stream.end(message);
    return;
  }

  const content = responses.map((descriptor, index) => {
    if (descriptor.type === 'response:text') {
      return { type: 'text' as const, text: descriptor.text };
    }
    if (descriptor.type === 'response:thinking') {
      return { type: 'thinking' as const, thinking: descriptor.text };
    }
    if (descriptor.type === 'response:push-task') {
      return {
        type: 'toolCall' as const,
        id: `call-${index + 1}`,
        name: 'push-task',
        arguments: {
          prompt: descriptor.prompt,
          inherit_context: descriptor.inherit_context,
        },
      };
    }
    throw new Error('aborts(...) must be the only descriptor in onPrompt(...)');
  });

  const stopReason = content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop';
  const message = makeAssistantMessage(content, stopReason);

  stream.push({ type: 'start', partial: message });

  for (const [index, block] of content.entries()) {
    if (block.type === 'text') {
      stream.push({ type: 'text_start', contentIndex: index, partial: message });
      stream.push({ type: 'text_delta', contentIndex: index, delta: block.text, partial: message });
      stream.push({ type: 'text_end', contentIndex: index, content: block.text, partial: message });
      continue;
    }

    if (block.type === 'thinking') {
      stream.push({ type: 'thinking_start', contentIndex: index, partial: message });
      stream.push({ type: 'thinking_delta', contentIndex: index, delta: block.thinking, partial: message });
      stream.push({ type: 'thinking_end', contentIndex: index, content: block.thinking, partial: message });
      continue;
    }

    stream.push({ type: 'toolcall_start', contentIndex: index, partial: message });
    stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: block, partial: message });
  }

  stream.push({ type: 'done', reason: stopReason, message });
  stream.end(message);
}
```

- [ ] **Step 5: Replace polling `result()` with a promise**

Replace the `FauxEventStream` state and `result()` implementation with:

```ts
  private readonly finalResultPromise = new Promise<AssistantMessage>((resolve) => {
    this.resolveFinalResult = resolve;
  });
  private resolveFinalResult!: (message: AssistantMessage) => void;
```

and:

```ts
  end(result: AssistantMessage): void {
    this.done = true;
    this.finalResult = result;
    this.resolveFinalResult(result);
    for (const resolve of this.waiting) {
      resolve({
        type: 'done',
        reason: result.stopReason === 'toolUse' ? 'toolUse' : 'stop',
        message: result,
      } as AssistantMessageEvent);
    }
    this.waiting = [];
  }

  result(): Promise<AssistantMessage> {
    return this.finalResultPromise;
  }
```

- [ ] **Step 6: Run focused tests for provider behavior**

Run:

```bash
npx tsx --test src/test-helpers/harness.test.ts --test-name-pattern "ReactionEngine|multiple prompt descriptors"
```

Expected: still FAIL until `TestHarness.create(engine)` is wired in Task 3, but provider-specific type errors should be gone.

### Task 3: Simplify `TestHarness` around injected engine and real slash commands

**Files:**
- Modify: `src/test-helpers/harness.ts`
- Delete: `src/test-helpers/reactions.ts`
- Modify: `src/test-helpers/index.ts`
- Test: `src/test-helpers/harness.test.ts`

- [ ] **Step 1: Change `TestHarness.create()` to require a `ReactionEngine`**

Update the static constructor signature and imports in `src/test-helpers/harness.ts`:

```ts
import { FauxProvider, FAUX_MODEL, FAUX_PROVIDER } from './faux-provider.js';
import { ReactionEngine } from './reaction-engine.js';
```

and:

```ts
  static async create(engine: ReactionEngine): Promise<TestHarness> {
```

Then replace `const fauxResponses = new FauxResponseQueue();` with:

```ts
    const fauxProvider = new FauxProvider(engine);
```

and the provider registration with:

```ts
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inline faux provider types don't exactly match ProviderConfig
            streamSimple: fauxProvider.stream as any,
```

- [ ] **Step 2: Remove provider queue state and `prompt(...responses)`**

Delete the `fauxResponses` field from the constructor and class state. Replace:

```ts
  async prompt(text: string, ...responses: ResponseDescriptor[]): Promise<void> {
    this.fauxResponses.enqueue(...responses);
    await this.session.prompt(text, { expandPromptTemplates: false, source: 'test' as InputSource });
    await this.session.agent.waitForIdle();
    this.assertNoQueuedResponses(`prompt(${JSON.stringify(text)})`);
  }
```

with:

```ts
  async prompt(text: string): Promise<void> {
    await this.session.prompt(text, { expandPromptTemplates: false, source: 'test' as InputSource });
    await this.session.agent.waitForIdle();
  }
```

- [ ] **Step 3: Remove `runAuto()` and its state**

Delete these fields and methods from `src/test-helpers/harness.ts`:

```ts
  private activeReactions: NonNullable<AutoConfig['reactions']> | null = null;
  private activeSeenIds: Set<string> | null = null;
  private activeRuntime: ReactionRuntime | null = null;
  async runAuto(config: AutoConfig): Promise<void> { ... }
  private assertNoQueuedResponses(label: string): void { ... }
  function makeUserMessage(text: string) { ... }
```

Keep `FAUX_TEST_USAGE` for now because Task 3 Step 5 reuses it when appending synthetic assistant entries for assistant/queued-task reactions. Remove or relocate it in Task 7 only if it becomes dead.

Also delete the imports of `AutoConfig`, `ResponseDescriptor`, `scanAndReact`, and `ReactionRuntime`.

- [ ] **Step 4: Replace the task workflow methods with one small `pushTask()` helper**

Delete `runStartTask`, `runFinishTask`, `runDiscardTask`, `runAbortTask`, `refreshTaskStatus`, `findPendingTask`, `findCurrentTask`, `findFreshTargetId`, `findLastAssistantMessage`, `findTaskPrompt`, `findLastIndex`, and `makeUserMessage`.

Keep only this helper:

```ts
  async pushTask(prompt_: string, inherit_context = false): Promise<void> {
    this.sessionManager.appendCustomEntry('task', { prompt: prompt_, inherit_context });
    updateTaskStatus(
      this.sessionManager as Parameters<typeof updateTaskStatus>[0],
      (key, value) => {
        if (key === 'task') this.ui.setStatus(key, value);
      },
      this.ui.theme,
    );
    this.ui.notify('Task stored. Use `/start-task` or `/auto` to start it.', 'info');
    await this.session.agent.waitForIdle();
  }
```

- [ ] **Step 5: Rebuild `waitForIdle` around engine scanning with seen-entry tracking**

Add a class field near `cancelNextNav`:

```ts
  private readonly seenReactionEntryIds = new Set<string>();
```

Then replace the `waitForIdle` body inside `commandContextActions()` with:

```ts
      waitForIdle: async () => {
        await this.session.agent.waitForIdle();

        let reacted: boolean;
        do {
          reacted = false;
          for (const entry of this.sessionManager.getBranch()) {
            if (this.seenReactionEntryIds.has(entry.id)) continue;
            this.seenReactionEntryIds.add(entry.id);

            if (entry.type === 'message' && entry.message.role === 'assistant') {
              const text = extractTextContent(entry.message.content, '') ?? '';
              for (const reaction of this.engine.matchAssistant(text)) {
                await this.applyReaction(reaction);
                reacted = true;
              }
              continue;
            }

            if (entry.type === 'custom' && entry.customType === 'task') {
              const data = entry.data as { prompt: string; inherit_context: boolean } | undefined;
              if (!data) continue;
              for (const reaction of this.engine.matchQueuedTask(data.prompt, data.inherit_context)) {
                await this.applyReaction(reaction);
                reacted = true;
              }
            }
          }

          if (reacted) {
            await flushMicrotasks();
          }
        } while (reacted);
      },
```

Add these helper methods to preserve the old response capability for assistant/queued-task rules:

```ts
  private appendSyntheticAssistantMessage(text: string, stopReason: 'stop' | 'aborted' = 'stop'): void {
    this.sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text' as const, text }],
      api: FAUX_MODEL.api,
      provider: FAUX_PROVIDER,
      model: FAUX_MODEL.id,
      usage: FAUX_TEST_USAGE,
      stopReason,
      timestamp: Date.now(),
    } as never);
  }

  private appendSyntheticTask(prompt_: string, inherit_context: boolean): void {
    this.sessionManager.appendCustomEntry('task', { prompt: prompt_, inherit_context });
  }

  private async applyReaction(
    reaction: import('./descriptors.js').ResponseDescriptor | import('./descriptors.js').ControlReactionDescriptor,
  ): Promise<void> {
    if (reaction.type === 'user-esc') {
      this.cancelNextNav = true;
      return;
    }
    if (reaction.type === 'user-ctrl-c') {
      await this.triggerSessionShutdown();
      return;
    }
    if (reaction.type === 'user-runs-auto') {
      await this.prompt('/auto');
      return;
    }
    if (reaction.type === 'user-append') {
      await this.prompt(reaction.text);
      return;
    }
    if (reaction.type === 'response:text') {
      this.appendSyntheticAssistantMessage(reaction.text);
      return;
    }
    if (reaction.type === 'response:thinking') {
      this.appendSyntheticAssistantMessage(reaction.text);
      return;
    }
    if (reaction.type === 'response:aborted') {
      this.appendSyntheticAssistantMessage(reaction.text, 'aborted');
      return;
    }
    this.appendSyntheticTask(reaction.prompt, reaction.inherit_context);
  }
```

Keep `flushMicrotasks()` in `harness.ts` for this task; move or dedupe it only in Task 7.

- [ ] **Step 6: Migrate `src/test-helpers/test-tree.ts` to the new constructor**

Replace the harness construction inside `src/test-helpers/test-tree.ts`:

```ts
const h = await TestHarness.create();
```

with:

```ts
const h = await TestHarness.create(new ReactionEngine());
```

and add:

```ts
import { ReactionEngine } from './reaction-engine.js';
```

This keeps manual tree tests buildable while their nodes start registering reactions directly on `h.engine` in later tasks.

- [ ] **Step 7: Type-check after the harness rewrite**

Run:

```bash
npx tsc --noEmit
```

Expected: FAIL in `manual.test.ts` and `auto.test.ts` because they still call removed methods and old `prompt(...responses)` / `runAuto(...)` APIs.

- [ ] **Step 8: Commit the harness rewrite**

```bash
git add src/test-helpers/harness.ts src/test-helpers/faux-provider.ts src/test-helpers/reaction-engine.ts src/test-helpers/index.ts
git commit -m "test: drive harness through reaction engine"
```

### Task 4: Capture notification levels and finish helper cleanup

**Files:**
- Modify: `src/test-helpers/ui.ts`
- Modify: `src/test-helpers/harness.ts`
- Test: `src/test-helpers/harness.test.ts`

- [ ] **Step 1: Add a failing test for notification levels**

Add to `src/test-helpers/harness.test.ts`:

```ts
it('records notification levels', async () => {
  const engine = new ReactionEngine();
  const h = await TestHarness.create(engine);
  try {
    await h.prompt('/start-task');
    h.assertNotificationEntries([
      { message: 'No pending task. Use push-task first.', level: 'warning' },
    ]);
  } finally {
    h.dispose();
  }
});
```

- [ ] **Step 2: Update `TestUI` to store level with each notification**

Replace the notification storage in `src/test-helpers/ui.ts` with:

```ts
export type TestNotification = {
  message: string;
  level: 'error' | 'warning' | 'info' | undefined;
};

export class TestUI {
  private readonly notificationLog: TestNotification[] = [];
```

and:

```ts
    notify: (message: string, level?: 'error' | 'warning' | 'info') => {
      this.notificationLog.push({ message, level });
    },
```

and:

```ts
  notifications(): readonly TestNotification[] {
    return this.notificationLog;
  }
```

- [ ] **Step 3: Add a structured notification assertion helper**

In `src/test-helpers/harness.ts`, keep `assertNotifications(...expected: string[])` but add:

```ts
  assertNotificationEntries(
    expected: Array<{ message: string; level: 'error' | 'warning' | 'info' | undefined }>,
  ): void {
    assert.deepStrictEqual(this.ui.notifications(), expected);
  }
```

- [ ] **Step 4: Run the focused harness tests**

Run:

```bash
npx tsx --test src/test-helpers/harness.test.ts --test-name-pattern "notification levels|ReactionEngine|multiple prompt descriptors"
```

Expected: PASS.

### Task 5: Migrate `harness.test.ts` to the new engine API and restore the subtask test

**Files:**
- Modify: `src/test-helpers/harness.test.ts`

- [ ] **Step 1: Update construction and simple prompt tests**

For every test in `src/test-helpers/harness.test.ts`, replace:

```ts
const h = await TestHarness.create();
await h.prompt('main work', responds('working...'));
```

with the explicit engine setup:

```ts
const engine = new ReactionEngine();
engine.onPrompt('main work', responds('working...'));
const h = await TestHarness.create(engine);
await h.prompt('main work');
```

- [ ] **Step 2: Add the no-match failure test**

Append:

```ts
it('fails when the faux provider receives an unmatched prompt', async () => {
  const engine = new ReactionEngine();
  const h = await TestHarness.create(engine);
  await assert.rejects(
    async () => h.prompt('unmatched prompt'),
    /No reaction engine rule matched provider prompt/,
  );
  h.dispose();
});
```

- [ ] **Step 3: Add the once-only scan regression test**

Append:

```ts
it('fires assistant and queued-task reactions once per new entry', async () => {
  const engine = new ReactionEngine();
  engine.onPrompt('main work', responds('working...'));
  engine.onAssistant('working...', pushTask('follow-up'));
  engine.onQueuedTask('follow-up', false, responds('queued response'));

  const h = await TestHarness.create(engine);
  try {
    await h.prompt('main work');
    await h.waitForIdle();
    await h.waitForIdle();

    h.assertSessionContains(
      user('main work'),
      assistant('working...'),
      task('follow-up'),
      assistant('queued response'),
    );
  } finally {
    h.dispose();
  }
});
```

Expected behavior: `task('follow-up')` and `assistant('queued response')` appear exactly once even after the second idle wait.

- [ ] **Step 4: Replace the old `/auto`-specific test with engine-based control reactions**

Add:

```ts
it('uses assistant and queued-task rules during /auto', async () => {
  const engine = new ReactionEngine();
  engine.onPrompt('main work', responds('working...'));
  engine.onPrompt('Analyze performance.', responds('Found 3 bottlenecks: ...'));

  const h = await TestHarness.create(engine);
  try {
    await h.prompt('main work');
    await h.pushTask('Analyze performance.');
    await h.prompt('/auto');
    h.assertSessionContains(taskResult('analyze-performance', 'Found 3 bottlenecks: ...'));
  } finally {
    h.dispose();
  }
});
```

- [ ] **Step 5: Restore the skipped subtask auto test here first**

Add:

```ts
it('processes a subtask pushed during a task', async () => {
  const engine = new ReactionEngine();
  engine.onPrompt('main work', responds('working...'));
  engine.onPrompt('parent task', responds('working on parent...'), pushTask('subtask'));
  engine.onPrompt('subtask', responds('sub done'));

  const h = await TestHarness.create(engine);
  try {
    await h.prompt('main work');
    await h.pushTask('parent task');
    await h.prompt('/auto');

    h.assertSessionContains(
      user('subtask'),
      assistant('sub done'),
      taskResult('subtask', 'sub done'),
    );
  } finally {
    h.dispose();
  }
});
```

- [ ] **Step 6: Run all harness tests**

Run:

```bash
npx tsx --test src/test-helpers/harness.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the harness test migration**

```bash
git add src/test-helpers/harness.test.ts src/test-helpers/ui.ts
git commit -m "test: migrate harness tests to reaction engine"
```

### Task 6: Migrate `manual.test.ts` and `auto.test.ts` to the new engine API

**Files:**
- Modify: `src/manual.test.ts`
- Modify: `src/auto.test.ts`
- Modify: `src/test-helpers/test-tree.ts` only if constructor plumbing requires it

- [ ] **Step 1: Add the new imports**

In both `src/manual.test.ts` and `src/auto.test.ts`, import `ReactionEngine`:

```ts
import {
  assistant,
  node,
  pushTask,
  responds,
  task,
  taskResult,
  user,
  ReactionEngine,
} from './test-helpers/index.js';
```

and in `auto.test.ts` also keep any control builders you still need (`userCtrlC`, `userEsc`, `userRunsAuto`, `aborts`).

- [ ] **Step 2: Expose the engine on `TestHarness` for test setup**

In `src/test-helpers/harness.ts`, add a readonly field and constructor parameter so tests can register rules after creation:

```ts
export class TestHarness {
  private constructor(
    readonly engine: ReactionEngine,
    private readonly session: AgentSession,
    private readonly sessionManager: SessionManager,
    private readonly ui: TestUI,
  ) {}
```

and update `create(engine)` to pass it through.

- [ ] **Step 3: Migrate one manual workflow root to prove the pattern**

Replace the first root node in `src/manual.test.ts`:

```ts
node('push AAA', async (h) => {
  await h.prompt('main work', responds('working...'));
  await h.runPushTask('Task AAA');
```

with:

```ts
node('push AAA', async (h) => {
  h.engine.onPrompt('main work', responds('working...'));
  await h.prompt('main work');
  await h.pushTask('Task AAA');
```

and replace all later `runStartTask`, `runFinishTask`, `runDiscardTask`, `runAbortTask` calls with:

```ts
await h.prompt('/start-task');
await h.prompt('/finish-task');
await h.prompt('/discard-task');
await h.prompt('/abort-task');
```

Whenever a command will trigger a model call, register the prompt reaction first, for example:

```ts
h.engine.onPrompt('Task AAA', responds('Done.'));
await h.prompt('/start-task');
await h.prompt('/finish-task');
```

- [ ] **Step 4: Run just the manual tests and fix the rest of the file**

Run:

```bash
npx tsx --test src/manual.test.ts
```

Expected: FAIL until every `run*Task` call is migrated and every command-triggered model call has an engine rule.

Then finish migrating the entire file to this pattern:
- `await h.pushTask(...)` for task creation
- `await h.prompt('/start-task')` for task entry
- register `h.engine.onPrompt('Task ...', responds(...))` before command-triggered model calls
- `await h.prompt('/finish-task')`, `await h.prompt('/abort-task')`, `await h.prompt('/discard-task')`

- [ ] **Step 5: Migrate the automated workflow tests**

In `src/auto.test.ts`, replace:

```ts
await h.prompt('main work', responds('working on main...'));
await h.runPushTask('Analyze performance.');
await h.runAuto({ reactions: [[prompt('Analyze performance.'), responds('Found 3 bottlenecks: ...')]] });
```

with:

```ts
const engine = new ReactionEngine();
engine.onPrompt('main work', responds('working on main...'));
engine.onPrompt('Analyze performance.', responds('Found 3 bottlenecks: ...'));
const h = await TestHarness.create(engine);
await h.prompt('main work');
await h.pushTask('Analyze performance.');
await h.prompt('/auto');
```

For navigation-cancel tests, register:

```ts
engine.onQueuedTask('Analyze performance.', false, userEsc());
```

For shutdown tests, register:

```ts
engine.onAssistant('working...', userCtrlC());
```

For steering tests, register:

```ts
engine.onAssistant('thinking...', { type: 'user-append', text: 'steer it' });
engine.onPrompt('steer it', responds('adjusted response'));
```

- [ ] **Step 6: Restore the skipped auto subtask test**

Put back the old scenario from the legacy suite, now using the engine API:

```ts
it('processes a subtask pushed during a task', async () => {
  const engine = new ReactionEngine();
  engine.onPrompt('main work', responds('working...'));
  engine.onPrompt('parent task', responds('working on parent...'), pushTask('subtask'));
  engine.onPrompt('subtask', responds('sub done'));

  const h = await TestHarness.create(engine);
  try {
    await h.prompt('main work');
    await h.pushTask('parent task');
    await h.prompt('/auto');

    h.assertSessionContains(
      user('subtask'),
      assistant('sub done'),
      taskResult('subtask', 'sub done'),
    );
  } finally {
    h.dispose();
  }
});
```

- [ ] **Step 7: Run the focused migrated suites**

Run:

```bash
npx tsx --test src/manual.test.ts src/auto.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the test migration**

```bash
git add src/manual.test.ts src/auto.test.ts src/test-helpers/harness.ts
git commit -m "test: migrate workflows to engine-driven harness"
```

### Task 7: Final cleanup, deletion, and verification

**Files:**
- Delete: `src/test-helpers/reactions.ts`
- Modify: `src/test-helpers/index.ts`
- Modify: `src/test-helpers/faux-provider.ts`
- Modify: `src/test-helpers/harness.ts`
- Modify: `src/text-content.ts` if `makeSlug` re-export is no longer needed

- [ ] **Step 1: Remove dead imports and exports**

Run:

```bash
rg "runAuto\(|runStartTask\(|runFinishTask\(|runDiscardTask\(|runAbortTask\(|prompt\(|queuedTask\(" src
```

Expected: only the new `h.prompt(...)` calls remain; no old helper APIs or removed matcher builders should appear.

Then remove any dead exports/imports accordingly.

- [ ] **Step 2: Delete `src/test-helpers/reactions.ts`**

Run:

```bash
rm src/test-helpers/reactions.ts
```

Expected: command exits 0.

- [ ] **Step 3: Clean `src/text-content.ts` if `makeSlug` is no longer imported from there**

If `rg "makeSlug" src/test-helpers src/manual.test.ts src/auto.test.ts` no longer shows `../text-content.js` consumers, remove:

```ts
export { makeSlug } from './slug.js';
```

from `src/text-content.ts`.

- [ ] **Step 4: Run type-check and full tests**

Run:

```bash
npx tsc --noEmit
npm test
```

Expected: PASS.

- [ ] **Step 5: Run lint autofix and verify**

Run:

```bash
npm run fix
npm run verify
```

Expected: both PASS.

- [ ] **Step 6: Commit the cleanup**

```bash
git add -A src docs/superpowers/specs
git commit -m "test: finish reaction engine follow-up"
```

Expected: commit succeeds.

## Self-Review

- **Spec coverage:** This plan covers the full approved spec: new `ReactionEngine`, provider integration, one-turn multi-descriptor responses, command-driven task flow, restored subtask auto test, notification levels, polling removal, and cleanup of the old scanner.
- **Placeholder scan:** No TODO/TBD markers remain. The only implementation choices left are explicitly resolved in the steps.
- **Type consistency:** `ReactionEngine.onPrompt()` accepts only `ResponseDescriptor[]`; `onAssistant()` and `onQueuedTask()` accept response/control reactions; `TestHarness.create(engine)` is the only constructor path.
- **Buildability:** Each task leaves the repository in a sensible state with focused tests before moving to broader migration.

Plan complete and saved to `docs/superpowers/plans/2026-05-31-reaction-engine-and-review-followup.md`. Ready to execute it using /skill:executing-plans?