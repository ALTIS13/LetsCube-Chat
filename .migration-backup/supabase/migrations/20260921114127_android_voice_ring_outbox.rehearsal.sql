-- ISOLATED SCHEMA COPY ONLY, after applying Task 2a and Task 2b proposals.
-- Coordinator prerequisite: same-image PG17.6, network none, empty auth.users
-- and chats, no dispatch workers. No cron jobs should run in the copy.
-- Connect as supabase_admin and set letscube.task2b.isolated_schema_copy = 'yes'
-- in this connection, then run with ON_ERROR_STOP. The opt-in is NOT proof of
-- isolation: the coordinator must verify container/network/job inventory.
-- This file never copies/replaces RPCs, creates a schedule or sends a wakeup.
-- All fixtures and grant probes are rolled back. The proposal remains installed
-- for the coordinator's separate .rollback.sql / dependency inventory check.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '30s';
do $guard$
begin
  if current_user <> 'supabase_admin'
     or current_setting('letscube.task2b.isolated_schema_copy', true) is distinct from 'yes' then
    raise exception 'Task 2b rehearsal requires explicit isolated-schema-copy opt-in as supabase_admin';
  end if;
  if exists (select 1 from auth.users) or exists (select 1 from public.chats) then
    raise exception 'Task 2b rehearsal requires empty synthetic schema copy, never customer rows';
  end if;
end
$guard$;

-- Random local-only identities. Keep auth/profile automation active: schema-copy
-- drift should fail visibly, not be hidden by disabling production triggers.
create temporary table task2b_fixture (caller uuid, recipient uuid, session1 uuid, session2 uuid, chat uuid, room uuid);
insert into task2b_fixture values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), null);
insert into auth.users(id) select caller from task2b_fixture union all select recipient from task2b_fixture;
insert into public.profiles(id)
  select u.id from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id);
insert into auth.sessions(id, user_id, not_after)
  select session1, recipient, null::timestamptz from task2b_fixture union all
  select session2, recipient, now() + interval '1 hour' from task2b_fixture;
insert into public.chats(id, type, created_by) select chat, 'private', caller from task2b_fixture;
insert into public.chat_members(chat_id, user_id, role)
  select chat, caller, 'owner'::public.chat_member_role from task2b_fixture union all
  select chat, recipient, 'member'::public.chat_member_role from task2b_fixture
  on conflict (chat_id, user_id) do nothing;
insert into public.user_push_devices(user_id, platform, provider, token, token_hash, session_id, voice_call_protocol)
  select recipient, 'android', 'fcm', repeat('synthetic-not-a-provider-token-1', 3), repeat('1', 64), session1, 1 from task2b_fixture union all
  select recipient, 'android', 'fcm', repeat('synthetic-not-a-provider-token-2', 3), repeat('2', 64), session1, 1 from task2b_fixture union all
  select recipient, 'android', 'fcm', repeat('synthetic-not-a-provider-token-3', 3), repeat('3', 64), session2, 1 from task2b_fixture;

-- Fixture ids are never returned or printed; only literal raising assertions.
select set_config('request.jwt.claims', jsonb_build_object('sub', caller)::text, true) is not null as claims_set from task2b_fixture;
grant select, update on task2b_fixture to authenticated;
set local role authenticated;
update task2b_fixture set room = (select channel_id from public.voice_call_ring(chat));
set local role supabase_admin;
do $ring$
begin
  if (select count(*) from public.voice_ring_push_events) <> 2
     or (select count(*) from public.voice_ring_push_devices) <> 3 then
    raise exception 'Task 2b rehearsal: real-owner RPC failed to capture two sessions / three devices';
  end if;
  if exists (select 1 from public.voice_ring_push_events e cross join task2b_fixture f
    where e.recipient_user_id <> f.recipient or e.caller_user_id <> f.caller or e.channel_id <> f.room
       or e.event <> 'ring' or e.state <> 'pending' or e.expires_at - e.ring_started_at <> interval '45 seconds') then
    raise exception 'Task 2b rehearsal: ring identity/deadline/state mismatch';
  end if;
  if exists (select 1 from public.messages m join task2b_fixture f on f.chat = m.chat_id) then
    raise exception 'Task 2b rehearsal: ring added in-app rows';
  end if;
