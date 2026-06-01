import { describe, it } from "node:test";
import assert from "node:assert";
import { applyPatches } from "./index.js";
import type { Patch } from "./index.js";

describe("applyPatches", () => {
  it("returns unmatched patches when find string is missing", () => {
    const patch = { op: "replace" as const, find: "xyz", replace: "abc" };
    const result = applyPatches("hello world", [patch]);
    assert.strictEqual(result.result, "hello world");
    assert.deepStrictEqual(result.unmatched, [patch]);
  });

  it("applies replace to all occurrences", () => {
    const result = applyPatches("a b a", [{ op: "replace", find: "a", replace: "x" }]);
    assert.strictEqual(result.result, "x b x");
    assert.deepStrictEqual(result.unmatched, []);
  });

  it("applies regex-replace with capture groups", () => {
    const result = applyPatches("Hello World", [{ op: "regex-replace", find: "Hello (\\w+)", replace: "Hi $1" }]);
    assert.strictEqual(result.result, "Hi World");
    assert.deepStrictEqual(result.unmatched, []);
  });

  it("returns unmatched regex-replace when pattern missing", () => {
    const patch = { op: "regex-replace" as const, find: "\\d+", replace: "0" };
    const result = applyPatches("no digits", [patch]);
    assert.strictEqual(result.result, "no digits");
    assert.deepStrictEqual(result.unmatched, [patch]);
  });

  it("deletes lines containing find string", () => {
    const result = applyPatches("line1\nline2\nline3", [{ op: "delete-line", find: "line2" }]);
    assert.strictEqual(result.result, "line1\nline3");
    assert.deepStrictEqual(result.unmatched, []);
  });

  it("deletes blocks from start to end line inclusive", () => {
    const result = applyPatches("start\na\nb\nend\nc", [{ op: "delete-block", findStart: "start", findEnd: "end" }]);
    assert.strictEqual(result.result, "c");
    assert.deepStrictEqual(result.unmatched, []);
  });

  it("returns unmatched delete-block when start missing", () => {
    const patch = {
      op: "delete-block" as const,
      findStart: "missing",
      findEnd: "end",
    };
    const result = applyPatches("a\nb\nc", [patch]);
    assert.strictEqual(result.result, "a\nb\nc");
    assert.deepStrictEqual(result.unmatched, [patch]);
  });

  it("prepends text", () => {
    const result = applyPatches("world", [{ op: "prepend", text: "hello " }]);
    assert.strictEqual(result.result, "hello world");
    assert.deepStrictEqual(result.unmatched, []);
  });

  it("appends text", () => {
    const result = applyPatches("hello", [{ op: "append", text: " world" }]);
    assert.strictEqual(result.result, "hello world");
    assert.deepStrictEqual(result.unmatched, []);
  });

  it("applies patches in order", () => {
    const result = applyPatches("abc", [
      { op: "replace", find: "a", replace: "x" },
      { op: "replace", find: "b", replace: "y" },
    ]);
    assert.strictEqual(result.result, "xyc");
    assert.deepStrictEqual(result.unmatched, []);
  });

  it("throws on invalid patch operation", () => {
    assert.throws(() => {
      applyPatches("test", [{ op: "invalid", find: "x", replace: "y" } as unknown as Patch]);
    }, /Invalid patch operation/);
  });
});
