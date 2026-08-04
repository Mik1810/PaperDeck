"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { HeartOff, Layers } from "lucide-react";
import { toggleFavoriteAction } from "@/app/actions";
import { PaperListItem } from "@/components/paper-list-item";
import { PlaylistPapers } from "@/components/playlist-papers";
import {
  PlaylistSidebar,
  type LibraryCollectionKey,
} from "@/components/playlist-sidebar";
import type { LibraryBackgroundData } from "@/lib/repositories/user-data";
import type { Paper } from "@/types/paper";

type PlaylistSummary = {
  id: string;
  name: string;
  paperIds: string[];
  isDefault?: boolean;
};

type Props = {
  initialFavoriteCount: number;
  initialIgnoredCount: number;
  initialPlaylists: PlaylistSummary[];
  initialReadLaterPapers: Paper[];
  initialSelectedPlaylistId: string | null;
  initialSelectedView: "read-later" | "favorites" | "ignored" | "playlist";
};

function formatIgnoredDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function ignoredActionLabel(action: "dismiss" | "not_interested") {
  return action === "not_interested" ? "Not interested" : "Dismissed";
}

function EmptyCollection({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center">
      <Layers
        aria-hidden="true"
        className="mx-auto text-slate-300"
        size={28}
        strokeWidth={1.5}
      />
      <h3 className="mt-3 text-sm font-black text-slate-950">{title}</h3>
      <p className="mt-1.5 text-xs font-semibold leading-5 text-slate-500">
        {description}
      </p>
    </div>
  );
}

function LoadingCollection() {
  return (
    <div aria-label="Loading collection" className="space-y-3">
      {[0, 1].map((item) => (
        <div
          key={item}
          className="h-36 animate-pulse rounded-lg border border-slate-200 bg-white"
        />
      ))}
    </div>
  );
}

function PaperGrid({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
      {children}
    </div>
  );
}

function initialCollectionKey({
  playlistId,
  view,
}: {
  playlistId: string | null;
  view: Props["initialSelectedView"];
}): LibraryCollectionKey {
  if (playlistId) return `playlist:${playlistId}`;
  return view === "playlist" ? "read-later" : view;
}

