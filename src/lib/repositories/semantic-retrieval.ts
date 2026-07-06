import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { userProfileEmbeddings } from "@/db/schema";
import { getPapersByIds } from "@/lib/repositories/catalog";
import type { Paper } from "@/types/paper";

type SemanticMatchRow = {
  paper_id: string;
  semantic_score: number;
};

export type SemanticPaperCandidates = {
  papers: Paper[];
  semanticScores: Map<string, number>;
  diagnostics: SemanticRetrievalDiagnostics;
};

export type SemanticRetrievalFallbackReason =
  | "profile_missing"
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
    papers: [],
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

  return (result as unknown as SemanticMatchRow[]) ?? [];
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
    })
    .from(userProfileEmbeddings)
    .where(
      eq(userProfileEmbeddings.ownerId, ownerId),
    )
    .orderBy(desc(userProfileEmbeddings.generatedAt))
    .limit(1);

  if (!profileRows.length) {
    return emptyResult({
      requestedCount: matchCount,
      fallbackReason: "profile_missing",
    });
  }

  const profileRow = profileRows[0];
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

  const papers = await getPapersByIds(
    semanticMatches.map((match) => match.paper_id),
  );

  if (!papers.length) {
    return emptyResult({
      requestedCount: matchCount,
      rpcAttempted: true,
      matchedCount: semanticMatches.length,
      model,
      fallbackReason: "no_papers_loaded",
    });
  }

  return {
    papers,
    semanticScores,
    diagnostics: {
      requestedCount: matchCount,
      rpcAttempted: true,
      matchedCount: semanticMatches.length,
      candidateCount: papers.length,
      model,
      fallbackReason: null,
      profileRefreshStatus: null,
      profileRefreshReason: null,
      profileRefreshError: null,
    },
  };
}
