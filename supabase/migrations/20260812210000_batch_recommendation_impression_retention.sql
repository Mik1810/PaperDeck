create index if not exists recommendation_impressions_shown_id_idx
on recommendation_impressions(shown_at, id);

create index if not exists recommendation_batch_items_delivered_id_idx
on recommendation_batch_items(delivered_at, id);
