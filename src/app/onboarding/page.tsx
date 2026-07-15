import { OnboardingTopicPicker } from "@/components/onboarding-topic-picker";
import { requireUserContext } from "@/lib/auth/session";
import { isDevAuthEnabled } from "@/lib/auth/dev-auth";
import {
  ensureUserProfile,
  getOnboardingData,
  hasUsableOnboardingState,
} from "@/lib/repositories/user-data";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUserContext();
  await ensureUserProfile(user);

  if (await hasUsableOnboardingState(user.ownerId)) {
    redirect("/feed");
  }

  const { topics } = await getOnboardingData(user.ownerId);

  return (
    <OnboardingTopicPicker
      devAuthEnabled={isDevAuthEnabled()}
      initialDisplayName={user.displayName ?? ""}
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
