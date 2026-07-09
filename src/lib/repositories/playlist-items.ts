import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
export async function addToOwnedPlaylist(
  ownerId: string,
  playlistId: string,
  paperId: string,
) {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: playlists.id, ownerId: playlists.ownerId })
      .from(playlists)
      .where(eq(playlists.id, playlistId))
      .limit(1)
      .for("update");

    if (!rows.length) {
      throw new Error("Authorize playlist add: playlist not found");
    }

    if (rows[0].ownerId !== ownerId) {
      throw new Error("Authorize playlist add: playlist not owned by user");
    }

    const maxRows = await tx
      .select({ position: playlistItems.position })
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, playlistId))
      .orderBy(desc(playlistItems.position))
      .limit(1);

    const nextPosition = (maxRows[0]?.position ?? -1) + 1;

    await tx
      .insert(playlistItems)
      .values({
        playlistId,
        paperId,
        position: nextPosition,
      })
      .onConflictDoUpdate({
        target: [playlistItems.playlistId, playlistItems.paperId],
        set: { position: nextPosition },
      });
  });
}

/** @user-scoped */
export async function removeFromOwnedPlaylist(
  ownerId: string,
  playlistId: string,
  paperId: string,
) {
  await requireOwnedPlaylist(ownerId, playlistId, "Authorize playlist removal");

  await db
    .delete(playlistItems)
    .where(
      and(
        eq(playlistItems.playlistId, playlistId),
        eq(playlistItems.paperId, paperId),
      ),
    );
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
