import Link from "next/link";
import { ArrowRight, Search as SearchIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { MathContent } from "@/components/math-content";
import { PaperListItem } from "@/components/paper-list-item";
import { requireOwnerId } from "@/lib/auth/session";
import { searchPapers } from "@/lib/repositories/catalog";
import {
  getReadLaterCount,
  hasUsableOnboardingState,
} from "@/lib/repositories/user-data";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SearchPageProps = {
  searchParams: Promise<{ q?: string }>;
};

function normalizeQueryParam(value?: string) {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const ownerId = await requireOwnerId();

  if (!(await hasUsableOnboardingState(ownerId))) {
    redirect("/onboarding");
  }

  const { q } = await searchParams;
  const query = normalizeQueryParam(q);
  const [readLaterCount, results] = await Promise.all([
    getReadLaterCount(ownerId),
    query ? searchPapers(query) : Promise.resolve([]),
  ]);

  return (
    <AppShell
      title="Search"
      subtitle="Find papers in the PaperDeck CS catalog."
      readLaterCount={readLaterCount}
    >
      <section className="space-y-5">
        <form
          action="/search"
          className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search papers</span>
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={18}
                strokeWidth={2.4}
              />
              <input
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                defaultValue={query}
                name="q"
                placeholder="Title, author, topic, arXiv ID"
                type="search"
              />
            </label>
            <button className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800 active:scale-[0.99]">
              <SearchIcon aria-hidden="true" size={17} strokeWidth={2.5} />
              Search
            </button>
          </div>
        </form>

        {query ? (
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
              Results
            </h2>
            <span className="text-xs font-bold text-slate-400">
              {results.length} found
            </span>
          </div>
        ) : null}

        {query && results.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {results.map((paper) => (
              <PaperListItem
                key={paper.id}
                action={
                  <Link
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 active:scale-[0.99]"
                    href={`/papers/${paper.id}`}
                  >
                    <ArrowRight aria-hidden="true" size={17} strokeWidth={2.5} />
                    Open detail
                  </Link>
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
            ))}
          </div>
        ) : null}

        {query && !results.length ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center">
            <h2 className="text-sm font-black text-slate-950">
              No papers found
            </h2>
            <p className="mt-1.5 text-xs font-semibold leading-5 text-slate-500">
              Try a paper title, author, topic, or arXiv category.
            </p>
          </div>
        ) : null}

        {!query ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center">
            <h2 className="text-sm font-black text-slate-950">
              Search the catalog
            </h2>
            <p className="mt-1.5 text-xs font-semibold leading-5 text-slate-500">
              Start with a title, author, topic, or arXiv ID.
            </p>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
