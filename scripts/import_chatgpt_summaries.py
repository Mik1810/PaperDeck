# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from embedding_common import SupabaseRestClient, load_local_env

MODEL_LABEL = "chatgpt:manual"
REQUIRED_FIELDS = ("why_it_matters", "main_contribution", "prerequisites", "read_if_you_care_about")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _extract_array(text: str) -> list[dict[str, Any]]:
    text = text.strip()
    fence_match = re.search(r"```(?:json)?\s*\n?([\s\S]*?)```", text)

    if fence_match:
        text = fence_match.group(1).strip()

    start = text.find("[")
    end = text.rfind("]")

    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON array found in input")

    return json.loads(text[start : end + 1])  # type: ignore[no-any-return]


def load_input(path: str) -> list[dict[str, Any]]:
    with open(path) as fh:
        raw = fh.read()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = _extract_array(raw)

    if isinstance(data, dict):
        data = [data]

    if not isinstance(data, list):
        raise ValueError(f"Expected JSON array, got {type(data).__name__}")

    return data  # type: ignore[no-any-return]


def validate_item(item: dict[str, Any], idx: int) -> list[str]:
    errors = []
    arxiv_id = item.get("arxiv_id") or "N/A"
    title = item.get("title", "") or arxiv_id

    if not item.get("arxiv_id"):
        errors.append(f"missing arxiv_id")

    for field in REQUIRED_FIELDS:
        val = item.get(field)

        if not isinstance(val, str) or not val.strip():
            errors.append(f"missing or empty '{field}'")
            break

    return errors


def main() -> None:
    load_local_env()

    parser = argparse.ArgumentParser(
        description="Import ChatGPT-generated summaries into Supabase.",
    )
    parser.add_argument(
        "input",
        help="JSON file with ChatGPT output (array of summary objects).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate only, do not write to database.",
    )
    parser.add_argument(
        "--model",
        default=MODEL_LABEL,
        help=f"Model label to store (default: {MODEL_LABEL}).",
    )
    args = parser.parse_args()

    items = load_input(args.input)
    print(f"Loaded {len(items)} items from {args.input}")

    supabase = SupabaseRestClient()
    ok = 0
    skipped = 0
    failed = 0

    for idx, item in enumerate(items):
        arxiv_id = item.get("arxiv_id") or "N/A"
        errors = validate_item(item, idx)

        if errors:
            print(f"  [{idx+1}/{len(items)}] {arxiv_id}... INVALID: {'; '.join(errors)}")
            skipped += 1
            continue

        if args.dry_run:
            print(f"  [{idx+1}/{len(items)}] {arxiv_id}... VALID (dry-run)")
            ok += 1
            continue

        try:
            rows = supabase.request_json(
                "papers",
                {
                    "select": "id,triage_summary",
                    "arxiv_id": f"eq.{arxiv_id}",
                },
            )

            if not rows or not isinstance(rows, list) or len(rows) == 0:
                print(f"  [{idx+1}/{len(items)}] {arxiv_id}... NOT FOUND in DB")
                failed += 1
                continue

            if rows[0].get("triage_summary"):
                print(f"  [{idx+1}/{len(items)}] {arxiv_id}... SKIPPED (already has summary)")
                skipped += 1
                continue

            paper_id = rows[0]["id"]
            summary = {
                "why_it_matters": item["why_it_matters"].strip(),
                "main_contribution": item["main_contribution"].strip(),
                "prerequisites": item["prerequisites"].strip(),
                "read_if_you_care_about": item["read_if_you_care_about"].strip(),
            }

            supabase.request_json(
                "papers",
                {"id": f"eq.{paper_id}"},
                method="PATCH",
                payload={
                    "triage_summary": summary,
                    "triage_summary_model": args.model,
                    "triage_summary_generated_at": utc_now(),
                },
                prefer="return=minimal",
            )

            print(f"  [{idx+1}/{len(items)}] {arxiv_id}... OK")
            ok += 1
        except Exception as exc:
            print(f"  [{idx+1}/{len(items)}] {arxiv_id}... FAILED: {exc}")
            failed += 1

    print(f"\nDone. {ok} OK, {skipped} skipped, {failed} failed ({len(items)} total)")


if __name__ == "__main__":
    main()
