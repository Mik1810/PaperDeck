"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwnerId, requireUserContext } from "@/lib/auth/session";
import {
  ensureUserProfile,
  recordPaperInteraction,
  saveSelectedTopics,
  toggleReadLater,
  toggleFavorite,
} from "@/lib/repositories/user-data";

function requirePaperId(formData: FormData) {
  const paperId = formData.get("paperId");

  if (typeof paperId !== "string" || !paperId) {
    throw new Error("Missing paperId");
  }

  return paperId;
}

function sourcePathFrom(formData: FormData, fallback: string) {
  const sourcePath = formData.get("sourcePath");

  if (typeof sourcePath !== "string") {
    return fallback;
  }

  if (
    sourcePath === "/feed" ||
    sourcePath === "/library" ||
    sourcePath === "/onboarding" ||
    sourcePath === "/settings" ||
    /^\/papers\/[0-9a-f-]+$/i.test(sourcePath)
  ) {
    return sourcePath;
  }

  return fallback;
}

export async function saveOnboardingInterestsAction(formData: FormData) {
  const user = await requireUserContext();
  await ensureUserProfile(user);

  const topicIds = formData
    .getAll("topicId")
    .filter((topicId): topicId is string => typeof topicId === "string");

  await saveSelectedTopics(user.ownerId, topicIds);

  revalidatePath("/feed");
  revalidatePath("/onboarding");
  revalidatePath("/settings");
  redirect("/feed");
}

export async function dismissPaperAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  await recordPaperInteraction(ownerId, requirePaperId(formData), "dismiss");

  revalidatePath(sourcePathFrom(formData, "/feed"));
}

export async function openPaperAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const paperId = requirePaperId(formData);

  await recordPaperInteraction(ownerId, paperId, "open_detail");

  revalidatePath(sourcePathFrom(formData, "/feed"));
  redirect(`/papers/${paperId}`);
}

export async function toggleFavoriteAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const paperId = requirePaperId(formData);

  await toggleFavorite(ownerId, paperId);

  revalidatePath(sourcePathFrom(formData, "/feed"));
}

export async function toggleReadLaterAction(formData: FormData) {
  const ownerId = await requireOwnerId();
  const paperId = requirePaperId(formData);

  await toggleReadLater(ownerId, paperId);

  revalidatePath(sourcePathFrom(formData, "/feed"));
}
