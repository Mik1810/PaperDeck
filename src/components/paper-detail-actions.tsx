"use client";

import { useState } from "react";
import { Bookmark, CheckCircle2, ExternalLink, Heart, X } from "lucide-react";
import {
  toggleFavoriteAction,
  toggleReadLaterAction,
} from "@/app/actions";

type PaperDetailActionsProps = {
  feedbackActionPath: string;
  isFavorite: boolean;
  isSaved: boolean;
  paperId: string;
  paperUrl: string;
  sourcePath: string;
};

export function PaperDetailActions({
  feedbackActionPath,
  isFavorite,
  isSaved,
  paperId,
  paperUrl,
  sourcePath,
}: PaperDetailActionsProps) {
  const [optimisticFavorite, setOptimisticFavorite] = useState(isFavorite);
  const [optimisticSaved, setOptimisticSaved] = useState(isSaved);

  return (
    <div className="mt-7 flex flex-wrap gap-2">
      <form
        action={toggleFavoriteAction}
        onSubmit={() => setOptimisticFavorite((current) => !current)}
      >
        <input name="paperId" type="hidden" value={paperId} />
        <input name="sourcePath" type="hidden" value={sourcePath} />
        <button
          aria-pressed={optimisticFavorite}
          className={`inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm font-black ${
            optimisticFavorite
              ? "border-pink-300 bg-pink-50 text-pink-700"
              : "border-pink-200 bg-white text-pink-700"
          }`}
        >
          <Heart
            aria-hidden="true"
            fill={optimisticFavorite ? "currentColor" : "none"}
            size={18}
            strokeWidth={2.5}
          />
          {optimisticFavorite ? "Favorited" : "Favorite"}
        </button>
      </form>

      <form
        action={toggleReadLaterAction}
        onSubmit={() => setOptimisticSaved((current) => !current)}
      >
        <input name="paperId" type="hidden" value={paperId} />
        <input name="sourcePath" type="hidden" value={sourcePath} />
        <button
          aria-pressed={optimisticSaved}
          className={`inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm font-black ${
            optimisticSaved
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-emerald-200 bg-white text-emerald-700"
          }`}
        >
          <Bookmark
            aria-hidden="true"
            fill={optimisticSaved ? "currentColor" : "none"}
            size={18}
            strokeWidth={2.5}
          />
          {optimisticSaved ? "Saved" : "Read later"}
        </button>
      </form>

      <form action={feedbackActionPath} method="post">
        <input name="action" type="hidden" value="already_read" />
        <button className="inline-flex h-11 items-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 text-sm font-black text-indigo-700">
          <CheckCircle2 aria-hidden="true" size={18} strokeWidth={2.5} />
          Already read
        </button>
      </form>

      <form action={feedbackActionPath} method="post">
        <input name="action" type="hidden" value="not_interested" />
        <button className="inline-flex h-11 items-center gap-2 rounded-lg border border-rose-200 bg-white px-4 text-sm font-black text-rose-700">
          <X aria-hidden="true" size={18} strokeWidth={2.5} />
          Not interested
        </button>
      </form>

      <a
        href={paperUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white"
      >
        <ExternalLink aria-hidden="true" size={18} strokeWidth={2.5} />
        Read online
      </a>
    </div>
  );
}
