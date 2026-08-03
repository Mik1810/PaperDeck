drop policy research_group_invitations_recipient_read
  on public.research_group_invitations;

create policy research_group_invitations_recipient_read
  on public.research_group_invitations
  for select
  to authenticated
  using (
    recipient_id = ((select auth.jwt()) ->> 'sub')
    and (select private.research_groups_reads_enabled())
  );
