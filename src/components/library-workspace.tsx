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
import { removeFavoriteAction } from "@/app/actions";
import { PaperListItem } from "@/components/paper-list-item";
import { PlaylistPapers } from "@/components/playlist-papers";
import { PlaylistSidebar } from "@/components/playlist-sidebar";
import type {
  LibraryCollectionKey,
  LibraryCollectionPage,
  LibraryPlaylistSummary,
} from "@/lib/library-collections";

type Props = {
  initialCollectionPage: LibraryCollectionPage;
  initialFavoriteCount: number;
  initialIgnoredCount: number;
  initialPlaylists: LibraryPlaylistSummary[];
  initialReadLaterCount: number;
  initialSelectedKey: LibraryCollectionKey;
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

function mergeCollectionPages(
  current: LibraryCollectionPage,
  next: LibraryCollectionPage,
): LibraryCollectionPage {
  const seenPaperIds = new Set<string>();
  const items = [...current.items, ...next.items].filter((item) => {
    if (seenPaperIds.has(item.paper.id)) return false;
    seenPaperIds.add(item.paper.id);
    return true;
  });

  return { ...next, items };
}

export function LibraryWorkspace({
  initialCollectionPage,
  initialFavoriteCount,
  initialIgnoredCount,
  initialPlaylists,
  initialReadLaterCount,
  initialSelectedKey,
}: Props) {
  const [selectedKey, setSelectedKey] =
    useState<LibraryCollectionKey>(initialSelectedKey);
  const [editingKey, setEditingKey] =
    useState<LibraryCollectionKey | null>(null);
  const [collectionPages, setCollectionPages] = useState<
    Record<string, LibraryCollectionPage>
  >({ [initialCollectionPage.collectionKey]: initialCollectionPage });
  const collectionPagesRef = useRef(collectionPages);
  const collectionRequestsRef = useRef(
    new Map<string, Promise<LibraryCollectionPage>>(),
  );
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [errorsByKey, setErrorsByKey] = useState<Record<string, string>>({});
  const [favoriteCount, setFavoriteCount] = useState(initialFavoriteCount);

  const loadCollectionPage = useCallback(
    async (key: LibraryCollectionKey, cursor: string | null = null) => {
      if (!cursor && collectionPagesRef.current[key]) return;

      const requestKey = `${key}:${cursor ?? "initial"}`;
      setLoadingKeys((current) => new Set(current).add(key));
      setErrorsByKey((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });

      let request = collectionRequestsRef.current.get(requestKey);
      if (!request) {
        const params = new URLSearchParams({ collection: key });
        if (cursor) params.set("cursor", cursor);
        request = fetch(`/api/library/collections?${params.toString()}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        }).then(async (response) => {
          if (!response.ok) throw new Error("Library collection request failed");
          const data = (await response.json()) as LibraryCollectionPage;
          if (data.collectionKey !== key) {
            throw new Error("Library collection response mismatch");
          }
          return data;
        });
        collectionRequestsRef.current.set(requestKey, request);
      }

      try {
        const data = await request;
        setCollectionPages((current) => {
          const nextPage =
            cursor && current[key]
              ? mergeCollectionPages(current[key], data)
              : data;
          const next = { ...current, [key]: nextPage };
          collectionPagesRef.current = next;
          return next;
        });
      } catch {
        setErrorsByKey((current) => ({
          ...current,
          [key]: "This collection could not be loaded.",
        }));
      } finally {
        collectionRequestsRef.current.delete(requestKey);
        setLoadingKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [],
  );

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
      const key = collectionKeyFromLocation();
      setSelectedKey(key);
      setEditingKey(null);
      void loadCollectionPage(key);
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [collectionKeyFromLocation, loadCollectionPage]);

  useEffect(() => {
    if (!selectedKey.startsWith("playlist:")) return;
    const playlistId = selectedKey.slice("playlist:".length);
    if (customPlaylistIds.has(playlistId)) return;
    const timeoutId = window.setTimeout(() => {
      setSelectedKey("read-later");
      setEditingKey(null);
      window.history.replaceState(null, "", "/library");
      void loadCollectionPage("read-later");
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [customPlaylistIds, loadCollectionPage, selectedKey]);

  function selectCollection(
    key: LibraryCollectionKey,
    href: string,
    edit: boolean,
  ) {
    setSelectedKey(key);
    setEditingKey(edit ? key : null);
    const currentHref = `${window.location.pathname}${window.location.search}`;
    if (currentHref !== href) window.history.pushState(null, "", href);
    void loadCollectionPage(key);
  }

  async function removeFavorite(formData: FormData) {
    const paperId = String(formData.get("paperId") ?? "");
    await removeFavoriteAction(formData);
    setCollectionPages((current) => {
      const page = current.favorites;
      if (!page) return current;
      const next = {
        ...current,
        favorites: {
          ...page,
          items: page.items.filter((item) => item.paper.id !== paperId),
        },
      };
      collectionPagesRef.current = next;
      return next;
    });
    setFavoriteCount((current) => Math.max(0, current - 1));
  }

  function removePlaylistPaper(
    collectionKey: LibraryCollectionKey,
    paperId: string,
  ) {
    setCollectionPages((current) => {
      const page = current[collectionKey];
      if (!page) return current;
      const next = {
        ...current,
        [collectionKey]: {
          ...page,
          items: page.items.filter((item) => item.paper.id !== paperId),
        },
      };
      collectionPagesRef.current = next;
      return next;
    });
  }

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
  const selectedPage = collectionPages[selectedKey];
  const selectedPapers = selectedPage?.items.map((item) => item.paper) ?? [];
  const isLoading = loadingKeys.has(selectedKey);
  const collectionError = errorsByKey[selectedKey];

  function retrySelectedCollection() {
    void loadCollectionPage(
      selectedKey,
      selectedPage?.nextCursor ?? null,
    );
  }

  return (
    <div className="grid gap-5 md:grid-cols-[260px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]">
      <PlaylistSidebar
        editingKey={editingKey}
        favoriteCount={favoriteCount}
        ignoredCount={initialIgnoredCount}
        onSelectCollection={(key, href) => selectCollection(key, href, false)}
        onToggleEditing={(key, href) =>
          selectCollection(key, href, editingKey !== key)
        }
        playlists={initialPlaylists}
        readLaterCount={initialReadLaterCount}
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

        {!selectedPage ? (
          collectionError ? (
            <div
              className="rounded-lg border border-rose-200 bg-rose-50 p-5"
              role="alert"
            >
              <p className="text-sm font-bold text-rose-800">
                {collectionError}
              </p>
              <button
                className="mt-3 text-sm font-black text-rose-900 underline"
                disabled={isLoading}
                onClick={retrySelectedCollection}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : (
            <LoadingCollection />
          )
        ) : null}

        {selectedKey === "read-later" && selectedPage ? (
          isEditing && defaultPlaylist ? (
            <PlaylistPapers
              key={`${defaultPlaylist.id}-${selectedPapers.map((paper) => paper.id).join(",")}`}
              onPaperRemoved={(paperId) =>
                removePlaylistPaper("read-later", paperId)
              }
              papers={selectedPapers}
              playlistId={defaultPlaylist.id}
              reorderDisabled={Boolean(selectedPage.nextCursor)}
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
              title="Read later is empty"
            />
          )
        ) : null}

        {selectedKey === "favorites" && selectedPage ? (
          selectedPapers.length ? (
            <PaperGrid>
              {selectedPapers.map((paper) => (
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

        {selectedKey === "ignored" && selectedPage ? (
          selectedPage.items.length ? (
            <PaperGrid>
              {selectedPage.items.map((item) => (
                <PaperListItem
                  key={`${item.ignoredAction}-${item.paper.id}-${item.ignoredAt}`}
                  meta={
                    item.ignoredAction && item.ignoredAt ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">
                          {ignoredActionLabel(item.ignoredAction)}
                        </span>
                        <span className="text-xs font-bold text-slate-500">
                          {formatIgnoredDate(item.ignoredAt)}
                        </span>
                      </div>
                    ) : null
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

        {selectedPlaylist && selectedPage ? (
          isEditing ? (
            <PlaylistPapers
              key={`${selectedPlaylist.id}-${selectedPapers.map((paper) => paper.id).join(",")}`}
              onPaperRemoved={(paperId) =>
                removePlaylistPaper(selectedKey, paperId)
              }
              papers={selectedPapers}
              playlistId={selectedPlaylist.id}
              reorderDisabled={Boolean(selectedPage.nextCursor)}
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

        {selectedPage && collectionError ? (
          <div
            className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-4"
            role="alert"
          >
            <p className="text-sm font-bold text-rose-800">{collectionError}</p>
            <button
              className="mt-2 text-sm font-black text-rose-900 underline"
              disabled={isLoading}
              onClick={retrySelectedCollection}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : null}

        {selectedPage?.nextCursor ? (
          <div className="mt-4 text-center">
            {isEditing &&
            (selectedKey === "read-later" || selectedPlaylist) ? (
              <p className="mb-2 text-xs font-semibold text-slate-500">
                Load all papers to enable drag-and-drop reordering.
              </p>
            ) : null}
            <button
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:border-teal-400 hover:text-teal-800 disabled:cursor-wait disabled:opacity-60"
              disabled={isLoading}
              onClick={() =>
                void loadCollectionPage(selectedKey, selectedPage.nextCursor)
              }
              type="button"
            >
              {isLoading ? "Loading..." : "Load more papers"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
