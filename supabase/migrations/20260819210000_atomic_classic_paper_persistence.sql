create or replace function public.upsert_classic_paper_bundle(p_bundle jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_paper_id uuid;
  requested_paper_id uuid;
  paper_authors text[];
  paper_topic_ids uuid[];
  v_arxiv_id text;
  v_doi text;
  v_identity_key text;
  v_semantic_scholar_id text;
begin
  if jsonb_typeof(p_bundle) is distinct from 'object'
    or nullif(btrim(p_bundle ->> 'semantic_scholar_id'), '') is null
    or nullif(btrim(p_bundle ->> 'title'), '') is null
    or nullif(btrim(p_bundle ->> 'url'), '') is null
    or jsonb_typeof(p_bundle -> 'authors') is distinct from 'array'
    or jsonb_typeof(p_bundle -> 'topic_ids') is distinct from 'array'
  then
    raise exception 'invalid_classic_paper_bundle' using errcode = '22023';
  end if;

  requested_paper_id := nullif(p_bundle ->> 'existing_paper_id', '')::uuid;
  v_semantic_scholar_id := btrim(p_bundle ->> 'semantic_scholar_id');
  v_arxiv_id := nullif(btrim(p_bundle ->> 'arxiv_id'), '');
  v_doi := nullif(btrim(p_bundle ->> 'doi'), '');

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
    raise exception 'invalid_classic_paper_authors' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct topic.value::uuid), '{}'::uuid[])
  into paper_topic_ids
  from jsonb_array_elements_text(p_bundle -> 'topic_ids') as topic(value);

  if cardinality(paper_topic_ids) > 200 then
    raise exception 'invalid_classic_paper_topics' using errcode = '22023';
  end if;

  for v_identity_key in
    select value
    from unnest(array[
      'semantic_scholar:' || v_semantic_scholar_id,
      case when v_arxiv_id is not null then 'arxiv:' || v_arxiv_id end,
      case when v_doi is not null then 'doi:' || v_doi end,
      case
        when nullif(p_bundle ->> 'title_fingerprint', '') is not null
        then 'title:' || (p_bundle ->> 'title_fingerprint')
      end
    ]) as candidate(value)
    where value is not null
    order by value
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_identity_key, 0)
    );
  end loop;

  select paper.id
  into saved_paper_id
  from public.papers as paper
  where (requested_paper_id is not null and paper.id = requested_paper_id)
    or paper.semantic_scholar_id = v_semantic_scholar_id
    or (v_arxiv_id is not null and paper.arxiv_id = v_arxiv_id)
    or (v_doi is not null and paper.doi = v_doi)
  order by
    case when paper.id = requested_paper_id then 0 else 1 end,
    case when paper.semantic_scholar_id = v_semantic_scholar_id then 0 else 1 end,
    paper.id
  limit 1
  for update;

  if saved_paper_id is null then
    insert into public.papers (
      title,
      abstract,
      year,
      published_at,
      source,
      doi,
      arxiv_id,
      semantic_scholar_id,
      url,
      pdf_url,
      venue,
      citation_count,
      is_open_access,
      access,
      is_classic
    ) values (
      btrim(p_bundle ->> 'title'),
      nullif(p_bundle ->> 'abstract', ''),
      nullif(p_bundle ->> 'year', '')::integer,
      nullif(p_bundle ->> 'published_at', '')::timestamptz,
      (p_bundle ->> 'source')::public.paper_source,
      v_doi,
      v_arxiv_id,
      v_semantic_scholar_id,
      btrim(p_bundle ->> 'url'),
      nullif(btrim(p_bundle ->> 'pdf_url'), ''),
      nullif(btrim(p_bundle ->> 'venue'), ''),
      nullif(p_bundle ->> 'citation_count', '')::integer,
      coalesce((p_bundle ->> 'is_open_access')::boolean, false),
      coalesce((p_bundle ->> 'access')::public.paper_access, 'unknown'),
      true
    )
    returning id into saved_paper_id;
  else
    update public.papers
    set
      title = btrim(p_bundle ->> 'title'),
      abstract = nullif(p_bundle ->> 'abstract', ''),
      year = nullif(p_bundle ->> 'year', '')::integer,
      published_at = nullif(p_bundle ->> 'published_at', '')::timestamptz,
      source = (p_bundle ->> 'source')::public.paper_source,
      doi = v_doi,
      arxiv_id = v_arxiv_id,
      semantic_scholar_id = v_semantic_scholar_id,
      url = btrim(p_bundle ->> 'url'),
      pdf_url = nullif(btrim(p_bundle ->> 'pdf_url'), ''),
      venue = nullif(btrim(p_bundle ->> 'venue'), ''),
      citation_count = nullif(p_bundle ->> 'citation_count', '')::integer,
      is_open_access = coalesce((p_bundle ->> 'is_open_access')::boolean, false),
      access = coalesce((p_bundle ->> 'access')::public.paper_access, 'unknown'),
      is_classic = true
    where id = saved_paper_id;
  end if;

  insert into public.paper_external_ids (paper_id, provider, external_id, url)
  select saved_paper_id, external.provider, external.external_id, external.url
  from (
    values
      (
        'semantic_scholar'::text,
        v_semantic_scholar_id,
        coalesce(
          nullif(p_bundle ->> 'semantic_scholar_url', ''),
          'https://www.semanticscholar.org/paper/' || v_semantic_scholar_id
        )
      ),
      (
        'arxiv'::text,
        v_arxiv_id,
        case
          when v_arxiv_id is not null
          then 'https://arxiv.org/abs/' || v_arxiv_id
        end
      ),
      (
        'doi'::text,
        v_doi,
        case when v_doi is not null then 'https://doi.org/' || v_doi end
      )
  ) as external(provider, external_id, url)
  where external.external_id is not null
  on conflict (paper_id, provider, external_id)
  do update set url = excluded.url;

  if cardinality(paper_authors) > 0 then
    delete from public.paper_authors
    where paper_id = saved_paper_id;

    insert into public.paper_authors (paper_id, name, position)
    select saved_paper_id, author.name, (author.ordinality - 1)::integer
    from unnest(paper_authors) with ordinality as author(name, ordinality);
  end if;

  insert into public.paper_topics (paper_id, topic_id, confidence, source)
  select saved_paper_id, topic_id, 0.85, 'classic_discovery'
  from unnest(paper_topic_ids) as topic(topic_id)
  on conflict (paper_id, topic_id)
  do update set confidence = excluded.confidence, source = excluded.source;

  return saved_paper_id;
end;
$$;

revoke all on function public.upsert_classic_paper_bundle(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_classic_paper_bundle(jsonb)
  to service_role;

comment on function public.upsert_classic_paper_bundle(jsonb) is
  'Service-role-only atomic upsert for one complete Semantic Scholar classic-paper metadata, external-ID, author, and topic bundle.';
