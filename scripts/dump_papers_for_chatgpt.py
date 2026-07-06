# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from embedding_common import SupabaseRestClient, load_local_env

SYSTEM_PROMPT = """You are a research paper summarizer for CS researchers. Given the text of a paper (which may contain PDF artifacts, garbled symbols, or LaTeX fragments), ignore formatting noise and extract the semantic meaning. Produce a structured JSON summary with exactly these four fields. Each field must be around 100 words. Do NOT repeat or paraphrase the abstract — synthesize new, original insights.

- "why_it_matters": What specific problem or gap does this paper address? Explain the real-world stakes, the limitation of prior work, or the concrete scenario that motivated this research.
- "main_contribution": What exactly did the authors build, prove, or discover? Describe the method, algorithm, framework, dataset, or theorem. Include specific names, metrics, baselines, and key numbers from experiments.
- "prerequisites": What specific background should a reader have? Name concrete concepts, prior architectures, formal tools, or mathematical frameworks.
- "read_if_you_care_about": Who specifically would find this paper most relevant? Name exact research communities, subfields, systems, or application domains.

Write in English. Output ONLY the JSON object, no other text."""


def fetch_authors(supabase: SupabaseRestClient, paper_ids: list[str]) -> dict[str, list[str]]:
    if not paper_ids:
        return {}

    authors_by_paper: dict[str, list[str]] = {}

    for pid in paper_ids:
        rows = supabase.request_json(
            "paper_authors",
            {
                "select": "name",
                "paper_id": f"eq.{pid}",
                "order": "position.asc",
            },
        )
        if rows:
            authors_by_paper[pid] = [r["name"] for r in rows]

    return authors_by_paper


def main() -> None:
    load_local_env()

    parser = argparse.ArgumentParser(
        description="Dump papers without summaries for manual ChatGPT processing.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=int(os.getenv("LLM_LIMIT", "20")),
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Write output to file instead of stdout.",
    )
    parser.add_argument(
        "--jsonl",
        default=None,
        help="Write the papers as a JSONL summary-batch file ready for import.",
    )
    parser.add_argument(
        "--id-field",
        default="id",
        help="Which JSON field ChatGPT should use as the paper identifier (default: id).",
    )
    args = parser.parse_args()

    id_field = args.id_field

    supabase = SupabaseRestClient()

    select = (
        "id,arxiv_id,doi,url,pdf_url,openalex_id,semantic_scholar_id,"
        "source,title,year,venue,abstract"
    )

    rows = supabase.request_json(  # type: ignore[no-any-return]
        "papers",
        {
            "select": select,
            "triage_summary": "is.null",
            "abstract": "not.is.null",
            "order": "ingested_at.desc",
            "limit": str(args.limit),
        },
    )

    if not rows:
        print("No papers to dump.", file=sys.stderr)
        return

    paper_ids = [r["id"] for r in rows]
    authors_by_paper = fetch_authors(supabase, paper_ids)

    if args.jsonl:
        for row in rows:
            pid = row["id"]
            with open(args.jsonl, "a") as fh:
                fh.write(
                    json.dumps(
                        {
                            "id": pid,
                            "arxiv_id": row.get("arxiv_id"),
                            "title": row["title"],
                            "abstract": row["abstract"],
                            "authors": authors_by_paper.get(pid, []),
                        },
                    )
                    + "\n",
                )
        print(f"Wrote {len(rows)} papers to {args.jsonl}", file=sys.stderr)
        return

    lines = []
    lines.append(SYSTEM_PROMPT)
    lines.append("")
    lines.append(f"Below are {len(rows)} papers. For each paper, visit the URL, read the")
    lines.append("full paper content, and produce a JSON object with exactly these four")
    lines.append("fields: why_it_matters, main_contribution, prerequisites,")
    lines.append("read_if_you_care_about (each ~100 words).")
    lines.append("")
    lines.append("Return the results as a JSON array with one object per paper,")
    lines.append(f"in the same order. Include the paper index and '{id_field}' in each object")
    lines.append(f"(fields: 'index', '{id_field}').")
    lines.append("")
    lines.append("IMPORTANT: Do NOT print any text in the chat. Instead, write the JSON")
    lines.append("array to a downloadable file named `summaries.json` and provide the")
    lines.append("download link. Do not output anything else.")
    lines.append("")

    for i, row in enumerate(rows):
        pid = row["id"]
        arxiv_id = row.get("arxiv_id")
        doi = row.get("doi")
        url = row.get("url") or (f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else None)
        pdf_url = row.get("pdf_url")
        oa_id = row.get("openalex_id")
        ss_id = row.get("semantic_scholar_id")
        source = row.get("source", "unknown")
        year = row.get("year")
        venue = row.get("venue")
        authors = authors_by_paper.get(pid, [])

        lines.append(f"--- Paper {i+1} ---")
        lines.append(f"ID: {pid}")
        if arxiv_id:
            lines.append(f"arXiv ID: {arxiv_id}")
        if doi:
            lines.append(f"DOI: {doi}")
        if oa_id:
            lines.append(f"OpenAlex ID: {oa_id}")
        if ss_id:
            lines.append(f"Semantic Scholar ID: {ss_id}")
        if source:
            lines.append(f"Source: {source}")
        lines.append(f"Title: {row['title']}")
        if authors:
            lines.append(f"Authors: {', '.join(authors)}")
        if year:
            year_str = str(year)
            if venue:
                year_str = f"{year_str}, {venue}"
            lines.append(f"Year: {year_str}")
        elif venue:
            lines.append(f"Venue: {venue}")
        if url:
            lines.append(f"URL: {url}")
        if pdf_url:
            lines.append(f"PDF: {pdf_url}")
        lines.append("Abstract:")
        lines.append(row["abstract"])
        lines.append("")

    output_text = "\n".join(lines)

    if args.output:
        with open(args.output, "w") as fh:
            fh.write(output_text)
        print(f"Wrote prompt with {len(rows)} papers to {args.output}", file=sys.stderr)
    else:
        print(output_text)


if __name__ == "__main__":
    main()
