# Embedding And Ranked Retrieval Workflow

PaperDeck uses embeddings as an offline batch layer, not as a live Vercel runtime dependency.

The goal is to keep Vercel lightweight: the web app should query already-computed vectors from Supabase/pgvector and run only cheap TypeScript reranking. Model loading and embedding generation run outside Vercel, initially through GitHub Actions or a local script.

## Decision

Current embedding model:

```text
sentence-transformers/all-MiniLM-L6-v2
```

Historical benchmark baselines:

```text
BAAI/bge-small-en-v1.5
intfloat/e5-small-v2
```

Reasons for using MiniLM now:

- 384-dimensional output, matching the current `papers.embedding vector(384)` schema;
- strongest offline result so far (+17.4% Rec@20 versus BGE-small on the 2026-07-02 benchmark);
- faster paper encoding than the BGE-small baseline in the same benchmark;
- reasonable quality for English retrieval;
- feasible on CPU for small batches;
- no paid API dependency;
- compatible with `sentence-transformers`.

## Runtime Boundary

### Runs On GitHub Actions Or Locally

Python embedding jobs run as batch jobs:

```text
GitHub Actions / local machine
  -> load Python dependencies
  -> restore model/cache when available
  -> load MiniLM
  -> read papers needing embeddings from Supabase
  -> compute vectors
  -> write vectors back to Supabase
  -> terminate
```

The model is not continuously hosted. Each workflow run gets a temporary machine, loads or restores the model, processes a batch, writes to Supabase, then exits.

### Runs On Vercel

Vercel only handles:

- authenticated app requests;
- profile and interaction reads;
- pgvector retrieval queries;
- TypeScript reranking;
- rendering the feed and details.

Vercel must not import `torch`, `sentence-transformers`, or model files.

## Current Implementation

Implemented files:

```text
supabase/migrations/20260701203000_add_embedding_workflow_tables.sql
supabase/migrations/20260701211500_add_embedding_match_function.sql
requirements-embeddings.txt
scripts/embedding_common.py
scripts/embed_papers.py
scripts/embed_topics.py
.github/workflows/embed-papers.yml
src/lib/repositories/semantic-retrieval.ts
src/lib/repositories/user-profile-embeddings.ts
```

Current status:

- schema support has been added and applied to Supabase;
- `papers.embedding_content_hash` exists;
- `topic_embeddings` and `user_profile_embeddings` exist with RLS enabled;
- `scripts/embedding_common.py` shares Supabase REST access, hashing, model loading, and pgvector formatting between workers;
- `scripts/embed_papers.py` supports real Supabase candidate selection over REST;
- `scripts/embed_topics.py` supports real Supabase candidate selection and upserts for `topic_embeddings`;
- `--dry-run` lists stale/missing topic and paper embeddings without loading the model;
- `match_papers_by_embedding` is installed in Supabase for pgvector top-K retrieval;
- `src/lib/repositories/semantic-retrieval.ts` loads the current user profile vector and calls the pgvector RPC;
- `src/lib/repositories/user-profile-embeddings.ts` can refresh a user vector from stored topic/paper embeddings without loading any model;
- `sentence-transformers/all-MiniLM-L6-v2` is the default model in the Python workers, GitHub Actions workflow, profile aggregation repository, and pgvector RPC;
- `/feed` uses semantic candidates when a user profile embedding exists and falls back to the current topic/feedback ranking otherwise;
- `/feed` does not refresh the stored user profile embedding on the normal read path; profile refresh should move to refresh-on-write or a background worker;
- a first real local BGE-small smoke batch wrote 2 topic vectors and 1 paper vector before the MiniLM decision; those rows are historical baseline data, not the current default;
- the 2026-07-03 MiniLM backfill verified 571 MiniLM paper rows, 66 MiniLM topic rows, and 2 MiniLM user profile rows in Supabase;
- GitHub Actions has been verified with both dry-run and tiny write-mode batches.

## Paper Embedding Input

For MVP, paper embeddings use only descriptive metadata that PaperDeck is already allowed to store:

```text
title
abstract
```

Recommended input format:

```text
<title>

<abstract>
```

Do not embed full PDFs in the MVP. Full text/RAG is a later feature and should only use open-access content with clear licensing.

