export const researchGroupRoles = ["member", "admin", "owner"] as const;

export type ResearchGroupRole = (typeof researchGroupRoles)[number];
export type ResearchGroupOperation = "read" | "write";

const roleRank: Record<ResearchGroupRole, number> = {
  member: 0,
  admin: 1,
  owner: 2,
};

export class ResearchGroupUnavailableError extends Error {
  constructor() {
    super("Research group unavailable.");
    this.name = "ResearchGroupUnavailableError";
  }
}

export function hasResearchGroupRole(
  actualRole: ResearchGroupRole | null,
  minimumRole: ResearchGroupRole,
) {
  return actualRole !== null && roleRank[actualRole] >= roleRank[minimumRole];
}

export function assertResearchGroupPermission({
  actualRole,
  minimumRole,
  operation,
  readsEnabled,
  writesEnabled,
}: {
  actualRole: ResearchGroupRole | null;
  minimumRole: ResearchGroupRole;
  operation: ResearchGroupOperation;
  readsEnabled: boolean;
  writesEnabled: boolean;
}): ResearchGroupRole {
  const operationEnabled =
    operation === "read"
      ? readsEnabled
      : readsEnabled && writesEnabled;

  if (
    !operationEnabled ||
    actualRole === null ||
    roleRank[actualRole] < roleRank[minimumRole]
  ) {
    throw new ResearchGroupUnavailableError();
  }

  return actualRole;
}
