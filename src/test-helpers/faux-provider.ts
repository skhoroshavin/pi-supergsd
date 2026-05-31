/**
 * Inline type definitions for the minimal subset of @earendil-works/pi-ai types
 * needed by the faux provider. Using inline types avoids a direct dependency on
 * @earendil-works/pi-ai which is nested under pi-coding-agent's node_modules.
 */

/* ─── Minimal pi-ai type subset ─── */

/* ─── Descriptor types ─── */

import type { ResponseDescriptor } from './descriptors.js';
import { ReactionEngine } from './reaction-engine.js';

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

export class FauxProvider {
  constructor(private readonly engine: ReactionEngine) {}

  stream = (_model: Model, context: Context): FauxEventStream => {
    const stream = new FauxEventStream();
    const lastUser = [...context.messages].reverse().find(message => message.role === 'user');
    const promptText = lastUser ? readUserText(lastUser.content) : '';
    const responses = this.engine.matchPrompt(promptText);


    queueMicrotask(() => {
      if (responses.length === 0) {
        // No matching rule — emit only a minimal stop event without content blocks
        const message = makeAssistantMessage([], 'stop');
        stream.end(message);
        return;
      }

      emitPromptResponses(stream, responses);
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

function emitPromptResponses(
  stream: FauxEventStream,
  responses: ResponseDescriptor[],
): void {
  if (responses.length === 1 && responses[0].type === 'response:aborted') {
    const descriptor = responses[0];
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

  const content = responses.map((descriptor, index) => {
    if (descriptor.type === 'response:text') {
      return { type: 'text' as const, text: descriptor.text };
    }
    if (descriptor.type === 'response:thinking') {
      return { type: 'thinking' as const, thinking: descriptor.text };
    }
    if (descriptor.type === 'response:push-task') {
      return {
        type: 'toolCall' as const,
        id: `call-${index + 1}`,
        name: 'push-task',
        arguments: {
          prompt: descriptor.prompt,
          inherit_context: descriptor.inherit_context,
        },
      };
    }
    throw new Error('aborts(...) must be the only descriptor in onPrompt(...)');
  });

  const stopReason = content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop';
  const message = makeAssistantMessage(content, stopReason);

  stream.push({ type: 'start', partial: message });

  for (const [index, block] of content.entries()) {
    if (block.type === 'text') {
      stream.push({ type: 'text_start', contentIndex: index, partial: message });
      stream.push({ type: 'text_delta', contentIndex: index, delta: block.text, partial: message });
      stream.push({ type: 'text_end', contentIndex: index, content: block.text, partial: message });
      continue;
    }

    if (block.type === 'thinking') {
      stream.push({ type: 'thinking_start', contentIndex: index, partial: message });
      stream.push({ type: 'thinking_delta', contentIndex: index, delta: block.thinking, partial: message });
      stream.push({ type: 'thinking_end', contentIndex: index, content: block.thinking, partial: message });
      continue;
    }

    stream.push({ type: 'toolcall_start', contentIndex: index, partial: message });
    stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: block, partial: message });
  }

  stream.push({ type: 'done', reason: stopReason, message });
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
