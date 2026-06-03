import * as piAi from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

import { extractTextContent } from "../text-content.js";
import type { MockLLM, MockLLMDescriptor } from "./mock-llm.js";

const registrations = new WeakMap<FauxProvider, piAi.FauxProviderRegistration>();

export const FAUX_PROVIDER = "supergsd-test";

export const FAUX_MODEL: Model<string> = {
  id: "deterministic",
  name: "Deterministic Test Model",
  api: "supergsd-test-api",
  provider: FAUX_PROVIDER,
  baseUrl: "memory://supergsd-test",
  reasoning: true,
  thinkingLevelMap: { off: null, low: "low", medium: "medium", high: "high" },
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 4096,
};

export class FauxProvider {
  constructor(private readonly llm: MockLLM) {
    registrations.set(
      this,
      piAi.registerFauxProvider({
        api: FAUX_MODEL.api,
        provider: FAUX_PROVIDER,
        tokenSize: { min: 1, max: 1 },
        models: [
          {
            id: FAUX_MODEL.id,
            name: FAUX_MODEL.name,
            reasoning: FAUX_MODEL.reasoning,
            input: [...FAUX_MODEL.input],
            cost: FAUX_MODEL.cost,
            contextWindow: FAUX_MODEL.contextWindow,
            maxTokens: FAUX_MODEL.maxTokens,
          },
        ],
      }),
    );
  }

  private onPartialText?: (text: string) => void;

  setOnPartialText(callback: (text: string) => void): void {
    this.onPartialText = callback;
  }

  stream(model: Model<string>, context: Context, options?: SimpleStreamOptions) {
    const lastUser = [...context.messages].reverse().find((message) => message.role === "user");
    const promptText = extractTextContent(lastUser?.content ?? "") ?? "";
    const responses = this.llm.matchPrompt(promptText);

    const registration = registrations.get(this);
    if (!registration) throw new Error("Faux provider registration missing.");

    const message = makeAssistantMessage(responses);
    registration.setResponses([message]);

    const inner = piAi.streamSimple(model, context, options);

    if (this.onPartialText) {
      return this.proxyStream(inner, options);
    }

    return inner;
  }

  private proxyStream(
    inner: piAi.AssistantMessageEventStream,
    options?: SimpleStreamOptions,
  ): piAi.AssistantMessageEventStream {
    const outer = createAssistantMessageEventStream();
    const signal = options?.signal;

    // Accumulate text locally from text_delta deltas, because
    // event.partial.content is a shared mutable reference that the
    // upstream continues to mutate even after events are queued.
    let accumulatedText = "";

    queueMicrotask(async () => {
      try {
        for await (const event of inner) {
          if (event.type === "text_delta") {
            accumulatedText += event.delta;

            // Forward the original event as-is downstream.
            outer.push(event);

            this.onPartialText?.(accumulatedText);

            if (signal?.aborted) {
              // Build aborted message with our locally accumulated text.
              const finalContent = event.partial.content.map((block) =>
                block.type === "text" ? { ...block, text: accumulatedText } : { ...block },
              );
              const partial = { ...event.partial, content: finalContent };
              outer.push(errorEvent(makeAborted(partial)));
              return;
            }

            continue;
          }

          if (event.type === "done" || event.type === "error") {
            outer.push(event);
            return;
          }

          outer.push(event);
        }
      } catch {
        outer.push(
          errorEvent(
            makeAborted({
              role: "assistant",
              content: [],
              api: FAUX_MODEL.api,
              provider: FAUX_PROVIDER,
              model: FAUX_MODEL.id,
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: "error" as const,
              errorMessage: "Unexpected error during streaming",
              timestamp: Date.now(),
            }),
          ),
        );
      }
    });

    return outer;
  }

  unregister(): void {
    const registration = registrations.get(this);
    if (!registration) return;
    registration.unregister();
    registrations.delete(this);
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function makeAborted(partial: AssistantMessage): AssistantMessage {
  return {
    ...partial,
    stopReason: "aborted",
    errorMessage: "Request was aborted",
    timestamp: Date.now(),
  };
}

function errorEvent(error: AssistantMessage): piAi.AssistantMessageEvent {
  return { type: "error", reason: "aborted", error };
}

function makeAssistantMessage(responses: MockLLMDescriptor[]): AssistantMessage {
  const content = responses.map((descriptor, index) => {
    switch (descriptor.type) {
      case "response:text":
        return piAi.fauxText(descriptor.text);
      case "response:thinking":
        return piAi.fauxThinking(descriptor.text);
      case "response:push-task":
        return piAi.fauxToolCall(
          "push-task",
          {
            prompt: descriptor.prompt,
            inherit_context: descriptor.inherit_context,
          },
          { id: `call-${index + 1}` },
        );
    }
  });

  return piAi.fauxAssistantMessage(content, {
    stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
  });
}
