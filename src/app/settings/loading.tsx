import { AppShell } from "@/components/app-shell";

export default function SettingsLoading() {
  return (
    <AppShell title="Settings" subtitle="Customize your PaperDeck experience">
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="animate-pulse rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-4 w-16 rounded bg-slate-100" />
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-4 w-12 rounded bg-slate-50" />
              <div className="h-4 w-16 rounded bg-slate-100" />
            </div>
            <div className="flex items-center justify-between">
              <div className="h-4 w-16 rounded bg-slate-50" />
              <div className="h-4 w-14 rounded bg-slate-100" />
            </div>
          </div>
        </section>

        <section className="animate-pulse rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-4 w-14 rounded bg-slate-100" />
          <div className="mt-4 h-12 rounded-lg bg-slate-50" />
        </section>

        <section className="animate-pulse rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="h-4 w-16 rounded bg-slate-100" />
            <div className="h-4 w-14 rounded bg-slate-50" />
          </div>
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="h-12 rounded-lg bg-slate-50" />
              <div className="h-12 rounded-lg bg-slate-50" />
              <div className="h-12 rounded-lg bg-slate-50" />
              <div className="h-12 rounded-lg bg-slate-50" />
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="h-9 w-20 rounded-lg bg-slate-50" />
              <div className="h-9 w-24 rounded-lg bg-slate-50" />
              <div className="h-9 w-16 rounded-lg bg-slate-50" />
              <div className="h-9 w-28 rounded-lg bg-slate-50" />
              <div className="h-9 w-20 rounded-lg bg-slate-50" />
              <div className="h-9 w-16 rounded-lg bg-slate-50" />
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
