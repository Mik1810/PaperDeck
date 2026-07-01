# Embedding And Ranked Retrieval Workflow

PaperDeck uses embeddings as an offline batch layer, not as a live Vercel runtime dependency.

The goal is to keep Vercel lightweight: the web app should query already-computed vectors from Supabase/pgvector and run only cheap TypeScript reranking. Model loading and embedding generation run outside Vercel, initially through GitHub Actions or a local script.

## Decision

Initial embedding model:

```text
BAAI/bge-small-en-v1.5
```

Baseline models to benchmark later:

```text
intfloat/e5-small-v2
sentence-transformers/all-MiniLM-L6-v2
```

Reasons for starting with BGE-small:

- 384-dimensional output, matching the current `papers.embedding vector(384)` schema;
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
  -> load BGE-small
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

Topic labels, arXiv categories, citation counts, and recency should stay outside the model input for now. They are structured reranking signals, not semantic text.

## Paper Embedding Output

For each embedded paper, the worker writes:

```sql
papers.embedding
papers.embedding_model
papers.embedding_dimension
papers.embedded_at
```

The next schema addition should also add:

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
```

Optional later input:

```text
<topic label>
Parent topic: <parent label>
arXiv category: <category>
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

## Paper Batch Selection

The embedding worker should process papers where:

```sql
embedding is null
or embedding_model != 'BAAI/bge-small-en-v1.5'
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
5. BGE-small computes vectors
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

## GitHub Actions Workflow

Recommended workflow:

```text
.github/workflows/embed-papers.yml
```

Triggers:

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: "30 3 * * *"
```

Required secrets:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Recommended cache paths:

```text
~/.cache/huggingface
~/.cache/pip
```

Initial command:

```bash
python scripts/embed_papers.py --model BAAI/bge-small-en-v1.5 --batch-size 64 --limit 256
```

For public repositories, standard GitHub-hosted runners are free. Do not use larger/GPU runners unless we explicitly accept paid usage.

## Implementation Steps

1. Add schema support:
   - `papers.embedding_content_hash`;
   - `topic_embeddings`;
   - `user_profile_embeddings`.
2. Add Python dependency files for the embedding worker.
3. Add `scripts/embed_papers.py`.
4. Add local dry-run mode.
5. Add GitHub Actions workflow with HuggingFace and pip caching.
6. Verify on a tiny batch against Supabase.
7. Add TypeScript retrieval repository using pgvector top-K.
8. Blend semantic retrieval with the existing `src/lib/ranking/feed-ranking.ts` reranker.
9. Update benchmark plan for BGE-small vs E5-small-v2 vs MiniLM.

## Non-Goals For MVP

- No live model inference on Vercel.
- No GPU requirement.
- No full-text/PDF embedding.
- No paid embedding API.
- No user-specific model fine-tuning.
