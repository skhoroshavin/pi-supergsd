import { stripVTControlCharacters } from "node:util";

import { Theme } from "@earendil-works/pi-coding-agent";

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export class TestUi {
  #lastNotification: string | undefined;
  #lastStatus: string | undefined;

  readonly context: ExtensionUIContext = {
    ...noOpContext,
    notify: (message: string) => {
      this.#lastNotification = normalizeText(message);
    },
    setStatus: (key: string, value: string | undefined) => {
      if (key !== "task") return;
      this.#lastStatus = normalizeText(value);
    },
  };

  get lastStatus(): string | undefined {
    return this.#lastStatus;
  }

  get lastNotification(): string | undefined {
    return this.#lastNotification;
  }
}

function normalizeText(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  const result = stripVTControlCharacters(value).trim();
  return result === "" ? undefined : result;
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
