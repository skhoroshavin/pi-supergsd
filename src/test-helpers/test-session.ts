import type {
  ExtensionCommandContext,
  ExtensionUIContext,
  SessionEntry as PiSessionEntry,
  SessionManager,
  Theme,
} from "@earendil-works/pi-coding-agent";

import { extractTextContent, type TextBlock } from "../text-content.js";

// ---------------------------------------------------------------------------
// Compatibility utility
// ---------------------------------------------------------------------------

export function assumeCommandContext<T extends object>(value: T): ExtensionCommandContext & T {
  return value as unknown as ExtensionCommandContext & T;
}

// ---------------------------------------------------------------------------
// Durable-entry projection helper
// ---------------------------------------------------------------------------

export function durableEntries(entries: PiSessionEntry[]): DurableSessionEntry[] {
  return entries.map(toDurableEntry).filter((entry): entry is DurableSessionEntry => entry !== null);
}

export type DurableSessionEntry = Exclude<SessionEntry, NotificationEntry>;

// ---------------------------------------------------------------------------
// TestSession — canonical visible-session model
// ---------------------------------------------------------------------------

export class TestSession {
  constructor(private readonly sessionManager: SessionManager) {}

  readonly taskStatusHistory: Array<string | undefined> = [];

  readonly theme = {
    fg: (_key: string, text: string) => text,
    bg: (_key: string, text: string) => text,
    bold: (text: string) => text,
  } satisfies Pick<Theme, "fg" | "bg" | "bold">;

  #notifications: TrackedNotification[] = [];

  #status: string | undefined;

  readonly context: ExtensionUIContext = {
    notify: (message: string) => {
      this.#notifications.push({
        message,
        anchorEntryId: this.sessionManager.getLeafId(),
      });
    },
    setStatus: (key: string, value: string | undefined) => {
      if (key !== "task") return;
      this.#status = value;
      this.taskStatusHistory.push(value);
    },
    theme: this.theme,
  } as ExtensionUIContext;

  entries(): SessionEntry[] {
    // Group tracked notifications by their anchor entry id.
    const notificationsByAnchor = new Map<string | null, NotificationEntry[]>();
    for (const item of this.#notifications) {
      const list = notificationsByAnchor.get(item.anchorEntryId) ?? [];
      list.push(notification(item.message));
      notificationsByAnchor.set(item.anchorEntryId, list);
    }

    // Merge: null-anchor notifications first, then branch entries with their
    // anchored notifications interleaved.
    const merged: SessionEntry[] = [...(notificationsByAnchor.get(null) ?? [])];
    for (const rawEntry of this.sessionManager.getBranch()) {
      const visible = toDurableEntry(rawEntry);
      if (visible) merged.push(visible);
      merged.push(...(notificationsByAnchor.get(rawEntry.id) ?? []));
    }
    return merged;
  }

  get status(): string | undefined {
    return this.#status;
  }
}

export type SessionEntry =
  | ReturnType<typeof user>
  | ReturnType<typeof assistant>
  | ReturnType<typeof task>
  | ReturnType<typeof taskResult>
  | NotificationEntry;

// ---------------------------------------------------------------------------
// Descriptor constructors
// ---------------------------------------------------------------------------

export const user = (content: string) => ({
  type: "message" as const,
  message: {
    role: "user" as const,
    content: [textBlock(content)],
  },
});

export const assistant = (content: string, stopReason?: string) => ({
  type: "message" as const,
  message: {
    role: "assistant" as const,
    content: [textBlock(content)],
    ...(stopReason ? { stopReason } : {}),
  },
});

export const task = (prompt: string, inherit_context = false) => ({
  type: "custom" as const,
  customType: "task" as const,
  data: { prompt, inherit_context },
});

export const taskResult = (slug: string, content?: string) => ({
  type: "custom_message" as const,
  customType: "task-result" as const,
  details: { slug },
  ...(content !== undefined ? { content: [textBlock(content)] } : {}),
});

export const notification = (message: string): NotificationEntry => ({
  type: "notification",
  message,
});

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type NotificationEntry = { type: "notification"; message: string };

// ---------------------------------------------------------------------------
// Tracked notification (internal, not exported)
// ---------------------------------------------------------------------------

type TrackedNotification = {
  message: string;
  anchorEntryId: string | null;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const textBlock = (text: string): TextBlock => ({ type: "text", text });

function toDurableEntry(entry: PiSessionEntry): DurableSessionEntry | null {
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
        return assistant(textContent(entry.message.content), visibleStopReason(entry.message.stopReason));
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
      return taskResult(entry.details.slug, textContent(entry.content) || undefined);
    default:
      return null;
  }
}

function textContent(content: unknown): string {
  return extractTextContent(content, "") ?? "";
}

function visibleStopReason(stopReason: unknown): string | undefined {
  return typeof stopReason === "string" && stopReason !== "stop" ? stopReason : undefined;
}

function isTaskData(value: unknown): value is { prompt: string; inherit_context: boolean } {
  return isRecord(value) && typeof value.prompt === "string" && typeof value.inherit_context === "boolean";
}

function hasSlug(value: unknown): value is { slug: string } {
  return isRecord(value) && typeof value.slug === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
