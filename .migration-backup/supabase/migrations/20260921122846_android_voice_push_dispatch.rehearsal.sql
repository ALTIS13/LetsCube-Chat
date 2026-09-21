-- AFTER Task 3 apply, EMPTY isolated schema copy ONLY, real supabase_admin.
-- Coordinator: same-image PG17, network none, no active cron/Edge sender; set
-- letscube.task3.isolated_schema_copy='yes' in this connection, ON_ERROR_STOP.
-- Synthetic Vault only. Actual pg_net queues stay uncommitted and are rolled back.
-- No permanent activation, external requests, altered RPC bodies or Task 2 edits.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '30s';
do $guard$
begin
  if current_user <> 'supabase_admin'
     or current_setting('letscube.task3.isolated_schema_copy', true) is distinct from 'yes' then
    raise exception 'Task 3 rehearsal requires supabase_admin and isolated-schema-copy opt-in';
  end if;
  if exists (select 1 from auth.users) or exists (select 1 from auth.sessions)
     or exists (select 1 from public.profiles) or exists (select 1 from public.chats)
     or exists (select 1 from public.user_push_devices) or exists (select 1 from public.voice_ring_push_events)
     or exists (select 1 from net.http_request_queue)
     or exists (select 1 from vault.decrypted_secrets where name in ('kub_project_url','kub_push_dispatch_token')) then
    raise exception 'Task 3 rehearsal requires empty offline clone and absent wake secrets';
  end if;
  if (select enabled from private.voice_push_dispatch_config where singleton) is distinct from false then
    raise exception 'Task 3 rehearsal requires disabled install';
  end if;
end
$guard$;

-- Same bounded synthetic-onboarding bootstrap as the reviewed Task 2a rehearsal.
-- Restore EXACT trigger modes before any call/dispatch behavior; never alter RLS.
create temp table task3_onboarding on commit drop as select tgrelid,tgname,tgenabled from pg_trigger
where not tgisinternal and ((tgrelid='auth.users'::regclass and tgname='on_auth_user_created')
  or (tgrelid='public.profiles'::regclass and tgname in ('trg_registration_invite_apply_from_profile','trg_bootstrap_first_admin')));
do $bootstrap$
declare t record;
begin
  for t in select * from task3_onboarding loop
    execute format('alter table %s disable trigger %I', t.tgrelid::regclass, t.tgname);
  end loop;
end
$bootstrap$;
create temp table task3_fixture(caller uuid,recipient uuid,session1 uuid,session2 uuid,chat uuid,room uuid);
insert into task3_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null);
insert into auth.users(id) select caller from task3_fixture union all select recipient from task3_fixture;
insert into public.profiles(id,full_name) select caller,'Synthetic caller' from task3_fixture union all select recipient,'Synthetic recipient' from task3_fixture;
do $restore$
declare t record;
begin
  for t in select * from task3_onboarding loop
    execute format('alter table %s %s trigger %I',t.tgrelid::regclass,
      case t.tgenabled when 'D' then 'disable' when 'R' then 'enable replica' when 'A' then 'enable always' else 'enable' end,t.tgname);
  end loop;
  if exists(select 1 from task3_onboarding b left join pg_trigger actual on actual.tgrelid=b.tgrelid and actual.tgname=b.tgname
    where actual.tgenabled is distinct from b.tgenabled) then raise exception 'Task 3 onboarding trigger restore failed'; end if;
end
$restore$;
insert into auth.sessions(id,user_id,not_after)
  select session1,recipient,null::timestamptz from task3_fixture union all
  select session2,recipient,now()+interval '1 hour' from task3_fixture;
insert into public.chats(id,type,created_by) select chat,'private',caller from task3_fixture;
insert into public.chat_members(chat_id,user_id,role)
  select chat,caller,'owner'::public.chat_member_role from task3_fixture union all
  select chat,recipient,'member'::public.chat_member_role from task3_fixture on conflict do nothing;
insert into public.user_push_devices(user_id,platform,provider,token,token_hash,session_id,voice_call_protocol)
  select recipient,'android','fcm',repeat('synthetic-device-1-',4),repeat('1',64),session1,1 from task3_fixture union all
  select recipient,'android','fcm',repeat('synthetic-device-2-',4),repeat('2',64),session1,1 from task3_fixture union all
  select recipient,'android','fcm',repeat('synthetic-device-3-',4),repeat('3',64),session2,1 from task3_fixture;
grant select,update on task3_fixture to authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',caller)::text,true) is not null as claims_set from task3_fixture;
set local role authenticated;
update task3_fixture set room=(select channel_id from public.voice_call_ring(chat));
set local role supabase_admin;
create temp table task3_claims(event_id uuid,push_device_id uuid,claim_id uuid);
grant select,insert,delete on task3_claims to service_role;
set local role service_role;
do $disabled$
begin
  if exists(select 1 from public.voice_push_claim(20,gen_random_uuid())) then raise exception 'Task 3 disabled claim leaked'; end if;
  if has_any_column_privilege(current_user,'public.voice_ring_push_devices','UPDATE')
     or has_any_column_privilege(current_user,'public.voice_ring_push_events','UPDATE') then
    raise exception 'Task 3 service direct UPDATE survived';
  end if;
