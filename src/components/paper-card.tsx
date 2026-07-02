"use client";

import { useState } from "react";
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
  dismissPaperAction,
  openPaperAction,
  toggleReadLaterAction,
  toggleFavoriteAction,
} from "@/app/actions";
import type { Paper } from "@/types/paper";

type PaperCardProps = {
  paper: Paper;
  isFavorite?: boolean;
  isSaved?: boolean;
  onDismissSubmit?: (paperId: string) => void;
  sourcePath?: string;
};

export function PaperCard({
  paper,
  isFavorite = false,
  isSaved = false,
  onDismissSubmit,
  sourcePath = "/feed",
}: PaperCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [optimisticFavorite, setOptimisticFavorite] = useState(isFavorite);
  const [optimisticSaved, setOptimisticSaved] = useState(isSaved);

  return (
    <article className="flex h-[min(760px,calc(100vh-150px))] min-h-[560px] w-full max-w-md flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.18)]">
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
        <span className="shrink-0 rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-black text-indigo-700">
          {paper.source}
        </span>
      </div>

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
          {paper.title}
        </h2>

        <p className="mt-3 text-sm font-bold text-slate-500">
          {paper.authors.join(", ")} - {paper.year}
        </p>

        {paper.venue ? (
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {paper.venue}
          </p>
        ) : null}

        <div className="mt-6 space-y-3 text-[15px] leading-7 text-slate-700">
          <p className={isExpanded ? "" : "line-clamp-[10]"}>
            {paper.abstract}
          </p>
          <button
            className="inline-flex items-center gap-1 text-sm font-black text-teal-700"
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
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2 border-t border-slate-100 bg-slate-50 p-3">
        <form
          action={dismissPaperAction}
          onSubmit={() => onDismissSubmit?.(paper.id)}
        >
          <input name="paperId" type="hidden" value={paper.id} />
          <input name="sourcePath" type="hidden" value={sourcePath} />
          <button className="grid h-12 w-full place-items-center rounded-lg border border-rose-200 bg-white text-rose-700">
            <X aria-label="Dismiss paper" size={19} strokeWidth={2.5} />
          </button>
        </form>
        <form action={openPaperAction} className="col-span-2">
          <input name="paperId" type="hidden" value={paper.id} />
          <input name="sourcePath" type="hidden" value={sourcePath} />
          <button className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-black text-white">
            <MoveRight aria-hidden="true" size={18} strokeWidth={2.5} />
            Open
          </button>
        </form>
        <form
          action={toggleFavoriteAction}
          onSubmit={() => setOptimisticFavorite((current) => !current)}
        >
          <input name="paperId" type="hidden" value={paper.id} />
          <input name="sourcePath" type="hidden" value={sourcePath} />
          <button
            aria-pressed={optimisticFavorite}
            className={`grid h-12 w-full place-items-center rounded-lg border ${
              optimisticFavorite
                ? "border-pink-300 bg-pink-50 text-pink-700"
                : "border-pink-200 bg-white text-pink-700"
            }`}
          >
            <Heart
              aria-label={
                optimisticFavorite ? "Remove favorite" : "Favorite paper"
              }
              fill={optimisticFavorite ? "currentColor" : "none"}
              size={19}
              strokeWidth={2.5}
            />
          </button>
        </form>
        <form
          action={toggleReadLaterAction}
          onSubmit={() => setOptimisticSaved((current) => !current)}
        >
          <input name="paperId" type="hidden" value={paper.id} />
          <input name="sourcePath" type="hidden" value={sourcePath} />
          <button
            aria-pressed={optimisticSaved}
            className={`grid h-12 w-full place-items-center rounded-lg border ${
              optimisticSaved
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-emerald-200 bg-white text-emerald-700"
            }`}
          >
            <Bookmark
              aria-label={
                optimisticSaved ? "Saved to Read later" : "Save to Read later"
              }
              fill={optimisticSaved ? "currentColor" : "none"}
              size={19}
              strokeWidth={2.5}
            />
          </button>
        </form>
      </div>

      <a
        href={paper.url}
        target="_blank"
        rel="noreferrer"
        className="flex h-11 items-center justify-center gap-2 border-t border-slate-100 bg-white text-sm font-black text-slate-700"
      >
        <ExternalLink aria-hidden="true" size={16} strokeWidth={2.4} />
        Read online
      </a>
    </article>
  );
}
