#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"
EMBEDDING_DIMENSION = 384


@dataclass(frozen=True)
class PaperCandidate:
    id: str
    title: str
    abstract: str
    text: str
    content_hash: str
    stale_reason: str


def load_local_env(path: Path = Path(".env.local")) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


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


def require_env(name: str) -> str:
    value = os.getenv(name)

    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")

    return value


class SupabaseRestClient:
    def __init__(self) -> None:
        self.base_url = require_env("NEXT_PUBLIC_SUPABASE_URL").rstrip("/")
        self.service_role_key = require_env("SUPABASE_SERVICE_ROLE_KEY")

    def headers(self, prefer: str | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        if prefer:
            headers["Prefer"] = prefer

        return headers

    def request_json(
        self,
        path: str,
        query: dict[str, str],
        method: str = "GET",
        payload: dict[str, Any] | None = None,
        prefer: str | None = None,
    ) -> Any:
        encoded_query = urllib.parse.urlencode(query)
        url = f"{self.base_url}/rest/v1/{path}"

        if encoded_query:
            url = f"{url}?{encoded_query}"

        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            url,
            data=body,
            headers=self.headers(prefer=prefer),
            method=method,
        )

        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                response_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            error_body = error.read().decode("utf-8")
            raise RuntimeError(f"Supabase REST error {error.code}: {error_body}") from error

        if not response_body:
            return None

        return json.loads(response_body)

    def select_papers(self, table_limit: int) -> list[dict[str, Any]]:
        return self.request_json(
            "papers",
            {
                "select": "id,title,abstract,embedding,embedding_model,embedding_content_hash,ingested_at",
                "order": "ingested_at.desc",
                "limit": str(table_limit),
            },
        )

    def update_paper_embedding(self, paper_id: str, payload: dict[str, Any]) -> None:
        self.request_json(
            "papers",
            {"id": f"eq.{paper_id}"},
            method="PATCH",
            payload=payload,
            prefer="return=minimal",
        )


def embedding_text(row: dict[str, Any]) -> str:
    title = str(row.get("title") or "").strip()
    abstract = str(row.get("abstract") or "").strip()

    return f"{title}\n\n{abstract}".strip()


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def stale_reason(row: dict[str, Any], model_name: str, text_hash: str, force: bool) -> str | None:
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
    supabase: SupabaseRestClient,
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


def load_model(model_name: str) -> Any:
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model_name)


def vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def write_embeddings(
    supabase: SupabaseRestClient,
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
    supabase = SupabaseRestClient()
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
