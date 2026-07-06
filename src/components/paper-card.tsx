"use client";

import Link from "next/link";
import { useState } from "react";
import { MathContent } from "@/components/math-content";
import { MutationAlert } from "@/components/mutation-alert";
import { PaperSourceBadge } from "@/components/paper-source-badge";
import {
  Bookmark,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Heart,
  MoveRight,
  X,
} from "lucide-react";
import {
  deckMutationErrorMessage,
  recordOpenDetail,
  type DeckMutationAction,
  submitDeckAction,
} from "@/lib/client/deck-mutations";
import type { FeedPaper } from "@/types/paper";

type PaperCardProps = {
  dismissErrorMessage?: string | null;
  paper: FeedPaper;
  isFavorite?: boolean;
  isSaved?: boolean;
  onDismissSubmit?: (
    paperId: string,
    recommendationImpressionId?: string,
  ) => void | Promise<void>;
};

export function PaperCard({
  dismissErrorMessage,
  paper,
  isFavorite = false,
  isSaved = false,
  onDismissSubmit,
}: PaperCardProps) {
  console.debug("PaperCard render:", paper.id, { isFavorite, isSaved });
  const [isExpanded, setIsExpanded] = useState(false);
  const [optimisticFavorite, setOptimisticFavorite] = useState(isFavorite);
  const [optimisticSaved, setOptimisticSaved] = useState(isSaved);
  const [mutationErrorMessage, setMutationErrorMessage] = useState<
    string | null
  >(null);
  const [pendingAction, setPendingAction] =
    useState<DeckMutationAction | null>(null);
  const isMutationPending = pendingAction !== null;

  async function commitDeckMutation(
    action: DeckMutationAction,
    rollback: () => void,
  ) {
    setMutationErrorMessage(null);
    setPendingAction(action);

    try {
      await submitDeckAction(action, paper.id, {
        recommendationImpressionId: paper.recommendationImpressionId,
      });
    } catch (error) {
      console.error(`Deck mutation ${action} failed:`, error);
      rollback();
      setMutationErrorMessage(deckMutationErrorMessage(action));
    } finally {
      setPendingAction((current) => (current === action ? null : current));
    }
  }

  const visibleErrorMessage = dismissErrorMessage ?? mutationErrorMessage;

  return (
    <article className="flex h-[min(760px,calc(100dvh-150px))] min-h-[360px] w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.18)] sm:min-h-[560px] md:max-w-2xl lg:h-auto lg:max-h-[calc(100vh-180px)] lg:max-w-none lg:rounded-xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <p className="text-xs font-black uppercase tracking-normal text-teal-700">
            {paper.recommendationReason}
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            {paper.isClassic ? "Classic paper" : "Fresh recommendation"}
            {paper.citationCount ? ` - ${paper.citationCount} citations` : ""}
          </p>
        </div>
        <PaperSourceBadge source={paper.source} />
      </div>

      <MutationAlert className="mx-5 mt-4" message={visibleErrorMessage} />

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="mb-4 flex flex-wrap gap-2">
          {paper.topics.map((topic) => (
            <span
              key={topic.id}
              className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700"
            >
              {topic.label}
            </span>
          ))}
        </div>

        <h2 className="text-2xl font-black leading-8 tracking-normal text-slate-950">
          <MathContent text={paper.title} />
        </h2>

        <p className="mt-3 text-sm font-bold text-slate-500">
          {paper.authors.join(", ")} - {paper.year}
        </p>

        {paper.venue ? (
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {paper.venue}
          </p>
        ) : null}

        <div className={`mt-6 space-y-3 text-[15px] leading-7 text-slate-700`}>
          {paper.abstract ? (
            <>
              <div className={isExpanded ? "" : "line-clamp-[10] lg:line-clamp-[18]"}>
                <MathContent text={paper.abstract} />
              </div>
              <button
                className="inline-flex items-center gap-1 rounded-md text-sm font-black text-teal-700 hover:text-teal-900"
                type="button"
                onClick={() => setIsExpanded((current) => !current)}
              >
                {isExpanded ? "less" : "more"}
                {isExpanded ? (
                  <ChevronUp aria-hidden="true" size={16} strokeWidth={2.4} />
                ) : (
                  <ChevronDown aria-hidden="true" size={16} strokeWidth={2.4} />
                )}
              </button>
            </>
          ) : (
            <p className="text-sm italic text-slate-400">
              No abstract available.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2 border-t border-slate-100 bg-slate-50 p-3">
        <button
          className="grid h-12 w-full place-items-center rounded-lg border border-rose-200 bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isMutationPending}
          onClick={() => {
            console.debug("PaperCard: dismiss clicked", paper.id);
            setMutationErrorMessage(null);
            if (onDismissSubmit) {
              void onDismissSubmit(paper.id, paper.recommendationImpressionId);
              return;
            }

            void commitDeckMutation("dismiss", () => undefined);
          }}
          type="button"
        >
          <X aria-label="Dismiss paper" size={19} strokeWidth={2.5} />
        </button>
        <Link
          className="col-span-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-black text-white hover:bg-slate-800"
          href={`/papers/${paper.id}`}
          onClick={() =>
            recordOpenDetail(paper.id, {
              recommendationImpressionId: paper.recommendationImpressionId,
            })
          }
        >
          <MoveRight aria-hidden="true" size={18} strokeWidth={2.5} />
          Open
        </Link>
        <button
          aria-label={optimisticFavorite ? "Remove favorite" : "Favorite paper"}
          className={`grid h-12 w-full place-items-center rounded-lg border ${
            optimisticFavorite
              ? "border-pink-300 bg-pink-50 text-pink-700"
              : "border-pink-200 bg-white text-pink-700"
          } hover:border-pink-300 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50`}
          disabled={isMutationPending}
          onClick={() => {
            console.debug("PaperCard: favorite clicked", paper.id);
            const previousFavorite = optimisticFavorite;
            setOptimisticFavorite(!previousFavorite);
            void commitDeckMutation("favorite", () =>
              setOptimisticFavorite(previousFavorite),
            );
          }}
          type="button"
        >
          <Heart
            aria-hidden="true"
            fill={optimisticFavorite ? "currentColor" : "none"}
            size={19}
            strokeWidth={2.5}
          />
        </button>
        <button
          aria-label={optimisticSaved ? "Saved to Read later" : "Save to Read later"}
          className={`grid h-12 w-full place-items-center rounded-lg border ${
            optimisticSaved
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-emerald-200 bg-white text-emerald-700"
          } hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50`}
          disabled={isMutationPending}
          onClick={() => {
            const previousSaved = optimisticSaved;
            setOptimisticSaved(!previousSaved);
            void commitDeckMutation("read_later", () =>
              setOptimisticSaved(previousSaved),
            );
          }}
          type="button"
        >
          <Bookmark
            aria-hidden="true"
            fill={optimisticSaved ? "currentColor" : "none"}
            size={19}
            strokeWidth={2.5}
          />
        </button>
      </div>

      <a
        href={paper.url}
        target="_blank"
        rel="noreferrer noopener"
        className="flex h-11 items-center justify-center gap-2 border-t border-slate-100 bg-white text-sm font-black text-slate-700 hover:bg-slate-50 hover:text-slate-950"
      >
        <ExternalLink aria-hidden="true" size={16} strokeWidth={2.4} />
        Read online
      </a>
    </article>
  );
}
