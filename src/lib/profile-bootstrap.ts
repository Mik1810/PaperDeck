const ownerProfileForeignKeyConstraints = new Set([
  "collaboration_identities_owner_id_fkey",
  "favorites_owner_id_fkey",
  "paper_notes_owner_id_fkey",
  "playlists_owner_id_fkey",
  "recommendation_batch_items_owner_id_fkey",
  "recommendation_impressions_owner_id_fkey",
  "recommendations_owner_id_fkey",
  "user_interests_owner_id_fkey",
  "user_paper_feed_exclusions_owner_id_fkey",
  "user_paper_interactions_owner_id_fkey",
  "user_profile_embeddings_owner_id_fkey",
]);

type PostgreSqlErrorLike = {
  cause?: unknown;
  code?: unknown;
  constraint?: unknown;
  constraint_name?: unknown;
};

export function isMissingOwnerProfileError(error: unknown) {
  let current = error;

  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") return false;
    const candidate = current as PostgreSqlErrorLike;
    const constraint = candidate.constraint ?? candidate.constraint_name;
    if (
      candidate.code === "23503" &&
      typeof constraint === "string" &&
      ownerProfileForeignKeyConstraints.has(constraint)
    ) {
      return true;
    }
    current = candidate.cause;
  }

  return false;
}
