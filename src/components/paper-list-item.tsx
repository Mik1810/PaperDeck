import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { MathContent } from "@/components/math-content";
import { PaperSourceBadge } from "@/components/paper-source-badge";
import type { ReactNode } from "react";
import type { Paper } from "@/types/paper";

type PaperListItemProps = {
  paper: Paper;
  action?: ReactNode;
  meta?: ReactNode;
};

export function PaperListItem({ paper, action, meta }: PaperListItemProps) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <PaperSourceBadge source={paper.source} />
            <span className="text-xs font-black text-slate-500 lg:text-sm">
              {paper.year}
            </span>
          </div>
          <h2 className="mt-2 text-base font-black leading-6 text-slate-950 md:text-lg">
            <MathContent text={paper.title} />
          </h2>
          <p className="mt-2 text-sm font-semibold text-slate-500 md:text-base">
            {paper.authors.join(", ")}
          </p>
          {meta ? <div className="mt-3">{meta}</div> : null}
        </div>
        <Link
          href={paper.url}
          target="_blank"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 active:scale-[0.98]"
        >
          <ExternalLink aria-label="Open paper" size={17} strokeWidth={2.4} />
        </Link>
      </div>
      {action ? <div className="mt-4">{action}</div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {paper.topics.slice(0, 3).map((topic) => (
          <span
            key={topic.id}
            className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700"
          >
            {topic.label}
          </span>
        ))}
      </div>
    </article>
  );
}
