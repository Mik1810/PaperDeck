import { AppShell } from "@/components/app-shell";

export default function LibraryLoading() {
  return (
    <AppShell title="Library" subtitle="Your saved papers and playlists">
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="h-4 w-3/4 rounded bg-slate-100" />
            <div className="mt-3 h-3 w-1/2 rounded bg-slate-50" />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
