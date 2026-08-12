import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { playlists, playlistItems } from "@/db/schema";

async function requireOwnedPlaylist(
  ownerId: string,
  playlistId: string,
  context: string,
) {
  const rows = await db
    .select({ id: playlists.id, ownerId: playlists.ownerId })
    .from(playlists)
    .where(eq(playlists.id, playlistId))
    .limit(1);

  if (!rows.length) {
    throw new Error(`${context}: playlist not found`);
  }

  if (rows[0].ownerId !== ownerId) {
    throw new Error(`${context}: playlist not owned by user`);
  }
}

/** @user-scoped */
export async function reorderOwnedPlaylistItems(
  ownerId: string,
  playlistId: string,
  orderedPaperIds: string[],
) {
  await requireOwnedPlaylist(ownerId, playlistId, "Authorize playlist reorder");

  if (orderedPaperIds.length === 0) {
    return;
  }

  const positionCases = orderedPaperIds.map(
    (paperId, index) => sql`when ${paperId}::uuid then ${index}`,
  );

  await db
    .update(playlistItems)
    .set({
      position: sql`case ${playlistItems.paperId} ${sql.join(
        positionCases,
        sql` `,
      )} else ${playlistItems.position} end`,
    })
    .where(
      and(
        eq(playlistItems.playlistId, playlistId),
        inArray(playlistItems.paperId, orderedPaperIds),
      ),
    );
}
