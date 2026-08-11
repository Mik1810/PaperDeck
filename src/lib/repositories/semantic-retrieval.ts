import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { profiles, userProfileEmbeddings } from "@/db/schema";
import {
  SemanticMatchRowArraySchema,
  type SemanticMatchRow,
} from "@/lib/schemas/semantic-match";

export type SemanticPaperCandidates = {
  paperIds: string[];
  semanticScores: Map<string, number>;
  diagnostics: SemanticRetrievalDiagnostics;
};

export type SemanticRetrievalFallbackReason =
  | "profile_missing"
  | "profile_stale"
  | "profile_refresh_failed"
  | "no_matches"
  | "no_papers_loaded"
  | "ranker_filtered_all";

export type SemanticRetrievalDiagnostics = {
  requestedCount: number;
  rpcAttempted: boolean;
  matchedCount: number;
  candidateCount: number;
  model: string | null;
  fallbackReason: SemanticRetrievalFallbackReason | null;
  profileRefreshStatus: "up_to_date" | "updated" | "skipped" | null;
  profileRefreshReason: "no_weighted_vectors" | "zero_vector" | null;
  profileRefreshError: string | null;
};

function emptyResult(
  diagnostics: Partial<SemanticRetrievalDiagnostics>,
): SemanticPaperCandidates {
  return {
    paperIds: [],
    semanticScores: new Map(),
    diagnostics: {
      requestedCount: 100,
      rpcAttempted: false,
      matchedCount: 0,
      candidateCount: 0,
      model: null,
      fallbackReason: null,
      profileRefreshStatus: null,
      profileRefreshReason: null,
      profileRefreshError: null,
      ...diagnostics,
    },
  };
}

async function matchPapersByEmbedding(
  queryEmbedding: string | number[],
  matchCount: number,
  embeddingModelFilter: string,
): Promise<SemanticMatchRow[]> {
  const embeddingStr = Array.isArray(queryEmbedding)
    ? `[${queryEmbedding.join(",")}]`
    : queryEmbedding;

  const result = await db.execute(
    sql`SELECT * FROM match_papers_by_embedding(${embeddingStr}::vector, ${matchCount}, ${embeddingModelFilter})`,
  );

  return SemanticMatchRowArraySchema.parse(result.rows);
}

/** @admin */
export async function getSemanticPaperCandidates(
  ownerId: string,
  matchCount = 100,
): Promise<SemanticPaperCandidates> {
  const profileRows = await db
    .select({
      embedding: userProfileEmbeddings.embedding,
      embeddingModel: userProfileEmbeddings.embeddingModel,
      inputGeneration: userProfileEmbeddings.inputGeneration,
      currentGeneration: profiles.embeddingInputGeneration,
    })
    .from(userProfileEmbeddings)
    .innerJoin(profiles, eq(profiles.ownerId, userProfileEmbeddings.ownerId))
    .where(eq(userProfileEmbeddings.ownerId, ownerId))
    .orderBy(desc(userProfileEmbeddings.generatedAt))
    .limit(1);

  if (!profileRows.length) {
    return emptyResult({
      requestedCount: matchCount,
      fallbackReason: "profile_missing",
    });
  }

  const profileRow = profileRows[0];
  if (profileRow.inputGeneration !== profileRow.currentGeneration) {
    return emptyResult({
      requestedCount: matchCount,
      fallbackReason: "profile_stale",
    });
  }

  const model = profileRow.embeddingModel;

  const semanticMatches = await matchPapersByEmbedding(
    profileRow.embedding,
    matchCount,
    model,
  );

  if (!semanticMatches.length) {
    return emptyResult({
      requestedCount: matchCount,
      rpcAttempted: true,
      model,
      fallbackReason: "no_matches",
    });
  }

  const semanticScores = new Map(
    semanticMatches.map((match) => [match.paper_id, match.semantic_score]),
  );

  const paperIds = semanticMatches.map((match) => match.paper_id);

  return {
    paperIds,
    semanticScores,
    diagnostics: {
      requestedCount: matchCount,
      rpcAttempted: true,
      matchedCount: semanticMatches.length,
      candidateCount: paperIds.length,
      model,
      fallbackReason: null,
      profileRefreshStatus: null,
      profileRefreshReason: null,
      profileRefreshError: null,
    },
  };
}
