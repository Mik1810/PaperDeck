export const DIGEST_RECENCY_WINDOWS_DAYS = [7, 14, 30] as const;

export type DigestRecencyCandidate = {
  availableAt: string;
  paperId: string;
};

type LoadDigestRecencyCandidates = (
  paperIds: string[],
  maximumWindowDays: number,
  nowMs: number,
) => Promise<DigestRecencyCandidate[]>;

type SelectDigestPaperIdsOptions = {
  loadCandidates: LoadDigestRecencyCandidates;
  minimumPaperCount: number;
  nowMs?: number;
  rankedPaperIds: string[];
};

export async function selectDigestPaperIdsByRecency({
  loadCandidates,
  minimumPaperCount,
  nowMs = Date.now(),
  rankedPaperIds,
}: SelectDigestPaperIdsOptions) {
  const maximumWindowDays =
    DIGEST_RECENCY_WINDOWS_DAYS[DIGEST_RECENCY_WINDOWS_DAYS.length - 1];
  const candidates = await loadCandidates(
    rankedPaperIds,
    maximumWindowDays,
    nowMs,
  );
  const availableAtByPaperId = new Map(
    candidates.map((candidate) => [
      candidate.paperId,
      Date.parse(candidate.availableAt),
    ]),
  );

  let paperIds: string[] = [];
  let windowDays = maximumWindowDays;

  for (const candidateWindowDays of DIGEST_RECENCY_WINDOWS_DAYS) {
    const cutoffMs =
      nowMs - candidateWindowDays * 24 * 60 * 60 * 1000;
    paperIds = rankedPaperIds.filter((paperId) => {
      const availableAtMs = availableAtByPaperId.get(paperId);
      return availableAtMs !== undefined && availableAtMs >= cutoffMs;
    });
    windowDays = candidateWindowDays;

    if (paperIds.length >= minimumPaperCount) {
      break;
    }
  }

  return { paperIds, windowDays };
}
