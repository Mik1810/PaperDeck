alter table public.collaboration_identities
  alter column discoverable_by_email set default false;

update public.collaboration_identities
set
  discoverable_by_email = false,
  updated_at = now()
where discoverable_by_email = true;
