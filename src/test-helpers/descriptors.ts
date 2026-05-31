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

export type ResponseDescriptor =
  | RespondsDescriptor
  | ThinksDescriptor
  | AbortsDescriptor
  | PushTaskDescriptor;

export type RespondsDescriptor = ReturnType<typeof responds>;

export type ThinksDescriptor = ReturnType<typeof thinks>;

export type AbortsDescriptor = ReturnType<typeof aborts>;

export type PushTaskDescriptor = ReturnType<typeof pushTask>;

export type ControlReactionDescriptor =
  | ReturnType<typeof userEsc>
  | ReturnType<typeof userCtrlC>
  | ReturnType<typeof userRunsAuto>
  | { type: "user-append"; text: string };

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

export const responds = (text: string) => ({
  type: "response:text" as const,
  text,
});

export const thinks = (text: string) => ({
  type: "response:thinking" as const,
  text,
});

export const aborts = (text: string) => ({
  type: "response:aborted" as const,
  text,
});

export const pushTask = (prompt: string, inherit_context = false) => ({
  type: "response:push-task" as const,
  prompt,
  inherit_context,
});

export const userEsc = () => ({ type: "user-esc" as const });

export const userCtrlC = () => ({ type: "user-ctrl-c" as const });

export const userRunsAuto = () => ({ type: "user-runs-auto" as const });

export function assumeCommandContext<T extends object>(
  value: T,
): ExtensionCommandContext & T {
  return value as unknown as ExtensionCommandContext & T;
}

const textBlock = (text: string): TextBlock => ({ type: "text", text });
