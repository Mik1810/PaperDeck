# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import textwrap
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from embedding_common import SupabaseRestClient, load_local_env


FIELD_NAMES = (
    "why_it_matters",
    "main_contribution",
    "prerequisites",
    "read_if_you_care_about",
)

DEFAULT_OUTPUT = Path("prompts/triage_review_results.jsonl")
DEFAULT_REVIEW_CSV = Path("/tmp/paperdeck-suspicious-triage.csv")
DEFAULT_WRONG_OUTPUT = Path("prompts/triage_wrong_summaries.jsonl")


@dataclass(frozen=True)
class SuspiciousRule:
    id: str
    severity: Literal["high", "review"]
    pattern: re.Pattern[str]


RULES = (
    SuspiciousRule(
        "graph_problem_boilerplate",
        "high",
        re.compile(
            r"The paper addresses a graph problem where naive algorithms or "
            r"unrestricted hardness results leave an unclear boundary",
            re.I,
        ),
    ),
    SuspiciousRule(
        "missing_piece_graph_boilerplate",
        "high",
        re.compile(
            r"targets a specific missing piece in graph algorithms, "
            r"parameterized complexity, and combinatorial optimization",
            re.I,
        ),
    ),
    SuspiciousRule(
        "named_object_title_substitution",
        "high",
        re.compile(r"the named object is", re.I),
    ),
    SuspiciousRule(
        "title_indicates_likely_contribution",
        "high",
        re.compile(
            r"The title indicates that the work narrows attention|"
            r"likely contribution is a sharper result|"
            r"It likely formalizes the problem variant",
            re.I,
        ),
    ),
    SuspiciousRule(
        "algorithmic_complexity_boilerplate",
        "review",
        re.compile(
            r"This paper addresses an algorithmic or complexity-theoretic problem "
            r"where existing methods are either too slow, too memory-intensive, "
            r"or do not explain the intrinsic hardness",
            re.I,
        ),
    ),
    SuspiciousRule(
        "depending_on_exact_theorem",
        "review",
        re.compile(r"Depending on the exact theorem|depending on the exact", re.I),
    ),
    SuspiciousRule(
        "unverified_or_synthetic_record",
        "high",
        re.compile(
            r"could not verify|No reliable main contribution|"
            r"unresolved or synthetic|No trustworthy contribution",
            re.I,
        ),
    ),
    SuspiciousRule(
        "too_hedged_likely_background",
        "review",
        re.compile(
            r"likely technical background would include|"
            r"should not be treated as actual prerequisites",
            re.I,
        ),
    ),
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def wrap(text: str, width: int, indent: str = "") -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text:
        return f"{indent}(empty)"

    return textwrap.fill(
        text,
        width=width,
        initial_indent=indent,
        subsequent_indent=indent,
        break_long_words=False,
        break_on_hyphens=False,
    )


def first_sentence(text: str) -> str:
    clean = re.sub(r"\s+", " ", text or "").strip()
    match = re.match(r"^(.{0,260}?[.!?])\s", clean)

    return match.group(1) if match else clean[:220]


def summary_fields(row: dict[str, Any]) -> list[str]:
    summary = row.get("triage_summary")
    if not isinstance(summary, dict):
        return []

    return [summary.get(field, "") for field in FIELD_NAMES]


def load_papers() -> list[dict[str, Any]]:
    supabase = SupabaseRestClient()
    rows = supabase.request_json(
        "papers",
        {
            "select": (
                "id,arxiv_id,title,abstract,url,pdf_url,venue,source,"
                "triage_summary,triage_summary_model,triage_summary_generated_at"
            ),
            "triage_summary": "not.is.null",
            "order": "triage_summary_generated_at.desc.nullslast,title.asc",
            "limit": os.getenv("TRIAGE_REVIEW_FETCH_LIMIT", "5000"),
        },
    )

    if not isinstance(rows, list):
        raise RuntimeError("Unexpected Supabase response while loading papers")

    return rows


def load_review_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(f"Review CSV not found: {path}")

    with path.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    required = {"id", "review_verdict"}
    missing = required.difference(rows[0].keys() if rows else set())
    if missing:
        raise ValueError(f"Review CSV is missing columns: {', '.join(sorted(missing))}")

    return rows


def write_review_csv(path: Path, rows: list[dict[str, str]]) -> None:
    if not rows:
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def load_papers_by_id() -> dict[str, dict[str, Any]]:
    return {row["id"]: row for row in load_papers()}


def csv_rows_for_verdict(
    rows: list[dict[str, str]],
    verdict: str,
) -> list[dict[str, str]]:
    if verdict == "all":
        return rows

    return [row for row in rows if row.get("review_verdict") == verdict]


def csv_items(
    rows: list[dict[str, str]],
    papers_by_id: dict[str, dict[str, Any]],
    verdict: str,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []

    for row in csv_rows_for_verdict(rows, verdict):
        paper_id = row.get("id")
        paper = papers_by_id.get(paper_id or "")
        if not paper:
            print(f"Skipping CSV row with missing paper in DB: {paper_id}")
            continue

        reasons = [
            reason
            for reason in (row.get("reasons") or "").split(";")
            if reason
        ]
        items.append(
            {
                "severity": row.get("severity") or "review",
                "reasons": reasons,
                "paper": paper,
                "csv_row": row,
            },
        )

    return items


def repeated_prefix_counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}

    for row in rows:
        for index, field in enumerate(summary_fields(row)):
            prefix = first_sentence(field)
            if len(prefix) < 70:
                continue

            key = f"{index}:{prefix}"
            counts[key] = counts.get(key, 0) + 1

    return counts


def classify_paper(
    row: dict[str, Any],
    prefix_counts: dict[str, int],
    repeat_threshold: int,
) -> dict[str, Any] | None:
    fields = summary_fields(row)
    text = "\n".join(fields)
    high_reasons: list[str] = []
    review_reasons: list[str] = []

    for rule in RULES:
        if rule.pattern.search(text):
            target = high_reasons if rule.severity == "high" else review_reasons
            target.append(rule.id)

    for index, field in enumerate(fields):
        prefix = first_sentence(field)
        count = prefix_counts.get(f"{index}:{prefix}", 0)
        if count >= repeat_threshold:
            review_reasons.append(f"{FIELD_NAMES[index]}_prefix_repeated_{count}x")

    if not high_reasons and not review_reasons:
        return None

    severity: Literal["high", "review"] = "high" if high_reasons else "review"

    return {
        "severity": severity,
        "reasons": high_reasons + review_reasons,
        "paper": row,
    }


def suspicious_papers(
    rows: list[dict[str, Any]],
    severity: str,
    repeat_threshold: int,
) -> list[dict[str, Any]]:
    prefix_counts = repeated_prefix_counts(rows)
    flagged = [
        classified
        for row in rows
        if (classified := classify_paper(row, prefix_counts, repeat_threshold))
    ]

    if severity != "all":
        flagged = [item for item in flagged if item["severity"] == severity]

    return sorted(
        flagged,
        key=lambda item: (
            0 if item["severity"] == "high" else 1,
            item["paper"].get("triage_summary_generated_at") or "",
            item["paper"].get("title") or "",
        ),
        reverse=False,
    )


def load_reviewed(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}

    reviewed: dict[str, dict[str, Any]] = {}
    for line_number, raw_line in enumerate(path.read_text().splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue

        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            print(f"Skipping invalid JSONL line {line_number} in {path}")
            continue

        paper_id = item.get("id")
        if isinstance(paper_id, str):
            reviewed[paper_id] = item

    return reviewed


def wrong_record(
    item: dict[str, Any],
    note: str,
    source: str,
) -> dict[str, Any]:
    paper = item["paper"]

    return {
        "recorded_at": utc_now(),
        "source": source,
        "note": note,
        "severity": item["severity"],
        "reasons": item["reasons"],
        "id": paper.get("id"),
        "arxiv_id": paper.get("arxiv_id"),
        "title": paper.get("title"),
        "url": paper.get("url"),
        "pdf_url": paper.get("pdf_url"),
        "triage_summary_model": paper.get("triage_summary_model"),
        "triage_summary_generated_at": paper.get("triage_summary_generated_at"),
    }


def load_jsonl_by_id(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}

    records: dict[str, dict[str, Any]] = {}
    for line_number, raw_line in enumerate(path.read_text().splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue

        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            print(f"Skipping invalid JSONL line {line_number} in {path}")
            continue

        paper_id = item.get("id")
        if isinstance(paper_id, str):
            records[paper_id] = item

    return records


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def sync_wrong_output_from_csv(
    csv_rows: list[dict[str, str]],
    papers_by_id: dict[str, dict[str, Any]],
    path: Path,
) -> int:
    existing = load_jsonl_by_id(path)

    for row in csv_rows_for_verdict(csv_rows, "wrong"):
        paper_id = row.get("id")
        paper = papers_by_id.get(paper_id or "")
        if not paper:
            print(f"Skipping wrong CSV row with missing paper in DB: {paper_id}")
            continue

        item = {
            "severity": row.get("severity") or "review",
            "reasons": [
                reason
                for reason in (row.get("reasons") or "").split(";")
                if reason
            ],
            "paper": paper,
        }
        existing[paper["id"]] = wrong_record(
            item,
            row.get("review_note") or "Marked wrong in review CSV.",
            "review_csv",
        )

    records = sorted(
        existing.values(),
        key=lambda record: (
            record.get("triage_summary_generated_at") or "",
            record.get("title") or "",
        ),
    )
    write_jsonl(path, records)

    return len(records)


def append_wrong_record(path: Path, item: dict[str, Any], note: str, source: str) -> None:
    records_by_id = load_jsonl_by_id(path)
    record = wrong_record(item, note or "Marked wrong during manual review.", source)
    paper_id = record.get("id")
    if isinstance(paper_id, str):
        records_by_id[paper_id] = record

    write_jsonl(path, list(records_by_id.values()))


def update_csv_decision(
    csv_path: Path | None,
    csv_rows: list[dict[str, str]] | None,
    item: dict[str, Any],
    verdict: str,
    note: str,
) -> None:
    if not csv_path or csv_rows is None:
        return

    paper_id = item["paper"].get("id")
    for row in csv_rows:
        if row.get("id") != paper_id:
            continue

        row["review_verdict"] = verdict
        row["review_confidence"] = "manual"
        row["review_basis"] = "manual"
        row["review_note"] = note or f"Manual review marked {verdict}."
        break

    write_review_csv(csv_path, csv_rows)


def save_decision(
    path: Path,
    item: dict[str, Any],
    verdict: str,
    note: str,
) -> None:
    paper = item["paper"]
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "reviewed_at": utc_now(),
        "verdict": verdict,
        "note": note,
        "severity": item["severity"],
        "reasons": item["reasons"],
        "id": paper.get("id"),
        "arxiv_id": paper.get("arxiv_id"),
        "title": paper.get("title"),
        "url": paper.get("url"),
        "pdf_url": paper.get("pdf_url"),
        "triage_summary_model": paper.get("triage_summary_model"),
        "triage_summary_generated_at": paper.get("triage_summary_generated_at"),
    }

    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def render_item(item: dict[str, Any], position: int, total: int, width: int) -> None:
    paper = item["paper"]
    summary = paper.get("triage_summary") or {}

    print("=" * width)
    print(f"[{position}/{total}] {item['severity'].upper()} - {paper.get('title')}")
    print("-" * width)
    print(f"ID: {paper.get('id')}")
    print(f"arXiv: {paper.get('arxiv_id') or 'n/a'}")
    print(f"Venue/source: {paper.get('venue') or 'n/a'} / {paper.get('source') or 'n/a'}")
    print(f"URL: {paper.get('url') or 'n/a'}")
    if paper.get("pdf_url"):
        print(f"PDF: {paper.get('pdf_url')}")
    print(
        "Summary model: "
        f"{paper.get('triage_summary_model') or 'n/a'} "
        f"at {paper.get('triage_summary_generated_at') or 'n/a'}"
    )
    csv_row = item.get("csv_row")
    if isinstance(csv_row, dict):
        print(
            "CSV review: "
            f"{csv_row.get('review_verdict') or 'n/a'} "
            f"({csv_row.get('review_confidence') or 'n/a'})"
        )
        if csv_row.get("review_note"):
            print(f"CSV note: {csv_row.get('review_note')}")
    print(f"Reasons: {', '.join(item['reasons'])}")
    print("-" * width)
    print("ABSTRACT")
    print(wrap(paper.get("abstract") or "", width))
    print("-" * width)
    print("TRIAGE")
    for field in FIELD_NAMES:
        print(f"\n{field}:")
        print(wrap(str(summary.get(field) or ""), width, indent="  "))
    print("\n" + "=" * width)


def parse_command(raw: str) -> tuple[str, str]:
    command, _, note = raw.strip().partition(" ")

    return command.lower(), note.strip()


def review_loop(
    items: list[dict[str, Any]],
    args: argparse.Namespace,
    csv_rows: list[dict[str, str]] | None = None,
) -> None:
    reviewed = load_reviewed(args.output)

    if not args.include_reviewed:
        items = [item for item in items if item["paper"].get("id") not in reviewed]

    if args.limit:
        items = items[: args.limit]

    total = len(items)
    print(f"Review file: {args.output}")
    print(f"Wrong summaries file: {args.wrong_output}")
    print(f"Papers to review now: {total}")
    print("Commands: o [note] = ok, w [note] = wrong, s [note] = skip, q = quit")

    for index, item in enumerate(items, start=1):
        if args.clear:
            os.system("cls" if os.name == "nt" else "clear")

        render_item(item, index, total, args.width)

        while True:
            raw = input("Decisione [o/w/s/q]: ")
            command, note = parse_command(raw)

            if command in {"q", "quit", "exit"}:
                print("Stopped. You can rerun the script to resume.")
                return

            if command in {"o", "ok"}:
                save_decision(args.output, item, "ok", note)
                update_csv_decision(args.csv, csv_rows, item, "ok", note)
                break

            if command in {"w", "wrong", "sbagliato"}:
                save_decision(args.output, item, "wrong", note)
                update_csv_decision(args.csv, csv_rows, item, "wrong", note)
                append_wrong_record(
                    args.wrong_output,
                    item,
                    note,
                    "manual_uncertain_review",
                )
                break

            if command in {"s", "skip", "salta"}:
                save_decision(args.output, item, "skip", note)
                update_csv_decision(args.csv, csv_rows, item, "skip", note)
                break

            print("Unknown command. Use: o [note], w [note], s [note], q")

    print(f"Done. Decisions appended to {args.output}")


def print_dry_run(items: list[dict[str, Any]], args: argparse.Namespace) -> None:
    counts: dict[str, int] = {"high": 0, "review": 0}
    for item in items:
        counts[item["severity"]] += 1

    print(f"Suspicious papers loaded: {len(items)}")
    print(f"High-confidence: {counts['high']}")
    print(f"Review: {counts['review']}")

    for item in items[: args.limit or 10]:
        paper = item["paper"]
        reasons = ", ".join(item["reasons"])
        print(
            f"- {item['severity']}: {paper.get('arxiv_id') or paper.get('id')} "
            f"| {paper.get('title')} | {reasons}"
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Interactively review suspicious PaperDeck triage summaries. "
            "This script reads Supabase and writes local JSONL decisions only."
        ),
    )
    parser.add_argument(
        "--source",
        choices=("csv", "db"),
        default="csv",
        help="Use the reviewed CSV or rescan Supabase patterns (default: csv).",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=DEFAULT_REVIEW_CSV,
        help=f"Reviewed suspicious triage CSV (default: {DEFAULT_REVIEW_CSV}).",
    )
    parser.add_argument(
        "--csv-verdict",
        choices=("uncertain", "wrong", "ok", "skip", "all"),
        default="uncertain",
        help="Which CSV review verdict to parse manually (default: uncertain).",
    )
    parser.add_argument(
        "--severity",
        choices=("all", "high", "review"),
        default="all",
        help="Which DB-rescanned suspicious summaries to review (default: all).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"JSONL review output path (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--wrong-output",
        type=Path,
        default=DEFAULT_WRONG_OUTPUT,
        help=f"JSONL file of wrong summaries to regenerate (default: {DEFAULT_WRONG_OUTPUT}).",
    )
    parser.add_argument(
        "--export-wrong-only",
        action="store_true",
        help="Sync CSV rows marked wrong into --wrong-output and exit.",
    )
    parser.add_argument(
        "--no-sync-wrong-output",
        action="store_true",
        help="Do not sync CSV rows marked wrong into --wrong-output before review.",
    )
    parser.add_argument(
        "--repeat-threshold",
        type=int,
        default=10,
        help="Repeated first-sentence threshold for review flags (default: 10).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Limit the number of papers in this run.",
    )
    parser.add_argument(
        "--include-reviewed",
        action="store_true",
        help="Include papers already present in the output JSONL.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print counts and sample rows without prompting.",
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Clear the terminal between papers.",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=shutil.get_terminal_size((100, 24)).columns,
        help="Display wrap width.",
    )

    return parser


def main() -> None:
    load_local_env()
    args = build_parser().parse_args()

    csv_rows: list[dict[str, str]] | None = None
    if args.source == "csv":
        csv_rows = load_review_csv(args.csv)
        papers_by_id = load_papers_by_id()

        if args.export_wrong_only:
            count = sync_wrong_output_from_csv(csv_rows, papers_by_id, args.wrong_output)
            print(f"Synced {count} wrong summaries into {args.wrong_output}")
            return
        elif not args.no_sync_wrong_output and not args.dry_run:
            count = sync_wrong_output_from_csv(csv_rows, papers_by_id, args.wrong_output)
            print(f"Synced {count} wrong summaries into {args.wrong_output}")

        items = csv_items(csv_rows, papers_by_id, args.csv_verdict)
    else:
        rows = load_papers()
        items = suspicious_papers(rows, args.severity, args.repeat_threshold)

    if args.dry_run:
        print_dry_run(items, args)
        return

    review_loop(items, args, csv_rows)


if __name__ == "__main__":
    main()
