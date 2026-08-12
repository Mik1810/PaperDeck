"use client";

import { useCallback, useRef, useState } from "react";
import { GroupPaperActions } from "@/components/research-group-controls";
import { PaperListItem } from "@/components/paper-list-item";
import type { ResearchGroupPaperPage } from "@/lib/research-group-paper-page";

function addedAtLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function mergePages(
  current: ResearchGroupPaperPage,
  next: ResearchGroupPaperPage,
): ResearchGroupPaperPage {
  const seenPaperIds = new Set<string>();
  const items = [...current.items, ...next.items].filter((item) => {
    if (seenPaperIds.has(item.paper.id)) return false;
    seenPaperIds.add(item.paper.id);
    return true;
  });

  return { ...next, items };
}

export function ResearchGroupPaperList({
  groupId,
  initialPage,
  role,
}: {
  groupId: string;
  initialPage: ResearchGroupPaperPage;
  role: "owner" | "admin" | "member";
}) {
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<Promise<ResearchGroupPaperPage> | null>(null);

  const loadMore = useCallback(async () => {
    if (!page.nextCursor || loading) return;
    setLoading(true);
    setError(null);

    let request = activeRequest.current;
    if (!request) {
      const params = new URLSearchParams({ cursor: page.nextCursor });
      request = fetch(`/api/groups/${groupId}/papers?${params.toString()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      }).then(async (response) => {
        if (!response.ok) throw new Error("Research-group page request failed");
        return (await response.json()) as ResearchGroupPaperPage;
      });
      activeRequest.current = request;
    }

    try {
      const nextPage = await request;
      setPage((current) => mergePages(current, nextPage));
    } catch {
      setError("More shared papers could not be loaded.");
    } finally {
      activeRequest.current = null;
      setLoading(false);
    }
  }, [groupId, loading, page.nextCursor]);

  return (
    <section className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
          Shared papers · {page.totalCount}
        </h2>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-600">
          {role}
        </span>
      </div>
      {page.items.length ? (
        page.items.map((item) => (
          <PaperListItem
            key={item.paper.id}
            paper={item.paper}
            meta={
              <p className="text-xs font-bold text-slate-500">
                Added by {item.contributor?.displayName || "Former member"} ·{" "}
                {addedAtLabel(item.addedAt)}
              </p>
            }
            action={
              <GroupPaperActions
                canRemove={item.canRemove}
                groupId={groupId}
                paperId={item.paper.id}
              />
            }
          />
        ))
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="text-base font-black text-slate-950">
            This group is empty
          </h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Add the first catalog paper when the group is ready.
          </p>
        </div>
      )}

      {error ? (
        <div
          className="rounded-lg border border-rose-200 bg-rose-50 p-4"
          role="alert"
        >
          <p className="text-sm font-bold text-rose-800">{error}</p>
          <button
            className="mt-2 text-sm font-black text-rose-900 underline"
            disabled={loading}
            onClick={() => void loadMore()}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : null}

      {page.nextCursor ? (
        <div className="pt-1 text-center">
          <button
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:border-teal-400 hover:text-teal-800 disabled:cursor-wait disabled:opacity-60"
            disabled={loading}
            onClick={() => void loadMore()}
            type="button"
          >
            {loading ? "Loading..." : "Load more papers"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
