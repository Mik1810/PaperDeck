import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePublicDisplayName,
  validatePublicDisplayName,
} from "../../src/lib/collaboration/profile";

test("public display names are normalized without becoming identifiers", () => {
  assert.equal(normalizePublicDisplayName("  Ada   Lovelace  "), "Ada Lovelace");
  assert.equal(validatePublicDisplayName("Ａda"), "Ada");
});

test("public display names reject unsafe or out-of-range values", () => {
  assert.throws(() => validatePublicDisplayName("A"), /2–50/);
  assert.throws(() => validatePublicDisplayName(`Ada\u200bLovelace`), /2–50/);
  assert.throws(() => validatePublicDisplayName("x".repeat(51)), /2–50/);
  assert.throws(() => validatePublicDisplayName("ada@example.test"), /email/);
});
