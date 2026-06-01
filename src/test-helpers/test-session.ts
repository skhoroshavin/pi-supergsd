import { stripVTControlCharacters } from "node:util";

import { Theme } from "@earendil-works/pi-coding-agent";

import type {
  ExtensionCommandContext,
  ExtensionUIContext,
  SessionEntry as PiSessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import { extractTextContent, type TextBlock } from "../text-content.js";

// ---------------------------------------------------------------------------
// Compatibility utility
// ---------------------------------------------------------------------------

export function assumeCommandContext<T extends object>(value: T): ExtensionCommandContext & T {
  return value as unknown as ExtensionCommandContext & T;
}

// ---------------------------------------------------------------------------
// TestSession — canonical visible-session model
// ---------------------------------------------------------------------------

export class TestSession {
  constructor(private readonly sessionManager: SessionManager) {}

  readonly taskStatusHistory: Array<string | undefined> = [];

  #lastNotification: TrackedNotification | undefined;

  #status: string | undefined;

  readonly context: ExtensionUIContext = {
    ...noOpContext,
    notify: (message: string) => {
      this.#lastNotification = {
        message: plainText(message),
        anchorEntryId: this.sessionManager.getLeafId()!,
      };
    },
    setStatus: (key: string, value: string | undefined) => {
      if (key !== "task") return;
      const nextValue = value === undefined ? undefined : plainText(value);
      this.#status = nextValue;
      this.taskStatusHistory.push(nextValue);
    },
  };

  entries(): SessionEntry[] {
    const branch = this.sessionManager.getBranch();
    const merged: SessionEntry[] = durableEntries(branch);
    if (!this.#lastNotification) return merged;

    const { anchorEntryId, message } = this.#lastNotification;

    // Only show if no durable entries exist after the anchor.
    const anchorIdx = branch.findIndex((e) => e.id === anchorEntryId);
    if (anchorIdx < 0) return merged;

    const hasLaterVisible = branch.slice(anchorIdx + 1).some((e) => toDurableEntry(e) !== null);
    if (!hasLaterVisible) merged.push(notification(message));
    return merged;
  }

  get status(): string | undefined {
    return this.#status;
  }
}

// ---------------------------------------------------------------------------
// Durable-entry projection helper
// ---------------------------------------------------------------------------

export function durableEntries(entries: PiSessionEntry[]): DurableSessionEntry[] {
  return entries
    .map(toDurableEntry)
    .filter((entry): entry is DurableSessionEntry => entry !== null);
}

export type DurableSessionEntry = Exclude<SessionEntry, NotificationEntry>;

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
  anchorEntryId: string;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function plainText(value: string): string {
  return stripVTControlCharacters(value);
}

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

// ---------------------------------------------------------------------------
// TestSession — canonical visible-session model
// ---------------------------------------------------------------------------

const noOpContext: ExtensionUIContext = {
  async select() {
    return undefined;
  },
  async confirm() {
    return false;
  },
  async input() {
    return undefined;
  },
  notify() {},
  onTerminalInput() {
    return () => {};
  },
  setStatus() {},
  setWorkingMessage() {},
  setWorkingVisible() {},
  setWorkingIndicator() {},
  setHiddenThinkingLabel() {},
  setWidget() {},
  setFooter() {},
  setHeader() {},
  setTitle() {},
  async custom() {
    return undefined as never;
  },
  pasteToEditor() {},
  setEditorText() {},
  getEditorText() {
    return "";
  },
  async editor() {
    return undefined;
  },
  addAutocompleteProvider() {},
  setEditorComponent() {},
  getEditorComponent() {
    return undefined;
  },
  theme: new Theme(
    {
      accent: 0,
      border: 0,
      borderAccent: 0,
      borderMuted: 0,
      success: 0,
      error: 0,
      warning: 0,
      muted: 0,
      dim: 0,
      text: 0,
      thinkingText: 0,
      userMessageText: 0,
      customMessageText: 0,
      customMessageLabel: 0,
      toolTitle: 0,
      toolOutput: 0,
      mdHeading: 0,
      mdLink: 0,
      mdLinkUrl: 0,
      mdCode: 0,
      mdCodeBlock: 0,
      mdCodeBlockBorder: 0,
      mdQuote: 0,
      mdQuoteBorder: 0,
      mdHr: 0,
      mdListBullet: 0,
      toolDiffAdded: 0,
      toolDiffRemoved: 0,
      toolDiffContext: 0,
      syntaxComment: 0,
      syntaxKeyword: 0,
      syntaxFunction: 0,
      syntaxVariable: 0,
      syntaxString: 0,
      syntaxNumber: 0,
      syntaxType: 0,
      syntaxOperator: 0,
      syntaxPunctuation: 0,
      thinkingOff: 0,
      thinkingMinimal: 0,
      thinkingLow: 0,
      thinkingMedium: 0,
      thinkingHigh: 0,
      thinkingXhigh: 0,
      bashMode: 0,
    },
    {
      selectedBg: 0,
      userMessageBg: 0,
      customMessageBg: 0,
      toolPendingBg: 0,
      toolSuccessBg: 0,
      toolErrorBg: 0,
    },
    "truecolor",
  ),
  getAllThemes() {
    return [];
  },
  getTheme() {
    return undefined;
  },
  setTheme() {
    return { success: false, error: "Theme switching not supported in tests." };
  },
  getToolsExpanded() {
    return false;
  },
  setToolsExpanded() {},
};
