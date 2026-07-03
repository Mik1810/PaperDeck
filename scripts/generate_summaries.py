# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "requests>=2.32",
# ]
# ///

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import requests

from embedding_common import SupabaseRestClient, load_local_env, require_env

DEFAULT_MODEL = "gemini-flash-latest"
DEFAULT_BATCH_SIZE = 3
DEFAULT_LIMIT = 50
DEFAULT_SOURCE_TEXT_CHARS = 8000
DEFAULT_MAX_OUTPUT_TOKENS = 8192
DEFAULT_RETRIES = 3
DEFAULT_REQUEST_DELAY_MS = 5000
DEFAULT_PAPER_DELAY_S = 5
JINA_BASE = "https://r.jina.ai"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

SYSTEM_PROMPT = """You are a research paper summarizer for CS researchers. Given the text of a paper (which may contain PDF artifacts, garbled symbols, or LaTeX fragments), ignore formatting noise and extract the semantic meaning. Produce a structured JSON summary with exactly these four fields. Each field must be around 100 words. Do NOT repeat or paraphrase the abstract — synthesize new, original insights.

- "why_it_matters": What specific problem or gap does this paper address? Explain the real-world stakes, the limitation of prior work, or the concrete scenario that motivated this research.
- "main_contribution": What exactly did the authors build, prove, or discover? Describe the method, algorithm, framework, dataset, or theorem. Include specific names, metrics, baselines, and key numbers from experiments.
- "prerequisites": What specific background should a reader have? Name concrete concepts, prior architectures, formal tools, or mathematical frameworks.
- "read_if_you_care_about": Who specifically would find this paper most relevant? Name exact research communities, subfields, systems, or application domains.

Write in English. Output ONLY the JSON object, no other text."""


def _extract_json(text: str) -> str:
    trimmed = text.strip()
    fence_match = re.search(r"```(?:json)?\s*\n?([\s\S]*?)```", trimmed)

    if fence_match:
        trimmed = fence_match.group(1).strip()

    start = trimmed.find("{")
    end = trimmed.rfind("}")

    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in response")

    return trimmed[start : end + 1]


@dataclass(frozen=True)
class Config:
    api_key: str
    model: str
    batch_size: int
    limit: int
    source_text_chars: int
    max_output_tokens: int
    retries: int
    request_delay_ms: int
    paper_delay_s: int
    dry_run: bool
    jina_api_key: str | None


@dataclass(frozen=True)
class Paper:
    id: str
    arxiv_id: str | None
    title: str
    abstract: str


@dataclass(frozen=True)
class Summary:
    why_it_matters: str
    main_contribution: str
    prerequisites: str
    read_if_you_care_about: str


