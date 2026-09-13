/**
 * Rollback for 20260913150000_voice_channels.sql.
 *
 * Order matters. The publication first, because a dropped table that is still
 * published leaves the replication slot describing something that is not there;
 * then the functions, which are the only way anything outside `private` reaches
 * the queue of webhook events; then the tables, whose foreign keys take the
 * participants with them.
 *
 * **This discards every voice channel and every participant row.** The
 * participants are a mirror of the SFU and are worth nothing once the call ends,
 * but a channel is a thing somebody made and named, and after this it is gone.
 * Worth knowing before running it rather than after.
 */

begin;

set local lock_timeout = '5s';

do $unpublish$
declare
  v_table text;
begin
  foreach v_table in array array['voice_participants', 'voice_channels']
  loop
    if exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', v_table);
    end if;
  end loop;
end
$unpublish$;

drop function if exists public.voice_webhook_events_purge(timestamptz);
drop function if exists public.voice_webhook_event_seen(uuid);
drop function if exists public.voice_participants_reap(timestamptz);
drop function if exists public.voice_channel_set_active(uuid, timestamptz);
drop function if exists public.voice_participants_replace(uuid, uuid[], timestamptz);
drop function if exists public.voice_participant_left(uuid, uuid, timestamptz);
drop function if exists public.voice_participant_joined(uuid, uuid, timestamptz);
drop function if exists private.voice_channel_recount(uuid);
drop function if exists public.voice_channel_chat(uuid);

drop table if exists private.voice_webhook_events;
drop table if exists public.voice_participants;
drop table if exists public.voice_channels;

do $check$
begin
  if pg_catalog.to_regclass('public.voice_channels') is not null
     or pg_catalog.to_regclass('public.voice_participants') is not null
     or pg_catalog.to_regclass('private.voice_webhook_events') is not null then
    raise exception 'a voice table survived its own rollback';
  end if;
  if exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where p.proname like 'voice\\_%' and n.nspname in ('public', 'private')
  ) then
    raise exception 'a voice function survived the rollback';
  end if;
end
$check$;

commit;
