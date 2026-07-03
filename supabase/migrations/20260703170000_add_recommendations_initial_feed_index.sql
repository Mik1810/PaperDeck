create index if not exists recommendations_owner_model_generated_idx
on recommendations(owner_id, model_version, generated_at desc);
