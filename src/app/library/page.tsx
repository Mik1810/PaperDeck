import { AppShell } from "@/components/app-shell";
import { LibraryWorkspace } from "@/components/library-workspace";
import { requireOwnerId } from "@/lib/auth/session";
import {
  getLibraryInitialData,
  hasUsableOnboardingState,
} from "@/lib/repositories/user-data";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type LibraryPageProps = {
  searchParams: Promise<{ playlist?: string; view?: string }>;
};

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const ownerId = await requireOwnerId();

  if (!(await hasUsableOnboardingState(ownerId))) {
    redirect("/onboarding");
  }

  const { playlist: requestedPlaylistId, view } = await searchParams;
  const {
    favoriteCount,
    ignoredCount,
    playlists,
    readLaterPapers,
    readLaterCount,
  } = await getLibraryInitialData(ownerId);

  const selectedPlaylist = requestedPlaylistId
    ? playlists.find(
        (playlist) =>
          playlist.id === requestedPlaylistId && !playlist.isDefault,
      ) ?? null
    : null;
  const selectedView = selectedPlaylist
    ? "playlist"
    : view === "favorites"
      ? "favorites"
      : view === "ignored"
        ? "ignored"
        : "read-later";
  return (
    <AppShell
      title="Library"
      subtitle="Your private paper collections."
      readLaterCount={readLaterCount}
    >
      <LibraryWorkspace
        initialFavoriteCount={favoriteCount}
        initialIgnoredCount={ignoredCount}
        initialPlaylists={playlists}
        initialReadLaterPapers={readLaterPapers}
        initialSelectedPlaylistId={selectedPlaylist?.id ?? null}
        initialSelectedView={selectedView}
      />
    </AppShell>
  );
}
