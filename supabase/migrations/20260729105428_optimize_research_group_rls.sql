drop policy research_group_members_self_read
  on public.research_group_members;

create policy research_group_members_self_read
  on public.research_group_members
  for select
  to authenticated
  using (
    member_id = (select auth.jwt() ->> 'sub')
    and revoked_at is null
    and (select private.research_groups_reads_enabled())
  );
