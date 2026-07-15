import "server-only";

import { createHmac } from "node:crypto";

export function normalizeLookupEmail(value: string) {
  const email = value.trim().toLowerCase();

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Enter a valid email address.");
  }

  return email;
}

export function emailLookupHash(value: string) {
  const pepper = process.env.PAPERDECK_EMAIL_LOOKUP_PEPPER;

  if (!pepper || pepper.length < 32) {
    throw new Error("PAPERDECK_EMAIL_LOOKUP_PEPPER must be at least 32 characters");
  }

  return createHmac("sha256", pepper)
    .update(normalizeLookupEmail(value), "utf8")
    .digest("hex");
}
