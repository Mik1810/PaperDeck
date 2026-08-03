"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Bell, CheckCheck, X } from "lucide-react";
import { markAllNotificationsReadAction } from "@/app/actions";
import { NotificationList } from "@/components/notification-list";
import {
  isImportantNotification,
  pinActionableNotifications,
  presentNotification,
} from "@/lib/notifications/presentation";
import type { NotificationSummary } from "@/lib/repositories/notifications";

type NotificationResponse = {
  items: NotificationSummary[];
  unreadCount: number;
};

export function NotificationCenter() {
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const knownIdsRef = useRef(new Set<string>());
  const initializedRef = useRef(false);
  const refreshSequenceRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationSummary[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<NotificationSummary | null>(null);
  const [panelPosition, setPanelPosition] = useState({ top: "4.5rem", right: "1rem" });
  const [isPending, startTransition] = useTransition();

  const positionPanel = useCallback(() => {
    const rectangle = bellRef.current?.getBoundingClientRect();
    if (!rectangle) return;
    setPanelPosition({
      top: `${rectangle.bottom + 12}px`,
      right: `${Math.max(16, window.innerWidth - rectangle.right)}px`,
    });
  }, []);

  const refresh = useCallback(async (announceNew = false) => {
    const sequence = ++refreshSequenceRef.current;
    try {
      const response = await fetch("/api/notifications?limit=20", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Notification request failed");
      const payload = (await response.json()) as NotificationResponse;
      const ordered = pinActionableNotifications(payload.items);
      if (sequence !== refreshSequenceRef.current) return;

      if (initializedRef.current && announceNew) {
        const important = ordered.find(
          (item) =>
            !item.readAt &&
            !knownIdsRef.current.has(item.id) &&
            isImportantNotification(item),
        );
        if (important) setToast(important);
      }

      knownIdsRef.current = new Set(ordered.map((item) => item.id));
      initializedRef.current = true;
      setItems(ordered);
      setUnreadCount(payload.unreadCount);
      setErrorMessage(null);
    } catch {
      if (sequence !== refreshSequenceRef.current) return;
      setErrorMessage("Notifications could not be refreshed.");
    } finally {
      if (sequence === refreshSequenceRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const onReconnect = () => void refresh(true);
    window.addEventListener("focus", onReconnect);
    window.addEventListener("online", onReconnect);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onReconnect);
      window.removeEventListener("online", onReconnect);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const focusable = panel?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        bellRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", positionPanel);
    return () => window.removeEventListener("resize", positionPanel);
  }, [open, positionPanel]);

  function markAllRead() {
    startTransition(async () => {
      try {
        const result = await markAllNotificationsReadAction();
        if (!result.ok) {
          setErrorMessage(
            result.message || "Notifications could not be updated.",
          );
          return;
        }
        const now = new Date().toISOString();
        setItems((current) =>
          current.map((item) => ({ ...item, readAt: item.readAt ?? now })),
        );
        setUnreadCount(0);
        setErrorMessage(null);
      } catch {
        setErrorMessage("Notifications could not be updated.");
      }
    });
  }

  const badge = unreadCount > 99 ? "99+" : String(unreadCount);
  const toastCopy = toast ? presentNotification(toast) : null;

  return (
    <div className="relative">
      <button
        ref={bellRef}
        type="button"
        aria-label={
          unreadCount
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={open}
        aria-controls="notification-center-panel"
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            positionPanel();
            setOpen(true);
            void refresh(false);
          }
        }}
        className="relative grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
      >
        <Bell aria-hidden="true" size={18} strokeWidth={2.4} />
        {unreadCount > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-rose-600 px-1.5 py-0.5 text-center text-[10px] font-black leading-4 text-white shadow-sm">
            {badge}
          </span>
        ) : null}
      </button>

      {(open || (toast && toastCopy)) && typeof document !== "undefined"
        ? createPortal(
            <>
              {open ? (
                <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40 bg-slate-950/30 md:bg-transparent"
            onClick={() => {
              setOpen(false);
              bellRef.current?.focus();
            }}
          />
          <div
            ref={panelRef}
            id="notification-center-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-center-title"
            style={
              {
                "--notification-panel-top": panelPosition.top,
                "--notification-panel-right": panelPosition.right,
              } as CSSProperties
            }
            className="fixed inset-x-0 bottom-0 z-50 max-h-[min(82vh,42rem)] overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl md:inset-auto md:right-[var(--notification-panel-right)] md:top-[var(--notification-panel-top)] md:w-[26rem] md:rounded-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2
                  id="notification-center-title"
                  className="text-base font-black text-slate-950"
                >
                  Notifications
                </h2>
                <p className="text-xs font-semibold text-slate-500">
                  {unreadCount} unread
                </p>
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={markAllRead}
                    className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-black text-teal-700 hover:bg-teal-50 disabled:opacity-60"
                  >
                    <CheckCheck aria-hidden="true" size={15} /> Mark all read
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Close notifications"
                  onClick={() => {
                    setOpen(false);
                    bellRef.current?.focus();
                  }}
                  className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-950"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
            </div>

            <div className="max-h-[calc(min(82vh,42rem)-8.5rem)] overflow-y-auto px-4 py-4">
              {loading ? (
                <div className="space-y-3" aria-label="Loading notifications">
                  {[0, 1, 2].map((item) => (
                    <div
                      key={item}
                      className="h-20 animate-pulse rounded-lg bg-slate-100"
                    />
                  ))}
                </div>
              ) : errorMessage ? (
                <div role="alert" className="rounded-lg bg-rose-50 p-4">
                  <p className="text-sm font-bold text-rose-800">{errorMessage}</p>
                  <button
                    type="button"
                    onClick={() => void refresh(false)}
                    className="mt-3 text-sm font-black text-rose-900 underline"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <NotificationList
                  key={items.map((item) => `${item.id}:${item.readAt}`).join("|")}
                  compact
                  initialItems={items}
                  onChanged={() => void refresh(false)}
                />
              )}
            </div>

            <div className="border-t border-slate-200 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="block rounded-lg bg-slate-950 px-4 py-2.5 text-center text-sm font-black text-white hover:bg-slate-800"
              >
                View notification history
              </Link>
            </div>
          </div>
                </>
              ) : null}

      {toast && toastCopy ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-4 top-20 z-[60] w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-teal-200 bg-white p-4 shadow-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black text-slate-950">{toastCopy.title}</p>
              <p className="mt-1 text-sm text-slate-600">{toastCopy.detail}</p>
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        </div>
      ) : null}
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
