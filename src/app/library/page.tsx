import { AppShell } from "@/components/app-shell";
import { LibraryWorkspace } from "@/components/library-workspace";
import { requireOwnerId } from "@/lib/auth/session";
import {
  isLibraryCollectionKey,
  type LibraryCollectionKey,
} from "@/lib/library-collections";
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
  const requestedCollectionKey = requestedPlaylistId
    ? `playlist:${requestedPlaylistId}`
    : view === "favorites"
      ? "favorites"
      : view === "ignored"
        ? "ignored"
        : "read-later";
  const safeRequestedCollectionKey: LibraryCollectionKey =
    isLibraryCollectionKey(requestedCollectionKey)
      ? requestedCollectionKey
      : "read-later";
  const {
    favoriteCount,
    ignoredCount,
    initialCollectionPage,
    playlists,
    readLaterCount,
    selectedCollectionKey,
  } = await getLibraryInitialData(ownerId, safeRequestedCollectionKey);

  return (
    <AppShell
      title="Library"
      subtitle="Your private paper collections."
      readLaterCount={readLaterCount}
    >
      <LibraryWorkspace
        initialFavoriteCount={favoriteCount}
        initialIgnoredCount={ignoredCount}
        initialCollectionPage={initialCollectionPage}
        initialPlaylists={playlists}
        initialReadLaterCount={readLaterCount}
        initialSelectedKey={selectedCollectionKey}
      />
    </AppShell>
  );
}
