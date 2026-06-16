import { describe, it } from "node:test";

import { pushTask, task, TestHarness } from "./test-helpers/index.js";

import { setSkills } from "./index.js";

import type { Skill } from "@earendil-works/pi-coding-agent";

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

// Mock skill paths are project-relative for the test environment.
// Actual file existence is not required — resolution is pure string replacement.
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
