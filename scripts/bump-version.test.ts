import assert from "node:assert/strict";
import test from "node:test";

import { computeNext, formatVersion, parseVersion } from "./bump-version.js";

test("parseVersion reads MAJOR.MINOR.PATCH strings", () => {
  assert.deepEqual(parseVersion("1.2.3"), { major: 1, minor: 2, patch: 3 });
});

test("parseVersion rejects invalid strings", () => {
  assert.throws(() => parseVersion("1.2"), /Invalid version/);
  assert.throws(() => parseVersion("v1.2.3"), /Invalid version/);
});

test("computeNext bumps patch", () => {
  assert.deepEqual(computeNext({ major: 1, minor: 2, patch: 3 }, "patch"), {
    major: 1,
    minor: 2,
    patch: 4,
  });
});

test("computeNext bumps minor and resets patch", () => {
  assert.deepEqual(computeNext({ major: 1, minor: 2, patch: 3 }, "minor"), {
    major: 1,
    minor: 3,
    patch: 0,
  });
});

test("computeNext bumps major and resets minor and patch", () => {
  assert.deepEqual(computeNext({ major: 1, minor: 2, patch: 3 }, "major"), {
    major: 2,
    minor: 0,
    patch: 0,
  });
});

test("formatVersion prints a parsed version", () => {
  assert.equal(formatVersion({ major: 2, minor: 0, patch: 1 }), "2.0.1");
});
