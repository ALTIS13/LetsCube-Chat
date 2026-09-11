-- Rollback of 20260911141000_message_read_events.sql.
--
-- Drops the read events and everything that reads them. What is lost: the
-- exact read times of the last seven days — the only thing the table holds.
-- The read pointers in public.chat_members are untouched, so unread counts and
-- check marks are exactly what they were. A client that already calls
-- mark_chat_read_through or message_read_times falls back to mark_chat_read and
-- the pointer time on the first PGRST202 it gets.

begin;

set local lock_timeout = '5s';

do $$
begin
  -- Nested: cron.job does not exist where pg_cron is not installed.
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'letscube-message-read-events-cleanup') then
      perform cron.unschedule('letscube-message-read-events-cleanup');
    end if;
  end if;
end
$$;

drop trigger if exists trg_record_message_read_event on public.chat_members;
drop function if exists public.message_read_times(uuid);
drop function if exists public.mark_chat_read_through(uuid, timestamptz);
drop function if exists public.message_read_events_cleanup(integer, integer);
drop function if exists private.record_message_read_event();
drop function if exists private.read_time_visible(uuid, uuid);
drop function if exists private.presence_visible(uuid);
drop function if exists private.message_read_time_retention();
drop table if exists private.message_read_events;

do $$
begin
  if pg_catalog.to_regclass('private.message_read_events') is not null
     or pg_catalog.to_regprocedure('public.message_read_times(uuid)') is not null
     or pg_catalog.to_regprocedure('public.mark_chat_read_through(uuid,timestamp with time zone)') is not null
     or exists (
       select 1 from pg_catalog.pg_trigger
        where tgrelid = 'public.chat_members'::regclass
          and tgname = 'trg_record_message_read_event'
     ) then
    raise exception 'rollback incomplete: read events objects are still present';
  end if;
end
$$;

commit;
