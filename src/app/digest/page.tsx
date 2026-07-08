import Link from "next/link";
import { ArrowRight, BookmarkPlus, BookmarkX } from "lucide-react";
import { toggleReadLaterAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { MathContent } from "@/components/math-content";
import { PaperListItem } from "@/components/paper-list-item";
import { requireOwnerId } from "@/lib/auth/session";
import {
  getDigestPageData,
  hasUsableOnboardingState,
} from "@/lib/repositories/user-data";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function formatGeneratedAt(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

export default async function DigestPage() {
  const ownerId = await requireOwnerId();

  if (!(await hasUsableOnboardingState(ownerId))) {
    redirect("/onboarding");
  }

  const { groups, totalCount, generatedAt, readLaterIds, readLaterCount } =
    await getDigestPageData(ownerId);

  return (
    <AppShell
      title="Digest"
      subtitle={`New for you — recent papers from the last few days, grouped by topic. ${formatGeneratedAt(
        generatedAt,
      )}`}
      readLaterCount={readLaterCount}
    >
      {totalCount ? (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.topicLabel}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-black uppercase tracking-normal text-slate-500 lg:text-base">
                  {group.topicLabel}
                </h2>
                <span className="text-xs font-bold text-slate-400">
                  {group.papers.length}
                </span>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {group.papers.map((paper) => {
                  const isSaved = readLaterIds.has(paper.id);

                  return (
                    <PaperListItem
                      key={paper.id}
                      action={
                        <div className="flex flex-wrap gap-2">
                          <form action={toggleReadLaterAction}>
                            <input name="paperId" type="hidden" value={paper.id} />
                            <input
                              name="sourcePath"
                              type="hidden"
                              value="/digest"
                            />
                            <button
                              className={
                                isSaved
                                  ? "inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-black text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 active:scale-[0.99]"
                                  : "inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 active:scale-[0.99]"
                              }
                            >
                              {isSaved ? (
                                <BookmarkX
                                  aria-hidden="true"
                                  size={17}
                                  strokeWidth={2.5}
                                />
                              ) : (
                                <BookmarkPlus
                                  aria-hidden="true"
                                  size={17}
                                  strokeWidth={2.5}
                                />
                              )}
                              {isSaved ? "Saved" : "Read later"}
                            </button>
                          </form>
                          <Link
                            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 active:scale-[0.99]"
                            href={`/papers/${paper.id}`}
                          >
                            <ArrowRight
                              aria-hidden="true"
                              size={17}
                              strokeWidth={2.5}
                            />
                            Open detail
                          </Link>
                        </div>
                      }
                      meta={
                        paper.abstract ? (
                          <p className="line-clamp-2 text-sm font-medium leading-6 text-slate-600">
                            <MathContent text={paper.abstract} />
                          </p>
                        ) : null
                      }
                      paper={paper}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center">
          <h2 className="text-sm font-black text-slate-950">
            No fresh papers yet
          </h2>
          <p className="mt-1.5 text-xs font-semibold leading-5 text-slate-500">
            Check back later — your digest fills up as new papers matching your
            interests are ingested.
          </p>
        </div>
      )}
    </AppShell>
  );
}
