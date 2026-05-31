import * as piAi from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import type { ResponseDescriptor } from "./descriptors.js";
import { ReactionEngine } from "./reaction-engine.js";

const registrations = new WeakMap<
  FauxProvider,
  piAi.FauxProviderRegistration
>();

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
  constructor(private readonly engine: ReactionEngine) {
    registrations.set(
      this,
      piAi.registerFauxProvider({
        api: FAUX_MODEL.api,
        provider: FAUX_PROVIDER,
        tokenSize: { min: 999999, max: 999999 },
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

  stream(
    model: Model<string>,
    context: Context,
    options?: SimpleStreamOptions,
  ) {
    const lastUser = [...context.messages]
      .reverse()
      .find((message) => message.role === "user");
    const promptText = lastUser ? readUserText(lastUser.content) : "";
    const responses = this.engine.matchPrompt(promptText);

    if (responses.length === 0) {
      throw new Error(
        `No reaction engine rule matched provider prompt: ${promptText || "<empty prompt>"}`,
      );
    }

    const registration = registrations.get(this);
    if (!registration) {
      throw new Error("Faux provider registration missing.");
    }

    registration.setResponses([makeAssistantMessage(responses)]);
    return piAi.streamSimple(model, context, options);
  }

  unregister(): void {
    const registration = registrations.get(this);
    if (!registration) return;
    registration.unregister();
    registrations.delete(this);
  }
}

function readUserText(
  content: string | Context["messages"][number]["content"],
): string {
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function makeAssistantMessage(
  responses: ResponseDescriptor[],
): AssistantMessage {
  if (responses.length === 1 && responses[0].type === "response:aborted") {
    const descriptor = responses[0];
    return piAi.fauxAssistantMessage(descriptor.text, {
      stopReason: "aborted",
      errorMessage: "Aborted by test descriptor",
    });
  }

  const content = responses.map((descriptor, index) => {
    if (descriptor.type === "response:text") {
      return piAi.fauxText(descriptor.text);
    }
    if (descriptor.type === "response:thinking") {
      return piAi.fauxThinking(descriptor.text);
    }
    if (descriptor.type === "response:push-task") {
      return piAi.fauxToolCall(
        "push-task",
        {
          prompt: descriptor.prompt,
          inherit_context: descriptor.inherit_context,
        },
        { id: `call-${index + 1}` },
      );
    }
    throw new Error("aborts(...) must be the only descriptor in onPrompt(...)");
  });

  return piAi.fauxAssistantMessage(content, {
    stopReason: content.some((block) => block.type === "toolCall")
      ? "toolUse"
      : "stop",
  });
}
