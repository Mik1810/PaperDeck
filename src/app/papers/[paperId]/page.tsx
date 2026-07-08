import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { addPaperNoteAction, deletePaperNoteAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { PaperDetailActions } from "@/components/paper-detail-actions";
import { PaperNoteEditor } from "@/components/paper-note-editor";
import { MathContent } from "@/components/math-content";
import { requireOwnerId } from "@/lib/auth/session";
import {
  getPaperDetailData,
  hasUsableOnboardingState,
  PAPER_NOTE_MAX_LENGTH,
} from "@/lib/repositories/user-data";
import { redirect } from "next/navigation";

type PaperDetailPageProps = {
  params: Promise<{
    paperId: string;
  }>;
};

export const dynamic = "force-dynamic";

function SummaryRow({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <span className="text-xs font-black uppercase tracking-normal text-slate-400">
        {label}
      </span>
      <div className="mt-0.5 text-sm leading-6 text-slate-600">
        <MathContent text={text} />
      </div>
    </div>
  );
}

export default async function PaperDetailPage({ params }: PaperDetailPageProps) {
  const { paperId } = await params;
  const ownerId = await requireOwnerId();

  if (!(await hasUsableOnboardingState(ownerId))) {
    redirect("/onboarding");
  }

  const { paper, isFavorite, isSaved, readLaterCount, notes } =
    await getPaperDetailData(ownerId, paperId);

  if (!paper) {
    notFound();
  }

  return (
    <AppShell
      title="Paper detail"
      subtitle={paper.recommendationReason}
      readLaterCount={readLaterCount}
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
      <article className="mx-auto w-full max-w-4xl rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-8 lg:px-12 lg:py-10">
        <div className="flex flex-wrap gap-2">
          {paper.topics.map((topic) => (
            <span
              key={topic.id}
              className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 lg:text-sm"
            >
              {topic.label}
            </span>
          ))}
        </div>

        <h1 className="mt-5 text-3xl font-black leading-10 tracking-normal text-slate-950 lg:text-4xl">
          <MathContent text={paper.title} />
        </h1>

        <p className="mt-4 text-sm font-bold text-slate-500 lg:text-base">
          {paper.authors.join(", ")} - {paper.year}
        </p>
        {paper.venue ? (
          <p className="mt-1 text-sm font-semibold text-slate-500 lg:text-base">
            {paper.venue}
          </p>
        ) : null}

        <PaperDetailActions
          feedbackActionPath={`/papers/${paper.id}/feedback`}
          isFavorite={isFavorite}
          isSaved={isSaved}
          paperId={paper.id}
          paperUrl={paper.url}
        />

        <section className="mt-8 border-t border-slate-200 pt-6">
          <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
            Abstract
          </h2>
          <div className="mt-4 text-sm leading-7 italic text-slate-600">
            {paper.abstract ? (
              <MathContent text={paper.abstract} />
            ) : (
              <span className="text-slate-400">No abstract available.</span>
            )}
          </div>
        </section>

        {paper.triageSummary ? (
          <section className="mt-8 border-t border-slate-200 pt-6">
            <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
              Triage summary
            </h2>
            <div className="mt-4 space-y-3">
              <SummaryRow label="Why it matters" text={paper.triageSummary.why_it_matters} />
              <SummaryRow label="Main contribution" text={paper.triageSummary.main_contribution} />
              <SummaryRow label="Prerequisites" text={paper.triageSummary.prerequisites} />
              <SummaryRow
                label="Read if you care about"
                text={paper.triageSummary.read_if_you_care_about}
              />
            </div>
          </section>
        ) : null}

        <PaperNoteEditor
          addAction={addPaperNoteAction}
          deleteAction={deletePaperNoteAction}
          maxLength={PAPER_NOTE_MAX_LENGTH}
          notes={notes}
          paperId={paper.id}
        />
      </article>
    </AppShell>
  );
}
