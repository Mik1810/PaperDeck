import { AppShell } from "@/components/app-shell";
import { FeedDeck } from "@/components/feed-deck";
import { requireOwnerId } from "@/lib/auth/session";
import {
  getFeedPageData,
  hasUsableOnboardingState,
} from "@/lib/repositories/user-data";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const ownerId = await requireOwnerId();

  if (!(await hasUsableOnboardingState(ownerId))) {
    redirect("/onboarding");
  }

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
