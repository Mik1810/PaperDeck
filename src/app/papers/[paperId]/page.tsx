import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bookmark, ExternalLink, Heart } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { mockPapers } from "@/lib/mock-data";

type PaperDetailPageProps = {
  params: Promise<{
    paperId: string;
  }>;
};

export function generateStaticParams() {
  return mockPapers.map((paper) => ({
    paperId: paper.id,
  }));
}

export default async function PaperDetailPage({ params }: PaperDetailPageProps) {
  const { paperId } = await params;
  const paper = mockPapers.find((item) => item.id === paperId);

  if (!paper) {
    notFound();
  }

  return (
    <AppShell
      title="Paper detail"
      subtitle={paper.recommendationReason}
      action={
        <Link
          href="/feed"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700"
        >
          <ArrowLeft aria-hidden="true" size={17} strokeWidth={2.4} />
          Feed
        </Link>
      }
    >
      <article className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap gap-2">
          {paper.topics.map((topic) => (
            <span
              key={topic.id}
              className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700"
            >
              {topic.label}
            </span>
          ))}
        </div>

        <h1 className="mt-5 text-3xl font-black leading-10 tracking-normal text-slate-950">
          {paper.title}
        </h1>

        <p className="mt-4 text-sm font-bold text-slate-500">
          {paper.authors.join(", ")} - {paper.year}
        </p>
        {paper.venue ? (
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {paper.venue}
          </p>
        ) : null}

        <div className="mt-7 flex flex-wrap gap-2">
          <button className="inline-flex h-11 items-center gap-2 rounded-lg border border-pink-200 bg-white px-4 text-sm font-black text-pink-700">
            <Heart aria-hidden="true" size={18} strokeWidth={2.5} />
            Favorite
          </button>
          <button className="inline-flex h-11 items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 text-sm font-black text-emerald-700">
            <Bookmark aria-hidden="true" size={18} strokeWidth={2.5} />
            Read later
          </button>
          <Link
            href={paper.url}
            target="_blank"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white"
          >
            <ExternalLink aria-hidden="true" size={18} strokeWidth={2.5} />
            Read online
          </Link>
        </div>

        <section className="mt-8 border-t border-slate-200 pt-6">
          <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
            Abstract
          </h2>
          <p className="mt-4 text-base leading-8 text-slate-700">
            {paper.abstract}
          </p>
        </section>
      </article>
    </AppShell>
  );
}
