alter table recommendations
add column candidate_source text
constraint recommendations_candidate_source_check
check (candidate_source in ('semantic', 'catalog_fallback'));
