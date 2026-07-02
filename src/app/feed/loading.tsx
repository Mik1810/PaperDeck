import { AppShell } from "@/components/app-shell";

function CardSkeleton() {
  return (
    <div className="mx-auto w-full max-w-md animate-pulse rounded-lg border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.18)] lg:max-w-none">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="space-y-1.5">
          <div className="h-3.5 w-36 rounded bg-slate-100" />
          <div className="h-3 w-28 rounded bg-slate-50" />
        </div>
        <div className="h-6 w-14 rounded-md bg-slate-100" />
      </div>
      <div className="px-5 py-5">
        <div className="mb-4 flex flex-wrap gap-2">
          <div className="h-6 w-16 rounded-md bg-slate-100" />
          <div className="h-6 w-20 rounded-md bg-slate-100" />
        </div>
        <div className="mb-3 h-7 w-11/12 rounded bg-slate-100" />
        <div className="mb-1 h-4 w-3/4 rounded bg-slate-50" />
        <div className="mb-1 h-4 w-1/2 rounded bg-slate-50" />
        <div className="mt-5 space-y-2.5">
          <div className="h-3.5 w-full rounded bg-slate-50" />
          <div className="h-3.5 w-full rounded bg-slate-50" />
          <div className="h-3.5 w-11/12 rounded bg-slate-50" />
          <div className="h-3.5 w-full rounded bg-slate-50" />
          <div className="h-3.5 w-5/6 rounded bg-slate-50" />
          <div className="h-3.5 w-full rounded bg-slate-50" />
          <div className="h-3.5 w-3/4 rounded bg-slate-50" />
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2 border-t border-slate-100 bg-slate-50 p-3">
        <div className="h-12 rounded-lg bg-slate-100" />
        <div className="col-span-2 h-12 rounded-lg bg-slate-200" />
        <div className="h-12 rounded-lg bg-slate-100" />
        <div className="h-12 rounded-lg bg-slate-100" />
      </div>
      <div className="h-11 border-t border-slate-100" />
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <aside className="hidden space-y-5 lg:block">
      <section className="animate-pulse rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="h-4 w-10 rounded bg-slate-100" />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="mx-auto h-7 w-10 rounded bg-slate-100" />
            <div className="mx-auto mt-1 h-3 w-12 rounded bg-slate-50" />
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="mx-auto h-7 w-10 rounded bg-slate-100" />
            <div className="mx-auto mt-1 h-3 w-12 rounded bg-slate-50" />
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="mx-auto h-7 w-10 rounded bg-slate-100" />
            <div className="mx-auto mt-1 h-3 w-12 rounded bg-slate-50" />
          </div>
        </div>
      </section>

      <section className="animate-pulse rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="h-4 w-14 rounded bg-slate-100" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border-t border-slate-100 pt-3">
              <div className="h-4 w-full rounded bg-slate-100" />
              <div className="mt-1 h-3 w-20 rounded bg-slate-50" />
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

export default function FeedLoading() {
  return (
    <AppShell title="Feed" subtitle="Your personalized paper deck">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <CardSkeleton />
        </div>
        <SidebarSkeleton />
      </div>
    </AppShell>
  );
}
