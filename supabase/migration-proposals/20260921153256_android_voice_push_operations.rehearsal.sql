-- AFTER Task 5 apply on EMPTY isolated PG17 schema ONLY, as supabase_admin.
-- Explicit opt-in: SET letscube.task5.isolated_schema_copy='yes'; ON_ERROR_STOP.
-- Keep cron launcher OFF, isolated network only; no production credentials.
-- All synthetic fixtures, local gate, grants and actual pg_net queues ROLLBACK.
-- This companion proves SQL/queue transactionality, NOT background worker timing.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '30s';
do $guard$
begin
  if current_user <> 'supabase_admin'
     or current_setting('letscube.task5.isolated_schema_copy',true) is distinct from 'yes' then
    raise exception 'Task 5 rehearsal requires supabase_admin and isolated-schema-copy opt-in';
  end if;
  if exists(select 1 from auth.users) or exists(select 1 from auth.sessions)
     or exists(select 1 from public.profiles) or exists(select 1 from public.chats)
     or exists(select 1 from public.user_push_devices) or exists(select 1 from public.voice_ring_push_events)
     or exists(select 1 from net.http_request_queue)
     or exists(select 1 from vault.decrypted_secrets where name in ('kub_project_url','kub_push_dispatch_token'))
     or exists(select 1 from private.voice_push_wake_slots where request_id is not null)
     or exists(select 1 from cron.job where jobname in ('letscube-voice-push-recovery','letscube-voice-push-cleanup') and active)
     or (select enabled from private.voice_push_dispatch_config where singleton) is distinct from false then
    raise exception 'Task 5 rehearsal requires empty isolated disabled installation';
  end if;
end
$guard$;

-- Same bounded synthetic-onboarding bootstrap as the reviewed Task 2a rehearsal.
-- Restore EXACT trigger modes before any call/dispatch behavior; never alter RLS.
create temp table task5_onboarding on commit drop as select tgrelid,tgname,tgenabled from pg_trigger
where not tgisinternal and ((tgrelid='auth.users'::regclass and tgname='on_auth_user_created')
  or (tgrelid='public.profiles'::regclass and tgname in ('trg_registration_invite_apply_from_profile','trg_bootstrap_first_admin')));
do $bootstrap$
declare t record;
begin
  for t in select * from task5_onboarding loop
    execute format('alter table %s disable trigger %I', t.tgrelid::regclass, t.tgname);
  end loop;