For paper embeddings, topic labels, arXiv categories, citation counts, and recency should stay outside the model input for now. They are structured reranking signals, not semantic text.

## Paper Embedding Output

For each embedded paper, the worker writes:

```sql
papers.embedding
papers.embedding_model
papers.embedding_dimension
papers.embedded_at
```

The current schema also stores:

```sql
papers.embedding_content_hash
```

This hash should be computed from the exact embedding input text. If the title or abstract changes, the hash changes and the paper becomes eligible for re-embedding.

## Topic Embeddings

To build user vectors without loading the model on Vercel, topic labels should also be embedded offline.

Recommended table:

```sql
topic_embeddings (
  topic_id uuid references taxonomy_topics(id) on delete cascade,
  embedding vector(384) not null,
  embedding_model text not null,
  embedding_dimension integer not null,
  embedding_content_hash text not null,
  embedded_at timestamptz not null default now(),
  primary key (topic_id, embedding_model)
)
```

Topic embedding input:

```text
<topic label>
Parent topic: <parent label>
arXiv category: <category>
```

The parent and arXiv lines are included only when available.

Current implementation:

```text
scripts/embed_topics.py
  -> reads taxonomy_topics
  -> reads existing topic_embeddings for the selected model
  -> hashes the exact topic embedding input
  -> selects missing or stale topic vectors
  -> supports --dry-run without loading sentence-transformers
  -> upserts topic_embeddings when writing real vectors
```

## User Profile Embeddings

Vercel should not call the embedding model for each user request.

Instead, PaperDeck should build a user vector from existing vectors:

```text
user_embedding =
  weighted average(
    selected topic embeddings,
    favorited paper embeddings,
    read-later paper embeddings,
    opened paper embeddings
  )
  minus / downweight negative feedback vectors
```

Initial weights:

```text
selected topic       4.0
favorite paper       6.0
read later paper     5.0
read paper           3.0
open detail paper    2.0
not interested      -5.0
dismiss             -4.0
already read         exclude from feed, no negative topic penalty by default
```

The vector should be normalized after aggregation.

Recommended table:

```sql
user_profile_embeddings (
  owner_id text not null references profiles(owner_id) on delete cascade,
  embedding vector(384) not null,
  embedding_model text not null,
  embedding_dimension integer not null,
  input_signature text not null,
  generated_at timestamptz not null default now(),
  primary key (owner_id, embedding_model)
)
```

`input_signature` should represent selected topic IDs and recent interaction IDs/timestamps. If it changes, the profile vector is stale.

Current implementation:

```text
src/lib/repositories/user-profile-embeddings.ts
  -> reads selected user_interests
  -> reads topic_embeddings for selected topics
  -> reads favorite, Read later, and recent interaction paper IDs
  -> reads paper embeddings for those papers
  -> computes a normalized weighted vector
  -> upserts user_profile_embeddings when the input signature changes
  -> clears stale user_profile_embeddings if no source vectors are available
```

If no weighted source vectors exist yet, the refresh removes any stale stored vector and the feed keeps using the non-semantic fallback ranking.

## Paper Batch Selection

The embedding worker should process papers where:

```sql
embedding is null
or embedding_model != 'sentence-transformers/all-MiniLM-L6-v2'
or embedding_content_hash != current_hash(title, abstract)
```

The first implementation can start simpler:

```sql
where embedding is null
limit :batch_size
```

Then add content hashes once the first embedding pipeline works.

## New Paper Flow

Daily flow:

```text
1. arXiv ingestion worker runs
2. new/updated papers are upserted into Supabase
3. those rows have embedding = null or stale hash
4. embedding worker selects them
5. MiniLM computes vectors
6. worker writes embeddings to Supabase
7. feed retrieval can use them
```

If a paper is imported before its embedding exists, it can still appear through the current topic/feedback ranking. Once the embedding job completes, it becomes eligible for semantic retrieval.

## Retrieval Flow

When a user opens the feed:

```text
1. Load or compute user profile embedding from stored vectors.
2. Use pgvector to retrieve top-K candidate papers by cosine similarity.
3. Exclude papers already opened, dismissed, marked not interested, read, or already read.
4. Apply TypeScript reranking:
   - topic match;
   - explicit feedback;
   - freshness;
   - citations;
   - classic cap;
   - saved/favorite state.
5. Return the first card and the next few candidates.
```

