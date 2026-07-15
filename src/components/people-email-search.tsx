"use client";

import { FormEvent, useState, useTransition } from "react";
import { Loader2, Search, UserRound } from "lucide-react";
import {
  blockProfileAction,
  cancelFriendRequestAction,
  respondFriendRequestAction,
  searchCollaborationProfileAction,
  sendFriendRequestAction,
  type CollaborationSearchResult,
  type FriendActionResult,
  unfriendProfileAction,
} from "@/app/actions";

export function PeopleEmailSearch() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<CollaborationSearchResult>({
    status: "idle",
  });
  const [isPending, startTransition] = useTransition();
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult({ status: "idle" });
    setActionMessage(null);
    startTransition(async () => {
      setResult(await searchCollaborationProfileAction(email));
    });
  }

  function applyAction(task: Promise<FriendActionResult>) {
    setActionMessage(null);
    startTransition(async () => {
      const actionResult = await task;
      if (!actionResult.ok) {
        setActionMessage(actionResult.message ?? "The action could not be completed.");
        return;
      }
      setResult((current) => {
        if (current.status !== "found" || !actionResult.relationshipStatus) {
          return current;
        }
        return {
          status: "found",
          profile: {
            ...current.profile,
            relationshipStatus: actionResult.relationshipStatus,
            requestId: actionResult.requestId ?? null,
          },
        };
      });
    });
  }

  function blockCurrentProfile() {
    if (result.status !== "found") return;
    if (!window.confirm(`Block ${result.profile.displayName}?`)) return;
    setActionMessage(null);
    startTransition(async () => {
      const actionResult = await blockProfileAction(result.profile.publicId);
      if (actionResult.ok) {
        setResult({ status: "unavailable" });
      } else {
        setActionMessage(actionResult.message ?? "The action could not be completed.");
      }
    });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div>
        <h2 className="text-sm font-black text-slate-950">Find people</h2>
        <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
          Enter their complete email. We never display or store the address.
        </p>
      </div>
      <form className="mt-3 flex flex-col gap-3 sm:flex-row" onSubmit={submit}>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Exact user email</span>
          <input
            autoComplete="off"
            className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            placeholder="researcher@example.test"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-black text-white transition hover:bg-teal-700 disabled:cursor-wait disabled:bg-teal-400"
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="animate-spin" size={17} />
          ) : (
            <Search size={17} />
          )}
          Find person
        </button>
      </form>

      {result.status === "found" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-teal-200 bg-teal-50 p-3">
          {result.profile.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              className="size-11 rounded-full object-cover"
              src={result.profile.imageUrl}
            />
          ) : (
            <span className="grid size-11 place-items-center rounded-full bg-white text-teal-700">
              <UserRound size={20} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black text-slate-950">
              {result.profile.displayName}
            </p>
            <p className="text-xs font-semibold text-slate-500">
              PaperDeck profile
            </p>
          </div>
          <div className="flex basis-full flex-wrap justify-end gap-2 sm:basis-auto">
            {result.profile.relationshipStatus === "none" ? (
              <button
                className="h-9 rounded-lg bg-teal-700 px-3 text-xs font-black text-white disabled:opacity-50"
                disabled={isPending}
                type="button"
                onClick={() => applyAction(sendFriendRequestAction(result.profile.publicId))}
              >
                Add friend
              </button>
            ) : null}
            {result.profile.relationshipStatus === "outgoing_pending" && result.profile.requestId ? (
              <button
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-50"
                disabled={isPending}
                type="button"
                onClick={() => applyAction(cancelFriendRequestAction(result.profile.requestId!))}
              >
                Cancel request
              </button>
            ) : null}
            {result.profile.relationshipStatus === "incoming_pending" && result.profile.requestId ? (
              <>
                <button
                  className="h-9 rounded-lg bg-teal-700 px-3 text-xs font-black text-white disabled:opacity-50"
                  disabled={isPending}
                  type="button"
                  onClick={() => applyAction(respondFriendRequestAction(result.profile.requestId!, true))}
                >
                  Accept
                </button>
                <button
                  className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-50"
                  disabled={isPending}
                  type="button"
                  onClick={() => applyAction(respondFriendRequestAction(result.profile.requestId!, false))}
                >
                  Decline
                </button>
              </>
            ) : null}
            {result.profile.relationshipStatus === "friends" ? (
              <button
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-50"
                disabled={isPending}
                type="button"
                onClick={() => applyAction(unfriendProfileAction(result.profile.publicId))}
              >
                Unfriend
              </button>
            ) : null}
            <button
              className="h-9 rounded-lg px-2 text-xs font-black text-rose-700 disabled:opacity-50"
              disabled={isPending}
              type="button"
              onClick={blockCurrentProfile}
            >
              Block
            </button>
          </div>
        </div>
      ) : null}

      {actionMessage ? (
        <p aria-live="polite" className="mt-3 text-xs font-bold text-rose-700">
          {actionMessage}
        </p>
      ) : null}

      {result.status === "unavailable" ? (
        <p aria-live="polite" className="mt-4 rounded-lg bg-slate-100 p-3 text-xs font-bold leading-5 text-slate-600">
          This profile is unavailable. Check the exact address or ask the person
          whether email discovery is enabled.
        </p>
      ) : null}
      {result.status === "rate_limited" ? (
        <p aria-live="polite" className="mt-4 rounded-lg bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900">
          Too many searches. Wait one minute and try again.
        </p>
      ) : null}
    </section>
  );
}
