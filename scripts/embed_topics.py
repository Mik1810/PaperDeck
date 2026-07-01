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
class TopicCandidate:
    id: str
    slug: str
    label: str
    text: str
    content_hash: str
    stale_reason: str


class TopicEmbeddingClient(SupabaseRestClient):
    def select_topics(self, table_limit: int) -> list[dict[str, Any]]:
        return self.request_json(
            "taxonomy_topics",
            {
                "select": "id,slug,label,parent_id,source,arxiv_category,depth,sort_order,created_at",
                "order": "depth.asc,sort_order.asc,created_at.asc",
                "limit": str(table_limit),
            },
        )

    def select_topic_embeddings(self, model_name: str) -> list[dict[str, Any]]:
        return self.request_json(
            "topic_embeddings",
            {
                "select": "topic_id,embedding_model,embedding_content_hash,embedded_at",
                "embedding_model": f"eq.{model_name}",
            },
        )

    def upsert_topic_embedding(self, payload: dict[str, Any]) -> None:
        self.request_json(
            "topic_embeddings",
            {"on_conflict": "topic_id,embedding_model"},
            method="POST",
            payload=payload,
            prefer="resolution=merge-duplicates,return=minimal",
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Embed PaperDeck taxonomy topics with a local sentence-transformers model.",
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
        default=int(os.getenv("EMBEDDING_TOPIC_LIMIT", "256")),
        help="Maximum number of topics to embed in this run.",
    )
    parser.add_argument(
        "--table-limit",
        type=int,
        default=int(os.getenv("EMBEDDING_TOPIC_TABLE_LIMIT", "0")),
        help="Maximum topic rows to inspect before local stale filtering. Defaults to max(limit * 4, 100).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List candidate topics without loading the model or writing embeddings.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Embed inspected topics even when hash metadata already match.",
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


def topic_embedding_text(
    row: dict[str, Any],
    topics_by_id: dict[str, dict[str, Any]],
) -> str:
    lines = [str(row.get("label") or "").strip()]
    parent_id = row.get("parent_id")
    parent = topics_by_id.get(parent_id) if parent_id else None
    parent_label = str(parent.get("label") or "").strip() if parent else ""
    arxiv_category = str(row.get("arxiv_category") or "").strip()

    if parent_label:
        lines.append(f"Parent topic: {parent_label}")

    if arxiv_category:
        lines.append(f"arXiv category: {arxiv_category}")

    return "\n".join(line for line in lines if line).strip()


def stale_reason(
    existing_embedding: dict[str, Any] | None,
    text_hash: str,
    force: bool,
) -> str | None:
    if force:
        return "force"

    if not existing_embedding:
        return "missing_embedding"

    if existing_embedding.get("embedding_content_hash") != text_hash:
        return "content_changed"

    return None


def load_candidates(
    supabase: TopicEmbeddingClient,
    model_name: str,
    limit: int,
    table_limit: int,
    force: bool,
) -> list[TopicCandidate]:
    topics = supabase.select_topics(table_limit)
    topics_by_id = {topic["id"]: topic for topic in topics}
    existing_by_topic_id = {
        row["topic_id"]: row for row in supabase.select_topic_embeddings(model_name)
    }
    candidates: list[TopicCandidate] = []

    for row in topics:
        text = topic_embedding_text(row, topics_by_id)

        if not text:
            continue

        text_hash = content_hash(text)
        reason = stale_reason(existing_by_topic_id.get(row["id"]), text_hash, force)

        if not reason:
            continue

        candidates.append(
            TopicCandidate(
                id=row["id"],
                slug=row["slug"],
                label=row["label"],
                text=text,
                content_hash=text_hash,
                stale_reason=reason,
            ),
        )

        if len(candidates) >= limit:
            break

    return candidates


def write_embeddings(
    supabase: TopicEmbeddingClient,
    candidates: list[TopicCandidate],
    embeddings: list[list[float]],
    model_name: str,
) -> None:
    embedded_at = utc_now()

    for candidate, embedding in zip(candidates, embeddings, strict=True):
        if len(embedding) != EMBEDDING_DIMENSION:
            raise RuntimeError(
                f"Model produced {len(embedding)} dimensions, expected {EMBEDDING_DIMENSION}",
            )

        supabase.upsert_topic_embedding(
            {
                "topic_id": candidate.id,
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
    supabase = TopicEmbeddingClient()
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
                    "topics": [
                        {
                            "id": candidate.id,
                            "slug": candidate.slug,
                            "label": candidate.label,
                            "staleReason": candidate.stale_reason,
                        }
                        for candidate in candidates[:20]
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
