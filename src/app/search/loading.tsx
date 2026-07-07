import { AppShell } from "@/components/app-shell";

export default function SearchLoading() {
  return (
    <AppShell title="Search" subtitle="Find papers in the PaperDeck CS catalog.">
      <section className="space-y-5">
        <div className="animate-pulse rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-11 rounded-lg bg-slate-100" />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="h-4 w-24 rounded bg-slate-100" />
              <div className="mt-3 h-5 w-4/5 rounded bg-slate-100" />
              <div className="mt-2 h-4 w-2/3 rounded bg-slate-50" />
              <div className="mt-4 h-4 w-full rounded bg-slate-50" />
              <div className="mt-2 h-4 w-5/6 rounded bg-slate-50" />
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
