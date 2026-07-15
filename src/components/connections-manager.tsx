"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserRound } from "lucide-react";
import {
  blockProfileAction,
  cancelFriendRequestAction,
  respondFriendRequestAction,
  unblockProfileAction,
  unfriendProfileAction,
  type FriendActionResult,
} from "@/app/actions";
import type { CollaborationConnection } from "@/lib/repositories/collaboration";

type ConnectionsManagerProps = {
  connections: CollaborationConnection[];
};

const sectionLabels = {
  incoming_pending: "Requests received",
  outgoing_pending: "Requests sent",
  friends: "Friends",
  blocked: "Blocked users",
} as const;

export function ConnectionsManager({ connections }: ConnectionsManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const populatedSections = Object.entries(sectionLabels).flatMap(
    ([status, label]) => {
      const rows = connections.filter(
        (connection) => connection.relationshipStatus === status,
      );
      return rows.length ? [{ status, label, rows }] : [];
    },
  );

  function run(task: Promise<FriendActionResult>) {
    setMessage(null);
    startTransition(async () => {
      const result = await task;
      if (!result.ok) {
        setMessage(result.message ?? "The action could not be completed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:col-span-2 md:p-5 lg:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-black uppercase tracking-normal text-slate-500 md:text-base">
            Connections
          </h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
            Friendships are private and never affect paper ranking.
          </p>
        </div>
        {isPending ? <Loader2 className="animate-spin text-slate-500" size={18} /> : null}
      </div>

      {connections.length ? (
        <div
          className={`mt-5 grid gap-5 ${
            populatedSections.length > 1 ? "md:grid-cols-2" : "grid-cols-1"
          }`}
        >
          {populatedSections.map(({ status, label, rows }) => (
              <div key={status}>
                <h3 className="text-xs font-black uppercase tracking-normal text-slate-400">
                  {label}
                </h3>
                <div className="mt-2 space-y-2">
                  {rows.map((connection) => (
                    <div
                      key={`${status}-${connection.publicId}`}
                      className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-100 p-3"
                    >
                      {connection.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt=""
                          className="size-10 rounded-full object-cover"
                          src={connection.imageUrl}
                        />
                      ) : (
                        <span className="grid size-10 place-items-center rounded-full bg-white text-slate-500">
                          <UserRound size={18} />
                        </span>
                      )}
                      <p className="min-w-28 flex-1 truncate text-sm font-black text-slate-900">
                        {connection.displayName}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {connection.relationshipStatus === "incoming_pending" && connection.requestId ? (
                          <>
                            <button
                              className="h-8 rounded-lg bg-teal-700 px-3 text-xs font-black text-white disabled:opacity-50"
                              disabled={isPending}
                              onClick={() => run(respondFriendRequestAction(connection.requestId!, true))}
                            >
                              Accept
                            </button>
                            <button
                              className="h-8 rounded-lg bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-50"
                              disabled={isPending}
                              onClick={() => run(respondFriendRequestAction(connection.requestId!, false))}
                            >
                              Decline
                            </button>
                          </>
                        ) : null}
                        {connection.relationshipStatus === "outgoing_pending" && connection.requestId ? (
                          <button
                            className="h-8 rounded-lg bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-50"
                            disabled={isPending}
                            onClick={() => run(cancelFriendRequestAction(connection.requestId!))}
                          >
                            Cancel
                          </button>
                        ) : null}
                        {connection.relationshipStatus === "friends" ? (
                          <button
                            className="h-8 rounded-lg bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-50"
                            disabled={isPending}
                            onClick={() => run(unfriendProfileAction(connection.publicId))}
                          >
                            Unfriend
                          </button>
                        ) : null}
                        {connection.relationshipStatus === "blocked" ? (
                          <button
                            className="h-8 rounded-lg bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-50"
                            disabled={isPending}
                            onClick={() => run(unblockProfileAction(connection.publicId))}
                          >
                            Unblock
                          </button>
                        ) : (
                          <button
                            className="h-8 rounded-lg px-2 text-xs font-black text-rose-700 disabled:opacity-50"
                            disabled={isPending}
                            onClick={() => {
                              if (window.confirm(`Block ${connection.displayName}?`)) {
                                run(blockProfileAction(connection.publicId));
                              }
                            }}
                          >
                            Block
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-lg bg-slate-100 p-4 text-sm font-semibold text-slate-500">
          No requests or friends yet. Find someone by their exact email in Search.
        </p>
      )}

      {message ? (
        <p aria-live="polite" className="mt-3 text-xs font-bold text-rose-700">
          {message}
        </p>
      ) : null}
    </section>
  );
}
