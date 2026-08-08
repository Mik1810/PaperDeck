-- Supabase installs this event-trigger function to enable RLS automatically on
-- new public tables. It must remain available to the event trigger, but API
-- roles do not need to invoke it directly.
do $migration$
begin
  if to_regprocedure('public.rls_auto_enable()') is null then
    return;
  end if;

  revoke execute on function public.rls_auto_enable() from public;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.rls_auto_enable() from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.rls_auto_enable() from authenticated;
  end if;
end;
$migration$;
