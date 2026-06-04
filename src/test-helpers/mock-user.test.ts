import assert from "node:assert";
import { describe, it } from "node:test";

import { MockUser, userCtrlC, userEsc, userPrompts } from "./index.js";

describe("MockUser", () => {
  it("uses the first matching assistant rule", () => {
    const user = new MockUser();
    user.onAssistant("working", userPrompts("/auto"));
    user.onAssistant("working", userEsc());

    assert.deepStrictEqual(user.matchAssistant("still working..."), [userPrompts("/auto")]);
  });

  it("matches queued tasks by prompt text only", () => {
    const user = new MockUser();
    user.onQueuedTask("Task BBB", userCtrlC());

    assert.deepStrictEqual(user.matchQueuedTask("Task BBB"), [userCtrlC()]);
    assert.deepStrictEqual(user.matchQueuedTask("prefix Task BBB suffix"), [userCtrlC()]);
  });

  it("returns a copied action array", () => {
    const user = new MockUser();
    user.onAssistant("done", userPrompts("next"));

    const first = user.matchAssistant("done now");
    first.push(userEsc());

    assert.deepStrictEqual(user.matchAssistant("done now"), [userPrompts("next")]);
  });

  it("returns no actions when nothing matches", () => {
    const user = new MockUser();
    assert.deepStrictEqual(user.matchAssistant("missing"), []);
    assert.deepStrictEqual(user.matchQueuedTask("missing"), []);
  });

  it("rejects userEsc for queued-task rules at registration time", () => {
    const user = new MockUser();

    assert.throws(
      () => user.onQueuedTask("Task BBB", userEsc()),
      /userEsc\(\) is only supported for onAssistant\(\.\.\.\), not onQueuedTask\(\.\.\.\)/,
    );
  });
});
