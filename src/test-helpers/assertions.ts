import assert from "node:assert";
import { isDeepStrictEqual } from "node:util";

import type {
  SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import { extractTextContent } from "../text-content.js";
import {
  assistant,
  task,
  taskResult,
  user,
  type BranchEntry,
} from "./descriptors.js";

export function assertBranchHistory(
  sessionManager: SessionManager,
  expected: BranchEntry[],
): void {
  assert.deepStrictEqual(visibleEntries(sessionManager.getBranch()), expected);
}

export function assertSessionContains(
  sessionManager: SessionManager,
  expected: BranchEntry[],
): void {
  const actual = visibleEntries(sessionManager.getEntries());

  for (const expectedEntry of expected) {
    assert.ok(
      actual.some((entry) => isDeepStrictEqual(entry, expectedEntry)),
      `Expected session to contain entry: ${JSON.stringify(expectedEntry)}`,
    );
  }
}

function visibleEntries(entries: SessionEntry[]): BranchEntry[] {
  return entries
    .map(toBranchEntry)
    .filter((entry): entry is BranchEntry => entry !== null);
}

function toBranchEntry(entry: SessionEntry): BranchEntry | null {
  switch (entry.type) {
    case "thinking_level_change":
    case "model_change":
    case "session_info":
    case "label":
      return null;
    case "message":
      if (entry.message.role === "user") {
        return user(textContent(entry.message.content));
      }
      if (entry.message.role === "assistant") {
        return assistant(
          textContent(entry.message.content),
          visibleStopReason(entry.message.stopReason),
        );
      }
      return null;
    case "custom":
      return entry.customType === "task" && isTaskData(entry.data)
        ? task(entry.data.prompt, entry.data.inherit_context)
        : null;
    case "custom_message":
      if (entry.customType !== "task-result" || !hasSlug(entry.details)) {
        return null;
      }
      return taskResult(
        entry.details.slug,
        textContent(entry.content) || undefined,
      );
    default:
      return null;
  }
}

function textContent(content: unknown): string {
  return extractTextContent(content, "") ?? "";
}

function visibleStopReason(stopReason: unknown): string | undefined {
  return typeof stopReason === "string" && stopReason !== "stop"
    ? stopReason
    : undefined;
}

function isTaskData(
  value: unknown,
): value is { prompt: string; inherit_context: boolean } {
  return (
    isRecord(value) &&
    typeof value.prompt === "string" &&
    typeof value.inherit_context === "boolean"
  );
}

function hasSlug(value: unknown): value is { slug: string } {
  return isRecord(value) && typeof value.slug === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
