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
    args = parser.parse_args()

    supabase = SupabaseRestClient()

    rows = supabase.request_json(  # type: ignore[no-any-return]
        "papers",
        {
            "select": "id,arxiv_id,title,abstract,triage_summary,ingested_at",
            "source": "eq.arxiv",
            "triage_summary": "is.null",
            "abstract": "not.is.null",
            "order": "ingested_at.desc",
            "limit": str(args.limit),
        },
    )

    if not rows:
        print("No papers to dump.", file=sys.stderr)
        return

    if args.jsonl:
        import json

        with open(args.jsonl, "w") as fh:
            for row in rows:
                fh.write(
                    json.dumps(
                        {
                            "id": row["id"],
                            "arxiv_id": row.get("arxiv_id"),
                            "title": row["title"],
                            "abstract": row["abstract"],
                        },
                    )
                    + "\n",
                )
        print(f"Wrote {len(rows)} papers to {args.jsonl}", file=sys.stderr)
        return

    lines = []
    lines.append(SYSTEM_PROMPT)
    lines.append("")
    lines.append(f"Below are {len(rows)} papers. For each paper, return a JSON object")
    lines.append("with exactly these four fields: why_it_matters, main_contribution,")
    lines.append("prerequisites, read_if_you_care_about (each ~100 words).")
    lines.append("")
    lines.append("Return the results as a JSON array with one object per paper,")
    lines.append("in the same order. Include the paper index and arxiv_id in each object")
    lines.append("(fields: 'index', 'arxiv_id').")
    lines.append("")
    lines.append("IMPORTANT: Do NOT print any text in the chat. Instead, write the JSON")
    lines.append("array to a downloadable file named `summaries.json` and provide the")
    lines.append("download link. Do not output anything else.")
    lines.append("")

    for i, row in enumerate(rows):
        lines.append(f"--- Paper {i+1} ---")
        lines.append(f"arXiv ID: {row.get('arxiv_id', 'N/A')}")
        lines.append(f"Title: {row['title']}")
        lines.append(f"Abstract: {row['abstract']}")
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
