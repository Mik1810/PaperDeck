export function resolveGitHubModelsToken(
  dedicatedToken: string | undefined,
  automaticToken: string | undefined,
) {
  return dedicatedToken?.trim() || automaticToken?.trim() || "";
}

export function summaryRunShouldFail(generated: number, failed: number) {
  return generated === 0 && failed > 0;
}
