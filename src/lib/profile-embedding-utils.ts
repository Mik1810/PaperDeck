export const PROFILE_EMBEDDING_DIMENSION = 384;
export const SELECTED_TOPIC_EMBEDDING_WEIGHT = 4;

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

export function topicSelectionInputSignature(
  model: string,
  topicIds: string[],
  embeddedAtByTopicId: Map<string, string | null> = new Map(),
) {
  const topicInputs = [...new Set(topicIds)]
    .sort()
    .map((topicId) => `${topicId}:${embeddedAtByTopicId.get(topicId) ?? "missing"}`);

  return `topic-selection:${model}:${topicInputs.join("|")}`;
}
