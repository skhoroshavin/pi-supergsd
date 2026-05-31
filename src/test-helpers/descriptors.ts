import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { TextBlock } from "../text-content.js";

export type BranchEntry =
  | UserEntry
  | AssistantEntry
  | TaskEntry
  | TaskResultEntry;

export type AssistantEntry = ReturnType<typeof assistant>;

export type UserEntry = ReturnType<typeof user>;

export type TaskEntry = ReturnType<typeof task>;

export type TaskResultEntry = ReturnType<typeof taskResult>;

export const assistant = (content: string, stopReason?: string) => ({
  type: "message" as const,
  message: {
    role: "assistant" as const,
    content: [textBlock(content)],
    ...(stopReason ? { stopReason } : {}),
  },
});

export const user = (content: string) => ({
  type: "message" as const,
  message: {
    role: "user" as const,
    content: [textBlock(content)],
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

export function assumeCommandContext<T extends object>(
  value: T,
): ExtensionCommandContext & T {
  return value as unknown as ExtensionCommandContext & T;
}

const textBlock = (text: string): TextBlock => ({ type: "text", text });
