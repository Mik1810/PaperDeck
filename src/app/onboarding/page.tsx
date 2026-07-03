import { AppShell } from "@/components/app-shell";
import { OnboardingTopicPicker } from "@/components/onboarding-topic-picker";
import { requireUserContext } from "@/lib/auth/session";
import { getOnboardingData, ensureUserProfile } from "@/lib/repositories/user-data";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUserContext();
  await ensureUserProfile(user);
  const { topics, selectedTopicIds } = await getOnboardingData(user.ownerId);

  return (
    <AppShell
      title="Topics"
      subtitle="Choose broad areas first, then refine the graph with related CS topics."
    >
      <OnboardingTopicPicker
        initialSelectedTopicIds={[...selectedTopicIds]}
        topics={topics.map((topic) => ({
          id: topic.id,
          label: topic.label,
          parentId: topic.parentId,
          depth: topic.depth,
        }))}
      />
    </AppShell>
  );
}
