-- Task 2b rollback ONLY. Drops transient attempt history, not messages, devices,
-- registration/session binding, preferences, existing RPCs or existing triggers.
-- No CASCADE: any later feature depending on these objects must stop this file.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '30s';
do $guard$
declare v_table regclass;
begin
  if current_user <> 'supabase_admin' then raise exception 'Task 2b rollback requires supabase_admin'; end if;
  foreach v_table in array array['public.voice_ring_push_events'::regclass, 'public.voice_ring_push_devices'::regclass] loop
    if (select relowner from pg_class where oid = v_table) <> 'supabase_admin'::regrole
       or coalesce(obj_description(v_table, 'pg_class'), '') not like 'Task 2b:%' then
      raise exception 'Task 2b rollback refused: owner/identity drift at %', v_table;
    end if;
  end loop;
  if (select tgfoid from pg_trigger where tgrelid = 'public.voice_channels'::regclass and tgname = 'trg_voice_ring_push_capture')
       is distinct from 'private.voice_ring_push_capture()'::regprocedure::oid
     or (select tgfoid from pg_trigger where tgrelid = 'public.chats'::regclass and tgname = 'trg_voice_ring_push_chat_changed')
       is distinct from 'private.voice_ring_push_chat_changed()'::regprocedure::oid then
    raise exception 'Task 2b rollback refused: trigger dependency drift';
  end if;
end
$guard$;
drop trigger trg_voice_ring_push_capture on public.voice_channels;
drop trigger trg_voice_ring_push_chat_changed on public.chats;
drop function private.voice_ring_push_capture();
drop function private.voice_ring_push_chat_changed();
drop function private.voice_ring_push_finish(uuid, timestamptz);
drop table public.voice_ring_push_devices;
drop table public.voice_ring_push_events;
do $check$
begin
  if to_regclass('public.voice_ring_push_events') is not null
     or to_regclass('public.voice_ring_push_devices') is not null
     or exists (select 1 from pg_proc where pronamespace = 'private'::regnamespace
       and proname in ('voice_ring_push_finish', 'voice_ring_push_capture', 'voice_ring_push_chat_changed'))
     or exists (select 1 from pg_trigger where tgrelid in ('public.voice_channels'::regclass, 'public.chats'::regclass)
       and tgname in ('trg_voice_ring_push_capture', 'trg_voice_ring_push_chat_changed')) then
    raise exception 'Task 2b rollback self-check failed: an owned object survived';
  end if;
end
$check$;
commit;
