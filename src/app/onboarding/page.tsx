import { OnboardingTopicPicker } from "@/components/onboarding-topic-picker";
import { requireUserContext } from "@/lib/auth/session";
import { isDevAuthEnabled } from "@/lib/auth/dev-auth";
import { getOnboardingData, ensureUserProfile } from "@/lib/repositories/user-data";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUserContext();
  await ensureUserProfile(user);
  const { topics } = await getOnboardingData(user.ownerId);

  return (
    <OnboardingTopicPicker
      devAuthEnabled={isDevAuthEnabled()}
      topics={topics.map((topic) => ({
        id: topic.id,
        arxivCategory: topic.arxivCategory,
        label: topic.label,
        parentId: topic.parentId,
        depth: topic.depth,
        slug: topic.slug,
        source: topic.source,
      }))}
    />
  );
}