class QuotaExceeded(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def parse_args() -> Config:
    parser = argparse.ArgumentParser(
        description="Generate paper summaries with Gemini.",
    )
    parser.add_argument(
        "--model",
        default=os.getenv("GEMINI_MODEL", DEFAULT_MODEL),
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=int(os.getenv("LLM_BATCH_SIZE", str(DEFAULT_BATCH_SIZE))),
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=int(os.getenv("LLM_LIMIT", str(DEFAULT_LIMIT))),
    )
    parser.add_argument(
        "--source-text-chars",
        type=int,
        default=int(os.getenv("LLM_SOURCE_TEXT_CHARS", str(DEFAULT_SOURCE_TEXT_CHARS))),
    )
    parser.add_argument(
        "--max-output-tokens",
        type=int,
        default=int(os.getenv("LLM_MAX_OUTPUT_TOKENS", str(DEFAULT_MAX_OUTPUT_TOKENS))),
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=int(os.getenv("LLM_RETRIES", str(DEFAULT_RETRIES))),
    )
    parser.add_argument(
        "--request-delay-ms",
        type=int,
        default=int(os.getenv("LLM_REQUEST_DELAY_MS", str(DEFAULT_REQUEST_DELAY_MS))),
    )
    parser.add_argument(
        "--paper-delay-s",
        type=int,
        default=os.getenv("LLM_PAPER_DELAY_S", str(DEFAULT_PAPER_DELAY_S)),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=os.getenv("LLM_DRY_RUN", "") == "true",
    )
    args = parser.parse_args()

    api_key = os.getenv("GEMINI_API_KEY")

    if not args.dry_run and not api_key:
        raise RuntimeError("GEMINI_API_KEY is required (set in .env.local)")

    return Config(
        api_key=api_key or "",
        model=args.model,
        batch_size=args.batch_size,
        limit=args.limit,
        source_text_chars=args.source_text_chars,
        max_output_tokens=args.max_output_tokens,
        retries=args.retries,
        request_delay_ms=args.request_delay_ms,
        paper_delay_s=args.paper_delay_s,
        dry_run=args.dry_run,
        jina_api_key=os.getenv("JINA_API_KEY") or None,
    )


# ---------------------------------------------------------------------------
# Supabase
# ---------------------------------------------------------------------------


class SummaryClient(SupabaseRestClient):
    def select_papers(self, limit: int) -> list[dict[str, Any]]:
        return self.request_json(  # type: ignore[no-any-return]
            "papers",
            {
                "select": "id,arxiv_id,title,abstract,triage_summary,ingested_at",
                "source": "eq.arxiv",
                "triage_summary": "is.null",
                "abstract": "not.is.null",
                "order": "ingested_at.desc",
                "limit": str(limit),
            },
        )

    def update_summary(
        self,
        paper_id: str,
        summary: Summary,
        model_label: str,
    ) -> None:
        self.request_json(
            "papers",
            {"id": f"eq.{paper_id}"},
            method="PATCH",
            payload={
                "triage_summary": {
                    "why_it_matters": summary.why_it_matters,
                    "main_contribution": summary.main_contribution,
                    "prerequisites": summary.prerequisites,
                    "read_if_you_care_about": summary.read_if_you_care_about,
                },
                "triage_summary_model": model_label,
                "triage_summary_generated_at": utc_now(),
            },
            prefer="return=minimal",
        )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Jina AI Reader
# ---------------------------------------------------------------------------


def fetch_paper_content(arxiv_id: str, jina_api_key: str | None) -> str:
    pdf_url = f"https://arxiv.org/pdf/{arxiv_id}"
    jina_url = f"{JINA_BASE}/{pdf_url}"

    headers: dict[str, str] = {"Accept": "text/markdown"}

    if jina_api_key:
        headers["Authorization"] = f"Bearer {jina_api_key}"

    response = requests.get(jina_url, headers=headers, timeout=120)
    response.raise_for_status()

    return response.text


def clean_text(text: str, max_chars: int) -> str:
    cleaned = re.sub(
        r"[^\x20-\x7E\u00A0-\u00FF\u0100-\u017F\u2010-\u2060\u2190-\u21FF\u2200-\u22FF\u2300-\u23FF\u03B1-\u03C9\u2207]",
        " ",
        text,
    )
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = cleaned.strip()

    if max_chars > 0:
        cleaned = cleaned[:max_chars]

    return cleaned


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------


def call_gemini(
    config: Config,
    title: str,
    text: str,
) -> Summary:
    url = f"{GEMINI_BASE}/{config.model}:generateContent?key={config.api_key}"

    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [
            {"parts": [{"text": f"Paper title: {title}\n\n{text}"}]}
        ],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": config.max_output_tokens,
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingBudget": 0},
        },
        "safetySettings": [
            {"category": cat, "threshold": "BLOCK_NONE"}
            for cat in (
                "HARM_CATEGORY_HARASSMENT",
                "HARM_CATEGORY_HATE_SPEECH",
                "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                "HARM_CATEGORY_DANGEROUS_CONTENT",
            )
        ],
    }

    for attempt in range(config.retries + 1):
        response = requests.post(
            url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=120,
        )

        if response.status_code == 200:
            data = response.json()
            candidates = data.get("candidates", [])
            prompt_feedback = data.get("promptFeedback", {})

            if not candidates and prompt_feedback.get("blockReason"):
                raise RuntimeError(
                    f"Gemini blocked: {prompt_feedback.get('blockReason')} — "
                    f"{json.dumps(prompt_feedback)[:300]}"
                )

            finish_reason = candidates[0].get("finishReason", "?") if candidates else "no_candidates"

            parts = (
                candidates[0].get("content", {}).get("parts", [])
                if candidates
                else []
            )

            raw = "".join(
                p.get("text", "") for p in parts if isinstance(p.get("text"), str)
            )

            if not raw:
                raise RuntimeError(
                    f"Gemini returned empty response (finish_reason={finish_reason}, "
                    f"candidates={len(candidates)}, parts={len(parts)}): "
                    f"{json.dumps(data)[:500]}"
                )

            return parse_summary(raw, title)

        if response.status_code in (429, 503) and attempt < config.retries:
            error_body = response.text[:300]

            if "exceeded your current quota" in response.text or "quota" in response.text.lower():
                raise QuotaExceeded(
                    f"Gemini daily quota exceeded. "
                    f"Wait for reset or use a different API key. "
                    f"Error: {error_body}"
                )

            retry_after = response.headers.get("Retry-After")
            sleep_ms = (
                min(int(retry_after) * 1000, 300_000)
                if retry_after and retry_after.isdigit()
                else (attempt + 1) * 15000
            )
            print(
                f"\n  {response.status_code} error: {error_body}",
                file=sys.stderr,
            )
            print(
                f"  retrying in {sleep_ms // 1000}s (attempt {attempt + 1}/{config.retries})",
                file=sys.stderr,
            )
            time.sleep(sleep_ms / 1000)
            continue

        raise RuntimeError(
            f"Gemini API error ({response.status_code}): {response.text[:300]}"
        )

    raise RuntimeError("Gemini API error: max retries exceeded")


