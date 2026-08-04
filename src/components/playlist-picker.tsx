"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Bookmark, Check, ListPlus, Plus, X } from "lucide-react";
import {
  createPlaylistWithPaperAction,
  setPaperPlaylistMembershipAction,
} from "@/app/actions";
import type {
  PaperPlaylistOption,
  PlaylistSaveContext,
} from "@/lib/repositories/user-data";

type PlaylistPickerProps = {
  context: PlaylistSaveContext;
  initialSaved: boolean;
  onSaveComplete?: () => void;
  paperId: string;
  recommendationImpressionId?: string;
  variant?: "icon" | "compact" | "full";
};

type PlaylistResponse = {
  items: PaperPlaylistOption[];
};

export function PlaylistPicker({
  context,
  initialSaved,
  onSaveComplete,
  paperId,
  recommendationImpressionId,
  variant = "full",
}: PlaylistPickerProps) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PaperPlaylistOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mutatedDuringOpenRef = useRef(false);
  const addedDuringOpenRef = useRef(false);

  const saved = items?.some((item) => item.selected) ?? initialSaved;

  async function loadOptions() {
    setLoading(true);
    setItems(null);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/papers/${paperId}/playlists`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Playlist request failed");
      const payload = (await response.json()) as PlaylistResponse;
      setItems(payload.items);
    } catch {
      setErrorMessage("Your playlists could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  const closePicker = useCallback(() => {
    setOpen(false);
    setCreating(false);
    setCreateName("");
    triggerRef.current?.focus();
    if (mutatedDuringOpenRef.current) router.refresh();
    if (addedDuringOpenRef.current) onSaveComplete?.();
    mutatedDuringOpenRef.current = false;
    addedDuringOpenRef.current = false;
  }, [onSaveComplete, router]);

  useEffect(() => {
    if (!open) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const initialFocusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    initialFocusable?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePicker();
        return;
      }
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
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
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [closePicker, open]);

  async function toggleOption(option: PaperPlaylistOption) {
    const selected = !option.selected;
    setPendingId(option.id);
    setErrorMessage(null);
    setItems((current) =>
      current?.map((item) =>
        item.id === option.id ? { ...item, selected } : item,
      ) ?? null,
    );

    try {
      const result = await setPaperPlaylistMembershipAction({
        context,
        paperId,
        playlistId: option.id,
        recommendationImpressionId,
        selected,
      });
      if (!result.ok) throw new Error(result.message);
      mutatedDuringOpenRef.current = true;
      if (result.created) addedDuringOpenRef.current = true;
    } catch {
      setItems((current) =>
        current?.map((item) =>
          item.id === option.id ? { ...item, selected: option.selected } : item,
        ) ?? null,
      );
      setErrorMessage("This playlist could not be updated.");
    } finally {
      setPendingId(null);
    }
  }

  async function createPlaylist() {
    const name = createName.trim();
    if (!name) return;
    setPendingId("create");
    setErrorMessage(null);
    try {
      const result = await createPlaylistWithPaperAction({
        context,
        name,
        paperId,
        recommendationImpressionId,
      });
      if (!result.ok || !result.option) throw new Error(result.message);
      const option = result.option;
      setItems((current) => [...(current ?? []), option]);
      setCreateName("");
      setCreating(false);
      mutatedDuringOpenRef.current = true;
      addedDuringOpenRef.current = true;
    } catch {
      setErrorMessage("This playlist could not be created.");
    } finally {
      setPendingId(null);
    }
  }

  const buttonLabel = saved ? "Manage saved playlists" : "Save to playlist";
  const buttonClassName =
    variant === "icon"
      ? `grid h-12 w-full place-items-center rounded-lg border ${
          saved
            ? "border-teal-300 bg-teal-50 text-teal-600"
            : "border-teal-200 bg-white text-teal-600"
        } hover:border-teal-300 hover:bg-teal-50`
      : variant === "compact"
        ? `inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-black transition ${
            saved
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
          }`
        : `inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm font-black ${
            saved
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-emerald-200 bg-white text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50"
          }`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={variant === "icon" ? buttonLabel : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={buttonClassName}
        onClick={() => {
          setOpen(true);
          mutatedDuringOpenRef.current = false;
          addedDuringOpenRef.current = false;
          void loadOptions();
        }}
      >
        <Bookmark
          aria-hidden="true"
          fill={saved ? "currentColor" : "none"}
          size={variant === "icon" ? 19 : 18}
          strokeWidth={2.5}
        />
        {variant === "icon" ? null : saved ? "Saved" : "Save to playlist"}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Close playlist picker"
                className="fixed inset-0 z-40 bg-slate-950/40"
                onClick={closePicker}
              />
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`playlist-picker-title-${paperId}`}
                className="fixed inset-x-0 bottom-0 z-50 max-h-[min(82vh,42rem)] overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[28rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
              >
                <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
                  <div>
                    <h2
                      id={`playlist-picker-title-${paperId}`}
                      className="text-lg font-black text-slate-950"
                    >
                      Save to playlists
                    </h2>
                    <p className="mt-1 text-sm font-medium text-slate-500">
                      Choose one or more private reading lists.
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close playlist picker"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-950"
                    onClick={closePicker}
                  >
                    <X aria-hidden="true" size={18} />
                  </button>
                </div>

                <div className="max-h-[min(58vh,28rem)] overflow-y-auto px-5 py-4">
                  {errorMessage ? (
                    <div
                      role="alert"
                      className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800"
                    >
                      {errorMessage}
                    </div>
                  ) : null}

                  {loading ? (
                    <div className="space-y-2" aria-label="Loading playlists">
                      {[0, 1, 2].map((item) => (
                        <div
                          key={item}
                          className="h-12 animate-pulse rounded-lg bg-slate-100"
                        />
                      ))}
                    </div>
                  ) : items ? (
                    <div className="space-y-2">
                      {items.map((option) => (
                        <label
                          key={option.id}
                          className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                            option.selected
                              ? "border-teal-300 bg-teal-50"
                              : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={option.selected}
                            disabled={pendingId !== null}
                            onChange={() => void toggleOption(option)}
                            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-black text-slate-900">
                            {option.name}
                          </span>
                          {option.isDefault ? (
                            <span className="rounded-md bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-500">
                              Default
                            </span>
                          ) : option.selected ? (
                            <Check
                              aria-hidden="true"
                              className="text-teal-700"
                              size={16}
                            />
                          ) : null}
                        </label>
                      ))}

                      {!items.length ? (
                        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                          <ListPlus
                            aria-hidden="true"
                            className="mx-auto text-slate-400"
                            size={24}
                          />
                          <p className="mt-2 text-sm font-bold text-slate-600">
                            Create your first playlist below.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void loadOptions()}
                      className="text-sm font-black text-rose-800 underline"
                    >
                      Try loading again
                    </button>
                  )}

                  <div className="mt-4 border-t border-slate-200 pt-4">
                    {creating ? (
                      <form
                        className="space-y-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void createPlaylist();
                        }}
                      >
                        <label className="block text-xs font-black uppercase text-slate-500">
                          New playlist name
                          <input
                            autoFocus
                            required
                            maxLength={80}
                            value={createName}
                            onChange={(event) => setCreateName(event.target.value)}
                            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-900"
                          />
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={pendingId !== null}
                            className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60"
                          >
                            {pendingId === "create" ? "Creating…" : "Create and save"}
                          </button>
                          <button
                            type="button"
                            disabled={pendingId !== null}
                            onClick={() => {
                              setCreating(false);
                              setCreateName("");
                            }}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        disabled={pendingId !== null || loading}
                        onClick={() => setCreating(true)}
                        className="inline-flex items-center gap-2 text-sm font-black text-teal-700 hover:text-teal-900 disabled:opacity-60"
                      >
                        <Plus aria-hidden="true" size={17} /> Create new playlist
                      </button>
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-200 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
                  <button
                    type="button"
                    disabled={pendingId !== null}
                    onClick={closePicker}
                    className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    Done
                  </button>
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
