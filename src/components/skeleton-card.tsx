export function SkeletonCard() {
  return (
    <div className="mx-auto w-full max-w-md animate-pulse rounded-lg border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.18)] lg:max-w-none">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="space-y-1.5">
          <div className="h-3.5 w-36 rounded bg-slate-100" />
          <div className="h-3 w-28 rounded bg-slate-50" />
        </div>
        <div className="h-6 w-14 rounded-md bg-slate-100" />
      </div>

      <div className="flex-1 px-5 py-5">
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
