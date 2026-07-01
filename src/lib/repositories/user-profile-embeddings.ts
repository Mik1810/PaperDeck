import "server-only";

import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { InteractionType } from "@/types/paper";

const EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5";
const EMBEDDING_DIMENSION = 384;
const MAX_INTERACTIONS = 100;

type TopicEmbeddingRow = {
  topic_id: string;
  embedding: string | number[];
  embedded_at: string | null;
};

type PaperEmbeddingRow = {
  id: string;
  embedding: string | number[];
  embedded_at: string | null;
};

type InteractionRow = {
  id: string;
  paper_id: string;
  action: InteractionType;
  created_at: string;
};

type ProfileEmbeddingRow = {
  input_signature: string;
};

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>;

export type ProfileEmbeddingRefreshResult =
  | {
      status: "up_to_date";
      vectorCount: number;
    }
  | {
      status: "updated";
      vectorCount: number;
    }
  | {
      status: "skipped";
      reason: "no_weighted_vectors" | "zero_vector";
      vectorCount: number;
    };

const paperInteractionWeights: Partial<Record<InteractionType, number>> = {
  open_detail: 2,
  favorite: 6,
  save_to_playlist: 5,
  read: 3,
  not_interested: -5,
  dismiss: -4,
};

function assertNoError(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function parseVector(value: string | number[]) {
  const vector = Array.isArray(value)
    ? value.map(Number)
    : value
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .filter(Boolean)
        .map(Number);

  if (vector.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSION} embedding dimensions, received ${vector.length}`,
    );
  }

  return vector;
}

function vectorLiteral(vector: number[]) {
  return `[${vector.map((value) => value.toFixed(8)).join(",")}]`;
}

function l2Normalize(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));

  if (!norm) {
    return null;
  }

  return vector.map((value) => value / norm);
}

function addWeightedVector(
  accumulator: number[],
  vector: number[],
  weight: number,
) {
  for (let index = 0; index < EMBEDDING_DIMENSION; index += 1) {
    accumulator[index] += vector[index] * weight;
  }
}

function stableSignature(payload: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function accumulateWeights(
  weights: Map<string, number>,
  paperId: string,
  weight: number,
) {
  if (!weight) {
    return;
  }

  weights.set(paperId, (weights.get(paperId) ?? 0) + weight);
}

async function clearUserProfileEmbedding(
  supabase: ServiceRoleClient,
  ownerId: string,
  context: string,
) {
  const { error } = await supabase
    .from("user_profile_embeddings")
    .delete()
    .eq("owner_id", ownerId)
    .eq("embedding_model", EMBEDDING_MODEL);

  assertNoError(error, context);
}

async function getReadLaterPaperIds(ownerId: string) {
  const supabase = createServiceRoleClient();
  const { data: readLaterPlaylist, error: playlistError } = await supabase
    .from("playlists")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("name", "Read later")
    .maybeSingle();

  assertNoError(playlistError, "Find Read later playlist for profile embedding");

  if (!readLaterPlaylist) {
    return [];
  }

  const { data: items, error: itemsError } = await supabase
    .from("playlist_items")
    .select("paper_id")
    .eq("playlist_id", readLaterPlaylist.id);

  assertNoError(itemsError, "Load Read later items for profile embedding");

  return (items ?? []).map((item) => item.paper_id as string);
}

export async function refreshUserProfileEmbedding(
  ownerId: string,
): Promise<ProfileEmbeddingRefreshResult> {
  const supabase = createServiceRoleClient();
  const [
    { data: interests, error: interestsError },
    { data: favorites, error: favoritesError },
    { data: interactions, error: interactionsError },
    readLaterPaperIds,
  ] = await Promise.all([
    supabase
      .from("user_interests")
      .select("topic_id, selected_at")
      .eq("owner_id", ownerId)
      .order("selected_at", { ascending: true }),
    supabase.from("favorites").select("paper_id, created_at").eq("owner_id", ownerId),
    supabase
      .from("user_paper_interactions")
      .select("id, paper_id, action, created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(MAX_INTERACTIONS),
    getReadLaterPaperIds(ownerId),
  ]);

  assertNoError(interestsError, "Load interests for profile embedding");
  assertNoError(favoritesError, "Load favorites for profile embedding");
  assertNoError(interactionsError, "Load interactions for profile embedding");

  const selectedTopicIds = [
    ...new Set((interests ?? []).map((interest) => interest.topic_id as string)),
  ].sort();
  const paperWeights = new Map<string, number>();

  for (const favorite of favorites ?? []) {
    accumulateWeights(paperWeights, favorite.paper_id as string, 6);
  }

  for (const paperId of readLaterPaperIds) {
    accumulateWeights(paperWeights, paperId, 5);
  }

  for (const interaction of (interactions ?? []) as InteractionRow[]) {
    const weight = paperInteractionWeights[interaction.action] ?? 0;
    accumulateWeights(paperWeights, interaction.paper_id, weight);
  }

  const [topicEmbeddings, paperEmbeddings] = await Promise.all([
    selectedTopicIds.length
      ? supabase
          .from("topic_embeddings")
          .select("topic_id, embedding, embedded_at")
          .eq("embedding_model", EMBEDDING_MODEL)
          .in("topic_id", selectedTopicIds)
      : Promise.resolve({ data: [], error: null }),
    paperWeights.size
      ? supabase
          .from("papers")
          .select("id, embedding, embedded_at")
          .eq("embedding_model", EMBEDDING_MODEL)
          .not("embedding", "is", null)
          .in("id", [...paperWeights.keys()])
      : Promise.resolve({ data: [], error: null }),
  ]);

  assertNoError(topicEmbeddings.error, "Load topic embeddings");
  assertNoError(paperEmbeddings.error, "Load paper embeddings");

  const accumulator = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  let vectorCount = 0;
  const signatureTopics = (topicEmbeddings.data ?? []) as TopicEmbeddingRow[];
  const signaturePapers = (paperEmbeddings.data ?? []) as PaperEmbeddingRow[];
  const embeddedTopicsById = new Map(
    signatureTopics.map((row) => [row.topic_id, row.embedded_at]),
  );
  const embeddedPapersById = new Map(
    signaturePapers.map((row) => [row.id, row.embedded_at]),
  );
  const weightedPaperInputs = [...paperWeights.entries()]
    .map(([id, weight]) => ({
      id,
      weight,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const row of signatureTopics) {
    addWeightedVector(accumulator, parseVector(row.embedding), 4);
    vectorCount += 1;
  }

  for (const row of signaturePapers) {
    const weight = paperWeights.get(row.id) ?? 0;

    if (!weight) {
      continue;
    }

    addWeightedVector(accumulator, parseVector(row.embedding), weight);
    vectorCount += 1;
  }

  if (!vectorCount) {
    await clearUserProfileEmbedding(
      supabase,
      ownerId,
      "Clear stale user profile embedding without source vectors",
    );

    return {
      status: "skipped",
      reason: "no_weighted_vectors",
      vectorCount,
    };
  }

  const normalized = l2Normalize(accumulator);

  if (!normalized) {
    await clearUserProfileEmbedding(
      supabase,
      ownerId,
      "Clear stale user profile embedding with zero vector",
    );

    return {
      status: "skipped",
      reason: "zero_vector",
      vectorCount,
    };
  }

  const inputSignature = stableSignature({
    model: EMBEDDING_MODEL,
    topics: selectedTopicIds.map((id) => ({
      id,
      embeddedAt: embeddedTopicsById.get(id) ?? null,
    })),
    papers: weightedPaperInputs.map((paper) => ({
      ...paper,
      embeddedAt: embeddedPapersById.get(paper.id) ?? null,
    })),
    interactions: ((interactions ?? []) as InteractionRow[]).map((interaction) => ({
      id: interaction.id,
      action: interaction.action,
      createdAt: interaction.created_at,
    })),
  });
  const { data: existing, error: existingError } = await supabase
    .from("user_profile_embeddings")
    .select("input_signature")
    .eq("owner_id", ownerId)
    .eq("embedding_model", EMBEDDING_MODEL)
    .maybeSingle();

  assertNoError(existingError, "Load existing user profile embedding");

  if ((existing as ProfileEmbeddingRow | null)?.input_signature === inputSignature) {
    return {
      status: "up_to_date",
      vectorCount,
    };
  }

  const { error: upsertError } = await supabase
    .from("user_profile_embeddings")
    .upsert(
      {
        owner_id: ownerId,
        embedding: vectorLiteral(normalized),
        embedding_model: EMBEDDING_MODEL,
        embedding_dimension: EMBEDDING_DIMENSION,
        input_signature: inputSignature,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,embedding_model" },
    );

  assertNoError(upsertError, "Save user profile embedding");

  return {
    status: "updated",
    vectorCount,
  };
}