export function LibraryWorkspace({
  initialFavoriteCount,
  initialIgnoredCount,
  initialPlaylists,
  initialReadLaterPapers,
  initialSelectedPlaylistId,
  initialSelectedView,
}: Props) {
  const initialKey = initialCollectionKey({
    playlistId: initialSelectedPlaylistId,
    view: initialSelectedView,
  });
  const [selectedKey, setSelectedKey] =
    useState<LibraryCollectionKey>(initialKey);
  const [editingKey, setEditingKey] =
    useState<LibraryCollectionKey | null>(null);
  const [backgroundData, setBackgroundData] =
    useState<LibraryBackgroundData | null>(null);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [backgroundLoading, setBackgroundLoading] = useState(true);
  const backgroundRequestRef =
    useRef<Promise<LibraryBackgroundData> | null>(null);

  const loadBackgroundData = useCallback(async () => {
    setBackgroundLoading(true);
    setBackgroundError(null);
    if (!backgroundRequestRef.current) {
      backgroundRequestRef.current = fetch("/api/library/collections", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      }).then(async (response) => {
        if (!response.ok) throw new Error("Library preload failed");
        return (await response.json()) as LibraryBackgroundData;
      });
    }

    try {
      const data = await backgroundRequestRef.current;
      setBackgroundData(data);
    } catch {
      backgroundRequestRef.current = null;
      setBackgroundError("This collection could not be loaded.");
    } finally {
      setBackgroundLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadBackgroundData();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadBackgroundData]);

  const customPlaylistIds = useMemo(
    () =>
      new Set(
        initialPlaylists
          .filter((playlist) => !playlist.isDefault)
          .map((playlist) => playlist.id),
      ),
    [initialPlaylists],
  );

  const collectionKeyFromLocation = useCallback((): LibraryCollectionKey => {
    const params = new URLSearchParams(window.location.search);
    const playlistId = params.get("playlist");
    if (playlistId && customPlaylistIds.has(playlistId)) {
      return `playlist:${playlistId}`;
    }
    return params.get("view") === "favorites"
      ? "favorites"
      : params.get("view") === "ignored"
        ? "ignored"
        : "read-later";
  }, [customPlaylistIds]);

  useEffect(() => {
    function onPopState() {
      setSelectedKey(collectionKeyFromLocation());
      setEditingKey(null);
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [collectionKeyFromLocation]);

  useEffect(() => {
    if (!selectedKey.startsWith("playlist:")) return;
    const playlistId = selectedKey.slice("playlist:".length);
    if (customPlaylistIds.has(playlistId)) return;
    const timeoutId = window.setTimeout(() => {
      setSelectedKey("read-later");
      setEditingKey(null);
      window.history.replaceState(null, "", "/library");
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [customPlaylistIds, selectedKey]);

  function selectCollection(
    key: LibraryCollectionKey,
    href: string,
    edit: boolean,
  ) {
    setSelectedKey(key);
    setEditingKey(edit ? key : null);
    const currentHref = `${window.location.pathname}${window.location.search}`;
    if (currentHref !== href) window.history.pushState(null, "", href);
  }

  async function removeFavorite(formData: FormData) {
    const paperId = String(formData.get("paperId") ?? "");
    await toggleFavoriteAction(formData);
    setBackgroundData((current) =>
      current
        ? {
            ...current,
            favoritePaperIds: current.favoritePaperIds.filter(
              (candidateId) => candidateId !== paperId,
            ),
          }
        : current,
    );
  }

  const papersById = useMemo(() => {
    const map = new Map<string, Paper>();
    for (const paper of initialReadLaterPapers) map.set(paper.id, paper);
    for (const paper of backgroundData?.papers ?? []) map.set(paper.id, paper);
    return map;
  }, [backgroundData?.papers, initialReadLaterPapers]);

  const defaultPlaylist = initialPlaylists.find(
    (playlist) => playlist.isDefault,
  );
  const selectedPlaylistId = selectedKey.startsWith("playlist:")
    ? selectedKey.slice("playlist:".length)
    : null;
  const selectedPlaylist = selectedPlaylistId
    ? initialPlaylists.find(
        (playlist) =>
          playlist.id === selectedPlaylistId && !playlist.isDefault,
      ) ?? null
    : null;
  const isEditing = editingKey === selectedKey;
  const title =
    selectedKey === "favorites"
      ? "Favorites"
      : selectedKey === "ignored"
        ? "Ignored"
        : selectedPlaylist?.name ?? "Read later";
  const favoritePapers =
    backgroundData?.favoritePaperIds.flatMap((paperId) => {
      const paper = papersById.get(paperId);
      return paper ? [paper] : [];
    }) ?? [];
  const ignoredPapers =
    backgroundData?.ignoredItems.flatMap((item) => {
      const paper = papersById.get(item.paperId);
      return paper ? [{ ...item, paper }] : [];
    }) ?? [];
  const selectedPapers =
    selectedPlaylist?.paperIds.flatMap((paperId) => {
      const paper = papersById.get(paperId);
      return paper ? [paper] : [];
    }) ?? [];
  const needsBackgroundData = selectedKey !== "read-later";

  return (
    <div className="grid gap-5 md:grid-cols-[260px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]">
      <PlaylistSidebar
        editingKey={editingKey}
        favoriteCount={
          backgroundData?.favoritePaperIds.length ?? initialFavoriteCount
        }
        ignoredCount={
          backgroundData?.ignoredItems.length ?? initialIgnoredCount
        }
        onSelectCollection={(key, href) => selectCollection(key, href, false)}
        onToggleEditing={(key, href) =>
          selectCollection(key, href, editingKey !== key)
        }
        playlists={initialPlaylists}
        readLaterCount={initialReadLaterPapers.length}
        selectedKey={selectedKey}
      />

      <section aria-labelledby="library-collection-title" className="min-w-0">
        <div className="mb-3 flex items-center gap-2">
          <h2
            id="library-collection-title"
            className="text-sm font-black uppercase tracking-normal text-slate-600 lg:text-base"
          >
            {title}
          </h2>
          {isEditing ? (
            <span className="rounded-md bg-teal-100 px-2 py-1 text-[10px] font-black uppercase text-teal-800">
              Editing
            </span>
          ) : null}
        </div>

        {needsBackgroundData && !backgroundData ? (
          backgroundError ? (
            <div
              className="rounded-lg border border-rose-200 bg-rose-50 p-5"
              role="alert"
            >
              <p className="text-sm font-bold text-rose-800">
                {backgroundError}
              </p>
              <button
                className="mt-3 text-sm font-black text-rose-900 underline"
                disabled={backgroundLoading}
                onClick={() => void loadBackgroundData()}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : (
            <LoadingCollection />
          )
        ) : null}

        {selectedKey === "read-later" ? (
          isEditing && defaultPlaylist ? (
            <PlaylistPapers
              key={`${defaultPlaylist.id}-${initialReadLaterPapers.map((paper) => paper.id).join(",")}`}
              papers={initialReadLaterPapers}
              playlistId={defaultPlaylist.id}
            />
          ) : initialReadLaterPapers.length ? (
            <PaperGrid>
              {initialReadLaterPapers.map((paper) => (
                <PaperListItem key={paper.id} paper={paper} />
              ))}
            </PaperGrid>
          ) : (
            <EmptyCollection
              description="Save papers from the deck or the playlist picker."
              title="Read later is empty"
            />
          )
        ) : null}

        {selectedKey === "favorites" && backgroundData ? (
          favoritePapers.length ? (
            <PaperGrid>
              {favoritePapers.map((paper) => (
                <PaperListItem
                  key={paper.id}
                  action={
                    isEditing ? (
                      <form action={removeFavorite}>
                        <input name="paperId" type="hidden" value={paper.id} />
                        <input
                          name="sourcePath"
                          type="hidden"
                          value="/library?view=favorites"
                        />
                        <button
                          className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 text-sm font-black text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
                          type="submit"
                        >
                          <HeartOff aria-hidden="true" size={17} />
                          Remove favorite
                        </button>
                      </form>
                    ) : null
                  }
                  paper={paper}
                />
              ))}
            </PaperGrid>
          ) : (
            <EmptyCollection
              description="Favorite papers from the deck to keep them here."
              title="No favorites yet"
            />
          )
        ) : null}

        {selectedKey === "ignored" && backgroundData ? (
          ignoredPapers.length ? (
            <PaperGrid>
              {ignoredPapers.map((item) => (
                <PaperListItem
                  key={`${item.action}-${item.paper.id}-${item.ignoredAt}`}
                  meta={
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">
                        {ignoredActionLabel(item.action)}
                      </span>
                      <span className="text-xs font-bold text-slate-500">
                        {formatIgnoredDate(item.ignoredAt)}
                      </span>
                    </div>
                  }
                  paper={item.paper}
                />
              ))}
            </PaperGrid>
          ) : (
            <EmptyCollection
              description="Papers dismissed from the deck will appear here."
              title="No ignored papers yet"
            />
          )
        ) : null}

        {selectedPlaylist && backgroundData ? (
          isEditing ? (
            <PlaylistPapers
              key={`${selectedPlaylist.id}-${selectedPapers.map((paper) => paper.id).join(",")}`}
              papers={selectedPapers}
              playlistId={selectedPlaylist.id}
            />
          ) : selectedPapers.length ? (
            <PaperGrid>
              {selectedPapers.map((paper) => (
                <PaperListItem key={paper.id} paper={paper} />
              ))}
            </PaperGrid>
          ) : (
            <EmptyCollection
              description="Save papers from the deck or the playlist picker."
              title="This playlist is empty"
            />
          )
        ) : null}
      </section>
    </div>
  );
}
