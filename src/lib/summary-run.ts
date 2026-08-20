export const TRIAGE_SUMMARY_JSON_SCHEMA = {
  type: "object",
  properties: {
    why_it_matters: {
      type: "string",
      description: "Why this paper matters and what gap it addresses.",
    },
    main_contribution: {
      type: "string",
      description: "The paper's concrete method, finding, artifact, or result.",
    },
    prerequisites: {
      type: "string",
      description: "Background concepts a reader should know first.",
    },
    read_if_you_care_about: {
      type: "string",
      description: "The specific reader profile, subfield, or application area.",
    },
  },
  required: [
    "why_it_matters",
    "main_contribution",
    "prerequisites",
    "read_if_you_care_about",
  ],
  additionalProperties: false,
} as const;

export type ProviderQuotaDisposition = "none" | "retryable" | "terminal";

export function classifyProviderQuota(
  provider: string,
  status: number,
  responseBody: string,
): ProviderQuotaDisposition {
  if (status !== 429) {
    return "none";
  }

  const normalized = responseBody.toLowerCase();
  const dailyQuota =
    /per[_-]?day/.test(normalized) ||
    normalized.includes("requests per day") ||
    normalized.includes("daily free allocation") ||
    normalized.includes("daily quota") ||
    /(?:quota|limit)[^\n]{0,80}(?:limit:\s*0|"limit"\s*:\s*0)/.test(
      normalized,
    );
  const cloudflareDailyQuota =
    provider === "cloudflare" &&
    /"code"\s*:\s*"?3036"?/.test(normalized);

  return dailyQuota || cloudflareDailyQuota ? "terminal" : "retryable";
}

export function cloudflareGenerationConfig(maxOutputTokens: number) {
  return {
    max_completion_tokens: maxOutputTokens,
    reasoning_effort: "low",
    response_format: {
      type: "json_schema",
      json_schema: TRIAGE_SUMMARY_JSON_SCHEMA,
    },
  } as const;
}

export function cloudflareResultToText(result: unknown): string | null {
  if (typeof result === "string") {
    return result;
  }

  if (!result || typeof result !== "object") {
    return null;
  }

  const record = result as Record<string, unknown>;
  const response = record.response;

  if (typeof response === "string") {
    return response;
  }

  if (response && typeof response === "object") {
    return JSON.stringify(response);
  }

  const choices = record.choices;

  if (!Array.isArray(choices)) {
    return null;
  }

  const firstChoice = choices[0] as Record<string, unknown> | undefined;
  const message = firstChoice?.message as Record<string, unknown> | undefined;
  const content = message?.content ?? firstChoice?.text;

  if (typeof content === "string") {
    return content;
  }

  if (content && typeof content === "object") {
    return JSON.stringify(content);
  }

  return null;
}

export function geminiGenerationConfig(maxOutputTokens: number) {
  return {
    maxOutputTokens,
    thinkingConfig: { thinkingLevel: "minimal" },
    responseFormat: {
      text: {
        mimeType: "APPLICATION_JSON",
        schema: TRIAGE_SUMMARY_JSON_SCHEMA,
      },
    },
  } as const;
}

function extractJson(text: string) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const content = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in response");
  }

  return content.slice(start, end + 1);
}

export function parseSummaryJson(raw: string, provider: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(extractJson(raw)) as Record<string, unknown>;
    } catch {
      throw new Error(`${provider} did not return valid JSON`);
    }
  }
}

export function resolveGitHubModelsToken(
  dedicatedToken: string | undefined,
  automaticToken: string | undefined,
) {
  return dedicatedToken?.trim() || automaticToken?.trim() || "";
}

export function summaryRunShouldFail(generated: number, failed: number) {
  return generated === 0 && failed > 0;
}
