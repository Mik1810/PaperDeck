import "server-only";

import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  userProfileEmbeddings,
  topicEmbeddings,
  papers,
  userInterests,
  favorites,
  userPaperInteractions,
  playlists,
  playlistItems,
} from "@/db/schema";
import type { InteractionType } from "@/types/paper";

export const EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const EMBEDDING_DIMENSION = 384;
const MAX_INTERACTIONS = 100;

type TopicEmbeddingRow = {
  topicId: string;
  embedding: string | number[];
  embeddedAt: string | null;
};

type PaperEmbeddingRow = {
  id: string;
  embedding: string | number[];
  embeddedAt: string | null;
};

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

async function getReadLaterPaperIds(ownerId: string) {
  const playlistRows = await db
    .select({ id: playlists.id })
    .from(playlists)
    .where(
      and(
        eq(playlists.ownerId, ownerId),
        eq(playlists.name, "Read later"),
      ),
    )
    .limit(1);

  if (!playlistRows.length) {
    return [];
  }

  const items = await db
    .select({ paperId: playlistItems.paperId })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, playlistRows[0].id));

  return items.map((r) => r.paperId);
}

export async function refreshUserProfileEmbedding(
  ownerId: string,
): Promise<ProfileEmbeddingRefreshResult> {
  const [interests, favRows, interactionRows, readLaterPaperIds] =
    await Promise.all([
      db
        .select({
          topicId: userInterests.topicId,
          selectedAt: userInterests.selectedAt,
        })
        .from(userInterests)
        .where(eq(userInterests.ownerId, ownerId))
        .orderBy(asc(userInterests.selectedAt)),
      db
        .select({ paperId: favorites.paperId, createdAt: favorites.createdAt })
        .from(favorites)
        .where(eq(favorites.ownerId, ownerId)),
      db
        .select({
          id: userPaperInteractions.id,
          paperId: userPaperInteractions.paperId,
          action: userPaperInteractions.action,
          createdAt: userPaperInteractions.createdAt,
        })
        .from(userPaperInteractions)
        .where(eq(userPaperInteractions.ownerId, ownerId))
        .orderBy(desc(userPaperInteractions.createdAt))
        .limit(MAX_INTERACTIONS),
      getReadLaterPaperIds(ownerId),
    ]);

  const selectedTopicIds = [...new Set(interests.map((r) => r.topicId))].sort();
  const paperWeights = new Map<string, number>();

  for (const fav of favRows) {
    accumulateWeights(paperWeights, fav.paperId, 6);
  }

  for (const paperId of readLaterPaperIds) {
    accumulateWeights(paperWeights, paperId, 5);
  }

  for (const interaction of interactionRows) {
    const weight = paperInteractionWeights[interaction.action] ?? 0;
    accumulateWeights(paperWeights, interaction.paperId, weight);
  }

  const [topicEmbRows, paperEmbRows] = await Promise.all([
    selectedTopicIds.length
      ? db
          .select({
            topicId: topicEmbeddings.topicId,
            embedding: topicEmbeddings.embedding,
            embeddedAt: topicEmbeddings.embeddedAt,
          })
          .from(topicEmbeddings)
          .where(
            and(
              eq(topicEmbeddings.embeddingModel, EMBEDDING_MODEL),
              inArray(topicEmbeddings.topicId, selectedTopicIds),
            ),
          )
      : ([] as TopicEmbeddingRow[]),
    paperWeights.size
      ? db
          .select({
            id: papers.id,
            embedding: papers.embedding,
            embeddedAt: papers.embeddedAt,
          })
          .from(papers)
          .where(
            and(
              eq(papers.embeddingModel, EMBEDDING_MODEL),
              isNotNull(papers.embedding),
              inArray(papers.id, [...paperWeights.keys()]),
            ),
          )
      : ([] as PaperEmbeddingRow[]),
  ]);

  const accumulator = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  let vectorCount = 0;
  const embeddedTopicsById = new Map(
    topicEmbRows.map((row) => [row.topicId, row.embeddedAt]),
  );
  const embeddedPapersById = new Map(
    paperEmbRows.map((row) => [row.id, row.embeddedAt]),
  );
  const weightedPaperInputs = [...paperWeights.entries()]
    .map(([id, weight]) => ({
      id,
      weight,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const row of topicEmbRows) {
    addWeightedVector(accumulator, parseVector(row.embedding), 4);
    vectorCount += 1;
  }

  for (const row of paperEmbRows) {
    const weight = paperWeights.get(row.id) ?? 0;

    if (!weight || !row.embedding) {
      continue;
    }

    addWeightedVector(accumulator, parseVector(row.embedding), weight);
    vectorCount += 1;
  }

  if (!vectorCount) {
    return {
      status: "skipped",
      reason: "no_weighted_vectors",
      vectorCount,
    };
  }

  const normalized = l2Normalize(accumulator);

  if (!normalized) {
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
    interactions: interactionRows.map((r) => ({
      id: r.id,
      action: r.action,
      createdAt: r.createdAt,
    })),
  });

  const existing = await db
    .select({
      inputSignature: userProfileEmbeddings.inputSignature,
    })
    .from(userProfileEmbeddings)
    .where(
      and(
        eq(userProfileEmbeddings.ownerId, ownerId),
        eq(userProfileEmbeddings.embeddingModel, EMBEDDING_MODEL),
      ),
    )
    .limit(1);

  if (existing[0]?.inputSignature === inputSignature) {
    return {
      status: "up_to_date",
      vectorCount,
    };
  }

  await db
    .insert(userProfileEmbeddings)
    .values({
      ownerId,
      embedding: sql`${`[${normalized.join(",")}]`}::vector`,
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimension: EMBEDDING_DIMENSION,
      inputSignature,
    })
    .onConflictDoUpdate({
      target: [
        userProfileEmbeddings.ownerId,
        userProfileEmbeddings.embeddingModel,
      ],
      set: {
        embedding: sql`${`[${normalized.join(",")}]`}::vector`,
        embeddingDimension: EMBEDDING_DIMENSION,
        inputSignature,
        generatedAt: sql`now()`,
      },
    });

  return {
    status: "updated",
    vectorCount,
  };
}
