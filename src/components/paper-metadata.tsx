import Link from "next/link";
import { PaperSourceBadge } from "@/components/paper-source-badge";
import type { Paper, PaperAccess } from "@/types/paper";

type PaperMetadataProps = {
  paper: Paper;
};

function accessBadge(access: PaperAccess) {
  if (access === "open") {
    return {
      label: "Open access",
      className: "border-emerald-100 bg-emerald-50 text-emerald-700",
    };
  }

  if (access === "publisher") {
    return {
      label: "Publisher",
      className: "border-amber-100 bg-amber-50 text-amber-700",
    };
  }

  return null;
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5">
      <dt className="text-[11px] font-black uppercase tracking-normal text-slate-400">
        {label}
      </dt>
      <dd className="text-xs font-semibold text-slate-700">{children}</dd>
    </div>
  );
}

export function PaperMetadata({ paper }: PaperMetadataProps) {
  const access = accessBadge(paper.access);

  return (
    <section className="mt-6 border-t border-slate-200 pt-5">
      <h2 className="text-xs font-black uppercase tracking-normal text-slate-500">
        Details
      </h2>

      <dl className="mt-1 divide-y divide-slate-100">
        <DetailRow label="Source">
          <PaperSourceBadge source={paper.source} />
        </DetailRow>

        {access ? (
          <DetailRow label="Access">
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-black leading-none ${access.className}`}
            >
              {access.label}
            </span>
          </DetailRow>
        ) : null}

        {paper.venue ? <DetailRow label="Venue">{paper.venue}</DetailRow> : null}

        <DetailRow label="Year">{paper.year}</DetailRow>

        {typeof paper.citationCount === "number" ? (
          <DetailRow label="Citations">
            {paper.citationCount.toLocaleString("en")}
          </DetailRow>
        ) : null}

        {paper.doi ? (
          <DetailRow label="DOI">
            <Link
              className="font-bold text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
              href={`https://doi.org/${paper.doi}`}
              target="_blank"
            >
              {paper.doi}
            </Link>
          </DetailRow>
        ) : null}
      </dl>
    </section>
  );
}
