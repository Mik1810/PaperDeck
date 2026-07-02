export function isDevAuthEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.PAPERDECK_DEV_AUTH === "true";
}

export function getDevOwnerId() {
  return process.env.PAPERDECK_DEV_OWNER_ID || "local-dev-user";
}
