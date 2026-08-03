import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createResearchGroupInvitationToken,
  researchGroupInvitationTokenDigest,
} from "@/lib/research-groups/invitation-token";

test("creates independent 256-bit URL-safe invitation tokens", () => {
  const first = createResearchGroupInvitationToken();
  const second = createResearchGroupInvitationToken();

  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("produces a stable SHA-256 digest without retaining the token", () => {
  const token = createResearchGroupInvitationToken();
  const digest = researchGroupInvitationTokenDigest(token);

  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(researchGroupInvitationTokenDigest(token), digest);
  assert.notEqual(digest, token);
});

test("rejects malformed invitation tokens", () => {
  for (const token of ["", "short", `${"a".repeat(42)}!`, "a".repeat(44)]) {
    assert.throws(
      () => researchGroupInvitationTokenDigest(token),
      /Invalid research-group invitation token/,
    );
  }
});
