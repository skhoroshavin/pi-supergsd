import * as piAi from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

import { extractTextContent } from "../text-content.js";
import type { MockLLM, MockLLMDescriptor } from "./mock-llm.js";
import type { MockUserAction } from "./mock-user.js";

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
  constructor(
    private readonly llm: MockLLM,
    private readonly matchAssistantActions: (text: string) => MockUserAction[],
  ) {
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

  /**
   * The system prompt actually shipped on each provider request, in order.
   * This is the value after the `before_provider_request` chain runs (i.e. the
   * value the extension may have restored), not the pre-handler base.
   */
  readonly systemPrompts: string[] = [];

  stream(model: Model<string>, context: Context, options?: SimpleStreamOptions) {
    const lastUser = [...context.messages].reverse().find((message) => message.role === "user");
    const promptText = extractTextContent(lastUser?.content ?? "") ?? "";
    const responses = this.llm.matchPrompt(promptText);

    const registration = registrations.get(this);
    if (!registration) throw new Error("Faux provider registration missing.");

    const message = maybeRewriteAssistantEsc(
      makeAssistantMessage(responses),
      this.matchAssistantActions,
    );
    registration.setResponses([message]);

    // Faithfully run the before_provider_request chain: real providers invoke
    // `options.onPayload(requestBody, model)` before sending. Record the
    // system prompt that actually ships so tests can assert prefix stability.
    const payload = buildFauxPayload(model, context);
    void (async () => {
      const replaced = options?.onPayload ? await options.onPayload(payload, model) : undefined;
      const shipped = replaced !== undefined && replaced !== null ? replaced : payload;
      this.systemPrompts.push(extractShippedSystemPrompt(shipped));
    })();

    return piAi.streamSimple(model, context, options);
  }

  unregister(): void {
    const registration = registrations.get(this);
    if (!registration) return;
    registration.unregister();
    registrations.delete(this);
  }
}

function maybeRewriteAssistantEsc(
  message: AssistantMessage,
  matchAssistantActions: (text: string) => MockUserAction[],
): AssistantMessage {
  const visibleText = extractTextContent(message.content, "") ?? "";
  const shouldAbort = matchAssistantActions(visibleText).some(
    (action) => action.type === "user-esc",
  );

  if (!shouldAbort) return message;

  return piAi.fauxAssistantMessage("", { stopReason: "aborted" });
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
            title: descriptor.title,
            prompt: descriptor.prompt,
          },
          { id: `call-${index + 1}` },
        );
    }
  });

  return piAi.fauxAssistantMessage(content, {
    stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
  });
}

/**
 * Build an OpenAI-compatible request body from the agent context so the
 * `before_provider_request` chain sees the same shape real OpenAI providers
 * send (system prompt as the first system/developer message).
 */
function buildFauxPayload(model: Model<string>, context: Context): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [
    ...(context.systemPrompt ? [{ role: "system", content: context.systemPrompt }] : []),
    ...(context.messages as unknown as Array<Record<string, unknown>>),
  ];
  return {
    model: model.id,
    messages,
    ...(context.tools && context.tools.length > 0 ? { tools: context.tools } : {}),
  };
}

/** Extract the shipped system prompt from a (possibly replaced) request body. */
function extractShippedSystemPrompt(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.messages)) {
    for (const entry of record.messages as Array<Record<string, unknown>>) {
      if (entry && (entry.role === "system" || entry.role === "developer")) {
        return typeof entry.content === "string"
          ? entry.content
          : JSON.stringify(entry.content ?? "");
      }
    }
  }
  return typeof record.system === "string" ? record.system : "";
}
