export function SkeletonCard() {
  return (
    <div className="mx-auto w-full max-w-lg animate-pulse rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap gap-1.5">
        <div className="h-5 w-16 rounded-full bg-slate-100" />
        <div className="h-5 w-20 rounded-full bg-slate-100" />
      </div>
      <div className="mb-3 h-6 w-4/5 rounded bg-slate-100" />
      <div className="mb-2 h-4 w-full rounded bg-slate-50" />
      <div className="mb-2 h-4 w-5/6 rounded bg-slate-50" />
      <div className="mb-4 h-4 w-3/4 rounded bg-slate-50" />
      <div className="mt-4 flex items-center justify-between">
        <div className="flex gap-3">
          <div className="h-10 w-10 rounded-full bg-slate-100" />
          <div className="h-10 w-10 rounded-full bg-slate-100" />
          <div className="h-10 w-10 rounded-full bg-slate-100" />
        </div>
        <div className="h-4 w-20 rounded bg-slate-100" />
      </div>
    </div>
  );
}
