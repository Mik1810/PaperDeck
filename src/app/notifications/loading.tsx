import { AppShell } from "@/components/app-shell";

export default function NotificationsLoading() {
  return (
    <AppShell
      title="Notifications"
      subtitle="Requests and research-group updates from the last 90 days."
    >
      <div className="space-y-4" aria-label="Loading notification history">
        <div className="h-14 animate-pulse rounded-lg bg-slate-200" />
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-32 animate-pulse rounded-lg bg-slate-200" />
        ))}
      </div>
    </AppShell>
  );
}
