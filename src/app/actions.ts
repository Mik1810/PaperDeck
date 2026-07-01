"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserContext } from "@/lib/auth/session";
import {
  ensureUserProfile,
  recordPaperInteraction,
  saveSelectedTopics,
  saveToReadLater,
  toggleFavorite,
} from "@/lib/repositories/user-data";

function requirePaperId(formData: FormData) {
  const paperId = formData.get("paperId");

  if (typeof paperId !== "string" || !paperId) {
    throw new Error("Missing paperId");
  }

  return paperId;
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
  const user = await requireUserContext();
  await ensureUserProfile(user);
  await recordPaperInteraction(user.ownerId, requirePaperId(formData), "dismiss");

  revalidatePath("/feed");
}

export async function openPaperAction(formData: FormData) {
  const user = await requireUserContext();
  await ensureUserProfile(user);
  const paperId = requirePaperId(formData);

  await recordPaperInteraction(user.ownerId, paperId, "open_detail");

  revalidatePath("/feed");
  redirect(`/papers/${paperId}`);
}

export async function toggleFavoriteAction(formData: FormData) {
  const user = await requireUserContext();
  await ensureUserProfile(user);
  const paperId = requirePaperId(formData);

  await toggleFavorite(user.ownerId, paperId);

  revalidatePath("/feed");
  revalidatePath("/library");
  revalidatePath(`/papers/${paperId}`);
}

export async function saveToReadLaterAction(formData: FormData) {
  const user = await requireUserContext();
  await ensureUserProfile(user);
  const paperId = requirePaperId(formData);

  await saveToReadLater(user.ownerId, paperId);

  revalidatePath("/feed");
  revalidatePath("/library");
  revalidatePath(`/papers/${paperId}`);
}
