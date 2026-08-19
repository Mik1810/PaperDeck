import {
  isRetryableProviderStatus,
  RetryableProviderError,
} from "./enrichment-outcomes";
import { UPResponseSchema } from "../src/lib/schemas/up-response";

const UP_BASE = "https://api.unpaywall.org/v2";

type FetchUnpaywallOptions = {
  doi: string;
  email: string;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export async function fetchUnpaywall({
  doi,
  email,
  timeoutMs,
  signal,
  fetchImpl = fetch,
}: FetchUnpaywallOptions) {
  const params = new URLSearchParams({ email });
  const query = params.size ? `?${params}` : "";
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  let response: Response;

  try {
    response = await fetchImpl(
      `${UP_BASE}/${encodeURIComponent(doi)}${query}`,
      { signal: requestSignal },
    );
  } catch {
    throw new RetryableProviderError();
  }

  if (response.status === 404) {
    return null;
  }

  if (isRetryableProviderStatus(response.status)) {
    throw new RetryableProviderError();
  }

  if (!response.ok) {
    throw new Error(
      `Unpaywall API error: ${response.status} ${response.statusText}`,
    );
  }

  try {
    return UPResponseSchema.parse(await response.json());
  } catch {
    throw new RetryableProviderError();
  }
}
