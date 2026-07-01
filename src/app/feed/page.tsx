import { AppShell } from "@/components/app-shell";
import { PaperCard } from "@/components/paper-card";
import { requireUserContext } from "@/lib/auth/session";
import { ensureUserProfile, getFeedPageData } from "@/lib/repositories/user-data";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const user = await requireUserContext();
  await ensureUserProfile(user);
  const {
    activePaper,
    nextPapers,
    favoriteIds,
    readLaterIds,
    readLaterCount,
  } = await getFeedPageData(user.ownerId);

  return (
    <AppShell
      title="Today"
      subtitle="A relevance-first deck tuned from your topics and recent feedback."
      readLaterCount={readLaterCount}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex justify-center">
          {activePaper ? (
            <PaperCard
              isFavorite={favoriteIds.has(activePaper.id)}
              isSaved={readLaterIds.has(activePaper.id)}
              paper={activePaper}
            />
          ) : (
            <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
              <h2 className="text-lg font-black text-slate-950">
                No papers left in this seed deck
              </h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                Adjust your interests or wait for the ingestion worker to add
                more papers.
              </p>
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
              Mix
            </h2>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-teal-50 p-3">
                <dt className="text-lg font-black text-teal-700">65%</dt>
                <dd className="mt-1 text-xs font-bold text-teal-900">
                  Relevant
                </dd>
              </div>
              <div className="rounded-lg bg-indigo-50 p-3">
                <dt className="text-lg font-black text-indigo-700">20%</dt>
                <dd className="mt-1 text-xs font-bold text-indigo-900">
                  Explore
                </dd>
              </div>
              <div className="rounded-lg bg-amber-50 p-3">
                <dt className="text-lg font-black text-amber-700">15%</dt>
                <dd className="mt-1 text-xs font-bold text-amber-900">
                  Classics
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
              Up next
            </h2>
            <div className="mt-4 space-y-3">
              {nextPapers.map((paper) => (
                <div key={paper.id} className="border-t border-slate-100 pt-3">
                  <p className="text-sm font-black leading-5 text-slate-900">
                    {paper.title}
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    {paper.source} - {paper.year}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