Target SQL shape:

```sql
select
  papers.*,
  1 - (papers.embedding <=> :user_embedding) as semantic_score
from papers
where papers.embedding is not null
order by papers.embedding <=> :user_embedding
limit 100;
```

Implemented RPC:

```sql
match_papers_by_embedding(
  query_embedding vector(384),
  match_count integer default 100,
  embedding_model_filter text default 'sentence-transformers/all-MiniLM-L6-v2'
)
```

Current TypeScript integration:

```text
src/lib/repositories/semantic-retrieval.ts
  -> loads latest user_profile_embeddings row
  -> calls match_papers_by_embedding
  -> loads matched Paper rows
  -> returns semantic scores and retrieval diagnostics to the existing reranker
```

If no user profile embedding exists, or if the semantic candidate set is empty after filtering seen papers, PaperDeck falls back to the topic/feedback ranking over the shared catalog.

`/feed` logs a structured `feed_timing` event with semantic retrieval diagnostics:

- whether semantic retrieval was used;
- requested match count;
- whether the pgvector RPC was attempted;
- RPC match count;
- loaded candidate paper count;
- embedding model name;
- fallback reason, including profile-missing, refresh failure, no matches, missing paper rows, or reranker filtering all candidates;
- profile refresh status/reason when the feed lazily tries to build a missing user profile vector.

The final displayed score should be a hybrid score:

```text
final_score =
  semantic_similarity * 0.60
  + topic_match_score * 0.20
  + feedback_score * 0.12
  + freshness_score * 0.04
  + citation_score * 0.03
  + classic_score * 0.01
  - seen_or_negative_penalties
```

These weights are starting defaults, not final product values. They should be benchmarked after enough real user judgments exist.

## Benchmark Plan

Historical benchmark models:

```text
BAAI/bge-small-en-v1.5
intfloat/e5-small-v2
sentence-transformers/all-MiniLM-L6-v2
```

Evaluation set:

```text
20-50 selected topics
100-300 paper candidates across CS categories
user judgments from right swipe, favorite, Read later, not interested, already read
manual seed judgments for a few known interests while real feedback is sparse
```

Offline protocol:

1. Generate paper embeddings for the same paper set with each model.
2. Generate topic embeddings with the same input template for each model.
3. Build user profile vectors from identical selected topics and interaction weights.
4. Retrieve top-K papers with pgvector for each model.
5. Apply the same TypeScript reranker weights.
6. Compare ranked lists against held-out positive and negative judgments.

Metrics:

```text
Recall@20        useful for discovery coverage
NDCG@20          useful for ranked order quality
MRR@10           useful for whether a strong paper appears early
negative@20      count of not_interested/already_read papers in the top 20
latency          Supabase RPC + reranker time, excluding offline embedding generation
storage          vector table size per model
```

Decision rule:

```text
Keep MiniLM unless another model improves NDCG@20 or Recall@20 by at least 10%
without materially increasing storage, runtime complexity, or GitHub Actions duration.
```

Benchmarking is offline-only. It should not introduce live model inference on Vercel or a paid embedding API.

### Benchmark Results (2026-07-02)

Run locally with `uv run python scripts/benchmark_embeddings.py` on 64 topics (31 with arXiv category) and 447 papers.

| Model | Dim | Enc Topics | Enc Papers | Rec@20 | Med@20 | Delta vs BGE |
|---|---|---|---|---|---|---|
| **all-MiniLM-L6-v2** | 384 | 0.0s | **0.9s** | **0.206** | 0.000 | **+17.4%** |
| BGE-small-v1.5 | 384 | 0.5s | 3.1s | 0.176 | 0.050 | baseline |
| E5-small-v2 | 384 | 0.0s | 2.9s | 0.165 | 0.050 | -6.4% |

**Decision: switch to MiniLM.** It exceeds the 10% improvement threshold on Rec@20 with better speed (3x faster paper encoding).

Rec@20 measures the fraction of top-20 retrieved papers that share the same arXiv category as the query topic, using category overlap as a relevance proxy without manual labels.

## GitHub Actions Workflow

Implemented workflow:

```text
.github/workflows/embed-papers.yml
```

The workflow name is `Embed papers and topics`; the filename remains `embed-papers.yml`.

