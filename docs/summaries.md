# Triage Summary Storage Strategy

Last updated: 2026-07-03

## Current approach (Session 8)

Triage summaries are stored as a JSONB column (`triage_summary`) inline on the `papers` table, alongside `triage_summary_model` and `triage_summary_generated_at` metadata columns. At current scale (567 papers, all with summaries) this is optimal: it's simple, requires no joins, and the overhead is negligible.

## Query-layer note

With the Drizzle ORM migration (July 2026), all paper queries in the app layer happen via Drizzle's query builder, which fetches full rows by default. The `paperSelectSimple`/`paperSelectWithSummary` string-based select optimization from the Supabase client era is no longer relevant. The `triage_summary` JSONB column is ~500 bytes - 5 KB per row, which is well within Postgres' comfort zone for queries returning up to 200 rows (feed candidates). No performance concern at current scale.

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
- Change `getPaperDetailData()` to call `getPaperSummary()` instead of joining on `papers.triage_summary`.
- Drop the `triage_summary` column from `papers` after verification.

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
| **Now (567 papers)** | Keep JSONB inline on `papers`. Drizzle fetches full rows; overhead is acceptable at current scale. |
| **At 5K papers with summaries** | Create `paper_summaries` table, backfill, update workers and queries, drop old columns. |
| **Model/prompt changes** | Regenerate in batches using `generated_at` and `model` columns for filtering. |
