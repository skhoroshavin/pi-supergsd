export function renderTextContent(content: unknown): string {
  return extractTextContent(content) ?? String(content ?? "");
}

export function extractTextContent(content: unknown, separator = "\n"): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  return extractTextBlocks(content)
    .map((block) => block.text)
    .join(separator);
}

export function firstTextContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  return extractTextBlocks(content)[0]?.text;
}

export function taskResultTextContent(content: unknown): TextContent | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return extractTextBlocks(content);
}

export type TextContent = string | TextBlock[];

export function extractTextBlocks(content: unknown): TextBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter(isTextBlock);
}

export function isTextBlock(value: unknown): value is TextBlock {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

export type TextBlock = {
  type: "text";
  text: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
