import assert from "node:assert";
import { describe, it } from "node:test";

import { MockLLM, pushTask, responds, thinks } from "./index.js";

describe("MockLLM", () => {
  it("uses the first matching prompt rule", () => {
    const llm = new MockLLM();
    llm.onPrompt("task", responds("first"));
    llm.onPrompt("task", responds("second"));

    assert.deepStrictEqual(llm.matchPrompt("run task now"), [responds("first")]);
  });

  it("treats the empty prompt as an exact-match-only rule", () => {
    const llm = new MockLLM();
    llm.onPrompt("", thinks("idle"));

    assert.deepStrictEqual(llm.matchPrompt(""), [thinks("idle")]);
    assert.throws(
      () => llm.matchPrompt("not empty"),
      /No MockLLM rule matched provider prompt: not empty/,
    );
  });

  it("returns a copied descriptor array", () => {
    const llm = new MockLLM();
    llm.onPrompt("delegate", responds("working"), pushTask("x", "subtask"));

    const first = llm.matchPrompt("delegate now");
    first.push(responds("mutated"));

    assert.deepStrictEqual(llm.matchPrompt("delegate now"), [
      responds("working"),
      pushTask("x", "subtask"),
    ]);
  });

  it("throws loudly when no prompt rule matches", () => {
    const llm = new MockLLM();
    assert.throws(
      () => llm.matchPrompt("missing prompt"),
      /No MockLLM rule matched provider prompt: missing prompt/,
    );
  });
});
