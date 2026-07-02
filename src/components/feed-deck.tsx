"use client";

import { useMemo, useState } from "react";
import { PaperCard } from "@/components/paper-card";
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

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="flex justify-center">
        {visibleActivePaper ? (
          <PaperCard
            key={visibleActivePaper.id}
            isFavorite={favoriteIds.has(visibleActivePaper.id)}
            isSaved={readLaterIds.has(visibleActivePaper.id)}
            onDismissSubmit={(paperId) =>
              setDismissedState((current) => {
                const paperIds =
                  current.queueSignature === queueSignature
                    ? new Set(current.paperIds)
                    : new Set<string>();

                paperIds.add(paperId);

                return {
                  queueSignature,
                  paperIds,
                };
              })
            }
            paper={visibleActivePaper}
            sourcePath="/feed"
          />
        ) : (
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
            <h2 className="text-lg font-black text-slate-950">
              No papers left in this seed deck
            </h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
              Adjust your interests or wait for the ingestion worker to add more
              papers.
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
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {paper.source} - {paper.year}
                </p>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
