import { paperSourceBadgeClassName } from "@/lib/paper-sources";
import type { PaperSource } from "@/types/paper";

type PaperSourceBadgeProps = {
  source: PaperSource;
  className?: string;
};

export function PaperSourceBadge({
  source,
  className,
}: PaperSourceBadgeProps) {
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center rounded-md border px-2.5 py-1 text-xs font-black leading-none",
        paperSourceBadgeClassName(source),
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {source}
    </span>
  );
}
