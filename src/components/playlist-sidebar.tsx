"use client";

import { useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  createPlaylistAction,
  deletePlaylistAction,
  renamePlaylistAction,
} from "@/app/actions";

type PlaylistSummary = {
  id: string;
  name: string;
  paperIds: string[];
  isDefault?: boolean;
};

type Props = {
  playlists: PlaylistSummary[];
  selectedId: string | null;
};

export function PlaylistSidebar({ playlists, selectedId }: Props) {
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingPending, setIsCreatingPending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <aside className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-black uppercase tracking-normal text-slate-500">
          Playlists
        </span>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
          onClick={() => {
            setIsCreating(true);
            setEditingId(null);
          }}
          type="button"
          aria-label="Create playlist"
        >
          <Plus aria-hidden="true" size={15} strokeWidth={2.4} />
        </button>
      </div>

      {isCreating ? (
        <form
          ref={formRef}
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setIsCreatingPending(true);
            const formData = new FormData(e.currentTarget);
            try {
              await createPlaylistAction(formData);
              setIsCreating(false);
            } catch {
              // Action failed — form stays visible for retry
            } finally {
              setIsCreatingPending(false);
            }
          }}
        >
          <input
            autoFocus
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900"
            name="name"
            placeholder="Playlist name"
            required
            type="text"
          />
          <div className="flex gap-2">
            <button
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50"
              disabled={isCreatingPending}
              type="submit"
            >
              {isCreatingPending ? "Saving..." : "Create"}
            </button>
            <button
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
              onClick={() => setIsCreating(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {playlists.map((playlist) => (
        <div key={playlist.id} className="group">
          {editingId === playlist.id ? (
            <form
              action={renamePlaylistAction}
              className="space-y-2"
              onSubmit={() => setEditingId(null)}
            >
              <input name="paperId" type="hidden" value={playlist.id} />
              <input
                autoFocus
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900"
                defaultValue={playlist.name}
                name="name"
                required
                type="text"
              />
              <div className="flex gap-2">
                <button
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-black text-white hover:bg-slate-800"
                  type="submit"
                >
                  Save
                </button>
                <button
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                  onClick={() => setEditingId(null)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div
              className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left shadow-sm ${
                selectedId === playlist.id
                  ? "border-slate-400 bg-slate-50"
                  : "border-slate-200 bg-white"
              }`}
            >
              <a
                className="flex-1 rounded-md font-black text-slate-900 hover:text-teal-700"
                href={`/library?playlist=${playlist.id}`}
              >
                {playlist.name}
              </a>
              <span className="mr-2 rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">
                {playlist.paperIds.length}
              </span>
              {!playlist.isDefault ? (
                <div className="flex gap-1">
                  <button
                    aria-label="Rename playlist"
                    className="invisible rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900 group-hover:visible"
                    onClick={() => {
                      setEditingId(playlist.id);
                      setIsCreating(false);
                    }}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={14} strokeWidth={2} />
                  </button>
                  <form action={deletePlaylistAction}>
                    <input name="paperId" type="hidden" value={playlist.id} />
                    <button
                      aria-label="Delete playlist"
                      className="invisible rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 group-hover:visible"
                      type="submit"
                    >
                      <Trash2 aria-hidden="true" size={14} strokeWidth={2} />
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ))}
    </aside>
  );
}
