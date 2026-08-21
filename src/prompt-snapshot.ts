/**
 * Overseer prompt-snapshot store for the push-task lifecycle.
 *
 * When a task is pushed, the agent navigates away from the overseer branch to a
 * fresh context. Returning via `/finish-task` (or `/abort-task`) rebuilds the
 * request from the *current* session/extension state, which may have drifted
 * during the task excursion (tool selection, skills, project context, or
 * other prompt-construction inputs). That changes the model-visible system
 * prefix on the first returned request, breaking byte-stability of the
 * unchanged conversation prefix (and any prefix/radix-cache reuse that depends
 * on it).
 *
 * This module snapshots the overseer's system prompt at task departure
 * (`startTask`) and restores it once, on the first provider request after
 * returning from the task. The restore is applied via the
 * `before_provider_request` payload because the task-return turn is triggered
 * with `sendMessage(..., { triggerTurn: true })`, which bypasses
 * `before_agent_start`. The snapshot lifetime is limited to the push-task
 * excursion: the restore is one-shot and does not pin the prompt for later
 * turns.
 */

export interface OverseerPromptSnapshot {
  /** Overseer branch leaf the snapshot was captured at (== task `returnTo`). */
  leafId: string;
  /** The exact system prompt string to restore verbatim on return. */
  systemPrompt: string;
  capturedAt: number;
}

/**
 * Capture the current overseer system prompt at task departure.
 * Call from `startTask` before navigating to the fresh task context.
 */
export function captureAtDeparture(leafId: string, systemPrompt: string): void {
  if (!leafId) return;
  snapshots.set(leafId, { leafId, systemPrompt, capturedAt: Date.now() });

  // Bound the store: snapshots are short-lived, the cap guards pathological
  // long sessions with many distinct leaves.
  if (snapshots.size > 32) {
    const oldest = snapshots.keys().next().value;
    if (oldest !== undefined) snapshots.delete(oldest);
  }
}

/**
 * Arm a one-shot restore of the overseer snapshot for a task's `returnTo` leaf.
 * Call from `finishTask`/`abortTask` after `navigateTree(returnTo)` succeeds.
 *
 * Returns true when a snapshot existed and the restore was armed.
 */
export function armTaskRestore(returnToLeafId: string): boolean {
  const snapshot = snapshots.get(returnToLeafId);
  if (!snapshot) return false;
  pendingRestore = snapshot;
  return true;
}

/**
 * Consume the armed restore and apply it to a provider payload, if any.
 * Call from a `before_provider_request` handler.
 *
 * Returns the (possibly replaced) payload to use for the request, or
 * undefined when no restore is armed (leave the payload untouched).
 */
export function applyTaskRestoreToPayload(payload: unknown): unknown | undefined {
  if (!pendingRestore) return undefined;
  const snapshot = pendingRestore;
  pendingRestore = null;
  return replaceSystemPromptInPayload(payload, snapshot.systemPrompt);
}

/** Drop all snapshots and any armed restore (session shutdown / restart). */
export function clearPromptSnapshots(): void {
  snapshots.clear();
  pendingRestore = null;
}

/**
 * Replace the system prompt in a provider request body, across the common
 * provider payload shapes. Unknown shapes are returned untouched so the
 * restore degrades to a no-op rather than corrupting an unfamiliar payload.
 */
function replaceSystemPromptInPayload(payload: unknown, systemPrompt: string): unknown {
  if (!isRecord(payload)) return payload;

  // OpenAI-compatible shape: the system prompt rides the messages array as the
  // first system/developer message.
  if (Array.isArray(payload.messages)) {
    const messages = payload.messages as Array<Record<string, unknown>>;
    const index = messages.findIndex(
      (m) => isRecord(m) && (m.role === "system" || m.role === "developer"),
    );
    if (index !== -1) {
      const next = { ...payload, messages: [...messages] };
      next.messages[index] = { ...messages[index], content: systemPrompt };
      return next;
    }
  }

  // Anthropic shape: a top-level `system` field.
  if ("system" in payload) return { ...payload, system: systemPrompt };

  // OpenAI Responses shape: an `instructions` field.
  if ("instructions" in payload) return { ...payload, instructions: systemPrompt };

  return payload;
}

// ── Module state (read-friendly: declared after its consumers) ──────────────

// Keyed by the overseer leaf we departed from (== the task's `returnTo`).
const snapshots = new Map<string, OverseerPromptSnapshot>();

// A single armed, one-shot restore. Set on finish/abort, consumed by the next
// provider request. Only one task excursion is in flight at a time per branch.
let pendingRestore: OverseerPromptSnapshot | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
