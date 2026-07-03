create or replace function get_table_sizes()
returns table (
  table_name text,
  total_size text,
  row_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    'papers'::text as table_name,
    pg_size_pretty(pg_total_relation_size('papers')) as total_size,
    (select count(*) from papers) as row_count;
$$;
