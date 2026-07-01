import { AppShell } from "@/components/app-shell";
import { PaperCard } from "@/components/paper-card";
import { mockPapers } from "@/lib/mock-data";

export default function FeedPage() {
  const activePaper = mockPapers[0];
  const nextPapers = mockPapers.slice(1, 4);

  return (
    <AppShell
      title="Today"
      subtitle="A relevance-first deck tuned for algorithms, complexity, and programming languages."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex justify-center">
          <PaperCard paper={activePaper} />
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