end
$bootstrap$;
create temp table task5_fixture(caller uuid,recipient uuid,session1 uuid,session2 uuid,chat uuid,room uuid);
insert into task5_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null);
insert into auth.users(id) select caller from task5_fixture union all select recipient from task5_fixture;
insert into public.profiles(id,full_name) select caller,'Synthetic caller' from task5_fixture union all select recipient,'Synthetic recipient' from task5_fixture;
do $restore$
declare t record;
begin
  for t in select * from task5_onboarding loop
    execute format('alter table %s %s trigger %I',t.tgrelid::regclass,
      case t.tgenabled when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' else 'enable' end,t.tgname);
  end loop;
  if exists(select 1 from task5_onboarding b left join pg_trigger actual on actual.tgrelid=b.tgrelid and actual.tgname=b.tgname
    where actual.tgenabled is distinct from b.tgenabled) then raise exception 'Task 5 onboarding trigger restore failed'; end if;
end
$restore$;
insert into auth.sessions(id,user_id,not_after)
  select session1,recipient,null::timestamptz from task5_fixture union all
  select session2,recipient,now()+interval '1 hour' from task5_fixture;
insert into public.chats(id,type,created_by) select chat,'private',caller from task5_fixture;
insert into public.chat_members(chat_id,user_id,role)
  select chat,caller,'owner'::public.chat_member_role from task5_fixture union all
  select chat,recipient,'member'::public.chat_member_role from task5_fixture on conflict do nothing;
insert into public.user_push_devices(user_id,platform,provider,token,token_hash,session_id,voice_call_protocol)
  select recipient,'android','fcm',repeat('synthetic-device-1-',4),repeat('1',64),session1,1 from task5_fixture union all
  select recipient,'android','fcm',repeat('synthetic-device-2-',4),repeat('2',64),session1,1 from task5_fixture union all
  select recipient,'android','fcm',repeat('synthetic-device-3-',4),repeat('3',64),session2,1 from task5_fixture;
insert into public.user_push_devices(user_id,platform,provider,token,token_hash,session_id,voice_call_protocol)
  select f.recipient,'android','fcm',repeat('synthetic-extra-'||n,4),
    md5('task5-'||n)||md5('task5-'||n),f.session1,1 from task5_fixture f cross join generate_series(1,37) n;
grant select,update on task5_fixture to authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',caller)::text,true) is not null as claims_set from task5_fixture;
set local role authenticated;
update task5_fixture set room=(select channel_id from public.voice_call_ring(chat));
set local role supabase_admin;

do $disabled$
declare r record;
begin
  if exists(select 1 from public.voice_push_claim(20,gen_random_uuid())) then raise exception 'Task 5 disabled claim leaked'; end if;
  if private.voice_push_tick() <> 0 then raise exception 'Task 5 disabled tick queued'; end if;
  select * into r from private.voice_push_cleanup();
  if r.outcomes_deleted<>0 or r.events_deleted<>0 or exists(select 1 from net.http_request_queue) then
    raise exception 'Task 5 disabled side effect';
  end if;
  if (select count(*) from public.voice_ring_push_devices)<>40 then raise exception 'Task 5 fixture count'; end if;
  perform vault.create_secret('http://kong:8000','kub_project_url');
  perform vault.create_secret('synthetic-dispatch-auth','kub_push_dispatch_token');
end
$disabled$;
update private.voice_push_dispatch_config set enabled=true;
do $queue$
begin
  if private.voice_push_tick()<>2 or private.voice_push_tick()<>0 then raise exception 'Task 5 bounded/coalesced wake mismatch'; end if;
  if (select count(*) from net.http_request_queue)<>2
    or exists(select 1 from net.http_request_queue where method::text<>'POST'
      or url<>'http://kong:8000/functions/v1/send-push-notifications' or timeout_milliseconds<>25000
      or convert_from(body,'UTF8')::jsonb<>'{"scope":"voice","limit":20}'::jsonb) then
    raise exception 'Task 5 transactional HTTP contract mismatch';
  end if;
end
$queue$;
create temp table task5_claims(event_id uuid,push_device_id uuid,claim_id uuid);
grant select,insert,delete on task5_claims to service_role;
create temp table task5_acl_probe(tick_oid oid);
insert into task5_acl_probe values ('private.voice_push_tick()'::regprocedure::oid);
grant select on task5_acl_probe to service_role;
set local role service_role;
do $capacity$
declare c record; n integer; total integer := 0; h record;
begin
  for n in 1..4 loop
    insert into task5_claims select * from public.voice_push_claim(4,gen_random_uuid());
  end loop;
  if (select count(*) from task5_claims)<>16 or exists(select 1 from public.voice_push_claim(4,gen_random_uuid())) then
    raise exception 'Task 5 global claim cap mismatch';
  end if;
  select * into h from public.voice_push_health();
  if h.live_claimed_count<>16 or h.ready_count<>24 or h.inflight_slots<>2 then
    raise exception 'Task 5 health counts mismatch: live %, ready %, inflight %',h.live_claimed_count,h.ready_count,h.inflight_slots;
  end if;
  loop
    for c in select * from task5_claims loop
      if not exists(select 1 from public.voice_push_prepare(c.event_id,c.push_device_id,c.claim_id)) then
        raise exception 'Task 5 eligibility regression';
      end if;
      if not public.voice_push_complete(c.event_id,c.push_device_id,c.claim_id,'accepted',null,null) then
        raise exception 'Task 5 completion regression';
      end if;
      total := total+1;
    end loop;
    delete from task5_claims;
    insert into task5_claims select * from public.voice_push_claim(4,gen_random_uuid());
    exit when not found;
  end loop;
  if total<>40 or exists(select 1 from public.voice_push_claim(20,gen_random_uuid())) then
    raise exception 'Task 5 residual backlog/accepted deduplication mismatch';
  end if;
  if has_function_privilege(current_user,(select tick_oid from task5_acl_probe),'EXECUTE')
    or has_function_privilege('authenticated','public.voice_push_health()','EXECUTE')
    or has_function_privilege('anon','public.voice_push_health()','EXECUTE') then
    raise exception 'Task 5 private/client ACL mismatch';
  end if;
end
$capacity$;
set local role supabase_admin;
update private.voice_push_dispatch_config set enabled=false;
update public.voice_ring_push_events set ring_started_at=now()-interval '25 hours 45 seconds',expires_at=now()-interval '25 hours';
do $disabled_retention$
declare r record;
begin
  select * into r from private.voice_push_cleanup();
  if r.outcomes_deleted<>0 or r.events_deleted<>0 or (select count(*) from public.voice_ring_push_devices)<>40 then
    raise exception 'Task 5 disabled cleanup purged old data';
  end if;
end
$disabled_retention$;
update private.voice_push_dispatch_config set enabled=true;
update public.voice_ring_push_events set ring_started_at=now()-interval '24 hours 45 seconds',expires_at=now()-interval '24 hours';
do $boundary$
declare r record;
begin
  select * into r from private.voice_push_cleanup();
  if r.outcomes_deleted<>0 or r.events_deleted<>0 then raise exception 'Task 5 exact 24-hour boundary purged'; end if;
end
$boundary$;
update public.voice_ring_push_events set ring_started_at=ring_started_at-interval '1 microsecond',expires_at=expires_at-interval '1 microsecond';
do $retention$
declare r record;
begin
  select * into r from private.voice_push_cleanup();
  if r.outcomes_deleted<>40 or r.events_deleted<>2 then raise exception 'Task 5 old transient cleanup mismatch'; end if;
  select * into r from private.voice_push_cleanup();
  if r.outcomes_deleted<>0 or r.events_deleted<>0 or (select count(*) from auth.users)<>2
     or (select count(*) from public.chats)<>1 or (select count(*) from public.user_push_devices)<>40 then
    raise exception 'Task 5 idempotent cleanup crossed retention boundary';
  end if;
end
$retention$;

-- One old event carries 603 captured outcomes. Empty-parent selection must not
-- cascade the 103 residual rows when the first outcome batch reaches 500.
create temp table task5_old_event(id uuid);
with old_event as (
  insert into public.voice_ring_push_events(channel_id,chat_id,caller_user_id,recipient_user_id,
    recipient_session_id,ring_started_at,event,expires_at)
  select room,chat,caller,recipient,gen_random_uuid(),now()-interval '25 hours 45 seconds','ring',now()-interval '25 hours'
    from task5_fixture returning id
) insert into task5_old_event select id from old_event;
insert into public.voice_ring_push_devices(event_id,push_device_id)
  select id,gen_random_uuid() from task5_old_event cross join generate_series(1,603);
do $outcome_bound$
declare r record;
begin
  select * into r from private.voice_push_cleanup();
  if r.outcomes_deleted<>500 or r.events_deleted<>0 or (select count(*) from public.voice_ring_push_devices)<>103 then
    raise exception 'Task 5 outcome bound or child cascade regression';
  end if;
  select * into r from private.voice_push_cleanup();
  if r.outcomes_deleted<>103 or r.events_deleted<>1 then raise exception 'Task 5 residual outcome cleanup mismatch'; end if;
end
$outcome_bound$;
insert into public.voice_ring_push_events(channel_id,chat_id,caller_user_id,recipient_user_id,
  recipient_session_id,ring_started_at,event,expires_at)
  select room,chat,caller,recipient,gen_random_uuid(),now()-interval '25 hours 45 seconds','ring',now()-interval '25 hours'
    from task5_fixture cross join generate_series(1,503);
-- Fresh event/outcome controls must survive every cleanup run.
with fresh as (
  insert into public.voice_ring_push_events(channel_id,chat_id,caller_user_id,recipient_user_id,
    recipient_session_id,ring_started_at,event,expires_at)
  select room,chat,caller,recipient,gen_random_uuid(),now()-interval '1 hour 45 seconds','ring',now()-interval '1 hour'
    from task5_fixture returning id
) insert into public.voice_ring_push_devices(event_id,push_device_id) select id,gen_random_uuid() from fresh;
do $event_bound$
declare r record;
begin
  select * into r from private.voice_push_cleanup();
  if r.outcomes_deleted<>0 or r.events_deleted<>500 then raise exception 'Task 5 empty event bound regression'; end if;
  select * into r from private.voice_push_cleanup();
  if r.outcomes_deleted<>0 or r.events_deleted<>3 then raise exception 'Task 5 residual event cleanup mismatch'; end if;
  select * into r from private.voice_push_cleanup();
  if r.outcomes_deleted<>0 or r.events_deleted<>0 or (select count(*) from public.voice_ring_push_events)<>1
     or (select count(*) from public.voice_ring_push_devices)<>1 then raise exception 'Task 5 fresh transient rows purged'; end if;
end
$event_bound$;
rollback;
