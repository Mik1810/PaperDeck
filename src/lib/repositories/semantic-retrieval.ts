import "server-only";

import { getPapersByIds } from "@/lib/repositories/catalog";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  refreshUserProfileEmbedding,
  type ProfileEmbeddingRefreshResult,
} from "@/lib/repositories/user-profile-embeddings";
import type { Paper } from "@/types/paper";

type UserProfileEmbeddingRow = {
  embedding: string;
  embedding_model: string;
};

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
  profileRefreshStatus: ProfileEmbeddingRefreshResult["status"] | null;
  profileRefreshReason: Extract<
    ProfileEmbeddingRefreshResult,
    { status: "skipped" }
  >["reason"] | null;
  profileRefreshError: string | null;
};

function assertNoError(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

export async function getSemanticPaperCandidates(
  ownerId: string,
  matchCount = 100,
): Promise<SemanticPaperCandidates> {
  const supabase = createServiceRoleClient();
  const emptyResult = (
    diagnostics: Partial<SemanticRetrievalDiagnostics>,
  ): SemanticPaperCandidates => ({
    papers: [],
    semanticScores: new Map(),
    diagnostics: {
      requestedCount: matchCount,
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
  });

  const { data: profileEmbedding, error: profileError } = await supabase
    .from("user_profile_embeddings")
    .select("embedding, embedding_model")
    .eq("owner_id", ownerId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  assertNoError(profileError, "Load user profile embedding");

  if (!profileEmbedding) {
    try {
      const refreshResult = await refreshUserProfileEmbedding(ownerId);

      return emptyResult({
        fallbackReason: "profile_missing",
        profileRefreshStatus: refreshResult.status,
        profileRefreshReason:
          refreshResult.status === "skipped" ? refreshResult.reason : null,
      });
    } catch (error) {
      return emptyResult({
        fallbackReason: "profile_refresh_failed",
        profileRefreshError:
          error instanceof Error ? error.message : "Unknown profile refresh error",
      });
    }
  }

  const embeddingRow = profileEmbedding as UserProfileEmbeddingRow;
  const { data: matches, error: matchesError } = await supabase.rpc(
    "match_papers_by_embedding",
    {
      query_embedding: embeddingRow.embedding,
      match_count: matchCount,
      embedding_model_filter: embeddingRow.embedding_model,
    },
  );

  assertNoError(matchesError, "Match papers by embedding");

  const semanticMatches = (matches ?? []) as SemanticMatchRow[];

  if (!semanticMatches.length) {
    return emptyResult({
      rpcAttempted: true,
      model: embeddingRow.embedding_model,
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
      rpcAttempted: true,
      matchedCount: semanticMatches.length,
      model: embeddingRow.embedding_model,
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
      model: embeddingRow.embedding_model,
      fallbackReason: null,
      profileRefreshStatus: null,
      profileRefreshReason: null,
      profileRefreshError: null,
    },
  };
}
