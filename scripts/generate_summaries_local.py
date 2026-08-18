#!/usr/bin/env python3
"""Generate triage summaries using a local llama.cpp server (OpenAI-compatible API).

Reads papers without triage_summary from Supabase. For papers with an
arxiv_id, downloads the PDF and extracts text via pymupdf. Falls back to
abstract when PDF fetching fails or for non-arXiv papers. Sends the text
to the local LLM, parses the JSON response, and writes the summary back.

Usage:
    # dry-run: list candidates without calling the LLM
    python scripts/generate_summaries_local.py --dry-run

    # generate and validate summaries without writing to Supabase
    python scripts/generate_summaries_local.py --no-write --limit 5

    # write mode, abstract-only (skip PDF fetch)
    python scripts/generate_summaries_local.py --no-pdf --limit 10

    # write mode with PDF download (default for arxiv papers)
    python scripts/generate_summaries_local.py --limit 5

    # custom PDF text length
    python scripts/generate_summaries_local.py --limit 5 --pdf-chars 16000

    # compare with the legacy first-characters extraction
    python scripts/generate_summaries_local.py --no-write --pdf-strategy first
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
from pathlib import Path
from typing import Any

from embedding_common import SupabaseRestClient, load_local_env, utc_now

LLAMA_CPP_BASE = os.getenv("LLAMA_CPP_URL", "http://localhost:43307").rstrip("/")

SYSTEM_PROMPT = (
    "You are a research paper summarizer for CS researchers. "
    "Given labeled excerpts from a paper (which may contain PDF artifacts, garbled symbols, "
    "or LaTeX fragments), ignore formatting noise and extract the semantic meaning. "
    "Do not merely paraphrase the abstract. Build a concise synthesis by combining evidence "
    "from the opening, method, results, and conclusion. Surface useful details that are absent "
    "from the abstract, especially concrete methods, experimental findings, limitations, and "
    "required background. Every factual claim must be supported by the supplied paper text. "
    "Do not invent implications or results. Copy model, dataset, benchmark, method, and system "
    "names exactly as they appear in the supplied text. Use precise relationship verbs: distinguish "
    "what the authors propose, implement, adapt, apply, evaluate, and merely discuss. When reporting "
    "a comparison, name both the evaluated system and its baseline in the same sentence so the metric "
    "cannot be attributed to the wrong method. "
    "Produce a structured JSON summary with exactly these four fields.\n\n"
    '- "why_it_matters": What specific problem or gap does this paper address? '
    "Combine the motivation, a concrete limitation of prior work, and consequences supported "
    "by the conclusion. Target 50-90 words.\n"
    '- "main_contribution": What exactly did the authors build, prove, or discover? '
    "Describe the method, algorithm, framework, dataset, or theorem. "
    "Use both method and results when available. Include specific names, metrics, baselines, "
    "and key numbers only when clearly supported. Target 70-120 words.\n"
    '- "prerequisites": What specific background should a reader have? '
    "Infer conservatively from techniques actually used in the method. Name concrete concepts, "
    "prior architectures, formal tools, or mathematical frameworks. Target 35-70 words.\n"
    '- "read_if_you_care_about": Who specifically would find this paper most relevant? '
    "Name 2-4 specific research communities, subfields, systems, or application domains grounded "
    "in the supplied text; avoid merely adjacent fields and do not add plausible but unmentioned "
    "application domains. Target 35-70 words.\n\n"
    "Use only claims supported by the supplied paper text. Do not invent names, metrics, "
    "baselines, results, or prerequisites. Do not include equations, LaTeX commands, or "
    "mathematical expressions; describe mathematical results in plain English and retain exact "
    "numbers only when they are clearly stated in the supplied text. "
    "Write in English. Output ONLY the JSON object, no other text."
)

REQUIRED_FIELDS = ["why_it_matters", "main_contribution", "prerequisites", "read_if_you_care_about"]
SUMMARY_WORD_RANGES = {
    "why_it_matters": (40, 100),
    "main_contribution": (55, 130),
    "prerequisites": (25, 80),
    "read_if_you_care_about": (20, 80),
}
FORBIDDEN_SUMMARY_MATH = re.compile(
    r"\\[A-Za-z]+|\b(?:exp|log|sqrt)\s*\(|\bO\s*\(",
    re.IGNORECASE,
)
SUMMARY_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        field: {"type": "string"}
        for field in REQUIRED_FIELDS
    },
    "required": REQUIRED_FIELDS,
    "additionalProperties": False,
}
ARXIV_PDF = "https://arxiv.org/pdf/{arxiv_id}.pdf"
SLOW_LLM_SECONDS = 60
DEFAULT_CONTEXT_MARGIN = 64
MIN_CONTENT_CHARS = 1000
SECTION_GROUPS = [
    ("method", ("method", "methodology", "approach", "framework", "system design")),
    ("results", ("experiment", "experiments", "evaluation", "results", "empirical study")),
    ("conclusion", ("conclusion", "conclusions", "discussion", "limitations")),
]


def clean_pdf_text(text: str) -> str:
    text = re.sub(r"(\n\s*){3,}", "\n\n", text)
    text = re.sub(r"(?<=[a-z])-\n(?=[a-z])", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


@dataclass(frozen=True)
class PaperRow:
    id: str
    arxiv_id: str | None
    title: str
    abstract: str
    ingested_at: str


class LlmServerError(RuntimeError):
    """The local llama.cpp server cannot complete requests."""


class LlmRequestError(RuntimeError):
    """A single inference request was rejected and the batch may continue."""


@dataclass(frozen=True)
class LlmResponse:
    content: str
    finish_reason: str | None
    prompt_tokens: int | None
    completion_tokens: int | None


class SummaryClient(SupabaseRestClient):
    def select_papers(
        self,
        limit: int,
        arxiv_ids: list[str] | None = None,
        include_summarized: bool = False,
    ) -> list[PaperRow]:
        params = {
            "select": "id,arxiv_id,title,abstract,ingested_at",
            "abstract": "not.is.null",
            "order": "ingested_at.desc",
            "limit": str(limit),
        }
        if not include_summarized:
            params["triage_summary"] = "is.null"
        if arxiv_ids:
            params["arxiv_id"] = f"in.({','.join(arxiv_ids)})"
            params["order"] = "arxiv_id.asc"

        rows = self.request_json("papers", params)
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

    def update_summary(self, paper_id: str, summary: dict[str, Any], model_label: str) -> bool:
        rows = self.request_json(
            "papers",
            {
                "id": f"eq.{paper_id}",
                "triage_summary": "is.null",
                "select": "id",
            },
            method="PATCH",
            payload={
                "triage_summary": summary,
                "triage_summary_model": model_label,
                "triage_summary_generated_at": utc_now(),
            },
            prefer="return=representation",
        )
        return isinstance(rows, list) and len(rows) == 1


def find_section_start(text: str, headings: tuple[str, ...]) -> int | None:
    alternatives = "|".join(re.escape(heading) for heading in headings)
    matches = list(re.finditer(
        rf"(?im)^[ \t]*(?:\d+(?:\.\d+)*[.)]?[ \t]+)?[^\n]{{0,70}}"
        rf"\b(?:{alternatives})\b[^\n]{{0,50}}$",
        text,
    ))
    content_matches = [match for match in matches if match.start() >= len(text) * 0.08]
    match = (content_matches or matches or [None])[0]
    return match.start() if match else None


def select_pdf_text(text: str, max_chars: int, strategy: str) -> tuple[str, list[str]]:
    if max_chars <= 0 or len(text) <= max_chars:
        return text, ["full"]
    if strategy == "first":
        return text[:max_chars], ["first"]

    opening_budget = max_chars * 40 // 100
    section_budget = (max_chars - opening_budget) // len(SECTION_GROUPS)
    chunks = [f"[OPENING]\n{text[:opening_budget]}"]
    labels = ["opening"]
    ranges = [(0, opening_budget)]

    fallback_positions = (0.30, 0.62, 0.86)
    for (label, headings), fallback_position in zip(SECTION_GROUPS, fallback_positions):
        start = find_section_start(text, headings)
        selected_label = label
        if start is None:
            start = int(len(text) * fallback_position)
            selected_label = f"{label}-sample"
        end = min(len(text), start + section_budget)
        if any(start < used_end and end > used_start for used_start, used_end in ranges):
            start = int(len(text) * fallback_position)
            end = min(len(text), start + section_budget)
            selected_label = f"{label}-sample"
            if any(start < used_end and end > used_start for used_start, used_end in ranges):
                continue
        section_name = selected_label.removesuffix("-sample").upper()
        chunks.append(f"[{section_name}]\n{text[start:end]}")
        labels.append(selected_label)
        ranges.append((start, end))

    selected = "\n\n".join(chunks)
    return selected[:max_chars], labels


def fetch_pdf_text(arxiv_id: str, max_chars: int, strategy: str) -> str | None:
    try:
        import pymupdf
    except ImportError:
        print("  pymupdf not installed, install with: pip install pymupdf")
        return None

    url = ARXIV_PDF.format(arxiv_id=arxiv_id)
    print(f"  Downloading PDF: {url}")

    request = urllib.request.Request(url, headers={"User-Agent": "PaperDeck/0.1.5"})
    with urllib.request.urlopen(request, timeout=120) as response:
        pdf_bytes = response.read()

    doc = pymupdf.open(stream=io.BytesIO(pdf_bytes), filetype="pdf")
    page_count = len(doc)
    text = "\n\n".join(page.get_text() for page in doc)
    doc.close()

    text = clean_pdf_text(text)
    selected, sections = select_pdf_text(text, max_chars, strategy)
    print(
        f"  Extracted {len(text)} chars from {page_count} pages; "
        f"selected {len(selected)} chars ({', '.join(sections)})"
    )
    return selected


def build_messages(
    title: str,
    text: str,
    correction: str | None = None,
) -> list[dict[str, str]]:
    user_content = f"Paper title: {title}\n\n{text}"
    if correction:
        user_content += f"\n\nMandatory correction: {correction}"
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


def http_error_detail(error: urllib.error.HTTPError) -> str:
    try:
        body = json.loads(error.read().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return str(error)

    detail = body.get("error", body) if isinstance(body, dict) else body
    if isinstance(detail, dict):
        message = detail.get("message")
        error_type = detail.get("type")
        if message:
            return f"HTTP {error.code}: {message}" + (
                f" ({error_type})" if error_type else ""
            )
    return str(error)


def request_json(
    path: str,
    payload: dict[str, Any] | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{LLAMA_CPP_BASE}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = http_error_detail(error)
        if error.code in {400, 413, 422}:
            raise LlmRequestError(f"Local llama.cpp rejected request: {detail}") from error
        raise LlmServerError(f"Local llama.cpp request failed: {detail}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise LlmServerError(f"Local llama.cpp request failed: {error}") from error
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LlmServerError("Local llama.cpp returned an invalid JSON envelope") from error

    if not isinstance(body, dict):
        raise LlmServerError("Local llama.cpp returned a non-object JSON envelope")
    return body


def get_context_size() -> int:
    body = request_json("/props")
    settings = body.get("default_generation_settings", {})
    context_size = settings.get("n_ctx") if isinstance(settings, dict) else None
    if not isinstance(context_size, int) or context_size <= 0:
        raise LlmServerError("Local llama.cpp /props did not report a valid context size")
    return context_size


def count_prompt_tokens(messages: list[dict[str, str]]) -> int:
    templated = request_json("/apply-template", {"messages": messages})
    prompt = templated.get("prompt")
    if not isinstance(prompt, str):
        raise LlmServerError("Local llama.cpp /apply-template did not return a prompt")

    tokenized = request_json(
        "/tokenize",
        {"content": prompt, "add_special": False, "parse_special": True},
    )
    tokens = tokenized.get("tokens")
    if not isinstance(tokens, list):
        raise LlmServerError("Local llama.cpp /tokenize did not return tokens")
    return len(tokens)


def shrink_excerpt(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text

    chunks = re.findall(r"(?ms)^\[[A-Z]+\]\n.*?(?=^\[[A-Z]+\]\n|\Z)", text)
    if len(chunks) < 2:
        return text[:max_chars]

    headings_and_bodies: list[tuple[str, str]] = []
    for chunk in chunks:
        heading, _, body = chunk.partition("\n")
        headings_and_bodies.append((heading, body.rstrip()))

    overhead = sum(len(heading) + 1 for heading, _ in headings_and_bodies)
    overhead += 2 * (len(headings_and_bodies) - 1)
    body_budget = max(0, max_chars - overhead)
    total_body_chars = sum(len(body) for _, body in headings_and_bodies)
    if total_body_chars == 0:
        return text[:max_chars]

    remaining = body_budget
    shortened: list[str] = []
    for index, (heading, body) in enumerate(headings_and_bodies):
        if index == len(headings_and_bodies) - 1:
            allocation = remaining
        else:
            allocation = body_budget * len(body) // total_body_chars
            remaining -= allocation
        shortened.append(f"{heading}\n{body[:allocation]}")
    return "\n\n".join(shortened)[:max_chars]


def fit_text_to_context(
    title: str,
    text: str,
    context_size: int,
    max_tokens: int,
    context_margin: int,
) -> tuple[str, int]:
    prompt_budget = context_size - max_tokens - context_margin
    if prompt_budget <= 0:
        raise LlmRequestError(
            f"Output budget ({max_tokens}) plus context margin ({context_margin}) "
            f"does not fit the server context ({context_size})"
        )

    counts: dict[int, int] = {}

    def count_for(char_limit: int) -> int:
        if char_limit not in counts:
            candidate = shrink_excerpt(text, char_limit)
            counts[char_limit] = count_prompt_tokens(build_messages(title, candidate))
        return counts[char_limit]

    full_chars = len(text)
    full_tokens = count_for(full_chars)
    if full_tokens <= prompt_budget:
        return text, full_tokens

    minimum = min(MIN_CONTENT_CHARS, full_chars)
    minimum_tokens = count_for(minimum)
    if minimum_tokens > prompt_budget:
        raise LlmRequestError(
            f"Prompt needs {minimum_tokens} tokens even after reducing paper content "
            f"to {minimum} characters; budget is {prompt_budget}"
        )

    low = minimum
    high = full_chars - 1
    best_chars = minimum
    best_tokens = minimum_tokens
    while low <= high:
        midpoint = (low + high) // 2
        tokens = count_for(midpoint)
        if tokens <= prompt_budget:
            best_chars = midpoint
            best_tokens = tokens
            low = midpoint + 1
        else:
            high = midpoint - 1

    return shrink_excerpt(text, best_chars), best_tokens


def completion_payload(
    messages: list[dict[str, str]],
    max_tokens: int,
) -> dict[str, Any]:
    return {
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.3,
        "stream": False,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "triage_summary",
                "strict": True,
                "schema": SUMMARY_JSON_SCHEMA,
            },
        },
    }


def request_completion(
    messages: list[dict[str, str]],
    max_tokens: int,
) -> LlmResponse:
    body = request_json(
        "/v1/chat/completions",
        completion_payload(messages, max_tokens),
        timeout=300,
    )
    choice = body.get("choices", [{}])[0]
    result = choice.get("message", {}).get("content", "")
    if not result:
        raise RuntimeError("Empty response from LLM")
    usage = body.get("usage", {})
    return LlmResponse(
        content=result,
        finish_reason=choice.get("finish_reason"),
        prompt_tokens=usage.get("prompt_tokens"),
        completion_tokens=usage.get("completion_tokens"),
    )


def call_llm(
    title: str,
    text: str,
    max_tokens: int = 1024,
    correction: str | None = None,
) -> LlmResponse:
    return request_completion(build_messages(title, text, correction), max_tokens)


def correct_llm_response(
    previous_json: str,
    validation_error: str,
    max_tokens: int,
) -> LlmResponse:
    messages = [
        {
            "role": "system",
            "content": (
                "You edit an existing research summary JSON object. Preserve its supported facts, "
                "names, comparisons, and numbers. Fix only the stated validation problem. Do not "
                "add facts. Keep the same four fields and output only the complete JSON object."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Validation problem: {validation_error}\n\n"
                "Replace equations, LaTeX, backslash commands, dollar delimiters, and symbolic "
                "complexity notation such as O(...) with plain English.\n\n"
                f"JSON to edit:\n{previous_json}"
            ),
        },
    ]
    return request_completion(messages, max_tokens)


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

    json_str = escape_ambiguous_json_backslashes(json_str)

    return json.loads(json_str)


def escape_ambiguous_json_backslashes(value: str) -> str:
    """Preserve model-emitted LaTeX commands inside JSON strings."""
    result: list[str] = []
    in_string = False
    index = 0

    while index < len(value):
        char = value[index]
        if char == '"':
            in_string = not in_string
            result.append(char)
            index += 1
            continue

        if not in_string or char != "\\":
            result.append(char)
            index += 1
            continue

        next_char = value[index + 1] if index + 1 < len(value) else ""
        if next_char in {'"', "\\", "/"}:
            result.extend((char, next_char))
            index += 2
            continue

        unicode_escape = (
            next_char == "u"
            and index + 5 < len(value)
            and all(c in "0123456789abcdefABCDEF" for c in value[index + 2:index + 6])
        )
        if unicode_escape:
            result.extend(value[index:index + 6])
            index += 6
            continue

        result.append("\\\\")
        index += 1

    return "".join(result)


def validate_summary(data: dict[str, Any]) -> None:
    fields = set(data)
    required = set(REQUIRED_FIELDS)
    if fields != required:
        raise ValueError(
            f"Summary fields must be exactly {REQUIRED_FIELDS}; "
            f"missing={sorted(required - fields)}, extra={sorted(fields - required)}"
        )

    for field in REQUIRED_FIELDS:
        value = data[field]
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field} must be a non-empty string")
        word_count = len(value.split())
        minimum, maximum = SUMMARY_WORD_RANGES[field]
        if not minimum <= word_count <= maximum:
            raise ValueError(
                f"{field} must contain {minimum}-{maximum} words, received {word_count}"
            )
        if FORBIDDEN_SUMMARY_MATH.search(value):
            raise ValueError(
                f"{field} contains a forbidden mathematical expression"
            )


def write_report(path: Path | None, payload: dict[str, Any]) -> None:
    if path is None:
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(f"{path.suffix}.tmp")
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary_path.replace(path)


def main() -> None:
    load_local_env()

    parser = argparse.ArgumentParser(description="Generate paper summaries via local llama.cpp server.")
    parser.add_argument("--limit", type=int, default=int(os.getenv("SUMMARY_LIMIT", "5")),
                        help="Maximum papers to process (default: 5)")
    parser.add_argument("--arxiv-id", action="append", default=[],
                        help="Target an arXiv ID; repeatable and allowed for existing summaries only in no-write mode")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true",
                      help="List candidates without calling the LLM")
    mode.add_argument("--no-write", action="store_true",
                      help="Call the LLM and validate summaries without writing to Supabase")
    parser.add_argument("--no-pdf", action="store_true", help="Skip PDF download, use abstract only")
    parser.add_argument("--pdf-chars", type=int, default=20000,
                        help="Max PDF characters to send to LLM (default: 20000, 0 = unlimited)")
    parser.add_argument("--pdf-strategy", choices=("sections", "first"), default="sections",
                        help="Select representative sections or only the PDF beginning (default: sections)")
    parser.add_argument("--debug", action="store_true", help="Print raw LLM response on failure")
    parser.add_argument("--max-tokens", type=int, default=1024,
                        help="Max output tokens for LLM (default: 1024)")
    parser.add_argument("--context-margin", type=int, default=DEFAULT_CONTEXT_MARGIN,
                        help=f"Unused context tokens kept as a safety margin (default: {DEFAULT_CONTEXT_MARGIN})")
    parser.add_argument("--delay", type=float, default=1.0,
                        help="Delay in seconds between LLM calls (default: 1)")
    parser.add_argument("--report", type=Path,
                        help="Atomically checkpoint a secret-free JSON run report")
    args = parser.parse_args()
    if args.max_tokens <= 0:
        parser.error("--max-tokens must be greater than zero")
    if args.context_margin < 0:
        parser.error("--context-margin must be zero or greater")
    if args.pdf_chars < 0:
        parser.error("--pdf-chars must be zero or greater")

    client = SummaryClient()
    papers = client.select_papers(
        args.limit,
        args.arxiv_id,
        include_summarized=args.no_write and bool(args.arxiv_id),
    )

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

    context_size = get_context_size()
    prompt_budget = context_size - args.max_tokens - args.context_margin
    if prompt_budget <= 0:
        parser.error(
            f"--max-tokens ({args.max_tokens}) plus --context-margin "
            f"({args.context_margin}) must be smaller than the server context ({context_size})"
        )
    print(
        f"Local context: {context_size} tokens; prompt budget: {prompt_budget}; "
        f"output budget: {args.max_tokens}; margin: {args.context_margin}"
    )

    model_label = os.getenv("LLAMA_CPP_MODEL_LABEL", "local-llama.cpp")
    run_started_at = utc_now()

    generated = 0
    errors = 0
    skipped_existing = 0
    failed_arxiv_ids: list[str] = []
    durations: list[float] = []

    def checkpoint(
        status: str,
        processed: int,
        last_arxiv_id: str | None = None,
        fatal_error: str | None = None,
    ) -> None:
        write_report(args.report, {
            "status": status,
            "mode": "no-write" if args.no_write else "write",
            "model": model_label,
            "context_size": context_size,
            "prompt_budget": prompt_budget,
            "started_at": run_started_at,
            "updated_at": utc_now(),
            "selected": len(papers),
            "processed": processed,
            "generated": generated,
            "errors": errors,
            "skipped_existing": skipped_existing,
            "failed_arxiv_ids": failed_arxiv_ids,
            "last_arxiv_id": last_arxiv_id,
            "average_llm_seconds": (
                round(sum(durations) / len(durations), 1) if durations else None
            ),
            "fatal_error": fatal_error,
        })

    checkpoint("running", 0)

    for i, paper in enumerate(papers, 1):
        arxiv_label = paper.arxiv_id or "NO_ARXIV"
        print(f"\n[{i}/{len(papers)}] {arxiv_label}: {paper.title[:80]}")

        raw = ""
        try:
            content = paper.abstract
            source = "abstract"

            if paper.arxiv_id and not args.no_pdf:
                pdf_text = fetch_pdf_text(paper.arxiv_id, args.pdf_chars, args.pdf_strategy)
                if pdf_text and len(pdf_text) > 200:
                    content = pdf_text
                    source = "pdf"
                else:
                    print(f"  PDF too short or failed, falling back to abstract")

            original_chars = len(content)
            content, prompt_tokens = fit_text_to_context(
                paper.title,
                content,
                context_size,
                args.max_tokens,
                args.context_margin,
            )
            if len(content) < original_chars:
                print(
                    f"  Context fit: reduced input from {original_chars} to {len(content)} "
                    f"chars; prompt uses {prompt_tokens}/{prompt_budget} tokens"
                )
            else:
                print(f"  Context fit: prompt uses {prompt_tokens}/{prompt_budget} tokens")

            inference_started_at = time.perf_counter()
            response = call_llm(paper.title, content, max_tokens=args.max_tokens)
            duration = time.perf_counter() - inference_started_at
            durations.append(duration)
            raw = response.content
            if duration > SLOW_LLM_SECONDS:
                print(
                    f"  WARNING: local inference took {duration:.1f}s "
                    f"(threshold {SLOW_LLM_SECONDS}s)"
                )
            if response.finish_reason == "length":
                raise ValueError(
                    "LLM response was truncated at the context/output limit "
                    f"(prompt={response.prompt_tokens}, completion={response.completion_tokens})"
                )

            summary = extract_json(raw)
            try:
                validate_summary(summary)
            except ValueError as validation_error:
                if "forbidden mathematical" not in str(validation_error):
                    raise
                print("  Retrying once by editing the previous JSON to remove mathematical notation")
                inference_started_at = time.perf_counter()
                response = correct_llm_response(raw, str(validation_error), args.max_tokens)
                duration = time.perf_counter() - inference_started_at
                durations.append(duration)
                raw = response.content
                if response.finish_reason == "length":
                    raise ValueError(
                        "Corrected LLM response was truncated at the context/output limit "
                        f"(prompt={response.prompt_tokens}, completion={response.completion_tokens})"
                    )
                summary = extract_json(raw)
                validate_summary(summary)

            if args.no_write:
                print(f"  OK [{source}] generated in {durations[-1]:.1f}s (not written)")
                print(json.dumps(summary, ensure_ascii=False, indent=2))
                generated += 1
            else:
                updated = client.update_summary(paper.id, summary, model_label)
                if not updated:
                    print("  SKIP: summary appeared after candidate selection")
                    skipped_existing += 1
                    continue
                print(f"  OK [{source}] why_it_matters: {summary['why_it_matters'][:80]}...")
                generated += 1
        except LlmServerError as error:
            print(f"  FATAL: {error}")
            checkpoint("failed", i - 1, paper.arxiv_id, str(error))
            raise
        except Exception as e:
            print(f"  FAIL: {e}")
            if args.debug and raw:
                print(f"  RAW_RESPONSE:\n{raw[:500]}")
            errors += 1
            failed_arxiv_ids.append(paper.arxiv_id or paper.id)
        checkpoint("running", i, paper.arxiv_id)

        if i < len(papers):
            time.sleep(args.delay)

    result = {
        "mode": "no-write" if args.no_write else "write",
        "model": model_label,
        "context_size": context_size,
        "prompt_budget": prompt_budget,
        "generated": generated,
        "errors": errors,
        "skipped_existing": skipped_existing,
        "failed_arxiv_ids": failed_arxiv_ids,
        "average_llm_seconds": round(sum(durations) / len(durations), 1) if durations else None,
    }
    print(json.dumps(result))
    checkpoint("completed", len(papers), papers[-1].arxiv_id if papers else None)

    if errors > 0 and generated == 0:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