end
$disabled$;
set local role supabase_admin;
do $no_wake$
begin
  if exists(select 1 from net.http_request_queue) then raise exception 'Task 3 disabled wake queued'; end if;
  perform vault.create_secret('http://kong:8000','kub_project_url');
  perform vault.create_secret('synthetic-dispatch-auth','kub_push_dispatch_token');
end
$no_wake$;
update private.voice_push_dispatch_config set enabled=true;
set local role service_role;
insert into task3_claims select * from public.voice_push_claim(20,gen_random_uuid());
do $prepared$
declare c record; p record;
begin
  if (select count(*) from task3_claims) <> 3 then raise exception 'Task 3 expected three claims'; end if;
  for c in select * from task3_claims loop
    select * into p from public.voice_push_prepare(c.event_id,c.push_device_id,c.claim_id);
    if not found or p.protocol_version <> 1 or p.event <> 'ring' or p.expires_at-p.ring_started_at <> interval '45 seconds'
       or p.claimed_until > p.expires_at or p.token is null or p.token_hash is null then
      raise exception 'Task 3 prepared DTO mismatch';
    end if;
    if public.voice_push_complete(c.event_id,c.push_device_id,gen_random_uuid(),'accepted',null,null) then
      raise exception 'Task 3 stale claim acknowledged';
    end if;
  end loop;
end
$prepared$;
set local role supabase_admin;
create temp table task3_target as select * from task3_claims order by event_id,push_device_id limit 1;
grant select,insert,delete on task3_target to service_role;
set local role service_role;
do $retry1$
declare c record;
begin
  select * into c from task3_target;
  if not public.voice_push_complete(c.event_id,c.push_device_id,c.claim_id,'retry',null,null) then raise exception 'Task 3 first retry refused'; end if;
end
$retry1$;
set local role supabase_admin;
do $delay1$
begin
  if not exists(select 1 from public.voice_ring_push_devices d join task3_target t using(event_id,push_device_id)
    where d.state='pending' and d.attempts=1 and d.next_attempt_at-d.updated_at=interval '2 seconds') then
    raise exception 'Task 3 first retry not literal 2 seconds';
  end if;
end
$delay1$;
update public.voice_ring_push_devices d set next_attempt_at=clock_timestamp()-interval '1 second'
  from task3_target t where d.event_id=t.event_id and d.push_device_id=t.push_device_id;
set local role service_role;
delete from task3_target;
insert into task3_target select * from public.voice_push_claim(20,gen_random_uuid());
do $retry2$
declare c record;
begin
  if (select count(*) from task3_target) <> 1 then raise exception 'Task 3 unexpected second claim set'; end if;
  select * into c from task3_target;
  if not public.voice_push_complete(c.event_id,c.push_device_id,c.claim_id,'retry',1000,null) then raise exception 'Task 3 second retry refused'; end if;
end
$retry2$;
set local role supabase_admin;
do $delay2$
begin
  if not exists(select 1 from public.voice_ring_push_devices d join task3_target t using(event_id,push_device_id)
    where d.state='pending' and d.attempts=2 and d.next_attempt_at-d.updated_at=interval '4 seconds') then
    raise exception 'Task 3 second retry not literal 4 seconds';
  end if;
end
$delay2$;

select set_config('request.jwt.claims',jsonb_build_object('sub',caller)::text,true) is not null as claims_set from task3_fixture;
set local role authenticated;
select public.voice_call_stop(room,'cancelled') is not null as stopped from task3_fixture;
set local role supabase_admin;
do $wake$
begin
  if (select count(*) from net.http_request_queue) <> 1
     or not exists(select 1 from net.http_request_queue where method='POST'
       and url='http://kong:8000/functions/v1/send-push-notifications'
       and convert_from(body,'UTF8')::jsonb='{"scope":"voice","limit":20}'::jsonb
       and headers->>'x-kub-push-token'='synthetic-dispatch-auth' and timeout_milliseconds=25000) then
    raise exception 'Task 3 transactional synthetic wake mismatch';
  end if;
end
$wake$;
set local role service_role;
do $cancel$
declare c record; p record;
begin
  for c in select * from task3_claims loop
    if public.voice_push_complete(c.event_id,c.push_device_id,c.claim_id,'invalid_token',null,repeat('1',64)) then
      raise exception 'Task 3 cancelled ring acknowledged';
    end if;
  end loop;
  for c in select * from public.voice_push_claim(20,gen_random_uuid()) loop
    select * into p from public.voice_push_prepare(c.event_id,c.push_device_id,c.claim_id);
    if not found or p.event <> 'cancel' then raise exception 'Task 3 cancel requires old active ring'; end if;
    if not public.voice_push_complete(c.event_id,c.push_device_id,c.claim_id,'accepted',null,null) then
      raise exception 'Task 3 cancel completion failed';
    end if;
  end loop;
end
$cancel$;
set local role supabase_admin;
do $final$
begin
  if (select count(*) from public.voice_ring_push_devices d join public.voice_ring_push_events e on e.id=d.event_id
    where e.event='cancel' and d.state='accepted') <> 3 then raise exception 'Task 3 expected three accepted cancels'; end if;
  if exists(select 1 from public.user_push_devices where not enabled or revoked_at is not null) then
    raise exception 'Task 3 stale invalid-token result revoked a device';
  end if;
end
$final$;
rollback;
