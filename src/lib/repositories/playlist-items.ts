import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type RepositoryError = {
  message: string;
};

export type PlaylistItemMutationClient = SupabaseClient<Database>;

function assertNoError(error: RepositoryError | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

async function requireOwnedPlaylist(
  supabase: PlaylistItemMutationClient,
  ownerId: string,
  playlistId: string,
  context: string,
) {
  const { data, error } = await supabase
    .from("playlists")
    .select("id")
    .eq("id", playlistId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  assertNoError(error, context);

  if (!data) {
    throw new Error(`${context}: playlist not found or not owned by user`);
  }
}

export async function addToOwnedPlaylist(
  supabase: PlaylistItemMutationClient,
  ownerId: string,
  playlistId: string,
  paperId: string,
) {
  await requireOwnedPlaylist(
    supabase,
    ownerId,
    playlistId,
    "Authorize playlist add",
  );

  const { data: maxRow, error: maxError } = await supabase
    .from("playlist_items")
    .select("position")
    .eq("playlist_id", playlistId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  assertNoError(maxError, "Find playlist position");

  const currentMaxPosition =
    typeof maxRow?.position === "number" ? maxRow.position : -1;

  const { error } = await supabase.from("playlist_items").upsert(
    {
      playlist_id: playlistId,
      paper_id: paperId,
      position: currentMaxPosition + 1,
    },
    { onConflict: "playlist_id,paper_id" },
  );

  assertNoError(error, "Add to playlist");
}

export async function removeFromOwnedPlaylist(
  supabase: PlaylistItemMutationClient,
  ownerId: string,
  playlistId: string,
  paperId: string,
) {
  await requireOwnedPlaylist(
    supabase,
    ownerId,
    playlistId,
    "Authorize playlist removal",
  );

  const { error } = await supabase
    .from("playlist_items")
    .delete()
    .eq("playlist_id", playlistId)
    .eq("paper_id", paperId);

  assertNoError(error, "Remove from playlist");
}

export async function reorderOwnedPlaylistItems(
  supabase: PlaylistItemMutationClient,
  ownerId: string,
  playlistId: string,
  orderedPaperIds: string[],
) {
  await requireOwnedPlaylist(
    supabase,
    ownerId,
    playlistId,
    "Authorize playlist reorder",
  );

  for (let i = 0; i < orderedPaperIds.length; i++) {
    const { error } = await supabase
      .from("playlist_items")
      .update({ position: i })
      .eq("playlist_id", playlistId)
      .eq("paper_id", orderedPaperIds[i]);

    assertNoError(error, "Reorder playlist");
  }
}
