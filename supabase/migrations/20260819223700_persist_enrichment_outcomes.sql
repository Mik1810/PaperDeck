create table public.paper_enrichment_outcomes (
  provider text not null,
  paper_id uuid not null
    references public.papers(id) on delete cascade,
  outcome text not null,
  attempt_count integer not null,
  last_checked_at timestamptz not null,
  next_eligible_at timestamptz,
  primary key (provider, paper_id),
  constraint paper_enrichment_outcomes_provider_check
    check (provider in ('semantic_scholar', 'openalex', 'unpaywall')),
  constraint paper_enrichment_outcomes_outcome_check
    check (outcome in ('found', 'not_found', 'not_oa', 'retryable_error')),
  constraint paper_enrichment_outcomes_attempt_count_check
    check (attempt_count > 0),
  constraint paper_enrichment_outcomes_retry_check
    check (
      (
        outcome = 'retryable_error'
        and next_eligible_at is not null
        and next_eligible_at > last_checked_at
      )
      or (outcome <> 'retryable_error' and next_eligible_at is null)
    )
);

create index paper_enrichment_outcomes_retry_idx
  on public.paper_enrichment_outcomes (provider, next_eligible_at, paper_id)
  where outcome = 'retryable_error';

create index paper_enrichment_outcomes_paper_idx
  on public.paper_enrichment_outcomes (paper_id);

create index papers_semantic_scholar_enrichment_scan_idx
  on public.papers (ingested_at desc, id desc)
  where source = 'arxiv'
    and semantic_scholar_id is null
    and arxiv_id is not null;

create index papers_openalex_enrichment_scan_idx
  on public.papers (ingested_at desc, id desc)
  where source = 'arxiv'
    and openalex_id is null
    and doi is not null;

create index papers_unpaywall_enrichment_scan_idx
  on public.papers (ingested_at desc, id desc)
  where source = 'arxiv'
    and doi is not null;

insert into public.paper_enrichment_outcomes (
  provider,
  paper_id,
  outcome,
  attempt_count,
  last_checked_at
)
select
  'semantic_scholar',
  paper.id,
  'found',
  1,
  coalesce(min(external_id.created_at), paper.ingested_at)
from public.papers as paper
left join public.paper_external_ids as external_id
  on external_id.paper_id = paper.id
 and external_id.provider = 'semantic_scholar'
where paper.semantic_scholar_id is not null
group by paper.id;

insert into public.paper_enrichment_outcomes (
  provider,
  paper_id,
  outcome,
  attempt_count,
  last_checked_at
)
select
  'openalex',
  paper.id,
  'found',
  1,
  coalesce(min(external_id.created_at), paper.ingested_at)
from public.papers as paper
left join public.paper_external_ids as external_id
  on external_id.paper_id = paper.id
 and external_id.provider = 'openalex'
where paper.openalex_id is not null
group by paper.id;

insert into public.paper_enrichment_outcomes (
  provider,
  paper_id,
  outcome,
  attempt_count,
  last_checked_at
)
select
  'unpaywall',
  external_id.paper_id,
  'found',
  1,
  min(external_id.created_at)
from public.paper_external_ids as external_id
where external_id.provider = 'unpaywall_oa'
group by external_id.paper_id;

alter table public.paper_enrichment_outcomes enable row level security;

revoke all on table public.paper_enrichment_outcomes
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.paper_enrichment_outcomes
  to service_role;
