/**
 * Rollback of 20260930210000_task_for_several_locations.sql. The tasks it made
 * stay: each is an ordinary task at one location.
 */
begin;
set local lock_timeout = '5s';

drop function if exists public.task_create_for_locations(
  uuid[], text, text, public.task_priority, timestamptz, uuid, public.task_visibility,
  public.task_assignment_scope, text, timestamptz, text, integer, integer[], integer,
  timestamptz, timestamptz, integer
);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'task_create_for_locations') then
    raise exception 'task_for_several_locations_rollback_incomplete';
  end if;
end;
$$;

commit;
