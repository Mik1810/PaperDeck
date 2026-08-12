create index if not exists playlist_items_order_idx
on playlist_items(playlist_id, position, added_at desc, paper_id);

create index if not exists favorites_owner_created_paper_idx
on favorites(owner_id, created_at desc, paper_id);

create index if not exists user_paper_interactions_ignored_history_idx
on user_paper_interactions(owner_id, paper_id, created_at desc, id desc)
where action in ('dismiss', 'not_interested');
