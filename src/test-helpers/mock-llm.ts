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
  | ReturnType<typeof pushTask>;

export const responds = (text: string) => ({
  type: "response:text" as const,
  text,
});

export const thinks = (text: string) => ({
  type: "response:thinking" as const,
  text,
});

export const pushTask = (title: string, prompt: string) => ({
  type: "response:push-task" as const,
  title,
  prompt,
});

type PromptRule = {
  text: string;
  responses: MockLLMDescriptor[];
};
