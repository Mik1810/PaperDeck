alter table public.ingestion_cursors
  add column if not exists last_seen_updated_at timestamptz;

create or replace function public.upsert_arxiv_paper_bundle(p_bundle jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_paper_id uuid;
  paper_authors text[];
  paper_topic_ids uuid[];
begin
  if jsonb_typeof(p_bundle) is distinct from 'object' then
    raise exception 'invalid_arxiv_paper_bundle' using errcode = '22023';
  end if;
  if nullif(btrim(p_bundle ->> 'arxiv_id'), '') is null
    or nullif(btrim(p_bundle ->> 'versioned_arxiv_id'), '') is null
    or nullif(btrim(p_bundle ->> 'title'), '') is null
    or nullif(btrim(p_bundle ->> 'url'), '') is null
    or nullif(p_bundle ->> 'published_at', '') is null
    or nullif(p_bundle ->> 'updated_at', '') is null
    or jsonb_typeof(p_bundle -> 'authors') is distinct from 'array'
    or jsonb_typeof(p_bundle -> 'topic_ids') is distinct from 'array'
  then
    raise exception 'invalid_arxiv_paper_bundle' using errcode = '22023';
  end if;

  select coalesce(array_agg(author.name order by author.ordinality), '{}'::text[])
  into paper_authors
  from jsonb_array_elements_text(p_bundle -> 'authors')
    with ordinality as author(name, ordinality);

  if cardinality(paper_authors) > 500
    or exists (
      select 1
      from unnest(paper_authors) as author(name)
      where nullif(btrim(author.name), '') is null
    )
  then
    raise exception 'invalid_arxiv_paper_authors' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct topic.value::uuid), '{}'::uuid[])
  into paper_topic_ids
  from jsonb_array_elements_text(p_bundle -> 'topic_ids') as topic(value);

  if cardinality(paper_topic_ids) > 200 then
    raise exception 'invalid_arxiv_paper_topics' using errcode = '22023';
  end if;

  insert into public.papers (
    title,
    abstract,
    year,
    published_at,
    updated_at,
    source,
    doi,
    arxiv_id,
    url,
    pdf_url,
    venue,
    is_open_access,
    access
  ) values (
    btrim(p_bundle ->> 'title'),
    nullif(p_bundle ->> 'abstract', ''),
    (p_bundle ->> 'year')::integer,
    (p_bundle ->> 'published_at')::timestamptz,
    (p_bundle ->> 'updated_at')::timestamptz,
    'arxiv',
    nullif(btrim(p_bundle ->> 'doi'), ''),
    btrim(p_bundle ->> 'arxiv_id'),
    btrim(p_bundle ->> 'url'),
    nullif(btrim(p_bundle ->> 'pdf_url'), ''),
    nullif(btrim(p_bundle ->> 'venue'), ''),
    true,
    'open'
  )
  on conflict (arxiv_id) where arxiv_id is not null
  do update set
    title = excluded.title,
    abstract = excluded.abstract,
    year = excluded.year,
    published_at = excluded.published_at,
    updated_at = excluded.updated_at,
    source = excluded.source,
    doi = excluded.doi,
    url = excluded.url,
    pdf_url = excluded.pdf_url,
    venue = excluded.venue,
    is_open_access = excluded.is_open_access,
    access = excluded.access,
    embedding = case
      when public.papers.title is distinct from excluded.title
        or public.papers.abstract is distinct from excluded.abstract
      then null
      else public.papers.embedding
    end,
    embedding_model = case
      when public.papers.title is distinct from excluded.title
        or public.papers.abstract is distinct from excluded.abstract
      then null
      else public.papers.embedding_model
    end,
    embedding_dimension = case
      when public.papers.title is distinct from excluded.title
        or public.papers.abstract is distinct from excluded.abstract
      then null
      else public.papers.embedding_dimension
    end,
    embedded_at = case
      when public.papers.title is distinct from excluded.title
        or public.papers.abstract is distinct from excluded.abstract
      then null
      else public.papers.embedded_at
    end,
    embedding_content_hash = case
      when public.papers.title is distinct from excluded.title
        or public.papers.abstract is distinct from excluded.abstract
      then null
      else public.papers.embedding_content_hash
    end,
    triage_summary = case
      when public.papers.title is distinct from excluded.title
        or public.papers.abstract is distinct from excluded.abstract
      then null
      else public.papers.triage_summary
    end,
    triage_summary_model = case
      when public.papers.title is distinct from excluded.title
        or public.papers.abstract is distinct from excluded.abstract
      then null
      else public.papers.triage_summary_model
    end,
    triage_summary_generated_at = case
      when public.papers.title is distinct from excluded.title
        or public.papers.abstract is distinct from excluded.abstract
      then null
      else public.papers.triage_summary_generated_at
    end
  returning id into saved_paper_id;

  insert into public.paper_external_ids (
    paper_id,
    provider,
    external_id,
    url
  ) values (
    saved_paper_id,
    'arxiv',
    btrim(p_bundle ->> 'versioned_arxiv_id'),
    btrim(p_bundle ->> 'url')
  )
  on conflict (paper_id, provider, external_id)
  do update set url = excluded.url;

  delete from public.paper_authors
  where paper_id = saved_paper_id;

  insert into public.paper_authors (paper_id, name, position)
  select saved_paper_id, author.name, (author.ordinality - 1)::integer
  from unnest(paper_authors) with ordinality as author(name, ordinality);

  delete from public.paper_topics
  where paper_id = saved_paper_id
    and source = 'arxiv_category';

  insert into public.paper_topics (
    paper_id,
    topic_id,
    confidence,
    source
  )
  select saved_paper_id, topic_id, 1, 'arxiv_category'
  from unnest(paper_topic_ids) as topic(topic_id)
  on conflict (paper_id, topic_id)
  do update set confidence = excluded.confidence, source = excluded.source;

  return saved_paper_id;
