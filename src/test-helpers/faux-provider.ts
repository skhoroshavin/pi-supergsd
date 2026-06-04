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
