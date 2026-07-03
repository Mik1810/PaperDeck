"use client";

import { useMemo, useState } from "react";
import { PaperCard } from "@/components/paper-card";
import { PaperSourceBadge } from "@/components/paper-source-badge";
import {
  deckMutationErrorMessage,
  submitDeckAction,
} from "@/lib/client/deck-mutations";
import type { Paper } from "@/types/paper";

type FeedDeckProps = {
  activePaper: Paper | null;
  nextPapers: Paper[];
  favoritePaperIds: string[];
  readLaterPaperIds: string[];
};

export function FeedDeck({
  activePaper,
  nextPapers,
  favoritePaperIds,
  readLaterPaperIds,
}: FeedDeckProps) {
  const paperQueue = useMemo(
    () => (activePaper ? [activePaper, ...nextPapers] : []),
    [activePaper, nextPapers],
  );
  const queueSignature = paperQueue.map((paper) => paper.id).join("|");
  const [dismissedState, setDismissedState] = useState<{
    queueSignature: string;
    paperIds: Set<string>;
  }>(() => ({
    queueSignature,
    paperIds: new Set(),
  }));
  const [dismissError, setDismissError] = useState<{
    message: string;
    paperId: string;
  } | null>(null);
  const favoriteIds = useMemo(
    () => new Set(favoritePaperIds),
    [favoritePaperIds],
  );
  const readLaterIds = useMemo(
    () => new Set(readLaterPaperIds),
    [readLaterPaperIds],
  );

  const dismissedPaperIds =
    dismissedState.queueSignature === queueSignature
      ? dismissedState.paperIds
      : new Set<string>();

  const visiblePapers = paperQueue.filter(
    (paper) => !dismissedPaperIds.has(paper.id),
  );
  const visibleActivePaper = visiblePapers[0] ?? null;
  const visibleNextPapers = visiblePapers.slice(1, 4);

  function setPaperDismissed(paperId: string, isDismissed: boolean) {
    setDismissedState((current) => {
      const paperIds =
        current.queueSignature === queueSignature
          ? new Set(current.paperIds)
          : new Set<string>();

      if (isDismissed) {
        paperIds.add(paperId);
      } else {
        paperIds.delete(paperId);
      }

      return {
        queueSignature,
        paperIds,
      };
    });
  }

  async function handleDismissSubmit(paperId: string) {
    setDismissError(null);
    setPaperDismissed(paperId, true);

    try {
      await submitDeckAction("dismiss", paperId);
    } catch {
      setPaperDismissed(paperId, false);
      setDismissError({
        message: deckMutationErrorMessage("dismiss"),
        paperId,
      });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="lg:pr-0">
        {visibleActivePaper ? (
          <PaperCard
            key={visibleActivePaper.id}
            isFavorite={favoriteIds.has(visibleActivePaper.id)}
            isSaved={readLaterIds.has(visibleActivePaper.id)}
            dismissErrorMessage={
              dismissError?.paperId === visibleActivePaper.id
                ? dismissError.message
                : null
            }
            onDismissSubmit={handleDismissSubmit}
            paper={visibleActivePaper}
          />
        ) : activePaper === null && nextPapers.length === 0 ? (
          <div className="w-full max-w-md rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center shadow-sm lg:max-w-none">
            <h2 className="text-lg font-black text-slate-950">
              No papers yet
            </h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
              Adjust your interests or wait for the ingestion worker to add more
              papers.
            </p>
          </div>
        ) : (
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm lg:max-w-none">
            <h2 className="text-lg font-black text-slate-950">
              No papers left in this deck
            </h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
              Adjust your interests or renew the recommendations.
            </p>
          </div>
        )}
      </section>

      <aside className="space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
            Mix
          </h2>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-teal-50 p-3">
              <dt className="text-lg font-black text-teal-700">65%</dt>
              <dd className="mt-1 text-xs font-bold text-teal-900">
                Relevant
              </dd>
            </div>
            <div className="rounded-lg bg-indigo-50 p-3">
              <dt className="text-lg font-black text-indigo-700">20%</dt>
              <dd className="mt-1 text-xs font-bold text-indigo-900">
                Explore
              </dd>
            </div>
            <div className="rounded-lg bg-amber-50 p-3">
              <dt className="text-lg font-black text-amber-700">15%</dt>
              <dd className="mt-1 text-xs font-bold text-amber-900">
                Classics
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
            Up next
          </h2>
          <div className="mt-4 space-y-3">
            {visibleNextPapers.map((paper) => (
              <div key={paper.id} className="border-t border-slate-100 pt-3">
                <p className="text-sm font-black leading-5 text-slate-900">
                  {paper.title}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <PaperSourceBadge className="px-2 py-0.5" source={paper.source} />
                  <span className="text-xs font-bold text-slate-500">
                    {paper.year}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