Triggers:

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: "47 4 * * *"
```

Required secrets:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Optional repository variables:

```text
EMBEDDING_MODEL
EMBEDDING_TOPIC_LIMIT
EMBEDDING_LIMIT
EMBEDDING_BATCH_SIZE
```

Recommended cache paths:

```text
~/.cache/huggingface
~/.cache/pip
```

Current command:

```bash
python scripts/embed_topics.py --model sentence-transformers/all-MiniLM-L6-v2 --batch-size 64 --limit 256
python scripts/embed_papers.py --model sentence-transformers/all-MiniLM-L6-v2 --batch-size 64 --limit 256
```

Local dry-run:

```bash
python3 scripts/embed_topics.py --dry-run --limit 10 --table-limit 100
python3 scripts/embed_papers.py --dry-run --limit 3 --table-limit 20
```

The dry-run does not import `sentence-transformers`; it only needs Supabase environment variables.

Local real smoke run used:

```bash
uv run --isolated --with-requirements requirements-embeddings.txt \
  python scripts/embed_topics.py --limit 2 --table-limit 100 --batch-size 2 --quiet

uv run --isolated --with-requirements requirements-embeddings.txt \
  python scripts/embed_papers.py --limit 1 --table-limit 20 --batch-size 1 --quiet
```

Historical BGE-small smoke result on remote Supabase:

```text
topic_embeddings: 2 rows for BAAI/bge-small-en-v1.5, dimension 384
papers.embedding: 1 row for BAAI/bge-small-en-v1.5, dimension 384
match_papers_by_embedding: returns the embedded paper with semantic_score 1.0 when queried with its own vector
```

Current MiniLM verification on remote Supabase (2026-07-03):

```text
papers.embedding: 571 rows for sentence-transformers/all-MiniLM-L6-v2
topic_embeddings: 66 rows for sentence-transformers/all-MiniLM-L6-v2, plus 66 historical BGE-small rows
user_profile_embeddings: 2 rows for sentence-transformers/all-MiniLM-L6-v2, plus 2 historical BGE-small rows
dry-run candidate checks: 0 stale paper candidates across 1000 inspected rows, 0 stale topic candidates across 512 inspected rows
```

Verified GitHub-hosted runs:

```text
2026-07-02 dry-run
Run: 28576016191
Inputs: dry_run=true, topic_limit=10, limit=3, batch_size=8
Result: success
Output: 10 topic candidates, 3 paper candidates, no vector writes

2026-07-02 tiny write batch
Run: 28576129575
Inputs: dry_run=false, topic_limit=2, limit=1, batch_size=2
Result: success
Output: 2 topic vectors written, 1 paper vector written
RPC check: querying `match_papers_by_embedding` with the embedded paper vector returned the same paper first with semantic_score 1
```

For public repositories, standard GitHub-hosted runners are free. Do not use larger/GPU runners unless we explicitly accept paid usage.

## Implementation Steps

1. Done: add schema support:
   - `papers.embedding_content_hash`;
   - `topic_embeddings`;
   - `user_profile_embeddings`.
2. Done: add Python dependency files for the embedding worker.
3. Done: add `scripts/embed_papers.py`.
4. Done: add local dry-run mode.
5. Done: add GitHub Actions workflow with HuggingFace and pip caching.
6. Done: verify dry-run candidate selection against Supabase.
7. Done: add pgvector top-K RPC.
8. Done: add TypeScript retrieval repository using pgvector top-K.
9. Done: blend semantic candidates with the existing `src/lib/ranking/feed-ranking.ts` reranker.
10. Done: build user profile embedding generation from stored topic and paper vectors.
11. Done: add topic embedding generation so cold-start users can get semantic profile vectors from selected interests.
12. Done: run a tiny real embedding batch from a local Python environment with `sentence-transformers` managed by `uv`.
13. Done: update benchmark plan for BGE-small vs E5-small-v2 vs MiniLM.
14. Done: verify GitHub Actions dry-run and tiny write-mode batches.
15. Done: run broader MiniLM topic and paper embedding batches through local `uv`.
16. Next: move user profile embedding refresh to refresh-on-write or a background worker.

## Non-Goals For MVP

- No live model inference on Vercel.
- No GPU requirement.
- No full-text/PDF embedding.
- No paid embedding API.
- No user-specific model fine-tuning.
