import { BookmarkX } from "lucide-react";
import { toggleReadLaterAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { PaperListItem } from "@/components/paper-list-item";
import { requireOwnerId } from "@/lib/auth/session";
import { getLibraryPageData } from "@/lib/repositories/user-data";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const ownerId = await requireOwnerId();
  const { playlists, favoritePapers, readLaterPapers, readLaterCount } =
    await getLibraryPageData(ownerId);

  return (
    <AppShell
      title="Library"
      subtitle="Favorites and private reading lists stay separate from lightweight open signals."
      readLaterCount={readLaterCount}
    >
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-3">
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm"
            >
              <span className="font-black text-slate-900">{playlist.name}</span>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">
                {playlist.paperIds.length}
              </span>
            </button>
          ))}
        </aside>

        <section className="space-y-5">
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
                <p className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-sm font-semibold text-slate-500">
                  Favorite papers from the deck to keep them here.
                </p>
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
                <p className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-sm font-semibold text-slate-500">
                  Save papers to the default Read later playlist from the deck.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
