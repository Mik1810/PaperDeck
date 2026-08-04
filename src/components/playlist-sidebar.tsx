"use client";

import { useRef, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import {
  createPlaylistAction,
  deletePlaylistAction,
  renamePlaylistAction,
} from "@/app/actions";

export type LibraryCollectionKey =
  | "read-later"
  | "favorites"
  | "ignored"
  | `playlist:${string}`;

type PlaylistSummary = {
  id: string;
  name: string;
  paperIds: string[];
  isDefault?: boolean;
};

type Props = {
  editingKey: LibraryCollectionKey | null;
  favoriteCount: number;
  ignoredCount: number;
  onSelectCollection: (
    key: LibraryCollectionKey,
    href: string,
  ) => void;
  onToggleEditing: (
    key: LibraryCollectionKey,
    href: string,
  ) => void;
  playlists: PlaylistSummary[];
  readLaterCount: number;
  selectedKey: LibraryCollectionKey;
};

function collectionRowClassName(selected: boolean) {
  return `flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left shadow-sm transition ${
    selected
      ? "border-teal-300 bg-teal-50"
      : "border-slate-200 bg-white hover:border-slate-300"
  }`;
}

function editControlClassName(active: boolean) {
  return `grid h-8 w-8 shrink-0 place-items-center rounded-md transition ${
    active
      ? "bg-teal-700 text-white hover:bg-teal-800"
      : "text-slate-500 hover:bg-slate-100 hover:text-slate-950"
  }`;
}

export function PlaylistSidebar({
  editingKey,
  favoriteCount,
  ignoredCount,
  onSelectCollection,
  onToggleEditing,
  playlists,
  readLaterCount,
  selectedKey,
}: Props) {
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingPending, setIsCreatingPending] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [optionsId, setOptionsId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const customPlaylists = playlists.filter((playlist) => !playlist.isDefault);

  function systemCollectionRow({
    count,
    editable,
    href,
    key,
    name,
  }: {
    count: number;
    editable: boolean;
    href: string;
    key: LibraryCollectionKey;
    name: string;
  }) {
    const selected = selectedKey === key;
    const editing = editingKey === key;

    return (
      <div className={collectionRowClassName(selected)}>
        <button
          className="flex min-w-0 flex-1 items-center rounded-md text-left font-black text-slate-900 hover:text-teal-700"
          onClick={() => onSelectCollection(key, href)}
          type="button"
        >
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <span className="mx-2 rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">
            {count}
          </span>
        </button>
        {editable ? (
          <button
            aria-label={`${editing ? "Stop editing" : "Edit"} ${name}`}
            aria-pressed={editing}
            className={editControlClassName(editing)}
            onClick={() => onToggleEditing(key, href)}
            title={`${editing ? "Stop editing" : "Edit"} ${name}`}
            type="button"
          >
            <Pencil aria-hidden="true" size={15} strokeWidth={2.2} />
          </button>
        ) : (
          <span aria-hidden="true" className="h-8 w-8" />
        )}
      </div>
    );
  }

  return (
    <aside className="space-y-3">
      <span className="block text-xs font-black uppercase tracking-normal text-slate-600">
        Library
      </span>

      {systemCollectionRow({
        count: readLaterCount,
        editable: true,
        href: "/library",
        key: "read-later",
        name: "Read later",
      })}
      {systemCollectionRow({
        count: favoriteCount,
        editable: true,
        href: "/library?view=favorites",
        key: "favorites",
        name: "Favorites",
      })}
      {systemCollectionRow({
        count: ignoredCount,
        editable: false,
        href: "/library?view=ignored",
        key: "ignored",
        name: "Ignored",
      })}

      <div className="border-t border-slate-300 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black uppercase tracking-normal text-slate-600">
            My playlists
          </span>
          <button
            aria-label="Create playlist"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
            onClick={() => {
              setIsCreating(true);
              setRenamingId(null);
              setOptionsId(null);
            }}
            type="button"
          >
            <Plus aria-hidden="true" size={15} strokeWidth={2.4} />
          </button>
        </div>
      </div>

      {isCreating ? (
        <form
          ref={formRef}
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setIsCreatingPending(true);
            const formData = new FormData(event.currentTarget);
            try {
              await createPlaylistAction(formData);
              setIsCreating(false);
            } catch {
              // Keep the form visible for a retry.
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

      {customPlaylists.map((playlist) => {
        const key = `playlist:${playlist.id}` as const;
        const href = `/library?playlist=${playlist.id}`;
        const selected = selectedKey === key;
        const editing = editingKey === key;

        return (
          <div key={playlist.id} className="group">
            {renamingId === playlist.id ? (
              <form
                action={renamePlaylistAction}
                className="space-y-2"
                onSubmit={() => setRenamingId(null)}
              >
                <input name="playlistId" type="hidden" value={playlist.id} />
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
                    onClick={() => setRenamingId(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className={collectionRowClassName(selected)}>
                <button
                  className="flex min-w-0 flex-1 items-center rounded-md text-left font-black text-slate-900 hover:text-teal-700"
                  onClick={() => onSelectCollection(key, href)}
                  type="button"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {playlist.name}
                  </span>
                  <span className="mx-2 rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">
                    {playlist.paperIds.length}
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    aria-label={`${editing ? "Stop editing" : "Edit"} ${playlist.name}`}
                    aria-pressed={editing}
                    className={editControlClassName(editing)}
                    onClick={() => onToggleEditing(key, href)}
                    title={`${editing ? "Stop editing" : "Edit"} ${playlist.name}`}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={15} strokeWidth={2.2} />
                  </button>
                  <div className="relative">
                    <button
                      aria-expanded={optionsId === playlist.id}
                      aria-haspopup="menu"
                      aria-label={`More options for ${playlist.name}`}
                      className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-950"
                      onClick={() =>
                        setOptionsId((current) =>
                          current === playlist.id ? null : playlist.id,
                        )
                      }
                      type="button"
                    >
                      <MoreHorizontal
                        aria-hidden="true"
                        size={16}
                        strokeWidth={2.2}
                      />
                    </button>
                    {optionsId === playlist.id ? (
                      <div
                        className="absolute right-0 top-9 z-20 w-36 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg"
                        role="menu"
                      >
                        <button
                          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-black text-slate-700 hover:bg-slate-100"
                          onClick={() => {
                            setRenamingId(playlist.id);
                            setIsCreating(false);
                            setOptionsId(null);
                          }}
                          role="menuitem"
                          type="button"
                        >
                          <Pencil aria-hidden="true" size={14} /> Rename
                        </button>
                        <form action={deletePlaylistAction}>
                          <input
                            name="playlistId"
                            type="hidden"
                            value={playlist.id}
                          />
                          <button
                            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-black text-rose-700 hover:bg-rose-50"
                            role="menuitem"
                            type="submit"
                          >
                            <Trash2 aria-hidden="true" size={14} /> Delete
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}
