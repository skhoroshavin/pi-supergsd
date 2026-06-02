import { stripVTControlCharacters } from "node:util";

import { Theme } from "@earendil-works/pi-coding-agent";

import type {
  ExtensionUIContext,
  SessionEntry as PiSessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import { extractTextContent, type TextBlock } from "../text-content.js";

export class TestSession {
  constructor(private readonly sessionManager: SessionManager) {}

  #lastNotification: string | undefined;
  #lastStatus: string | undefined;

  readonly context: ExtensionUIContext = {
    ...noOpContext,
    notify: (message: string) => {
      const nextNotification = plainText(message).trim();
      this.#lastNotification = nextNotification === "" ? undefined : nextNotification;
    },
    setStatus: (key: string, value: string | undefined) => {
      if (key !== "task") return;
      this.#lastStatus = value === undefined ? undefined : plainText(value);
    },
  };

  entries(): SessionEntry[] {
    return sessionEntries(this.sessionManager.getBranch());
  }

  allEntries(): SessionEntry[] {
    return sessionEntries(this.sessionManager.getEntries());
  }

  get lastStatus(): string | undefined {
    return this.#lastStatus;
  }

  get lastNotification(): string | undefined {
    return this.#lastNotification;
  }
}

export type SessionEntry =
  | ReturnType<typeof user>
  | ReturnType<typeof assistant>
  | ReturnType<typeof task>
  | ReturnType<typeof taskResult>;

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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sessionEntries(entries: PiSessionEntry[]): SessionEntry[] {
  const result: SessionEntry[] = [];

  for (const entry of entries) {
    switch (entry.type) {
      case "thinking_level_change":
      case "model_change":
      case "session_info":
      case "label":
        break;
      case "message":
        if (entry.message.role === "user") {
          result.push(user(textContent(entry.message.content)));
        } else if (entry.message.role === "assistant") {
          result.push(
            assistant(
              textContent(entry.message.content),
              visibleStopReason(entry.message.stopReason),
            ),
          );
        }
        break;
      case "custom":
        if (entry.customType === "task" && isTaskData(entry.data)) {
          result.push(task(entry.data.prompt, entry.data.inherit_context));
        }
        break;
      case "custom_message":
        if (entry.customType === "task-result" && hasSlug(entry.details)) {
          result.push(taskResult(entry.details.slug, textContent(entry.content) || undefined));
        }
        break;
    }
  }

  return result;
}

function plainText(value: string): string {
  return stripVTControlCharacters(value);
}

const textBlock = (text: string): TextBlock => ({ type: "text", text });

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
