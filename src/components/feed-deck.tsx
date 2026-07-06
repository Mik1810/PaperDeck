"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, X } from "lucide-react";
import { MathContent } from "@/components/math-content";
import { PaperCard } from "@/components/paper-card";
import { PaperSourceBadge } from "@/components/paper-source-badge";
import {
  deckMutationErrorMessage,
  submitDeckAction,
} from "@/lib/client/deck-mutations";
import { loadMoreDeckPapersAction } from "@/app/actions";
import type { FeedPaper } from "@/types/paper";

const SWIPE_THRESHOLD = 100;
const EXIT_DURATION = 300;

type FeedDeckProps = {
  activePaper: FeedPaper | null;
  nextPapers: FeedPaper[];
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
  const [extraPapers, setExtraPapers] = useState<FeedPaper[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreRequestedRef = useRef(false);

  const fullQueue = useMemo(
    () => [...paperQueue, ...extraPapers],
    [paperQueue, extraPapers],
  );
  const queuedPaperIds = useMemo(
    () => new Set(paperQueue.map((p) => p.id)),
    [paperQueue],
  );

  const loadMore = useCallback(async () => {
    if (isLoadingMore || loadMoreRequestedRef.current) return;
    loadMoreRequestedRef.current = true;
    setIsLoadingMore(true);

    try {
      const newPapers = await loadMoreDeckPapersAction();
      const fresh = newPapers.filter((p) => !queuedPaperIds.has(p.id));
      if (fresh.length) {
        setExtraPapers((prev) => [...prev, ...fresh]);
      }
    } finally {
      setIsLoadingMore(false);
      loadMoreRequestedRef.current = false;
    }
  }, [isLoadingMore, queuedPaperIds]);
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

  const visiblePapers = fullQueue.filter(
    (paper) => !dismissedPaperIds.has(paper.id),
  );
  const visibleActivePaper = visiblePapers[0] ?? null;
  const visibleNextPapers = visiblePapers.slice(1, 4);

  const LOAD_MORE_THRESHOLD = 3;

  const prevVisibleCount = useRef(visiblePapers.length);

  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null);
  const dragStartX = useRef(0);
  const currentDragX = useRef(0);
  const isSwipeLocked = useRef(false);

  const setPaperDismissed = useCallback((paperId: string, isDismissed: boolean) => {
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
  }, [queueSignature]);

  const handleDismissSubmit = useCallback(async function (
    paperId: string,
    recommendationImpressionId?: string,
  ) {
    setDismissError(null);
    setPaperDismissed(paperId, true);

    try {
      await submitDeckAction("dismiss", paperId, {
        recommendationImpressionId,
      });
    } catch {
      setPaperDismissed(paperId, false);
      setDismissError({
        message: deckMutationErrorMessage("dismiss"),
        paperId,
      });
    }
  }, [setPaperDismissed]);

  const pointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    setIsDragging(true);
    isSwipeLocked.current = false;
    dragStartX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const pointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX.current;

    if (!isSwipeLocked.current && Math.abs(dx) > 10) {
      isSwipeLocked.current = true;
    }

    if (isSwipeLocked.current) {
      currentDragX.current = dx;
      setDragX(dx);
    }
  }, [isDragging]);

  const pointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      setIsDragging(false);
      e.currentTarget.releasePointerCapture(e.pointerId);

      const finalX = currentDragX.current;

      if (Math.abs(finalX) >= SWIPE_THRESHOLD && visibleActivePaper) {
        const direction = finalX > 0 ? "right" : "left";
        setExitDirection(direction);
        setIsExiting(true);

        setTimeout(() => {
          if (direction === "right") {
            submitDeckAction("read_later", visibleActivePaper.id, {
              recommendationImpressionId:
                visibleActivePaper.recommendationImpressionId,
            });
          } else {
            handleDismissSubmit(
              visibleActivePaper.id,
              visibleActivePaper.recommendationImpressionId,
            );
          }
          setIsExiting(false);
          setExitDirection(null);
          setDragX(0);
          currentDragX.current = 0;
        }, EXIT_DURATION);
      } else {
        setDragX(0);
        currentDragX.current = 0;
      }
    },
    [handleDismissSubmit, isDragging, visibleActivePaper],
  );

  const exitTransform = exitDirection === "left"
    ? "translateX(-150%) rotate(-15deg)"
    : exitDirection === "right"
    ? "translateX(150%) rotate(15deg)"
    : "";

  useEffect(() => {
    const wasAbove = prevVisibleCount.current > LOAD_MORE_THRESHOLD;
    const nowBelow = visiblePapers.length <= LOAD_MORE_THRESHOLD;

    prevVisibleCount.current = visiblePapers.length;

    if (wasAbove && nowBelow && fullQueue.length > 0) {
      loadMore();
    }
  }, [visiblePapers.length, fullQueue.length, loadMore]);

  const cardOpacity = isDragging ? (1 - Math.min(Math.abs(dragX) / SWIPE_THRESHOLD, 0.4)) : 1;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="lg:pr-0">
        {visibleActivePaper ? (
          <div className="relative" style={{ minHeight: "70vh" }}>
            {/* Stacked next cards behind */}
            {visiblePapers.slice(1, 3).map((paper, index) => (
              <div
                key={paper.id}
                className="pointer-events-none absolute inset-0 rounded-2xl border border-slate-200 bg-white shadow-sm"
                style={{
                  transform: `scale(${0.97 - index * 0.03}) translateY(${(index + 1) * 6}px)`,
                  opacity: 1 - index * 0.35,
                  zIndex: 0,
                  transition: "opacity 300ms ease",
                }}
              />
            ))}

            {/* Active card with swipe */}
            <div
              className="relative z-10 cursor-grab touch-none select-none active:cursor-grabbing"
              style={{
                transform: isExiting
                  ? exitTransform
                  : isDragging
                  ? `translateX(${dragX}px) rotate(${dragX * 0.05}deg)`
                  : "translateX(0) rotate(0deg)",
                opacity: isExiting ? 0 : cardOpacity,
                transition: isDragging ? "none" : `transform ${EXIT_DURATION}ms ease, opacity ${EXIT_DURATION}ms ease`,
              }}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
            >
              {/* Swipe hint overlays */}
              {isDragging && Math.abs(dragX) > 20 && (
                <>
                  <div
                    className="absolute inset-0 z-20 flex items-center justify-start rounded-2xl px-8"
                    style={{
                      opacity: Math.min(Math.abs(Math.min(dragX, 0)) / SWIPE_THRESHOLD, 1),
                    }}
                  >
                    <div className="rounded-2xl border-4 border-red-500 p-3">
                      <X className="text-red-500" size={36} strokeWidth={3} />
                    </div>
                  </div>
                  <div
                    className="absolute inset-0 z-20 flex items-center justify-end rounded-2xl px-8"
                    style={{
                      opacity: Math.min(Math.abs(Math.max(dragX, 0)) / SWIPE_THRESHOLD, 1),
                    }}
                  >
                    <div className="rounded-2xl border-4 border-emerald-500 p-3">
                      <Bookmark className="text-emerald-500" size={36} strokeWidth={3} />
                    </div>
                  </div>
                </>
              )}

              <PaperCard
                key={`${visibleActivePaper.id}-${favoriteIds.has(visibleActivePaper.id)}-${readLaterIds.has(visibleActivePaper.id)}`}
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
            </div>
          </div>
        ) : isLoadingMore ? (
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm lg:max-w-none">
            <p className="text-sm font-semibold text-slate-500">
              Loading more papers&hellip;
            </p>
          </div>
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
                  <MathContent text={paper.title} />
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
