#!/usr/bin/env python3
"""Offline embedding benchmark — no DB writes, all vectors in RAM.

Compares BAAI/bge-small-en-v1.5, intfloat/e5-small-v2, and all-MiniLM-L6-v2
using arXiv category overlap as a proxy for retrieval quality.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Any

from embedding_common import DEFAULT_MODEL, SupabaseRestClient, load_local_env, load_model


MODELS = [
    "BAAI/bge-small-en-v1.5",
    "intfloat/e5-small-v2",
    "sentence-transformers/all-MiniLM-L6-v2",
]

TOP_K = 20


@dataclass
class TopicInfo:
    id: str
    label: str
    slug: str
    arxiv_category: str | None
    parent_label: str


@dataclass
class PaperInfo:
    id: str
    title: str
    abstract: str
    arxiv_categories: list[str]


@dataclass
class ModelResult:
    model: str
    topics_encoded: int = 0
    papers_encoded: int = 0
    encode_topics_ms: float = 0
    encode_papers_ms: float = 0
    dim: int = 384
    mean_category_overlap: float = 0.0
    median_category_overlap: float = 0.0
    per_topic_scores: dict[str, float] = field(default_factory=dict)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def build_topic_text(
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


def build_paper_text(row: dict[str, Any]) -> str:
    title = str(row.get("title") or "").strip()
    abstract = str(row.get("abstract") or "").strip()
    return f"{title}\n\n{abstract}"


def load_data() -> tuple[list[TopicInfo], list[PaperInfo]]:
    supabase = SupabaseRestClient()
    topics_raw = supabase.request_json(
        "taxonomy_topics",
        {"select": "id,slug,label,parent_id,arxiv_category", "order": "slug.asc"},
    )
    papers_raw = supabase.request_json(
        "papers",
        {
            "select": "id,title,abstract,paper_topics(taxonomy_topics(id,slug,label,arxiv_category))",
            "source": "eq.arxiv",
            "order": "ingested_at.desc",
            "limit": "500",
        },
    )

    topics_by_id = {t["id"]: t for t in topics_raw}
    topics = []
    for t in topics_raw:
        text = build_topic_text(t, topics_by_id)
        if not text.strip():
            continue
        parent = topics_by_id.get(t.get("parent_id")) if t.get("parent_id") else None
        topics.append(
            TopicInfo(
                id=t["id"],
                label=t["label"],
                slug=t["slug"],
                arxiv_category=t.get("arxiv_category"),
                parent_label=parent.get("label", "") if parent else "",
            )
        )

    papers = []
    for p in papers_raw:
        text = build_paper_text(p)
        if not text.strip():
            continue
        arxiv_cats = _extract_paper_categories(p, topics_raw)
        papers.append(
            PaperInfo(
                id=p["id"],
                title=p["title"],
                abstract=p.get("abstract") or "",
                arxiv_categories=arxiv_cats,
            )
        )

    return topics, papers


def _extract_paper_categories(
    paper: dict[str, Any],
    topics_raw: list[dict[str, Any]],
) -> list[str]:
    cats: list[str] = []
    paper_topics = paper.get("paper_topics", [])
    if not isinstance(paper_topics, list):
        return cats
    for pt in paper_topics:
        tt = pt.get("taxonomy_topics")
        if not tt:
            continue
        if isinstance(tt, list):
            tt = tt[0] if tt else None
        if not isinstance(tt, dict):
            continue
        cat = (tt.get("arxiv_category") or "").strip()
        if cat:
            cats.append(cat)
    return cats


def benchmark_model(
    model_name: str,
    topics: list[TopicInfo],
    papers: list[PaperInfo],
    top_k: int = 20,
) -> ModelResult:
    result = ModelResult(model=model_name)
    print(f"\n{'='*60}")
    print(f"Benchmarking: {model_name}")
    print(f"{'='*60}")

    print("Loading model...")
    model = load_model(model_name)
    dim = model.get_sentence_embedding_dimension() or 384
    result.dim = dim

    print(f"Encoding {len(topics)} topics...")
    t0 = time.time()
    topic_texts = [_full_topic_text(t) for t in topics]
    topic_vectors = model.encode(
        topic_texts,
        normalize_embeddings=True,
        show_progress_bar=True,
    )
    result.encode_topics_ms = (time.time() - t0) * 1000
    result.topics_encoded = len(topics)

    print(f"Encoding {len(papers)} papers...")
    t0 = time.time()
    paper_texts = [f"{p.title}\n\n{p.abstract}" for p in papers]
    paper_vectors = model.encode(
        paper_texts,
        normalize_embeddings=True,
        show_progress_bar=True,
    )
    result.encode_papers_ms = (time.time() - t0) * 1000
    result.papers_encoded = len(papers)

    topics_with_cat = [
        (i, t) for i, t in enumerate(topics) if t.arxiv_category
    ]

    if not topics_with_cat:
        print("No topics with arxiv_category — skipping recall evaluation")
        return result

    scores: list[float] = []
    for topic_idx, topic in topics_with_cat:
        tv = topic_vectors[topic_idx]
        sims = [
            (cosine_similarity(tv.tolist(), pv.tolist()), pi)
            for pi, pv in enumerate(paper_vectors)
        ]
        sims.sort(key=lambda x: x[0], reverse=True)
        top_papers = [papers[pi] for _, pi in sims[:top_k]]
        overlap = sum(
            1 for p in top_papers if topic.arxiv_category in p.arxiv_categories
        )
        score = overlap / top_k
        scores.append(score)
        result.per_topic_scores[topic.slug] = round(score, 3)

    result.mean_category_overlap = sum(scores) / len(scores) if scores else 0.0
    result.median_category_overlap = _median(scores) if scores else 0.0

    return result


def _full_topic_text(topic: TopicInfo) -> str:
    parts = [topic.label]
    if topic.parent_label:
        parts.append(f"Parent topic: {topic.parent_label}")
    if topic.arxiv_category:
        parts.append(f"arXiv category: {topic.arxiv_category}")
    return "\n".join(parts)


def _median(values: list[float]) -> float:
    s = sorted(values)
    n = len(s)
    if n == 0:
        return 0.0
    if n % 2 == 1:
        return s[n // 2]
    return (s[n // 2 - 1] + s[n // 2]) / 2.0


def print_table(results: list[ModelResult], top_k: int = 20) -> None:
    print(f"\n{'='*80}")
    print("BENCHMARK RESULTS")
    print(f"{'='*80}")
    header = (
        f"{'Model':<45} {'Dim':>5} {'Topics':>7} {'Papers':>7} "
        f"{'T-enc(s)':>9} {'P-enc(s)':>9} {'Rec@20':>7} {'Med@20':>7}"
    )
    print(header)
    print("-" * len(header))

    best_recall = max(r.mean_category_overlap for r in results)
    for r in sorted(results, key=lambda x: x.mean_category_overlap, reverse=True):
        star = " *" if r.mean_category_overlap == best_recall else "  "
        print(
            f"{r.model:<45} {r.dim:>5d} {r.topics_encoded:>7d} {r.papers_encoded:>7d} "
            f"{r.encode_topics_ms/1000:>9.1f} {r.encode_papers_ms/1000:>9.1f} "
            f"{r.mean_category_overlap:>7.3f} {r.median_category_overlap:>7.3f}{star}"
        )

    print(f"\n* best category overlap (arXiv category match as proxy for relevance)")
    print(f"  Rec@20 = fraction of top-{top_k} papers in same arXiv category as the topic")

    if len(results) >= 2:
        current = results[0]
        for r in results[1:]:
            improvement = (r.mean_category_overlap - current.mean_category_overlap) / max(current.mean_category_overlap, 0.001) * 100
            print(f"\n  {r.model.split('/')[-1]} vs {current.model.split('/')[-1]}: {improvement:+.1f}% change in category overlap")


def main() -> None:
    load_local_env()
    parser = argparse.ArgumentParser(description="Offline embedding benchmark")
    parser.add_argument("--models", nargs="*", help="Models to benchmark (default: all 3)")
    parser.add_argument("--top-k", type=int, default=TOP_K)
    args = parser.parse_args()

    models = args.models if args.models else MODELS
    top_k = args.top_k

    print("Loading topic and paper data from Supabase (read-only)...")
    topics, papers = load_data()
    print(f"Topics: {len(topics)} (with category: {sum(1 for t in topics if t.arxiv_category)})")
    print(f"Papers: {len(papers)}")

    results: list[ModelResult] = []
    for model_name in models:
        result = benchmark_model(model_name, topics, papers, top_k)
        results.append(result)

    print_table(results, top_k)

    print("\n" + json.dumps(
        {r.model: {"mean": round(r.mean_category_overlap, 3), "median": round(r.median_category_overlap, 3)} for r in results},
        indent=2,
    ))


if __name__ == "__main__":
    main()
