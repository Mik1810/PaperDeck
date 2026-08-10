-- Deterministic, synthetic catalog for the standard Playwright suite.
-- Never add production users, interactions, playlists, groups, or notifications here.

insert into public.taxonomy_topics
  (id, slug, label, parent_id, source, arxiv_category, depth, sort_order)
values
  ('10000000-0000-4000-8000-000000000001', 'computer-science', 'Computer Science', null, 'fixture', null, 0, 1),
  ('10000000-0000-4000-8000-000000000002', 'artificial-intelligence', 'Artificial Intelligence', '10000000-0000-4000-8000-000000000001', 'fixture', 'cs.AI', 1, 2),
  ('10000000-0000-4000-8000-000000000003', 'machine-learning', 'Machine Learning', '10000000-0000-4000-8000-000000000002', 'fixture', 'cs.LG', 2, 3),
  ('10000000-0000-4000-8000-000000000004', 'computer-vision', 'Computer Vision', '10000000-0000-4000-8000-000000000001', 'fixture', 'cs.CV', 1, 4);

insert into public.topic_relations
  (source_topic_id, target_topic_id, relation_type, weight)
values
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'contains', 0.9),
  ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'related', 0.8);

insert into public.topic_embeddings
  (topic_id, embedding, embedding_model, embedding_dimension, embedding_content_hash)
select
  topic.id,
  array(
    select case
      when dimension = topic.sort_order then 1::real
      else 0.001::real
    end
    from generate_series(1, 384) as dimension
  )::vector(384),
  'sentence-transformers/all-MiniLM-L6-v2',
  384,
  repeat(to_hex(topic.sort_order), 64)
from public.taxonomy_topics as topic;

insert into public.papers
  (id, title, abstract, year, published_at, source, arxiv_id, url, pdf_url,
   venue, citation_count, is_open_access, access, embedding, embedding_model,
   embedding_dimension, embedding_content_hash, embedded_at)
select
  ('20000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  'Synthetic research paper ' || series,
  'A deterministic fixture abstract for isolated PaperDeck end-to-end testing. Paper number ' || series || '.',
  2026,
  timestamptz '2026-01-31 12:00:00+00' - (series || ' days')::interval,
  'manual'::paper_source,
  'fixture.' || lpad(series::text, 4, '0'),
  'https://example.invalid/papers/' || series,
  'https://example.invalid/papers/' || series || '.pdf',
  'PaperDeck Test Venue',
  series * 3,
  true,
  'open'::paper_access,
  array(
    select case
      when dimension = 1 + (series % 4) then 1::real
      else (series::real / 10000)
    end
    from generate_series(1, 384) as dimension
  )::vector(384),
  'sentence-transformers/all-MiniLM-L6-v2',
  384,
  md5('synthetic-paper-' || series) || md5('fixture-' || series),
  timestamptz '2026-02-01 00:00:00+00'
from generate_series(1, 24) as series;

insert into public.paper_authors (paper_id, name, position)
select
  paper.id,
  'Fixture Author ' || row_number() over (order by paper.id),
  0
from public.papers as paper;

insert into public.paper_topics (paper_id, topic_id, confidence, source)
select
  paper.id,
  ('10000000-0000-4000-8000-' || lpad((2 + (row_number() over (order by paper.id) % 3))::text, 12, '0'))::uuid,
  0.9,
  'fixture'
from public.papers as paper;

insert into public.paper_external_ids (paper_id, provider, external_id, url)
select id, 'fixture', arxiv_id, url
from public.papers;
