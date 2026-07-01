import { AppShell } from "@/components/app-shell";
import { PaperListItem } from "@/components/paper-list-item";
import { requireUserContext } from "@/lib/auth/session";
import {
  ensureUserProfile,
  getLibraryPageData,
} from "@/lib/repositories/user-data";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const user = await requireUserContext();
  await ensureUserProfile(user);
  const { playlists, favoritePapers, readLaterPapers, readLaterCount } =
    await getLibraryPageData(user.ownerId);

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
                  <PaperListItem key={paper.id} paper={paper} />
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
