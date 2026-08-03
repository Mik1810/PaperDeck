"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCheck } from "lucide-react";
import { markAllNotificationsReadAction } from "@/app/actions";

export function NotificationHistoryControls({ unreadCount }: { unreadCount: number }) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (unreadCount === 0) return null;

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setErrorMessage(null);
          startTransition(async () => {
            try {
              const result = await markAllNotificationsReadAction();
              if (!result.ok) {
                setErrorMessage(
                  result.message || "Notifications could not be updated.",
                );
                return;
              }
              router.refresh();
            } catch {
              setErrorMessage("Notifications could not be updated.");
            }
          });
        }}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
      >
        <CheckCheck aria-hidden="true" size={17} />
        {isPending ? "Updating…" : "Mark all as read"}
      </button>
      {errorMessage ? (
        <p role="alert" className="mt-2 text-xs font-bold text-rose-700">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
