/**
 * Rollback of 20260930230000_presence_status.sql. Drops the two functions and
 * the status columns; presence goes back to `online_at` alone.
 *
 * Roll the client back first: it calls `presence_beat` for its heartbeat and
 * `presence_set_status` for the menu, and names `presence_status` when it
 * clears presence.
 */
begin;
set local lock_timeout = '5s';

drop function if exists public.presence_set_status(text, timestamptz);
drop function if exists public.presence_beat(timestamptz);

alter table public.profiles drop constraint if exists profiles_presence_status_check;
alter table public.profiles drop column if exists presence_status;
alter table public.privacy_preferences drop constraint if exists privacy_preferences_manual_status_check;
alter table public.privacy_preferences
  drop column if exists manual_status,
  drop column if exists manual_status_until,
  drop column if exists last_active_at;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'presence_status')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'privacy_preferences' and column_name in ('manual_status', 'manual_status_until', 'last_active_at'))
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('presence_beat', 'presence_set_status')) then
    raise exception 'presence_status_rollback_incomplete';
  end if;
end;
$$;

commit;