def parse_summary(raw: str, title: str = "") -> Summary:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        try:
            data = json.loads(_extract_json(raw))
        except (json.JSONDecodeError, ValueError) as exc:
            raise ValueError(
                f"Failed to parse JSON (title: {title[:80]}, "
                f"raw len={len(raw)}): {raw[:500]}"
            ) from exc

    missing = [
        field
        for field in ("why_it_matters", "main_contribution", "prerequisites", "read_if_you_care_about")
        if not isinstance(data.get(field), str) or not data[field].strip()
    ]

    if missing:
        raise ValueError(f"Missing or empty fields: {missing}")

    return Summary(
        why_it_matters=data["why_it_matters"].strip(),
        main_contribution=data["main_contribution"].strip(),
        prerequisites=data["prerequisites"].strip(),
        read_if_you_care_about=data["read_if_you_care_about"].strip(),
    )


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


def process_paper(config: Config, paper: Paper) -> tuple[Paper, Summary] | None:
    content = paper.abstract

    if paper.arxiv_id:
        try:
            full_text = fetch_paper_content(paper.arxiv_id, config.jina_api_key)

            if full_text and len(full_text) > 200:
                cleaned = clean_text(full_text, config.source_text_chars)
                print(
                    f"  Jina: fetched {len(full_text)} chars for {paper.arxiv_id}, using {len(cleaned)}",
                    file=sys.stderr,
                )
                content = cleaned
        except Exception as exc:
            print(
                f"  Jina failed for {paper.arxiv_id}, falling back to abstract: {exc}",
                file=sys.stderr,
            )

    summary = call_gemini(config, paper.title, content)

    return paper, summary


def main() -> None:
    load_local_env()

    try:
        config = parse_args()
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    supabase = SummaryClient()

    rows = supabase.select_papers(config.limit)
    papers = [
        Paper(
            id=row["id"],
            arxiv_id=row.get("arxiv_id"),
            title=row["title"],
            abstract=row["abstract"],
        )
        for row in rows
    ]

    if not papers:
        print("No papers to summarize.")
        return

    print(
        f"Generating summaries with gemini:{config.model} (limit {config.limit}, dry-run: {config.dry_run})",
        file=sys.stderr,
    )
    print(f"Found {len(papers)} papers to summarize")

    if config.dry_run:
        print(f"dry run: {len(papers)} would be processed")
        return

    total = 0

    for batch_start in range(0, len(papers), config.batch_size):
        batch = papers[batch_start : batch_start + config.batch_size]
        batch_num = batch_start // config.batch_size + 1
        total_batches = (len(papers) + config.batch_size - 1) // config.batch_size
        print(f"Batch {batch_num}/{total_batches}: {len(batch)} papers")

        for i, paper in enumerate(batch):
            if i > 0:
                time.sleep(config.paper_delay_s)

            global_idx = batch_start + i + 1

            try:
                result = process_paper(config, paper)

                if result is None:
                    print(f"  [{global_idx}/{len(papers)}] {paper.title[:80]}... SKIPPED")
                    continue

                _, summary = result
                model_label = f"gemini:{config.model}"
                supabase.update_summary(paper.id, summary, model_label)
                total += 1
                print(f"  [{global_idx}/{len(papers)}] {paper.title[:80]}... OK")
            except QuotaExceeded:
                print(
                    f"Quota exceeded — stopping. {total}/{len(papers)} done so far.",
                    file=sys.stderr,
                )
                return
            except Exception as exc:
                print(f"  [{global_idx}/{len(papers)}] {paper.title[:80]}... FAILED: {exc}", file=sys.stderr)

        if batch_start + config.batch_size < len(papers):
            delay_s = config.request_delay_ms / 1000
            print(f"  waiting {delay_s:.0f}s before next batch...")
            time.sleep(delay_s)

    print(f"Done. {total}/{len(papers)} summaries generated.")


if __name__ == "__main__":
    main()
