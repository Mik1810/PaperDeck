export const GROUP_INVITE_POLICIES = [
  "nobody",
  "friends_only",
  "anyone",
] as const;

export type GroupInvitePolicy = (typeof GROUP_INVITE_POLICIES)[number];

export function normalizePublicDisplayName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function validatePublicDisplayName(value: string) {
  const displayName = normalizePublicDisplayName(value);
  const length = [...displayName].length;

  if (length < 2 || length > 50 || /[\p{Cc}\p{Cf}]/u.test(displayName)) {
    throw new Error("Public name must contain 2–50 visible characters.");
  }

  if (displayName.includes("@")) {
    throw new Error("Public name cannot be an email address.");
  }

  return displayName;
}

export function isGroupInvitePolicy(value: string): value is GroupInvitePolicy {
  return GROUP_INVITE_POLICIES.includes(value as GroupInvitePolicy);
}
