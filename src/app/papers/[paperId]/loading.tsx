import { AppShell } from "@/components/app-shell";

function ActionSkeleton() {
  return (
    <div className="animate-pulse mt-7 flex flex-wrap gap-2">
      <div className="h-11 w-28 rounded-lg border border-slate-200 bg-slate-50" />
      <div className="h-11 w-28 rounded-lg border border-slate-200 bg-slate-50" />
      <div className="h-11 w-32 rounded-lg border border-slate-200 bg-slate-50" />
      <div className="h-11 w-32 rounded-lg border border-slate-200 bg-slate-50" />
      <div className="h-11 w-32 rounded-lg bg-slate-200" />
    </div>
  );
}

function SummaryRowSkeleton({ wide }: { wide?: boolean }) {
  return (
    <div>
      <div className="h-3 w-28 rounded bg-slate-100" />
      <div className="mt-2 space-y-1.5">
        <div className="h-3.5 w-full rounded bg-slate-50" />
        <div className="h-3.5 w-11/12 rounded bg-slate-50" />
        {wide ? (
          <>
            <div className="h-3.5 w-full rounded bg-slate-50" />
            <div className="h-3.5 w-5/6 rounded bg-slate-50" />
          </>
        ) : (
          <div className="h-3.5 w-2/3 rounded bg-slate-50" />
        )}
      </div>
    </div>
  );
}

export default function PaperDetailLoading() {
  return (
    <AppShell
      title="Paper detail"
      subtitle={
        <span className="inline-block h-4 w-64 animate-pulse rounded bg-slate-100" />
      }
    >
      <article className="mx-auto w-full max-w-4xl animate-pulse rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <div className="flex flex-wrap gap-2">
          <div className="h-6 w-16 rounded-md bg-slate-100" />
          <div className="h-6 w-20 rounded-md bg-slate-100" />
          <div className="h-6 w-14 rounded-md bg-slate-100" />
        </div>

        <div className="mt-5 space-y-2">
          <div className="h-8 w-full rounded bg-slate-100" />
          <div className="h-8 w-5/6 rounded bg-slate-100" />
        </div>

        <div className="mt-4 space-y-1.5">
          <div className="h-4 w-3/4 rounded bg-slate-50" />
          <div className="h-4 w-1/2 rounded bg-slate-50" />
        </div>

        <ActionSkeleton />

        <section className="mt-8 border-t border-slate-200 pt-6">
          <div className="h-3.5 w-16 rounded bg-slate-100" />
          <div className="mt-4 space-y-2">
            <div className="h-3.5 w-full rounded bg-slate-50" />
            <div className="h-3.5 w-full rounded bg-slate-50" />
            <div className="h-3.5 w-11/12 rounded bg-slate-50" />
            <div className="h-3.5 w-full rounded bg-slate-50" />
            <div className="h-3.5 w-5/6 rounded bg-slate-50" />
            <div className="h-3.5 w-full rounded bg-slate-50" />
            <div className="h-3.5 w-3/4 rounded bg-slate-50" />
          </div>
        </section>

        <section className="mt-8 border-t border-slate-200 pt-6">
          <div className="h-3.5 w-24 rounded bg-slate-100" />
          <div className="mt-4 space-y-5">
            <SummaryRowSkeleton wide />
            <SummaryRowSkeleton wide />
            <SummaryRowSkeleton />
            <SummaryRowSkeleton />
          </div>
        </section>
      </article>
    </AppShell>
  );
}