end;
$$;

revoke all on function public.upsert_arxiv_paper_bundle(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_arxiv_paper_bundle(jsonb)
  to service_role;

comment on function public.upsert_arxiv_paper_bundle(jsonb) is
  'Service-role-only atomic upsert for one complete arXiv metadata, external-ID, author, and category-topic bundle.';

create or replace function public.upsert_arxiv_ingestion_cursor(
  p_cursor_key text,
  p_cursor_value text,
  p_last_seen_published_at timestamptz,
  p_last_seen_updated_at timestamptz,
  p_last_seen_external_id text,
  p_last_successful_run_id uuid,
  p_imported_count integer
)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.ingestion_cursors (
    source,
    cursor_key,
    cursor_value,
    last_seen_published_at,
    last_seen_updated_at,
    last_seen_external_id,
    last_successful_run_id,
    imported_count,
    updated_at
  ) values (
    'arxiv',
    p_cursor_key,
    p_cursor_value,
    p_last_seen_published_at,
    p_last_seen_updated_at,
    p_last_seen_external_id,
    p_last_successful_run_id,
    p_imported_count,
    now()
  )
  on conflict (source, cursor_key)
  do update set
    cursor_value = excluded.cursor_value,
    last_seen_published_at = excluded.last_seen_published_at,
    last_seen_updated_at = excluded.last_seen_updated_at,
    last_seen_external_id = excluded.last_seen_external_id,
    last_successful_run_id = excluded.last_successful_run_id,
    imported_count = excluded.imported_count,
    updated_at = excluded.updated_at;
$$;

revoke all on function public.upsert_arxiv_ingestion_cursor(
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.upsert_arxiv_ingestion_cursor(
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  uuid,
  integer
) to service_role;

comment on function public.upsert_arxiv_ingestion_cursor(
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  uuid,
  integer
) is 'Service-role-only arXiv cursor checkpoint supporting independent publication and revision paths.';
