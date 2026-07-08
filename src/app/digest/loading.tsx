import { AppShell } from "@/components/app-shell";

export default function DigestLoading() {
  return (
    <AppShell
      title="Digest"
      subtitle="New for you — recent papers from the last few days, grouped by topic."
    >
      <div className="space-y-8">
        {Array.from({ length: 2 }).map((_, groupIndex) => (
          <section key={groupIndex}>
            <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
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
        ))}
      </div>
    </AppShell>
  );
}
