export class MockLLM {
  private readonly promptRules: PromptRule[] = [];

  onPrompt(text: string, ...responses: MockLLMDescriptor[]): void {
    this.promptRules.push({ text, responses });
  }

  matchPrompt(text: string): MockLLMDescriptor[] {
    const matched = this.promptRules.find((rule) => {
      if (rule.text === "") return text === "";
      return text.includes(rule.text);
    });

    if (!matched) {
      throw new Error(`No MockLLM rule matched provider prompt: ${text || "<empty prompt>"}`);
    }

    return [...matched.responses];
  }
}

export type MockLLMDescriptor =
  | ReturnType<typeof responds>
  | ReturnType<typeof thinks>
  | ReturnType<typeof aborts>
  | ReturnType<typeof pushTask>;

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

type PromptRule = {
  text: string;
  responses: MockLLMDescriptor[];
};
