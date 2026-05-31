import assert from "node:assert";
import { describe, it } from "node:test";

import { FAUX_MODEL, FauxProvider, pushTask, ReactionEngine } from "./index.js";

describe("FauxProvider", () => {
  it("emits toolcall deltas before the tool call ends", async () => {
    const engine = new ReactionEngine();
    engine.onPrompt("delegate work", pushTask("subtask", true));

    const provider = new FauxProvider(engine);
    const stream = provider.stream(FAUX_MODEL, {
      messages: [
        {
          role: "user",
          content: "delegate work",
          timestamp: Date.now(),
        },
      ],
    });

    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    const deltaIndex = events.findIndex(
      (event) => event.type === "toolcall_delta",
    );
    const endIndex = events.findIndex((event) => event.type === "toolcall_end");

    assert.ok(deltaIndex >= 0, "expected at least one toolcall_delta event");
    assert.ok(endIndex >= 0, "expected a toolcall_end event");
    assert.ok(
      deltaIndex < endIndex,
      "expected toolcall_delta before toolcall_end",
    );
  });
});
