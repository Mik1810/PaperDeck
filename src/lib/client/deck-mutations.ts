export type DeckMutationAction =
  | "dismiss"
  | "favorite"
  | "open_detail"
  | "read_later";

type DeckMutationPayload = {
  error?: string;
  ok?: boolean;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type BeaconLike = Pick<Navigator, "sendBeacon">;

type DeckMutationOptions = {
  recommendationBatchItemId?: string;
  recommendationImpressionId?: string;
  selected?: boolean;
};

type RecordOpenDetailOptions = {
  fetchImpl?: FetchLike;
  navigatorImpl?: BeaconLike;
  recommendationBatchItemId?: string;
  recommendationImpressionId?: string;
};

type RecommendationImpressionPayload = {
  error?: string;
  ok?: boolean;
  recommendationImpressionId?: string;
};

function isDeckMutationPayload(value: unknown): value is DeckMutationPayload {
  return typeof value === "object" && value !== null;
}

async function readDeckMutationPayload(
  response: Response,
): Promise<DeckMutationPayload | null> {
  try {
    const payload = (await response.json()) as unknown;
    return isDeckMutationPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function submitDeckAction(
  action: DeckMutationAction,
  paperId: string,
  options: DeckMutationOptions = {},
  fetchImpl: FetchLike = fetch,
) {
  if (
    (action === "favorite" || action === "read_later") &&
    typeof options.selected !== "boolean"
  ) {
    throw new Error(`Deck action requires an explicit target state: ${action}`);
  }

  const response = await fetchImpl("/api/deck", {
    body: JSON.stringify({
      action,
      paperId,
      ...(typeof options.selected === "boolean"
        ? { selected: options.selected }
        : {}),
      ...(options.recommendationImpressionId
        ? { recommendationImpressionId: options.recommendationImpressionId }
        : {}),
      ...(options.recommendationBatchItemId
        ? { recommendationBatchItemId: options.recommendationBatchItemId }
        : {}),
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload = await readDeckMutationPayload(response);

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error ?? `Deck action failed: ${action}`);
  }
}

export function recordOpenDetail(
  paperId: string,
  options: RecordOpenDetailOptions = {},
) {
  const body = JSON.stringify({
    action: "open_detail",
    paperId,
    ...(options.recommendationImpressionId
      ? { recommendationImpressionId: options.recommendationImpressionId }
      : {}),
    ...(options.recommendationBatchItemId
      ? { recommendationBatchItemId: options.recommendationBatchItemId }
      : {}),
  });
  const beaconTarget =
    options.navigatorImpl ??
    (typeof navigator !== "undefined" ? navigator : undefined);

  if (beaconTarget) {
    const payload = new Blob([body], { type: "application/json" });

    if (beaconTarget.sendBeacon("/api/deck", payload)) {
      return "beacon";
    }
  }

  void (options.fetchImpl ?? fetch)("/api/deck", {
    body,
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => undefined);

  return "fetch";
}

export async function recordRecommendationImpression(
  paperId: string,
  recommendationBatchItemId: string,
  fetchImpl: FetchLike = fetch,
) {
  const response = await fetchImpl("/api/recommendation-impressions", {
    body: JSON.stringify({ paperId, recommendationBatchItemId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | RecommendationImpressionPayload
    | null;

  if (
    !response.ok ||
    payload?.ok === false ||
    typeof payload?.recommendationImpressionId !== "string"
  ) {
    throw new Error(payload?.error ?? "Recommendation impression failed");
  }

  return payload.recommendationImpressionId;
}

export function deckMutationErrorMessage(action: DeckMutationAction) {
  switch (action) {
    case "dismiss":
      return "We could not dismiss this paper. It has been restored.";
    case "favorite":
      return "We could not update this favorite. Your previous choice was restored.";
    case "open_detail":
      return "We could not record this paper open.";
    case "read_later":
      return "We could not update Read later. Your previous choice was restored.";
  }
}
