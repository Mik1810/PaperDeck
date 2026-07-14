"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function PwaProvider() {
  const [updateReady, setUpdateReady] = useState(false);
  const dismissed = useRef(false);

  const handleRefresh = useCallback(() => {
    window.location.reload();
  }, []);

  const handleDismiss = useCallback(() => {
    dismissed.current = true;
    setUpdateReady(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;

    function showUpdate() {
      if (cancelled || dismissed.current) return;
      setUpdateReady(true);
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        if (cancelled) return;

        if (registration.waiting && navigator.serviceWorker.controller) {
          showUpdate();
          return;
        }

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;

          worker.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              showUpdate();
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[PWA] Service worker registration failed:", err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!updateReady) return null;

  return (
    <div className="fixed bottom-[calc(4.5rem+max(0.6rem,env(safe-area-inset-bottom)))] inset-x-0 z-40 mx-auto w-fit max-w-md px-4 md:hidden">
      <div className="flex items-center gap-3 rounded-xl border border-slate-300 bg-slate-900 px-5 py-3 shadow-xl shadow-slate-900/20">
        <span className="text-sm font-bold text-white">
          New version available
        </span>
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg bg-teal-500 px-3 py-1 text-sm font-bold text-white transition hover:bg-teal-600 active:scale-[0.98]"
            onClick={handleRefresh}
            type="button"
          >
            Refresh
          </button>
          <button
            className="rounded-lg px-3 py-1 text-sm font-bold text-slate-400 transition hover:text-slate-200 active:scale-[0.98]"
            onClick={handleDismiss}
            type="button"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
