import "server-only";

import { createHash, randomBytes } from "node:crypto";

const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createResearchGroupInvitationToken() {
  return randomBytes(32).toString("base64url");
}

export function researchGroupInvitationTokenDigest(token: string) {
  if (!INVITATION_TOKEN_PATTERN.test(token)) {
    throw new Error("Invalid research-group invitation token.");
  }

  return createHash("sha256").update(token, "utf8").digest("hex");
}
