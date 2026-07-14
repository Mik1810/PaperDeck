#!/usr/bin/env python3
"""Generate triage summaries using a local llama.cpp server (OpenAI-compatible API).

Reads papers without triage_summary from Supabase. For papers with an
arxiv_id, downloads the PDF and extracts text via pymupdf. Falls back to
abstract when PDF fetching fails or for non-arXiv papers. Sends the text
to the local LLM, parses the JSON response, and writes the summary back.

Usage:
    # dry-run: list candidates without calling the LLM
    python scripts/generate_summaries_local.py --dry-run

    # write mode, abstract-only (skip PDF fetch)
    python scripts/generate_summaries_local.py --no-pdf --limit 10

    # write mode with PDF download (default for arxiv papers)
    python scripts/generate_summaries_local.py --limit 5

    # custom PDF text length
    python scripts/generate_summaries_local.py --limit 5 --pdf-chars 16000
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from embedding_common import SupabaseRestClient, load_local_env, utc_now

LLAMA_CPP_BASE = os.getenv("LLAMA_CPP_URL", "http://localhost:43307").rstrip("/")

SYSTEM_PROMPT = (
    "You are a research paper summarizer for CS researchers. "
    "Given the text of a paper (which may contain PDF artifacts, garbled symbols, or LaTeX fragments), "
    "ignore formatting noise and extract the semantic meaning. "
    "Produce a structured JSON summary with exactly these four fields. "
    "Each field must be around 100 words. "
    "Do NOT repeat or paraphrase the abstract — synthesize new, original insights.\n\n"
    '- "why_it_matters": What specific problem or gap does this paper address? '
    "Explain the real-world stakes, the limitation of prior work, or the concrete scenario that motivated this research.\n"
    '- "main_contribution": What exactly did the authors build, prove, or discover? '
    "Describe the method, algorithm, framework, dataset, or theorem. "
    "Include specific names, metrics, baselines, and key numbers from experiments.\n"
    '- "prerequisites": What specific background should a reader have? '
    "Name concrete concepts, prior architectures, formal tools, or mathematical frameworks.\n"
    '- "read_if_you_care_about": Who specifically would find this paper most relevant? '
    "Name exact research communities, subfields, systems, or application domains.\n\n"
    "Write in English. Output ONLY the JSON object, no other text."
)

REQUIRED_FIELDS = ["why_it_matters", "main_contribution", "prerequisites", "read_if_you_care_about"]
ARXIV_PDF = "https://arxiv.org/pdf/{arxiv_id}.pdf"


def clean_pdf_text(text: str) -> str:
    text = re.sub(r"(\n\s*){3,}", "\n\n", text)
    text = re.sub(r"-\n(\S)", r"\1", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


@dataclass(frozen=True)
class PaperRow:
    id: str
    arxiv_id: str | None
    title: str
    abstract: str
    ingested_at: str


class SummaryClient(SupabaseRestClient):
    def select_papers(self, limit: int) -> list[PaperRow]:
        rows = self.request_json(
            "papers",
            {
                "select": "id,arxiv_id,title,abstract,ingested_at",
                "triage_summary": "is.null",
                "abstract": "not.is.null",
                "order": "ingested_at.desc",
                "limit": str(limit),
            },
        )
        if not isinstance(rows, list):
            return []
        return [
            PaperRow(
                id=r["id"],
                arxiv_id=r.get("arxiv_id"),
                title=r["title"],
                abstract=r.get("abstract") or "",
                ingested_at=r["ingested_at"],
            )
            for r in rows
        ]

    def update_summary(self, paper_id: str, summary: dict[str, Any], model_label: str) -> None:
        self.request_json(
            "papers",
            {"id": f"eq.{paper_id}"},
            method="PATCH",
            payload={
                "triage_summary": summary,
                "triage_summary_model": model_label,
                "triage_summary_generated_at": utc_now(),
            },
            prefer="return=minimal",
        )


def fetch_pdf_text(arxiv_id: str, max_chars: int) -> str | None:
    try:
        import fitz
    except ImportError:
        print("  pymupdf not installed, install with: pip install pymupdf")
        return None

    url = ARXIV_PDF.format(arxiv_id=arxiv_id)
    print(f"  Downloading PDF: {url}")

    request = urllib.request.Request(url, headers={"User-Agent": "PaperDeck/0.1.5"})
    with urllib.request.urlopen(request, timeout=120) as response:
        pdf_bytes = response.read()

    doc = fitz.open(stream=io.BytesIO(pdf_bytes), filetype="pdf")
    page_count = len(doc)
    text = "\n\n".join(page.get_text() for page in doc)
    doc.close()

    text = clean_pdf_text(text)
    if max_chars > 0 and len(text) > max_chars:
        text = text[:max_chars]
    print(f"  Extracted {len(text)} chars from {page_count} pages")
    return text


def call_llm(title: str, text: str, max_tokens: int = 1024) -> str:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Paper title: {title}\n\n{text}"},
    ]

    payload = json.dumps({
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.3,
        "stream": False,
    }).encode("utf-8")

    request = urllib.request.Request(
        f"{LLAMA_CPP_BASE}/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    with urllib.request.urlopen(request, timeout=300) as response:
        body = json.loads(response.read().decode("utf-8"))

    result = body.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not result:
        raise RuntimeError(f"Empty response from LLM: {json.dumps(body)}")
    return result


def extract_json(raw: str) -> dict[str, Any]:
    raw = raw.strip()

    fence = raw.find("```")
    if fence != -1:
        inner_start = raw.index("\n", fence) + 1 if "\n" in raw[fence:] else fence + 3
        inner_end = raw.rfind("```")
        if inner_end > inner_start:
            raw = raw[inner_start:inner_end].strip()

    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in response")
    json_str = raw[start:end + 1]

    json_str = re.sub(r"\\(?![\"\\/bfnrtu])", r"\\\\", json_str)

    return json.loads(json_str)


def validate_summary(data: dict[str, Any]) -> None:
    missing = [f for f in REQUIRED_FIELDS if not data.get(f)]
    if missing:
        raise ValueError(f"Missing required fields: {missing}")


def main() -> None:
    load_local_env()

    parser = argparse.ArgumentParser(description="Generate paper summaries via local llama.cpp server.")
    parser.add_argument("--limit", type=int, default=int(os.getenv("SUMMARY_LIMIT", "5")),
                        help="Maximum papers to process (default: 5)")
    parser.add_argument("--dry-run", action="store_true", help="List candidates without calling the LLM")
    parser.add_argument("--no-pdf", action="store_true", help="Skip PDF download, use abstract only")
    parser.add_argument("--pdf-chars", type=int, default=12000,
                        help="Max PDF characters to send to LLM (default: 12000, 0 = unlimited)")
    parser.add_argument("--debug", action="store_true", help="Print raw LLM response on failure")
    parser.add_argument("--max-tokens", type=int, default=2048,
                        help="Max output tokens for LLM (default: 2048)")
    parser.add_argument("--delay", type=float, default=1.0,
                        help="Delay in seconds between LLM calls (default: 1)")
    args = parser.parse_args()

    client = SummaryClient()
    papers = client.select_papers(args.limit)

    print(f"Found {len(papers)} papers without summary")

    if args.dry_run:
        for p in papers:
            has_arxiv = "pdf" if p.arxiv_id else "abstract-only"
            print(f"  [{has_arxiv}] {p.arxiv_id or 'NO_ARXIV'} | {p.title[:100]}")
        print(json.dumps({"mode": "dry-run", "candidates": len(papers)}, indent=2))
        return

    if not papers:
        print(json.dumps({"mode": "write", "generated": 0}))
        return

    model_label = os.getenv("LLAMA_CPP_MODEL_LABEL", "gemma4-e2b:local-llama.cpp")

    generated = 0
    errors = 0

    for i, paper in enumerate(papers, 1):
        arxiv_label = paper.arxiv_id or "NO_ARXIV"
        print(f"\n[{i}/{len(papers)}] {arxiv_label}: {paper.title[:80]}")

        raw = ""
        try:
            content = paper.abstract
            source = "abstract"

            if paper.arxiv_id and not args.no_pdf:
                pdf_text = fetch_pdf_text(paper.arxiv_id, args.pdf_chars)
                if pdf_text and len(pdf_text) > 200:
                    content = pdf_text
                    source = "pdf"
                else:
                    print(f"  PDF too short or failed, falling back to abstract")

            raw = call_llm(paper.title, content, max_tokens=args.max_tokens)
            summary = extract_json(raw)
            validate_summary(summary)
            client.update_summary(paper.id, summary, model_label)
            print(f"  OK [{source}] why_it_matters: {summary['why_it_matters'][:80]}...")
            generated += 1
        except Exception as e:
            print(f"  FAIL: {e}")
            if args.debug and raw:
                print(f"  RAW_RESPONSE:\n{raw[:500]}")
            errors += 1

        if i < len(papers):
            time.sleep(args.delay)

    print(json.dumps({
        "mode": "write",
        "model": model_label,
        "generated": generated,
        "errors": errors,
    }))


if __name__ == "__main__":
    main()
