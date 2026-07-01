create or replace function match_papers_by_embedding(
  query_embedding vector(384),
  match_count integer default 100,
  embedding_model_filter text default 'BAAI/bge-small-en-v1.5'
)
returns table (
  paper_id uuid,
  semantic_score real
)
language sql
stable
set search_path = public
as $$
  select
    papers.id as paper_id,
    (1 - (papers.embedding <=> query_embedding))::real as semantic_score
  from papers
  where papers.embedding is not null
    and (
      embedding_model_filter is null
      or papers.embedding_model = embedding_model_filter
    )
  order by papers.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 500);
$$;
