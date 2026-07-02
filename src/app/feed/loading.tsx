import { AppShell } from "@/components/app-shell";
import { SkeletonCard } from "@/components/skeleton-card";

export default function FeedLoading() {
  return (
    <AppShell title="Feed" subtitle="Your personalized paper deck">
      <div>
        <SkeletonCard />
      </div>
    </AppShell>
  );
}
