import "server-only";

import { getPapersByIds } from "@/lib/repositories/catalog";
import { createServiceRoleClient } from "@/lib/supabase/server";
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
  model: string;
};

function assertNoError(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

export async function getSemanticPaperCandidates(
  ownerId: string,
  matchCount = 100,
): Promise<SemanticPaperCandidates | null> {
  const supabase = createServiceRoleClient();
  const { data: profileEmbedding, error: profileError } = await supabase
    .from("user_profile_embeddings")
    .select("embedding, embedding_model")
    .eq("owner_id", ownerId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  assertNoError(profileError, "Load user profile embedding");

  if (!profileEmbedding) {
    return null;
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
    return null;
  }

  const semanticScores = new Map(
    semanticMatches.map((match) => [match.paper_id, match.semantic_score]),
  );
  const papers = await getPapersByIds(
    semanticMatches.map((match) => match.paper_id),
  );

  return {
    papers,
    semanticScores,
    model: embeddingRow.embedding_model,
  };
}
