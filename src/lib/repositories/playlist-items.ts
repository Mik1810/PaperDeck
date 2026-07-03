import "server-only";

import { and, desc, eq } from "drizzle-orm";
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

export async function addToOwnedPlaylist(
  ownerId: string,
  playlistId: string,
  paperId: string,
) {
  await requireOwnedPlaylist(ownerId, playlistId, "Authorize playlist add");

  const maxRows = await db
    .select({ position: playlistItems.position })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, playlistId))
    .orderBy(desc(playlistItems.position))
    .limit(1);

  const nextPosition = (maxRows[0]?.position ?? -1) + 1;

  await db
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
}

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

export async function reorderOwnedPlaylistItems(
  ownerId: string,
  playlistId: string,
  orderedPaperIds: string[],
) {
  await requireOwnedPlaylist(ownerId, playlistId, "Authorize playlist reorder");

  for (let i = 0; i < orderedPaperIds.length; i++) {
    await db
      .update(playlistItems)
      .set({ position: i })
      .where(
        and(
          eq(playlistItems.playlistId, playlistId),
          eq(playlistItems.paperId, orderedPaperIds[i]),
        ),
      );
  }
}
