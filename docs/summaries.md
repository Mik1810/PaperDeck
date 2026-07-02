# Triage Summary Storage Strategy

Last updated: 2026-07-02

## Current approach (Session 8)

Triage summaries are stored as a JSONB column (`triage_summary`) inline on the `papers` table, alongside `triage_summary_model` and `triage_summary_generated_at` metadata columns. At the current scale (~447 papers, ~7 summaries so far) this is optimal: it's simple, requires no joins, and the overhead is negligible.

## Query-level optimization (Session 8)

As of Session 8, the catalog repository (`src/lib/repositories/catalog.ts`) splits paper selection into two variants:

| Select variant | Columns | Used by |
|---|---|---|
| `paperSelectSimple` | All paper columns **except** `triage_summary` | Feed candidates, library, favorites, read later |
| `paperSelectWithSummary` | All columns including `triage_summary` | Paper detail page (single paper) |

This means bulk queries (feed semantic candidates, library pages, favorites lists) no longer drag the summary JSONB over the wire. The detail page — the only place summaries are displayed — still includes the column.

The `getPapersByIds()` function accepts an `includeSummary` boolean option (default `false`). Only `getPaperDetailData()` in `user-data.ts` passes `includeSummary: true`.

**Impact at 10K papers with 5KB summaries per paper:**
- Feed candidate query (200 papers): saves ~1 MB of JSONB transfer
- Favorites query (100 papers): saves ~500 KB
- Library query (all papers): saves ~50 MB in worst case

This optimization preserves the simplicity of inline storage while eliminating the performance concern for the feed path — which was the primary scaling worry.

## Scaling triggers and migration plan

### When to stay inline

The current approach (JSONB inline on `papers` + query-level column exclusion) is the right choice when:

- Paper count with summaries is under 5,000.
- The `papers` table row size stays under 2 KB on average (Postgres performs well with rows up to 8 KB).

### Trigger threshold: 5,000 papers with summaries

When the number of papers with a non-null `triage_summary` exceeds 5,000, execute the migration below. This is expected to happen ~3-6 months after daily summary generation is fully operational.

### Migration to `paper_summaries` table

**Step 1 — Create the table and backfill:**

```sql
create table paper_summaries (
  paper_id uuid not null references papers(id) on delete cascade,
  summary jsonb not null,
  model text not null,
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (paper_id)
);

create index idx_paper_summaries_generated_at on paper_summaries (generated_at);

insert into paper_summaries (paper_id, summary, model, generated_at)
select id, triage_summary, triage_summary_model, triage_summary_generated_at
from papers
where triage_summary is not null;
```

**Step 2 — Update the summary worker (`scripts/generate-summaries.ts`):**

Replace the `updatePaper()` function that writes to `papers.triage_summary` with an insert/upsert into `paper_summaries`. The worker already tracks model and timestamp — these map directly to the new table columns.

**Step 3 — Update the catalog repository:**

- Add a `getPaperSummary(paperId: string)` function that queries `paper_summaries` by `paper_id`.
- Change `getPaperDetailData()` to call `getPaperSummary()` instead of using `includeSummary: true` on `getPapersByIds()`.
- Remove `paperSelectWithSummary` entirely — all queries use `paperSelectSimple`.

**Step 4 — Drop old columns (after verification):**

```sql
alter table papers
  drop column triage_summary,
  drop column triage_summary_model,
  drop column triage_summary_generated_at;
```

## Rejected alternatives

| Approach | Rejected because |
|---|---|
| **External cache (Redis/Edge Functions)** | Adds infrastructure complexity; summaries are read-only after generation and don't benefit from KV caching over Postgres; would need cache warming on detail page loads. |
| **TOAST compression** | PostgreSQL's TOAST mechanism compresses rows >2 KB, but typical summaries (~500 bytes - 5 KB) are too small to trigger it. Wouldn't address the query overhead of fetching summaries with every bulk query. |
| **Accept current approach indefinitely** | The query-level split implemented in Session 8 already addresses the immediate concern. At 10K+ summaries (~50 MB) the `papers` table would be fine, but a separate table provides cleaner separation of concerns, easier model migrations, and index-only access for the worker. |

## Model versioning

The `paper_summaries` table stores `model` and `generated_at`, which allows:

- Tracking which model version produced each summary.
- Regenerating summaries in batches when the model or prompt changes, without touching the `papers` table.
- A/B testing summary formats by model column.

This capability is not needed at current scale but becomes valuable when 500+ summaries exist and the prompt/model needs updating.

## Decision summary

| Context | Decision |
|---|---|
| **Now (447 papers)** | Keep JSONB inline on `papers`. Split select queries so feed/library don't fetch summary data. |
| **At 5K papers with summaries** | Create `paper_summaries` table, backfill, update workers and queries, drop old columns. |
| **Model/prompt changes** | Regenerate in batches using `generated_at` and `model` columns for filtering. |
