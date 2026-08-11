"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
  type PanInfo,
} from "motion/react";
import { Bookmark, X } from "lucide-react";
import { MathContent } from "@/components/math-content";
import {
  PaperCard,
  PAPER_CARD_HEIGHT_CLASS_NAME,
} from "@/components/paper-card";
import { PaperSourceBadge } from "@/components/paper-source-badge";
import {
  deckMutationErrorMessage,
  submitDeckAction,
} from "@/lib/client/deck-mutations";
import { resolveDeckSwipe } from "@/lib/client/deck-swipe";
import type { FeedPaper } from "@/types/paper";

const SWIPE_OVERLAY_DISTANCE = 72;
const EXIT_DURATION = 0.22;
const OPENED_FEED_PAPER_STORAGE_KEY = "paperdeck:opened-feed-paper";

function SwipeOverlay({
  direction,
  dragX,
}: {
  direction: "left" | "right";
  dragX: MotionValue<number>;
}) {
  const opacity = useTransform(dragX, (value: number) => {
    const relevant = direction === "left" ? Math.abs(Math.min(value, 0)) : Math.max(value, 0);
    if (relevant < 20) return 0;
    return Math.min(relevant / SWIPE_OVERLAY_DISTANCE, 1);
  });

  const scale = useTransform(dragX, (value: number) => {
    const raw = Math.min(Math.abs(value) / SWIPE_OVERLAY_DISTANCE, 1);
    return 0.8 + raw * 0.2;
  });

  const isLeft = direction === "left";

  return (
    <motion.div
      className={`pointer-events-none absolute inset-0 z-20 flex items-center rounded-2xl ${
        isLeft ? "justify-start" : "justify-end"
      }`}
      style={{
        opacity,
        background: isLeft
          ? "linear-gradient(to right, rgba(244,63,94,0.18) 0%, transparent 50%)"
          : "linear-gradient(to left, rgba(20,184,166,0.18) 0%, transparent 50%)",
      }}
    >
      <motion.div
        className={`mx-8 flex h-16 w-16 items-center justify-center rounded-full border-2 bg-white/85 backdrop-blur-sm shadow-sm ${
          isLeft ? "border-rose-200 text-rose-600" : "border-teal-200 text-teal-600"
        }`}
        style={{ scale }}
      >
        {isLeft ? (
          <X size={30} strokeWidth={2.5} />
        ) : (
          <Bookmark size={28} strokeWidth={2.5} />
        )}
      </motion.div>
    </motion.div>
  );
}

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
  const visibleNextPapers = visiblePapers.slice(1, 6);

  const exitingRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const prev = document.body.style.overflowX;
    document.body.style.overflowX = "hidden";
    document.documentElement.style.overflowX = "hidden";
    return () => {
      document.body.style.overflowX = prev;
      document.documentElement.style.overflowX = "";
    };
  }, []);

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

  useEffect(() => {
    function dismissOpenedPaper() {
      const openedPaperId = sessionStorage.getItem(
        OPENED_FEED_PAPER_STORAGE_KEY,
      );

      if (!openedPaperId) return;

      sessionStorage.removeItem(OPENED_FEED_PAPER_STORAGE_KEY);
      setPaperDismissed(openedPaperId, true);
    }

    dismissOpenedPaper();
    window.addEventListener("pageshow", dismissOpenedPaper);

    return () => {
      window.removeEventListener("pageshow", dismissOpenedPaper);
    };
  }, [setPaperDismissed]);

  const handleOpen = useCallback((paperId: string) => {
    sessionStorage.setItem(OPENED_FEED_PAPER_STORAGE_KEY, paperId);
    setPaperDismissed(paperId, true);
  }, [setPaperDismissed]);

  const handlePlaylistSaveComplete = useCallback((paperId: string) => {
    setPaperDismissed(paperId, true);
  }, [setPaperDismissed]);

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

  const handleReadLaterSubmit = useCallback(async function (
    paperId: string,
    recommendationImpressionId?: string,
  ) {
    setDismissError(null);
    setPaperDismissed(paperId, true);

    try {
      await submitDeckAction("read_later", paperId, {
        recommendationImpressionId,
        selected: true,
      });
    } catch {
      setPaperDismissed(paperId, false);
      setDismissError({
        message: deckMutationErrorMessage("read_later"),
        paperId,
      });
    }
  }, [setPaperDismissed]);

  const dragX = useMotionValue<number>(0);
  const rotate = useTransform(dragX, (value: number) => value * 0.05);

  function handleDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    const direction = resolveDeckSwipe({
      offsetX: info.offset.x,
      offsetY: info.offset.y,
      velocityX: info.velocity.x,
      viewportWidth: window.innerWidth,
    });

    if (direction) {
      if (exitingRef.current || !visibleActivePaper) return;
      exitingRef.current = true;

      const targetX = direction === "left" ? -window.innerWidth * 1.2 : window.innerWidth * 1.2;

      void animate(dragX, targetX, {
        type: "tween",
        duration: prefersReducedMotion ? 0.01 : EXIT_DURATION,
        ease: [0.32, 0.72, 0, 1],
      }).then(() => {
        if (direction === "right") {
          void handleReadLaterSubmit(
            visibleActivePaper.id,
            visibleActivePaper.recommendationImpressionId,
          );
        } else {
          void handleDismissSubmit(
            visibleActivePaper.id,
            visibleActivePaper.recommendationImpressionId,
          );
        }
        dragX.set(0);
        exitingRef.current = false;
      });
    } else {
      void animate(dragX, 0, {
        type: "spring",
        stiffness: 400,
        damping: 25,
      });
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_280px] lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="md:pr-0">
        {visibleActivePaper ? (
          <div className={`relative [overflow-y:clip] ${PAPER_CARD_HEIGHT_CLASS_NAME}`}>
            {visiblePapers.slice(1, 3).map((paper, index) => {
              const style = {
                transform: `scale(${0.97 - index * 0.03}) translateY(${(index + 1) * 6}px)`,
                opacity: 1 - index * 0.35,
                zIndex: 0,
                transition: "opacity 220ms ease, transform 220ms ease",
              };

              return index === 0 ? (
                <div
                  key={paper.id}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0"
                  data-paper-id={paper.id}
                  data-testid="next-deck-card"
                  inert
                  style={style}
                >
                  <PaperCard
                    isFavorite={favoriteIds.has(paper.id)}
                    isSaved={readLaterIds.has(paper.id)}
                    paper={paper}
                  />
                </div>
              ) : (
                <div
                  key={paper.id}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-2xl border border-slate-200 bg-white shadow-sm"
                  inert
                  style={style}
                />
              );
            })}

            <motion.div
              key={visibleActivePaper.id}
              className="relative z-10 select-none"
              data-paper-id={visibleActivePaper.id}
              data-testid="active-deck-card"
              drag="x"
              dragMomentum={false}
              onDragEnd={handleDragEnd}
              style={{
                rotate: prefersReducedMotion ? 0 : rotate,
                touchAction: "pan-y",
                x: dragX,
              }}
              whileDrag={prefersReducedMotion ? undefined : { scale: 1.01 }}
              whileTap={{ cursor: "grabbing" }}
            >
              <SwipeOverlay direction="left" dragX={dragX} />
              <SwipeOverlay direction="right" dragX={dragX} />

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
                onOpen={handleOpen}
                onPlaylistSaveComplete={handlePlaylistSaveComplete}
                paper={visibleActivePaper}
              />
            </motion.div>

          </div>
        ) : activePaper === null && nextPapers.length === 0 ? (
          <div className="w-full max-w-md rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center shadow-sm md:max-w-xl lg:max-w-none">
            <h2 className="text-lg font-black text-slate-950">
              No papers yet
            </h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
              Adjust your interests or wait for the ingestion worker to add more
              papers.
            </p>
          </div>
        ) : (
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm md:max-w-xl lg:max-w-none">
            <h2 className="text-lg font-black text-slate-950">
              No papers left in this deck
            </h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
              Adjust your interests or renew the recommendations.
            </p>
          </div>
        )}
      </section>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <section className={`${PAPER_CARD_HEIGHT_CLASS_NAME} flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm`}>
          <h2 className="shrink-0 text-sm font-black uppercase tracking-normal text-slate-500">
            Up next
          </h2>
          <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
            {visibleNextPapers.map((paper) => (
              <div key={paper.id} className="border-t border-slate-100 pt-3">
                <p className="text-sm font-black leading-5 text-slate-900 line-clamp-2">
                  <MathContent text={paper.title} />
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <PaperSourceBadge className="px-2 py-0.5" source={paper.source} />
                  {paper.year ? (
                    <span className="text-xs font-bold text-slate-500">
                      {paper.year}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
