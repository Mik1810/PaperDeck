import { redirect } from "next/navigation";
import { requireOwnerId } from "@/lib/auth/session";
import { hasUsableOnboardingState } from "@/lib/repositories/user-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ownerId = await requireOwnerId();

  redirect((await hasUsableOnboardingState(ownerId)) ? "/feed" : "/onboarding");
}
