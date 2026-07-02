import { AppShell } from "@/components/app-shell";

export default function OnboardingLoading() {
  return (
    <AppShell title="Topics" subtitle="Choose your academic interests">
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5"
          >
            <div className="h-5 w-1/3 rounded bg-slate-100" />
            <div className="mt-3 flex flex-wrap gap-2">
              <div className="h-8 w-20 rounded-full bg-slate-50" />
              <div className="h-8 w-24 rounded-full bg-slate-50" />
              <div className="h-8 w-16 rounded-full bg-slate-50" />
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
