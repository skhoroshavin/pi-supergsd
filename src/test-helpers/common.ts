export {
  assistant,
  user,
  task,
  taskResult,
  userEsc,
  userCtrlC,
  userRunsAuto,
  notification,
};

import type {
  ExtensionAPI,
  SessionEntry,
} from '@earendil-works/pi-coding-agent';

const assistant = (content: string, stopReason?: string) => ({
  type: 'message' as const,
  message: {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text: content }],
    ...(stopReason ? { stopReason } : {}),
  }
}) as unknown as Partial<BranchEntry>;

const user = (content: string) => ({
  type: 'message' as const,
  message: { role: 'user' as const, content: [{ type: 'text', text: content }] }
}) as unknown as Partial<BranchEntry>;

const task = (prompt: string, inherit_context = false) => ({
  type: 'custom' as const,
  customType: 'task',
  data: { prompt, inherit_context }
}) as unknown as Partial<BranchEntry>;

const taskResult = (slug: string, content?: string) => ({
  type: 'custom_message' as const,
  customType: 'task-result',
  details: { slug },
  ...(content !== undefined ? { content: [{ type: 'text' as const, text: content }] } : {}),
}) as unknown as Partial<BranchEntry>;

const userEsc = () => ({ type: 'user-esc' as const });

const userCtrlC = () => ({ type: 'user-ctrl-c' as const });

const userRunsAuto = () => ({ type: 'user-runs-auto' as const });

const notification = (text: string) => ({
  type: 'notification' as const,
  text,
  afterEntryId: null as string | null
}) as unknown as Partial<BranchEntry>;

export type BranchEntry = SessionEntry | NotificationEntry;

export type NotificationEntry = {
  type: 'notification';
  text: string;
  afterEntryId: string | null;
};

export interface AutoConfig {
  reactions?: Array<[MatchDescriptor, ReactionDescriptor]>;
}

/** Entry kinds that can appear in a reaction pair's match slot. */
export type MatchDescriptor =
  | Partial<BranchEntry>;

/** Entry kinds that can appear in a reaction pair's reaction slot. */
export type ReactionDescriptor =
  | Partial<BranchEntry>
  | { type: 'user-esc' }
  | { type: 'user-ctrl-c' }
  | { type: 'user-runs-auto' }
  ;

export interface HarnessImplementation {
  createPushTaskTool: (pi: ExtensionAPI) => unknown;
  createStartTaskCommand: (pi: ExtensionAPI) => unknown;
  createFinishTaskCommand: (pi: ExtensionAPI) => unknown;
  createDiscardTaskCommand: (pi: ExtensionAPI) => unknown;
  createAbortTaskCommand: () => unknown;
  createAutoCommand: (pi: ExtensionAPI) => unknown;
}
