"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, Heart, X } from "lucide-react";
import { MutationAlert } from "@/components/mutation-alert";
import { PlaylistPicker } from "@/components/playlist-picker";
import {
  deckMutationErrorMessage,
  type DeckMutationAction,
  submitDeckAction,
} from "@/lib/client/deck-mutations";

type PaperDetailActionsProps = {
  feedbackActionPath: string;
  isFavorite: boolean;
  isSaved: boolean;
  paperId: string;
  paperUrl: string;
};

export function PaperDetailActions({
  feedbackActionPath,
  isFavorite,
  isSaved,
  paperId,
  paperUrl,
}: PaperDetailActionsProps) {
  const [optimisticFavorite, setOptimisticFavorite] = useState(isFavorite);
  const [mutationErrorMessage, setMutationErrorMessage] = useState<
    string | null
  >(null);
  const [pendingAction, setPendingAction] =
    useState<DeckMutationAction | null>(null);
  const isMutationPending = pendingAction !== null;

  async function commitDeckMutation(
    action: DeckMutationAction,
    rollback: () => void,
    selected?: boolean,
  ) {
    setMutationErrorMessage(null);
    setPendingAction(action);

    try {
      await submitDeckAction(action, paperId, { selected });
    } catch {
      rollback();
      setMutationErrorMessage(deckMutationErrorMessage(action));
    } finally {
      setPendingAction((current) => (current === action ? null : current));
    }
  }

  return (
    <div className="mt-7 space-y-3">
      <MutationAlert message={mutationErrorMessage} />
      <div className="flex flex-wrap gap-2">
        <button
          aria-pressed={optimisticFavorite}
          className={`inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm font-black ${
            optimisticFavorite
              ? "border-pink-300 bg-pink-50 text-pink-700"
              : "border-pink-200 bg-white text-pink-700"
          } hover:border-pink-300 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50`}
          disabled={isMutationPending}
          onClick={() => {
            const previousFavorite = optimisticFavorite;
            setOptimisticFavorite(!previousFavorite);
            void commitDeckMutation(
              "favorite",
              () => setOptimisticFavorite(previousFavorite),
              !previousFavorite,
            );
          }}
          type="button"
        >
          <Heart
            aria-hidden="true"
            fill={optimisticFavorite ? "currentColor" : "none"}
            size={18}
            strokeWidth={2.5}
          />
          {optimisticFavorite ? "Favorited" : "Favorite"}
        </button>

        <PlaylistPicker
          context="paper_detail"
          initialSaved={isSaved}
          paperId={paperId}
        />

        <form action={feedbackActionPath} method="post">
          <input name="action" type="hidden" value="already_read" />
          <button className="inline-flex h-11 items-center gap-2 rounded-lg border border-indigo-200 bg-white px-4 text-sm font-black text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50">
            <CheckCircle2 aria-hidden="true" size={18} strokeWidth={2.5} />
            Already read
          </button>
        </form>

        <form action={feedbackActionPath} method="post">
          <input name="action" type="hidden" value="not_interested" />
          <button className="inline-flex h-11 items-center gap-2 rounded-lg border border-rose-200 bg-white px-4 text-sm font-black text-rose-700 hover:border-rose-300 hover:bg-rose-50">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
            Not interested
          </button>
        </form>

        <a
          href={paperUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white hover:bg-slate-800"
        >
          <ExternalLink aria-hidden="true" size={18} strokeWidth={2.5} />
          Read online
        </a>
      </div>
    </div>
  );
}
