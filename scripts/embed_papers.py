#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from embedding_common import (
    DEFAULT_MODEL,
    EMBEDDING_DIMENSION,
    SupabaseRestClient,
    content_hash,
    load_local_env,
    load_model,
    utc_now,
    vector_literal,
)


@dataclass(frozen=True)
class PaperCandidate:
    id: str
    title: str
    abstract: str
    text: str
    content_hash: str
    stale_reason: str


@dataclass(frozen=True)
class CandidateScan:
    candidates: list[PaperCandidate]
    inspected: int
    scan_complete: bool


class PaperEmbeddingClient(SupabaseRestClient):
    def _select_page(
        self,
        page_size: int,
        offset: int,
        embedding_filter: str | None,
        classic_only: bool,
    ) -> list[dict[str, Any]]:
        query = {
            "select": "id,title,abstract,embedding_model,embedding_content_hash,ingested_at",
            "order": "ingested_at.asc,id.asc",
            "limit": str(page_size),
            "offset": str(offset),
        }
        if embedding_filter:
            query["embedding"] = embedding_filter
        if classic_only:
            query["is_classic"] = "eq.true"

        result = self.request_json(
            "papers",
            query,
        )
        return result if isinstance(result, list) else []

    def iter_papers(
        self,
        page_size: int,
        embedding_filter: str | None,
        classic_only: bool,
    ) -> Iterator[dict[str, Any]]:
        page_size = min(page_size, 1000)
        offset = 0
        while True:
            page = self._select_page(
                page_size,
                offset,
                embedding_filter,
                classic_only,
            )
            if not page:
                break
            yield from page
            offset += len(page)
            if len(page) < page_size:
                break

    def update_paper_embedding(self, paper_id: str, payload: dict[str, Any]) -> None:
        self.request_json(
            "papers",
            {"id": f"eq.{paper_id}"},
            method="PATCH",
            payload=payload,
            prefer="return=minimal",
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Embed PaperDeck papers with a local sentence-transformers model.",
    )
    parser.add_argument("--model", default=os.getenv("EMBEDDING_MODEL", DEFAULT_MODEL))
    parser.add_argument(
        "--batch-size",
        type=int,
        default=int(os.getenv("EMBEDDING_BATCH_SIZE", "64")),
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=int(os.getenv("EMBEDDING_LIMIT", "256")),
        help="Maximum number of papers to embed in this run.",
    )
    parser.add_argument(
        "--table-limit",
        type=int,
        default=int(os.getenv("EMBEDDING_TABLE_LIMIT", "0")),
        help="Rows per bounded REST scan page. Defaults to max(limit * 4, 100).",
    )
    parser.add_argument(
        "--classic-only",
        action="store_true",
        help="Restrict candidate discovery to papers marked as classic.",
    )
    parser.add_argument(
        "--until-fresh",
        action="store_true",
        help="Keep processing bounded batches until a fresh full scan is observed.",
    )
    parser.add_argument(
        "--max-batches",
        type=int,
        default=100,
        help="Safety cap for --until-fresh. Defaults to 100 batches.",
    )
    parser.add_argument(
        "--log-file",
        type=Path,
        help="Append batch progress as JSON Lines to this .log file.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List candidate papers without loading the model or writing embeddings.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Embed inspected papers even when hash/model metadata already match.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Disable model progress output.",
    )

    args = parser.parse_args()

    if args.limit < 1:
        parser.error("--limit must be >= 1")

    if args.batch_size < 1:
        parser.error("--batch-size must be >= 1")

    if args.max_batches < 1:
        parser.error("--max-batches must be >= 1")

    if args.log_file and args.log_file.suffix != ".log":
        parser.error("--log-file must use a .log suffix")

    if args.force and args.until_fresh:
        parser.error("--force cannot be combined with --until-fresh")

    if args.table_limit < 1:
        args.table_limit = max(args.limit * 4, 100)

    if args.until_fresh and not args.log_file:
        timestamp = utc_now().replace("-", "").replace(":", "").split(".", 1)[0]
        args.log_file = Path(f".codex-logs/embed-papers-backfill-{timestamp}.log")

    return args


def embedding_text(row: dict[str, Any]) -> str:
    title = str(row.get("title") or "").strip()
    abstract = str(row.get("abstract") or "").strip()

    return f"{title}\n\n{abstract}".strip()


def stale_reason(
    row: dict[str, Any],
    has_embedding: bool,
    model_name: str,
    text_hash: str,
    force: bool,
) -> str | None:
    if force:
        return "force"

    if not has_embedding:
        return "missing_embedding"

    if row.get("embedding_model") != model_name:
        return "model_changed"

    if row.get("embedding_content_hash") != text_hash:
        return "content_changed"

    return None


def load_candidates(
    supabase: PaperEmbeddingClient,
    model_name: str,
    limit: int,
    table_limit: int,
    force: bool,
    classic_only: bool = False,
) -> CandidateScan:
    candidates: list[PaperCandidate] = []
    inspected = 0

    scan_phases = (
        ((None, True),) if force else (("is.null", False), ("not.is.null", True))
    )

    for embedding_filter, has_embedding in scan_phases:
        for row in supabase.iter_papers(
            table_limit,
            embedding_filter,
            classic_only,
        ):
            inspected += 1
            text = embedding_text(row)

            if not text:
                continue

            text_hash = content_hash(text)
            reason = stale_reason(row, has_embedding, model_name, text_hash, force)

            if not reason:
                continue

            candidates.append(
                PaperCandidate(
                    id=row["id"],
                    title=row["title"],
                    abstract=row.get("abstract") or "",
                    text=text,
                    content_hash=text_hash,
                    stale_reason=reason,
                ),
            )

            if len(candidates) >= limit:
                return CandidateScan(candidates, inspected, False)

    return CandidateScan(candidates, inspected, True)


