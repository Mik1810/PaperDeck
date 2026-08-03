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

export function geminiGenerationConfig(maxOutputTokens: number) {
  return {
    maxOutputTokens,
    thinkingConfig: { thinkingLevel: "minimal" },
    responseFormat: {
      text: {
        mimeType: "application/json",
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
