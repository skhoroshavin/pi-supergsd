import assert from "node:assert";

import { describe, it } from "node:test";

import { stripVTControlCharacters } from "node:util";

import type {
  ExtensionContext,
  MessageRenderOptions,
  Skill,
} from "@earendil-works/pi-coding-agent";

import { type Component, Text } from "@earendil-works/pi-tui";

import { pushTask, task, TestHarness, TestUi } from "./test-helpers/index.js";

import { rendererTaskResult, setSkills, toolPushTask } from "./index.js";

// ---------------------------------------------------------------------------
// Skill resolution tests
// ---------------------------------------------------------------------------

describe("push-task skill resolution", () => {
  it("leaves prompt unchanged when there are no skill refs", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("work", pushTask("No refs", "Do a thing with no skill refs."));
    try {
      setSkills(MOCK_SKILLS);
      await h.prompt("work");

      h.assertSessionContains(task("No refs", "Do a thing with no skill refs."));
    } finally {
      h.dispose();
    }
  });

  it("resolves a single /skill:name to its absolute path", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt(
      "work",
      pushTask("Brainstorming review", "Review using /skill:brainstorming for ideas."),
    );
    try {
      setSkills(MOCK_SKILLS);
      await h.prompt("work");

      h.assertSessionContains(
        task(
          "Brainstorming review",
          "Review using /dev/null/skills/brainstorming/SKILL.md for ideas.",
        ),
      );
      h.assertLastNotification("Task stored. Use `/start-task` or `/auto` to start it.");
    } finally {
      h.dispose();
    }
  });

  it("resolves multiple /skill:name refs", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt(
      "work",
      pushTask("Multiple skills", "Use /skill:brainstorming then /skill:tdd for implementation."),
    );
    try {
      setSkills(MOCK_SKILLS);
      await h.prompt("work");

      h.assertSessionContains(
        task(
          "Multiple skills",
          "Use /dev/null/skills/brainstorming/SKILL.md then /dev/null/skills/tdd/SKILL.md for implementation.",
        ),
      );
    } finally {
      h.dispose();
    }
  });

  it("resolves the same /skill:name appearing twice", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt(
      "work",
      pushTask("Duplicate skill", "First /skill:brainstorming. Then more /skill:brainstorming."),
    );
    try {
      setSkills(MOCK_SKILLS);
      await h.prompt("work");

      h.assertSessionContains(
        task(
          "Duplicate skill",
          "First /dev/null/skills/brainstorming/SKILL.md. Then more /dev/null/skills/brainstorming/SKILL.md.",
        ),
      );
    } finally {
      h.dispose();
    }
  });

  it("keeps unknown skill names unchanged - partial resolution", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt(
      "work",
      pushTask("Partial unknown", "Use /skill:brainstorming and /skill:nonexistent."),
    );
    try {
      setSkills(MOCK_SKILLS);
      await h.prompt("work");

      h.assertSessionContains(
        task(
          "Partial unknown",
          "Use /dev/null/skills/brainstorming/SKILL.md and /skill:nonexistent.",
        ),
      );
      h.assertLastNotification(
        "Warning: /skill:nonexistent were not resolved.\nTask stored. Use `/start-task` or `/auto` to start it.",
      );
    } finally {
      h.dispose();
    }
  });

  it("keeps all unknown skill names unchanged", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt("work", pushTask("All unknown", "Use /skill:foo and /skill:bar."));
    try {
      setSkills(MOCK_SKILLS);
      await h.prompt("work");

      h.assertSessionContains(task("All unknown", "Use /skill:foo and /skill:bar."));
      h.assertLastNotification(
        "Warning: /skill:foo, /skill:bar were not resolved.\nTask stored. Use `/start-task` or `/auto` to start it.",
      );
    } finally {
      h.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Title validation and rendering tests
// ---------------------------------------------------------------------------

describe("push-task title validation and rendering", () => {
  it("stores trimmed titles while resolving skill refs", async () => {
    const h = await TestHarness.create();
    h.llm.onPrompt(
      "work",
      pushTask("  Review ideas  ", "Use /skill:brainstorming then /skill:tdd for implementation."),
    );
    try {
      setSkills(MOCK_SKILLS);
      await h.prompt("work");

      h.assertSessionContains(
        task(
          "Review ideas",
          "Use /dev/null/skills/brainstorming/SKILL.md then /dev/null/skills/tdd/SKILL.md for implementation.",
        ),
      );
    } finally {
      h.dispose();
    }
  });

  it("rejects blank titles without storing a task, then allows an immediate retry", async () => {
    const appended: unknown[] = [];
    const tool = toolPushTask({
      appendEntry(type, data) {
        appended.push({ type, data });
      },
    });

    await assert.rejects(
      async () =>
        tool.execute?.("call-1", { title: "   ", prompt: "Do the work." }, undefined, undefined, {
          ...stubContext(),
        }),
      /push-task title must not be empty\./,
    );

    assert.deepStrictEqual(appended, []);

    const result = await tool.execute?.(
      "call-2",
      { title: "Review work", prompt: "Do the work." },
      undefined,
      undefined,
      { ...stubContext() },
    );

    assert.deepStrictEqual(appended, [
      {
        type: "task",
        data: { title: "Review work", prompt: "Do the work." },
      },
    ]);
    assert.deepStrictEqual(result?.details, {
      title: "Review work",
      prompt: "Do the work.",
    });
  });

  it("renders the task title in the push-task header", () => {
    const tool = toolPushTask({ appendEntry() {} });
    const theme = new TestUi().context.theme;
    const rendered = stripVTControlCharacters(
      (
        tool.renderCall?.(
          { title: "Review implementation", prompt: "Check correctness.\nCheck tests." },
          theme,
          { ...stubRenderContext() },
        ) ?? new Text("", 0, 0)
      )
        .render(80)
        .join("\n"),
    );

    assert.match(rendered, /push-task: Review implementation/);
  });

  it("renders task results with the explicit title", () => {
    const theme = new TestUi().context.theme;
    const message: StubCustomMessage<{ title: string }> = {
      role: "custom",
      customType: "task-result",
      content: [{ type: "text", text: "Looks good." }],
      display: true,
      details: { title: "Review implementation" },
      timestamp: 0,
    };
    const options: MessageRenderOptions = { expanded: false };
    const rendered = stripVTControlCharacters(
      (rendererTaskResult(message, options, theme) ?? new Text("", 0, 0)).render(80).join("\n"),
    );

    assert.match(rendered, /Review implementation result:/);
  });
});

// ---------------------------------------------------------------------------
// Mock skill data
// ---------------------------------------------------------------------------

const MOCK_SKILLS: Skill[] = [
  {
    name: "brainstorming",
    description: "Brainstorming ideas",
    filePath: "/dev/null/skills/brainstorming/SKILL.md",
    baseDir: "/dev/null/skills/brainstorming",
    sourceInfo: {
      path: "/dev/null/skills/brainstorming/SKILL.md",
      source: "project",
      scope: "project",
      origin: "package",
    },
    disableModelInvocation: false,
  },
  {
    name: "tdd",
    description: "Test-driven development",
    filePath: "/dev/null/skills/tdd/SKILL.md",
    baseDir: "/dev/null/skills/tdd",
    sourceInfo: {
      path: "/dev/null/skills/tdd/SKILL.md",
      source: "project",
      scope: "project",
      origin: "package",
    },
    disableModelInvocation: false,
  },
];

// ---------------------------------------------------------------------------
// Locally-defined interfaces for types not re-exported by the public API
// ---------------------------------------------------------------------------

interface StubCustomMessage<T> {
  role: "custom";
  customType: string;
  content: string | { type: "text"; text: string }[];
  display: boolean;
  details?: T;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Typed stubs
// ---------------------------------------------------------------------------

function stubContext(overrides?: Partial<ExtensionContext>): ExtensionContext {
  return {
    hasUI: false,
    cwd: "/",
    getSystemPrompt: () => "",
    isIdle: () => true,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    ui: undefined as unknown as ExtensionContext["ui"],
    sessionManager: undefined as unknown as ExtensionContext["sessionManager"],
    modelRegistry: undefined as unknown as ExtensionContext["modelRegistry"],
    model: undefined,
    signal: undefined,
    ...overrides,
  };
}

function stubRenderContext(overrides?: Partial<StubRenderContext>): StubRenderContext {
  return {
    args: undefined,
    toolCallId: "test-call",
    invalidate: () => {},
    lastComponent: undefined,
    state: undefined,
    cwd: "/",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: false,
    isError: false,
    ...overrides,
  };
}

interface StubRenderContext {
  args: unknown;
  toolCallId: string;
  invalidate: () => void;
  lastComponent: Component | undefined;
  state: unknown;
  cwd: string;
  executionStarted: boolean;
  argsComplete: boolean;
  isPartial: boolean;
  expanded: boolean;
  showImages: boolean;
  isError: boolean;
}