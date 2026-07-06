import "server-only";

/**
 * Guards service-role operations by asserting the caller provides an explicit
 * owner id before accessing user-owned data. This is a defense-in-depth layer:
 * every mutation that bypasses Supabase RLS must carry its own owner check.
 *
 * Functions tagged `@user-scoped` in the repository layer should always receive
 * a non-empty owner id. The guard makes this explicit and auditable.
 */
export function requireOwnerId(
  ownerId: string,
  operation: string,
): asserts ownerId is string {
  if (!ownerId || typeof ownerId !== "string" || !ownerId.trim()) {
    throw new Error(
      `Owner-scoped operation "${operation}" requires a non-empty owner id.`,
    );
  }
}

/**
 * Returns a normalized owner id suitable for database operations.
 * Use this when the owner id might come from an auth source
 * whose format needs validation.
 */
export function normalizeOwnerId(ownerId: string): string {
  const trimmed = ownerId.trim();

  if (!trimmed) {
    throw new Error("Owner id cannot be empty.");
  }

  return trimmed;
}
