export class MockUser {
  private readonly assistantRules: AssistantRule[] = [];
  private readonly queuedTaskRules: QueuedTaskRule[] = [];

  onAssistant(text: string, ...actions: MockUserAction[]): void {
    this.assistantRules.push({ text, actions });
  }

  onQueuedTask(prompt: string, ...actions: MockUserAction[]): void {
    if (actions.some((action) => action.type === "user-esc")) {
      throw new Error("userEsc() is only supported for onAssistant(...), not onQueuedTask(...)");
    }

    this.queuedTaskRules.push({ prompt, actions });
  }

  matchAssistant(text: string): MockUserAction[] {
    const matched = this.assistantRules.find((rule) => text.includes(rule.text));
    return matched ? [...matched.actions] : [];
  }

  matchQueuedTask(prompt: string): MockUserAction[] {
    const matched = this.queuedTaskRules.find((rule) => prompt.includes(rule.prompt));
    return matched ? [...matched.actions] : [];
  }
}

export type MockUserAction =
  | ReturnType<typeof userEsc>
  | ReturnType<typeof userCtrlC>
  | ReturnType<typeof userPrompts>;

export const userEsc = () => ({ type: "user-esc" as const });

export const userCtrlC = () => ({ type: "user-ctrl-c" as const });

export const userPrompts = (text: string) => ({
  type: "user-prompts" as const,
  text,
});

type AssistantRule = {
  text: string;
  actions: MockUserAction[];
};

type QueuedTaskRule = {
  prompt: string;
  actions: MockUserAction[];
};
