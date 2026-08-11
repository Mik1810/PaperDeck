import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  notInArray,
} from "drizzle-orm";
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
  profiles,
} from "@/db/schema";
import {
  addWeightedEmbeddingVector,
  buildProfilePaperWeights,
  createEmbeddingAccumulator,
  l2NormalizeEmbedding,
  parseEmbeddingVector,
  PROFILE_EMBEDDING_DIMENSION,
  vectorToPgLiteral,
} from "@/lib/profile-embedding-utils";
import {
  createRefreshCoalescer,
  refreshLatestGeneration,
} from "@/lib/profile-embedding-refresh-coordinator";

export const EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
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
    }
  | {
      status: "superseded";
      vectorCount: 0;
    };

function parseVector(value: string | number[]) {
  return parseEmbeddingVector(value, PROFILE_EMBEDDING_DIMENSION);
}

function l2Normalize(vector: number[]) {
  return l2NormalizeEmbedding(vector);
}

function addWeightedVector(
  accumulator: number[],
  vector: number[],
  weight: number,
) {
  addWeightedEmbeddingVector(accumulator, vector, weight);
}

function stableSignature(payload: unknown) {
  return JSON.stringify(payload);
}

async function getPlaylistPaperIds(ownerId: string) {
  const items = await db
    .selectDistinct({ paperId: playlistItems.paperId })
    .from(playlistItems)
    .innerJoin(
      playlists,
      and(
        eq(playlists.id, playlistItems.playlistId),
        eq(playlists.ownerId, ownerId),
      ),
    );

  return items.map((r) => r.paperId);
}

async function currentInputGeneration(ownerId: string) {
  const rows = await db
    .select({ generation: profiles.embeddingInputGeneration })
    .from(profiles)
    .where(eq(profiles.ownerId, ownerId))
    .limit(1);

  return rows[0]?.generation ?? null;
}

async function clearUserProfileEmbeddingIfCurrent(
  ownerId: string,
  inputGeneration: number,
) {
  const result = await db.execute<{ current: boolean }>(sql`
    with current_generation as materialized (
      select 1
      from public.profiles
      where owner_id = ${ownerId}
        and embedding_input_generation = ${inputGeneration}
      for update
    ), deleted as (
      delete from public.user_profile_embeddings
      where owner_id = ${ownerId}
        and embedding_model = ${EMBEDDING_MODEL}
        and exists (select 1 from current_generation)
      returning 1
    )
    select exists(select 1 from current_generation) as current
  `);

  return result.rows[0]?.current ?? false;
}

async function upsertUserProfileEmbeddingIfCurrent(
  ownerId: string,
  normalized: number[],
  inputSignature: string,
  inputGeneration: number,
) {
  const embeddingLiteral = vectorToPgLiteral(normalized);

  const result = await db.execute<{ input_generation: number }>(sql`
    with current_generation as materialized (
      select 1
      from public.profiles
      where owner_id = ${ownerId}
        and embedding_input_generation = ${inputGeneration}
      for update
    )
    insert into public.user_profile_embeddings (
      owner_id,
      embedding,
      embedding_model,
      embedding_dimension,
      input_signature,
      input_generation,
      generated_at
    )
    select
      ${ownerId},
      ${embeddingLiteral}::vector,
      ${EMBEDDING_MODEL},
      ${PROFILE_EMBEDDING_DIMENSION},
      ${inputSignature},
      ${inputGeneration},
      now()
    from current_generation
    on conflict (owner_id, embedding_model) do update
    set embedding = excluded.embedding,
        embedding_dimension = excluded.embedding_dimension,
        input_signature = excluded.input_signature,
        input_generation = excluded.input_generation,
        generated_at = now()
    where exists (
      select 1
      from current_generation
    )
    returning input_generation
  `);

  return result.rows.length > 0;
}

async function refreshUserProfileEmbeddingOnce(
  ownerId: string,
): Promise<
  | { committed: true; value: ProfileEmbeddingRefreshResult }
  | { committed: false }
> {
  const inputGeneration = await currentInputGeneration(ownerId);
  if (inputGeneration === null) {
    return { committed: false };
  }

  const [interests, favRows, interactionRows, playlistPaperIds] =
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
        .where(
          and(
            eq(userPaperInteractions.ownerId, ownerId),
            notInArray(userPaperInteractions.action, [
              "favorite",
              "save_to_playlist",
            ]),
          ),
        )
        .orderBy(desc(userPaperInteractions.createdAt))
        .limit(MAX_INTERACTIONS),
      getPlaylistPaperIds(ownerId),
    ]);

  const selectedTopicIds = [...new Set(interests.map((r) => r.topicId))].sort();
  const paperWeights = buildProfilePaperWeights({
    favoritePaperIds: favRows.map((favorite) => favorite.paperId),
    playlistPaperIds,
    interactions: interactionRows,
  });

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

  if ((await currentInputGeneration(ownerId)) !== inputGeneration) {
    return { committed: false };
  }

  const accumulator = createEmbeddingAccumulator(PROFILE_EMBEDDING_DIMENSION);
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
    if (!(await clearUserProfileEmbeddingIfCurrent(ownerId, inputGeneration))) {
      return { committed: false };
    }

    return {
      committed: true,
      value: {
        status: "skipped",
        reason: "no_weighted_vectors",
        vectorCount,
      },
    };
  }

  const normalized = l2Normalize(accumulator);

  if (!normalized) {
    if (!(await clearUserProfileEmbeddingIfCurrent(ownerId, inputGeneration))) {
      return { committed: false };
    }

    return {
      committed: true,
      value: {
        status: "skipped",
        reason: "zero_vector",
        vectorCount,
      },
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
      inputGeneration: userProfileEmbeddings.inputGeneration,
    })
    .from(userProfileEmbeddings)
    .where(
      and(
        eq(userProfileEmbeddings.ownerId, ownerId),
        eq(userProfileEmbeddings.embeddingModel, EMBEDDING_MODEL),
      ),
    )
    .limit(1);

  if (
    existing[0]?.inputSignature === inputSignature &&
    existing[0]?.inputGeneration === inputGeneration
  ) {
    if ((await currentInputGeneration(ownerId)) !== inputGeneration) {
      return { committed: false };
    }
    return {
      committed: true,
      value: { status: "up_to_date", vectorCount },
    };
  }

  if (
    !(await upsertUserProfileEmbeddingIfCurrent(
      ownerId,
      normalized,
      inputSignature,
      inputGeneration,
    ))
  ) {
    return { committed: false };
  }

  return {
    committed: true,
    value: { status: "updated", vectorCount },
  };
}

async function refreshUserProfileEmbeddingUntilCurrent(ownerId: string) {
  const result = await refreshLatestGeneration(() =>
    refreshUserProfileEmbeddingOnce(ownerId),
  );

  return result ?? { status: "superseded" as const, vectorCount: 0 as const };
}

const coalescedRefresh = createRefreshCoalescer(
  refreshUserProfileEmbeddingUntilCurrent,
);

/** @user-scoped */
export async function refreshUserProfileEmbedding(
  ownerId: string,
): Promise<ProfileEmbeddingRefreshResult> {
  return coalescedRefresh(ownerId);
}