end
$ring$;

-- Owner-independent RLS and EXECUTE probes; the default deny must still work
-- even if somebody accidentally grants SELECT later. All changes roll back.
grant select on public.voice_ring_push_events, public.voice_ring_push_devices to authenticated, anon;
set local role authenticated;
do $client$
begin
  if exists (select 1 from public.voice_ring_push_events) or exists (select 1 from public.voice_ring_push_devices) then
    raise exception 'Task 2b rehearsal: RLS leaked a transient row';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'voice_ring_push_capture'
      and has_function_privilege(current_user, p.oid, 'EXECUTE')) then
    raise exception 'Task 2b rehearsal: private trigger EXECUTE leaked';
  end if;
end
$client$;
set local role anon;
do $anon$
begin
  if exists (select 1 from public.voice_ring_push_events) or exists (select 1 from public.voice_ring_push_devices) then
    raise exception 'Task 2b rehearsal: anon RLS leaked a transient row';
  end if;
end
$anon$;
set local role supabase_admin;
revoke select on public.voice_ring_push_events, public.voice_ring_push_devices from authenticated, anon;

set local role service_role;
update public.voice_ring_push_devices set state = 'claimed', attempts = 1,
  claim_id = gen_random_uuid(), claimed_until = now() + interval '10 seconds', last_attempt_at = now();
set local role supabase_admin;
select set_config('request.jwt.claims', jsonb_build_object('sub', recipient)::text, true) is not null as claims_set from task2b_fixture;
set local role authenticated;
select public.voice_call_answer(room) is not null as answered from task2b_fixture;
select public.voice_call_stop(room, 'answered') = 'answered' as stopped from task2b_fixture;
select public.voice_call_stop(room, 'answered') = 'idle' as stopped_again from task2b_fixture;
set local role supabase_admin;
do $cancel$
begin
  if (select count(*) from public.voice_ring_push_events) <> 4
     or (select count(*) from public.voice_ring_push_devices) <> 6 then
    raise exception 'Task 2b rehearsal: cancellation duplicated or lost captured targets';
  end if;
  if exists (select 1 from public.voice_ring_push_events where event = 'ring' and (state <> 'terminal' or terminal_at is null))
     or exists (select 1 from public.voice_ring_push_devices d join public.voice_ring_push_events e on e.id = d.event_id
       where e.event = 'ring' and (d.state <> 'terminal' or d.claim_id is not null or d.claimed_until is not null)) then
    raise exception 'Task 2b rehearsal: stale claimed ring survived answer';
  end if;
  if exists (
    select recipient_user_id, recipient_session_id, channel_id, ring_started_at, expires_at, d.push_device_id
      from public.voice_ring_push_events e join public.voice_ring_push_devices d on d.event_id = e.id where event = 'ring'
    except
    select recipient_user_id, recipient_session_id, channel_id, ring_started_at, expires_at, d.push_device_id
      from public.voice_ring_push_events e join public.voice_ring_push_devices d on d.event_id = e.id where event = 'cancel'
  ) then raise exception 'Task 2b rehearsal: cancel generation/device mismatch'; end if;
  if (select count(*) from public.messages m join task2b_fixture f on f.chat = m.chat_id) <> 1 then
    raise exception 'Task 2b rehearsal: existing history writer changed';
  end if;
end
$cancel$;
delete from public.chats where id = (select chat from task2b_fixture);
do $delete$
begin
  if exists (select 1 from public.voice_ring_push_events) or exists (select 1 from public.voice_ring_push_devices) then
    raise exception 'Task 2b rehearsal: deleted chat left a sendable event';
  end if;
  if (select count(*) from public.user_push_devices) <> 3 then
    raise exception 'Task 2b rehearsal: cascade escaped transient ownership';
  end if;
end
$delete$;
rollback;
