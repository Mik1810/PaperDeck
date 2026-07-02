"use client";

import { useState } from "react";
import { BookmarkX, Pencil, Plus, Trash2 } from "lucide-react";
import {
  createPlaylistAction,
  deletePlaylistAction,
  removeFromPlaylistAction,
  renamePlaylistAction,
} from "@/app/actions";
import type { Paper } from "@/types/paper";

type PlaylistSummary = {
  id: string;
  name: string;
  paperIds: string[];
  isDefault?: boolean;
};

type Props = {
  playlists: PlaylistSummary[];
  selectedId: string | null;
  selectedPapers: Paper[];
};

export function PlaylistSidebar({ playlists, selectedId, selectedPapers }: Props) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  return (
    <aside className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-black uppercase tracking-normal text-slate-500">
          Playlists
        </span>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
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
          action={createPlaylistAction}
          className="space-y-2"
          onSubmit={() => setIsCreating(false)}
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
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-black text-white"
              type="submit"
            >
              Create
            </button>
            <button
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500"
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
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-black text-white"
                  type="submit"
                >
                  Save
                </button>
                <button
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500"
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
                className="flex-1 font-black text-slate-900"
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
                    className="invisible rounded p-1 text-slate-400 hover:bg-slate-100 group-hover:visible"
                    onClick={() => {
                      setEditingId(playlist.id);
                      setEditName(playlist.name);
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

      {selectedId ? (
        <div className="mt-6 space-y-3">
          {selectedPapers.map((paper) => (
            <div
              key={paper.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3"
            >
              <div className="min-w-0 flex-1">
                <a
                  className="text-sm font-bold text-slate-900 hover:text-teal-700"
                  href={`/papers/${paper.id}`}
                >
                  {paper.title}
                </a>
                <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">
                  {paper.authors.join(", ")} - {paper.year}
                </p>
              </div>
              <form action={removeFromPlaylistAction}>
                <input name="playlistId" type="hidden" value={selectedId} />
                <input name="paperId" type="hidden" value={paper.id} />
                <button
                  aria-label="Remove from playlist"
                  className="ml-2 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  type="submit"
                >
                  <BookmarkX aria-hidden="true" size={16} strokeWidth={2.4} />
                </button>
              </form>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
