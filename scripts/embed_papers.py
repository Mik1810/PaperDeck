#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
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


class PaperEmbeddingClient(SupabaseRestClient):
    def _select_page(self, table_limit: int, offset: int) -> list[dict[str, Any]]:
        result = self.request_json(
            "papers",
            {
                "select": "id,title,abstract,embedding,embedding_model,embedding_content_hash,ingested_at",
                "order": "ingested_at.asc",
                "limit": str(table_limit),
                "offset": str(offset),
            },
            range_header=f"{offset}-{offset + table_limit - 1}",
        )
        return result if isinstance(result, list) else []

    def select_papers(self, table_limit: int) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            page = self._select_page(min(table_limit - len(rows), 1000), offset)
            if not page:
                break
            rows.extend(page)
            offset += len(page)
            if len(rows) >= table_limit or len(page) < 1000:
                break
        return rows

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
        help="Maximum rows to inspect before local stale filtering. Defaults to max(limit * 4, 100).",
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

    if args.table_limit < 1:
        args.table_limit = max(args.limit * 4, 100)

    return args


def embedding_text(row: dict[str, Any]) -> str:
    title = str(row.get("title") or "").strip()
    abstract = str(row.get("abstract") or "").strip()

    return f"{title}\n\n{abstract}".strip()


def stale_reason(
    row: dict[str, Any],
    model_name: str,
    text_hash: str,
    force: bool,
) -> str | None:
    if force:
        return "force"

    if not row.get("embedding"):
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
) -> list[PaperCandidate]:
    candidates: list[PaperCandidate] = []

    for row in supabase.select_papers(table_limit):
        text = embedding_text(row)

        if not text:
            continue

        text_hash = content_hash(text)
        reason = stale_reason(row, model_name, text_hash, force)

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
            break

    return candidates


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


def main() -> None:
    load_local_env()
    args = parse_args()
    supabase = PaperEmbeddingClient()
    candidates = load_candidates(
        supabase=supabase,
        model_name=args.model,
        limit=args.limit,
        table_limit=args.table_limit,
        force=args.force,
    )

    if args.dry_run:
        print(
            json.dumps(
                {
                    "mode": "dry-run",
                    "model": args.model,
                    "inspected": args.table_limit,
                    "candidates": len(candidates),
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
        print(
            json.dumps(
                {
                    "mode": "write",
                    "model": args.model,
                    "embedded": 0,
                },
            ),
        )
        return

    model = load_model(args.model)
    encoded = model.encode(
        [candidate.text for candidate in candidates],
        batch_size=args.batch_size,
        normalize_embeddings=True,
        show_progress_bar=not args.quiet,
    )
    embeddings = [embedding.tolist() for embedding in encoded]
    write_embeddings(supabase, candidates, embeddings, args.model)

    print(
        json.dumps(
            {
                "mode": "write",
                "model": args.model,
                "embedded": len(candidates),
            },
        ),
    )


if __name__ == "__main__":
    main()
