import { AppShell } from "@/components/app-shell";
import { FeedDeck } from "@/components/feed-deck";
import { requireOwnerId } from "@/lib/auth/session";
import { getFeedPageData } from "@/lib/repositories/user-data";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const ownerId = await requireOwnerId();
  const {
    activePaper,
    nextPapers,
    favoriteIds,
    readLaterIds,
    readLaterCount,
  } = await getFeedPageData(ownerId);

  return (
    <AppShell
      title="Today"
      subtitle="A relevance-first deck tuned from your topics and recent feedback."
      readLaterCount={readLaterCount}
    >
      <FeedDeck
        activePaper={activePaper}
        favoritePaperIds={[...favoriteIds]}
        nextPapers={nextPapers}
        readLaterPaperIds={[...readLaterIds]}
      />
    </AppShell>
  );
}
