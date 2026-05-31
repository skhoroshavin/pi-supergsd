import {
  SessionManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import { extractTextContent as readTextContent } from "../text-content.js";

export class PiStub implements Partial<ExtensionAPI> {
  constructor(private readonly sessionManager: SessionManager) {}

  private readonly sessionShutdownHandlers: Array<() => unknown> = [];
  private readonly triggeredCustomMessages = new Set<string>();
  private readonly triggeredUserMessages = new Set<string>();

  readonly on: ExtensionAPI["on"] = ((
    eventName: string,
    handler: () => unknown,
  ) => {
    if (eventName === "session_shutdown")
      this.sessionShutdownHandlers.push(handler);
  }) as ExtensionAPI["on"];

  appendEntry(customType: string, data?: unknown): void {
    this.sessionManager.appendCustomEntry(customType, data);
  }

  sendUserMessage(
    content: Parameters<ExtensionAPI["sendUserMessage"]>[0],
  ): void {
    const text = extractContentText(content) ?? "";
    this.sessionManager.appendMessage(makeUserMessage(text, Date.now()));
    this.recordLastEntry(this.triggeredUserMessages);
  }

  sendMessage(
    message: Parameters<ExtensionAPI["sendMessage"]>[0],
    options?: Parameters<ExtensionAPI["sendMessage"]>[1],
  ): void {
    this.sessionManager.appendCustomMessageEntry(
      message.customType,
      message.content,
      message.display ?? true,
      message.details,
    );

    if (options?.triggerTurn) {
      this.recordLastEntry(this.triggeredCustomMessages);
    }
  }

  isTriggeredCustomMessage(entryId: string): boolean {
    return this.triggeredCustomMessages.has(entryId);
  }

  isTriggeredUserMessage(entryId: string): boolean {
    return this.triggeredUserMessages.has(entryId);
  }

  triggerSessionShutdown(): void {
    for (const handler of this.sessionShutdownHandlers) {
      handler();
    }
  }

  private recordLastEntry(target: Set<string>): void {
    const branch = this.sessionManager.getBranch();
    const last = branch[branch.length - 1];
    if (last) target.add(last.id);
  }
}

export function makeUserMessage(text: string, timestamp = 0): AppendedMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp };
}

export function extractContentText(content: unknown): string | null {
  return readTextContent(content, "");
}

type AppendedMessage = Parameters<SessionManager["appendMessage"]>[0];
