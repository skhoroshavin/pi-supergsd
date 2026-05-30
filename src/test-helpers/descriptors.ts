import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';

export type BranchEntry = UserEntry | AssistantEntry | TaskEntry | TaskResultEntry | NotificationEntry;

export type NotificationEntry = {
  type: 'notification';
  text: string;
  afterEntryId: string | null;
};

export interface AutoConfig {
  reactions?: Array<[MatchDescriptor, ReactionDescriptor]>;
}

/** Entry kinds that can appear in a reaction pair's match slot. */
export type MatchDescriptor = UserEntry | AssistantEntry | TaskEntry;

/** Entry kinds that can appear in a reaction pair's reaction slot. */
export type ReactionDescriptor =
  | UserEntry
  | AssistantEntry
  | TaskEntry
  | { type: 'user-esc' }
  | { type: 'user-ctrl-c' }
  | { type: 'user-runs-auto' };

export {
  assistant,
  user,
  task,
  taskResult,
  userEsc,
  userCtrlC,
  userRunsAuto,
  notification,
  assumeCommandContext,
};

const assistant = (content: string, stopReason?: string): AssistantEntry => ({
  type: 'message',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    ...(stopReason ? { stopReason } : {}),
  },
});

type AssistantEntry = {
  type: 'message';
  message: {
    role: 'assistant';
    content: TextBlock[];
    stopReason?: string;
  };
};

const user = (content: string): UserEntry => ({
  type: 'message',
  message: {
    role: 'user',
    content: [{ type: 'text', text: content }],
  },
});

type UserEntry = {
  type: 'message';
  message: {
    role: 'user';
    content: TextBlock[];
  };
};

const task = (prompt: string, inherit_context = false): TaskEntry => ({
  type: 'custom',
  customType: 'task',
  data: { prompt, inherit_context },
});

type TaskEntry = {
  type: 'custom';
  customType: 'task';
  data: {
    prompt: string;
    inherit_context: boolean;
  };
};

const taskResult = (slug: string, content?: string): TaskResultEntry => ({
  type: 'custom_message',
  customType: 'task-result',
  details: { slug },
  ...(content !== undefined ? { content: [{ type: 'text', text: content }] } : {}),
});

type TaskResultEntry = {
  type: 'custom_message';
  customType: 'task-result';
  details: {
    slug: string;
  };
  content?: TextBlock[];
};

type TextBlock = {
  type: 'text';
  text: string;
};

const userEsc = (): { type: 'user-esc' } => ({ type: 'user-esc' });

const userCtrlC = (): { type: 'user-ctrl-c' } => ({ type: 'user-ctrl-c' });

const userRunsAuto = (): { type: 'user-runs-auto' } => ({ type: 'user-runs-auto' });

const notification = (text: string): NotificationEntry => ({
  type: 'notification',
  text,
  afterEntryId: null,
});

function assumeCommandContext<T extends object>(value: T): ExtensionCommandContext & T {
  return value as unknown as ExtensionCommandContext & T;
}