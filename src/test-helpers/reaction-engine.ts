import type {
  ControlReactionDescriptor,
  ResponseDescriptor,
} from "./descriptors.js";

export class ReactionEngine {
  private readonly promptRules: PromptRule[] = [];
  private readonly assistantRules: SessionRule[] = [];
  private readonly queuedTaskRules: QueuedTaskRule[] = [];

  onPrompt(text: string, ...responses: ResponseDescriptor[]): void {
    this.promptRules.push({ text, responses });
  }

  onAssistant(
    text: string,
    ...reactions: Array<ResponseDescriptor | ControlReactionDescriptor>
  ): void {
    this.assistantRules.push({ text, reactions });
  }

  onQueuedTask(
    prompt: string,
    inheritContext: boolean | undefined,
    ...reactions: Array<ResponseDescriptor | ControlReactionDescriptor>
  ): void {
    this.queuedTaskRules.push({ prompt, inheritContext, reactions });
  }

  matchPrompt(text: string): ResponseDescriptor[] {
    const matched = this.promptRules.find((rule) => {
      if (rule.text === "") return text === "";
      return text.includes(rule.text);
    });
    return matched ? [...matched.responses] : [];
  }

  matchAssistant(
    text: string,
  ): Array<ResponseDescriptor | ControlReactionDescriptor> {
    const matched = this.assistantRules.find((rule) =>
      text.includes(rule.text),
    );
    return matched ? [...matched.reactions] : [];
  }

  matchQueuedTask(
    prompt: string,
    inheritContext: boolean,
  ): Array<ResponseDescriptor | ControlReactionDescriptor> {
    const matched = this.queuedTaskRules.find((rule) => {
      if (!prompt.includes(rule.prompt)) return false;
      return (
        rule.inheritContext === undefined ||
        rule.inheritContext === inheritContext
      );
    });
    return matched ? [...matched.reactions] : [];
  }
}

type PromptRule = {
  text: string;
  responses: ResponseDescriptor[];
};

type SessionRule = {
  text: string;
  reactions: Array<ResponseDescriptor | ControlReactionDescriptor>;
};

type QueuedTaskRule = {
  prompt: string;
  inheritContext: boolean | undefined;
  reactions: Array<ResponseDescriptor | ControlReactionDescriptor>;
};
