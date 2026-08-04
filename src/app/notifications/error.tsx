"use client";

import { AppShell } from "@/components/app-shell";

export default function NotificationsError({ reset }: { reset: () => void }) {
  return (
    <AppShell title="Notifications">
      <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5">
        <h2 className="text-base font-black text-rose-900">
          Notification history is unavailable
        </h2>
        <p className="mt-2 text-sm text-rose-800">
          Your notification data was not changed. Try loading it again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg bg-rose-900 px-4 py-2 text-sm font-black text-white hover:bg-rose-800"
        >
          Try again
        </button>
      </div>
    </AppShell>
  );
}
