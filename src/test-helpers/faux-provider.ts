/**
 * Inline type definitions for the minimal subset of @earendil-works/pi-ai types
 * needed by the faux provider. Using inline types avoids a direct dependency on
 * @earendil-works/pi-ai which is nested under pi-coding-agent's node_modules.
 */

/* ─── Minimal pi-ai type subset ─── */

/* ─── Descriptor types ─── */

import type { ResponseDescriptor } from './descriptors.js';

export const FAUX_PROVIDER = 'supergsd-test';

export const FAUX_MODEL_ID = 'deterministic';

export const FAUX_MODEL: Model = {
  id: FAUX_MODEL_ID,
  name: 'Deterministic Test Model',
  api: 'supergsd-test-api',
  provider: FAUX_PROVIDER,
  baseUrl: 'memory://supergsd-test',
  reasoning: true,
  thinkingLevelMap: { off: null, low: 'low', medium: 'medium', high: 'high' },
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 4096,
};

export class FauxResponseQueue {
  private readonly queued: ResponseDescriptor[] = [];
  private callCount = 0;
  private readonly seenPrompts: string[] = [];

  enqueue(...responses: ResponseDescriptor[]): void {
    this.queued.push(...responses);
  }

  remaining(): readonly ResponseDescriptor[] {
    return this.queued;
  }

  prompts(): readonly string[] {
    return this.seenPrompts;
  }

  stream = (_model: Model, context: Context): FauxEventStream => {
    const stream = new FauxEventStream();
    const descriptor = this.queued.shift();
    const lastUser = [...context.messages].reverse().find(message => message.role === 'user');
    if (lastUser) this.seenPrompts.push(readUserText(lastUser.content));

    queueMicrotask(() => {
      if (!descriptor) {
        const error = makeAssistantMessage(
          [],
          'error',
          `No faux response queued for provider call ${this.callCount + 1}`,
        );
        stream.push({ type: 'error', reason: 'error' as const, error });
        stream.end(error);
        return;
      }

      this.callCount++;
      emitDescriptor(stream, descriptor, this.callCount);
    });

    return stream;
  };
}

/**
 * Minimal event stream that satisfies the AssistantMessageEventStream interface
 * (push, end, [Symbol.asyncIterator], result) without importing from
 * @earendil-works/pi-ai at runtime.
 */
export class FauxEventStream {
  private readonly queue: AssistantMessageEvent[] = [];
  private waiting: Array<(event: AssistantMessageEvent) => void> = [];
  private done = false;
  private finalResult: AssistantMessage | undefined;

  push(event: AssistantMessageEvent): void {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      resolve(event);
    } else {
      this.queue.push(event);
    }
  }

  end(result: AssistantMessage): void {
    this.done = true;
    this.finalResult = result;
    for (const resolve of this.waiting) {
      resolve({
        type: 'done',
        reason: result.stopReason === 'toolUse' ? 'toolUse' : 'stop',
        message: result,
      } as AssistantMessageEvent);
    }
    this.waiting = [];
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    while (!this.done || this.queue.length > 0) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        break;
      } else {
        yield await new Promise<AssistantMessageEvent>(resolve => {
          this.waiting.push(resolve);
        });
      }
    }
  }

  async result(): Promise<AssistantMessage> {
    while (!this.done) {
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
    return this.finalResult!;
  }
}

interface Context {
  systemPrompt?: string;
  messages: { role: string; content: string | TextContent[] }[];
}

type AssistantMessageEvent =
  | { type: 'start'; partial: AssistantMessage }
  | { type: 'text_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'text_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'text_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'thinking_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'thinking_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'thinking_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'toolcall_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'toolcall_end'; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: 'done'; reason: Extract<StopReason, 'stop' | 'length' | 'toolUse'>; message: AssistantMessage }
  | { type: 'error'; reason: Extract<StopReason, 'aborted' | 'error'>; error: AssistantMessage };

type StopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';

interface Model {
  id: string;
  name: string;
  api: Api;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input: ('text' | 'image')[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

function readUserText(content: string | TextContent[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((block): block is TextContent => block.type === 'text')
    .map(block => block.text)
    .join('\n');
}

function emitDescriptor(
  stream: FauxEventStream,
  descriptor: ResponseDescriptor,
  callNumber: number,
): void {
  if (descriptor.type === 'response:text') {
    const block: TextContent = { type: 'text', text: descriptor.text };
    const message = makeAssistantMessage([block], 'stop');
    stream.push({ type: 'start', partial: message });
    stream.push({ type: 'text_start', contentIndex: 0, partial: message });
    stream.push({ type: 'text_delta', contentIndex: 0, delta: descriptor.text, partial: message });
    stream.push({ type: 'text_end', contentIndex: 0, content: descriptor.text, partial: message });
    stream.push({ type: 'done', reason: 'stop', message });
    stream.end(message);
    return;
  }

  if (descriptor.type === 'response:thinking') {
    const message = makeAssistantMessage(
      [{ type: 'thinking', thinking: descriptor.text }],
      'stop',
    );
    stream.push({ type: 'start', partial: message });
    stream.push({ type: 'thinking_start', contentIndex: 0, partial: message });
    stream.push({ type: 'thinking_delta', contentIndex: 0, delta: descriptor.text, partial: message });
    stream.push({ type: 'thinking_end', contentIndex: 0, content: descriptor.text, partial: message });
    stream.push({ type: 'done', reason: 'stop', message });
    stream.end(message);
    return;
  }

  if (descriptor.type === 'response:aborted') {
    const message = makeAssistantMessage(
      [{ type: 'text', text: descriptor.text }],
      'aborted',
      'Aborted by test descriptor',
    );
    stream.push({ type: 'start', partial: message });
    stream.push({ type: 'error', reason: 'aborted', error: message });
    stream.end(message);
    return;
  }

  // response:push-task
  const toolCall: ToolCall = {
    type: 'toolCall' as const,
    id: `call-${callNumber}`,
    name: 'push-task',
    arguments: { prompt: descriptor.prompt, inherit_context: descriptor.inherit_context },
  };
  const message = makeAssistantMessage([toolCall], 'toolUse');
  stream.push({ type: 'start', partial: message });
  stream.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
  stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message });
  stream.push({ type: 'done', reason: 'toolUse', message });
  stream.end(message);
}

function makeAssistantMessage(
  content: AssistantMessage['content'],
  stopReason: string,
  errorMessage?: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: FAUX_MODEL.api,
    provider: FAUX_PROVIDER,
    model: FAUX_MODEL_ID,
    usage: TEST_USAGE,
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  } as AssistantMessage;
}

interface AssistantMessage {
  role: 'assistant';
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: string;
  model: string;
  usage: Usage;
  stopReason: string;
  errorMessage?: string;
  timestamp: number;
}

type Api = string;

interface TextContent {
  type: 'text';
  text: string;
}

interface ThinkingContent {
  type: 'thinking';
  thinking: string;
}

interface ToolCall {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

const TEST_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};