def write_embeddings(
    supabase: PaperEmbeddingClient,
    candidates: list[PaperCandidate],
    embeddings: list[list[float]],
    model_name: str,
) -> None:
    embedded_at = utc_now()

    for candidate, embedding in zip(candidates, embeddings, strict=True):
        if len(embedding) != EMBEDDING_DIMENSION:
            raise RuntimeError(
                f"Model produced {len(embedding)} dimensions, expected {EMBEDDING_DIMENSION}",
            )

        supabase.update_paper_embedding(
            candidate.id,
            {
                "embedding": vector_literal(embedding),
                "embedding_model": model_name,
                "embedding_dimension": EMBEDDING_DIMENSION,
                "embedding_content_hash": candidate.content_hash,
                "embedded_at": embedded_at,
            },
        )


def scan_progress(scan: CandidateScan) -> dict[str, Any]:
    return {
        "inspected": scan.inspected,
        "scanComplete": scan.scan_complete,
        "status": (
            "catalog_fully_fresh"
            if scan.scan_complete and not scan.candidates
            else "scan_complete_with_candidates"
            if scan.scan_complete
            else "candidate_limit_reached"
        ),
    }


def append_log(log_file: Path | None, event: dict[str, Any]) -> None:
    if not log_file:
        return

    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("a", encoding="utf-8") as handle:
        handle.write(
            json.dumps(
                {"loggedAt": utc_now(), **event},
                separators=(",", ":"),
            )
            + "\n",
        )


def encode_candidates(
    model: Any,
    candidates: list[PaperCandidate],
    batch_size: int,
    quiet: bool,
) -> list[list[float]]:
    encoded = model.encode(
        [candidate.text for candidate in candidates],
        batch_size=batch_size,
        normalize_embeddings=True,
        show_progress_bar=not quiet,
    )
    return [embedding.tolist() for embedding in encoded]


def run(args: argparse.Namespace) -> None:
    if args.until_fresh:
        append_log(
            args.log_file,
            {
                "event": "run_started",
                "mode": "dry-run" if args.dry_run else "write",
                "model": args.model,
                "limit": args.limit,
                "batchSize": args.batch_size,
                "maxBatches": args.max_batches,
                "classicOnly": args.classic_only,
            },
        )
    supabase = PaperEmbeddingClient()
    scan = load_candidates(
        supabase=supabase,
        model_name=args.model,
        limit=args.limit,
        table_limit=args.table_limit,
        force=args.force,
        classic_only=args.classic_only,
    )
    candidates = scan.candidates
    progress = scan_progress(scan)

    if args.dry_run:
        print(
            json.dumps(
                {
                    "mode": "dry-run",
                    "model": args.model,
                    **progress,
                    "candidates": len(candidates),
                    "untilFresh": args.until_fresh,
                    "papers": [
                        {
                            "id": candidate.id,
                            "title": candidate.title,
                            "staleReason": candidate.stale_reason,
                        }
                        for candidate in candidates[:10]
                    ],
                },
                indent=2,
            ),
        )
        return

    if not candidates:
        result = {
            "mode": "write",
            "model": args.model,
            "embedded": 0,
            **progress,
        }
        if args.until_fresh:
            result.update({"batches": 0, "logFile": str(args.log_file)})
            append_log(args.log_file, {"event": "run_completed", **result})
        print(
            json.dumps(result),
        )
        return

    model = load_model(args.model)
    total_embedded = 0
    total_inspected = 0
    batches = 0

    while candidates:
        embeddings = encode_candidates(
            model,
            candidates,
            args.batch_size,
            args.quiet or args.until_fresh,
        )
        write_embeddings(supabase, candidates, embeddings, args.model)
        batches += 1
        total_embedded += len(candidates)
        total_inspected += scan.inspected
        append_log(
            args.log_file,
            {
                "event": "batch_completed",
                "batch": batches,
                "selected": len(candidates),
                "written": len(candidates),
                **progress,
            },
        )

        if not args.until_fresh:
            break

        scan = load_candidates(
            supabase=supabase,
            model_name=args.model,
            limit=args.limit,
            table_limit=args.table_limit,
            force=args.force,
            classic_only=args.classic_only,
        )
        candidates = scan.candidates
        progress = scan_progress(scan)

        if candidates and batches >= args.max_batches:
            total_inspected += scan.inspected
            result = {
                "mode": "write",
                "model": args.model,
                "embedded": total_embedded,
                "batches": batches,
                "inspected": total_inspected,
                "status": "max_batches_reached",
                "logFile": str(args.log_file),
            }
            append_log(args.log_file, {"event": "run_stopped", **result})
            print(json.dumps(result))
            raise SystemExit(2)

    if args.until_fresh:
        total_inspected += scan.inspected
        result = {
            "mode": "write",
            "model": args.model,
            "embedded": total_embedded,
            "batches": batches,
            "inspected": total_inspected,
            **progress,
            "logFile": str(args.log_file),
        }
        append_log(args.log_file, {"event": "run_completed", **result})
        print(json.dumps(result))
        return

    print(
        json.dumps(
            {
                "mode": "write",
                "model": args.model,
                "embedded": total_embedded,
                **progress,
            },
        ),
    )


def main() -> None:
    load_local_env()
    args = parse_args()
    try:
        run(args)
    except Exception as error:
        if args.until_fresh:
            append_log(
                args.log_file,
                {
                    "event": "run_failed",
                    "errorType": type(error).__name__,
                    "error": str(error)[:500],
                },
            )
        raise


if __name__ == "__main__":
    main()
