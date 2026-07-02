import { AppShell } from "@/components/app-shell";

export default function SettingsLoading() {
  return (
    <AppShell title="Settings" subtitle="Customize your PaperDeck experience">
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5"
          >
            <div className="h-5 w-1/3 rounded bg-slate-100" />
            <div className="mt-3 h-3 w-2/3 rounded bg-slate-50" />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
