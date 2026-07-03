import { BookmarkX } from "lucide-react";
import { toggleReadLaterAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { PaperListItem } from "@/components/paper-list-item";
import { PlaylistPapers } from "@/components/playlist-papers";
import { PlaylistSidebar } from "@/components/playlist-sidebar";
import { requireOwnerId } from "@/lib/auth/session";
import {
  getLibraryPageData,
  hasCompletedOnboarding,
} from "@/lib/repositories/user-data";
import { getPapersByIds } from "@/lib/repositories/catalog";
import { redirect } from "next/navigation";
import type { Paper } from "@/types/paper";

export const dynamic = "force-dynamic";

type LibraryPageProps = {
  searchParams: Promise<{ playlist?: string }>;
};

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const ownerId = await requireOwnerId();

  if (!(await hasCompletedOnboarding(ownerId))) {
    redirect("/onboarding");
  }

  const { playlist: selectedPlaylistId } = await searchParams;
  const { playlists, favoritePapers, readLaterPapers, readLaterCount } =
    await getLibraryPageData(ownerId);

  const selectedPlaylist = selectedPlaylistId
    ? playlists.find((p) => p.id === selectedPlaylistId)
    : null;

  const selectedPapers: Paper[] = selectedPlaylist?.paperIds.length
    ? await getPapersByIds(selectedPlaylist.paperIds)
    : [];

  return (
    <AppShell
      title="Library"
      subtitle="Favorites and private reading lists stay separate from lightweight open signals."
      readLaterCount={readLaterCount}
    >
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <PlaylistSidebar
          playlists={playlists}
          selectedId={selectedPlaylistId ?? null}
        />

        <section className="space-y-5">
          {selectedPlaylist && selectedPlaylistId ? (
            <div>
              <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
                {selectedPlaylist.name}
              </h2>
              <div className="mt-3">
                <PlaylistPapers playlistId={selectedPlaylistId} papers={selectedPapers} />
              </div>
            </div>
          ) : null}

          {!selectedPlaylist ? (
            <>
              <div>
                <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
                  Favorites
                </h2>
                <div className="mt-3 space-y-3">
                  {favoritePapers.length ? (
                    favoritePapers.map((paper) => (
                      <PaperListItem key={paper.id} paper={paper} />
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center">
                      <div className="mx-auto h-8 w-8 rounded-full bg-rose-50" />
                      <h3 className="mt-3 text-sm font-black text-slate-950">
                        No favorites yet
                      </h3>
                      <p className="mt-1.5 text-xs font-semibold leading-5 text-slate-500">
                        Favorite papers from the deck to keep them here.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
                  Read later
                </h2>
                <div className="mt-3 space-y-3">
                  {readLaterPapers.length ? (
                    readLaterPapers.map((paper) => (
                      <PaperListItem
                        key={paper.id}
                        action={
                          <form action={toggleReadLaterAction}>
                            <input name="paperId" type="hidden" value={paper.id} />
                            <input name="sourcePath" type="hidden" value="/library" />
                            <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-black text-emerald-700">
                              <BookmarkX
                                aria-hidden="true"
                                size={17}
                                strokeWidth={2.5}
                              />
                              Remove from Read later
                            </button>
                          </form>
                        }
                        paper={paper}
                      />
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center">
                      <div className="mx-auto h-8 w-8 rounded-full bg-emerald-50" />
                      <h3 className="mt-3 text-sm font-black text-slate-950">
                        Read later is empty
                      </h3>
                      <p className="mt-1.5 text-xs font-semibold leading-5 text-slate-500">
                        Save papers to the default Read later playlist from the deck.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
