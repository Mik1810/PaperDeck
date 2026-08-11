import type { InteractionType } from "@/types/paper";

export const PROFILE_EMBEDDING_DIMENSION = 384;

export const PROFILE_PAPER_INTERACTION_WEIGHTS: Partial<
  Record<InteractionType, number>
> = {
  open_detail: 2,
  read: 3,
  already_read: 3,
  not_interested: -5,
  dismiss: -4,
};

export function buildProfilePaperWeights(input: {
  favoritePaperIds: string[];
  playlistPaperIds: string[];
  interactions: Array<{ action: InteractionType; paperId: string }>;
}) {
  const weights = new Map<string, number>();
  const add = (paperId: string, weight: number) => {
    if (weight) weights.set(paperId, (weights.get(paperId) ?? 0) + weight);
  };

  for (const paperId of new Set(input.favoritePaperIds)) add(paperId, 6);
  for (const paperId of new Set(input.playlistPaperIds)) add(paperId, 5);
  for (const interaction of input.interactions) {
    add(
      interaction.paperId,
      PROFILE_PAPER_INTERACTION_WEIGHTS[interaction.action] ?? 0,
    );
  }

  return weights;
}

export type EmbeddingVectorInput = string | number[];

export function parseEmbeddingVector(
  value: EmbeddingVectorInput,
  dimension = PROFILE_EMBEDDING_DIMENSION,
) {
  const vector = Array.isArray(value)
    ? value.map(Number)
    : value
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .filter(Boolean)
        .map(Number);

  if (vector.length !== dimension) {
    throw new Error(
      `Expected ${dimension} embedding dimensions, received ${vector.length}`,
    );
  }

  return vector;
}

export function createEmbeddingAccumulator(
  dimension = PROFILE_EMBEDDING_DIMENSION,
) {
  return new Array<number>(dimension).fill(0);
}

export function addWeightedEmbeddingVector(
  accumulator: number[],
  vector: number[],
  weight: number,
) {
  for (let index = 0; index < accumulator.length; index += 1) {
    accumulator[index] += vector[index] * weight;
  }
}

export function l2NormalizeEmbedding(vector: number[]) {
  const norm = Math.sqrt(
    vector.reduce((total, value) => total + value * value, 0),
  );

  if (!norm) {
    return null;
  }

  return vector.map((value) => value / norm);
}

export function vectorToPgLiteral(vector: number[]) {
  return `[${vector.join(",")}]`;
}
