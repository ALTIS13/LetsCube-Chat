-- Task 5 operational prerequisite PROPOSAL. Apply only as supabase_admin after Task 3.
-- No activation: existing SQL gate must be false; both new cron jobs are INACTIVE.
-- Rollback: 20260921153256_android_voice_push_operations.rollback.sql, before Task 3.
-- Requires pg_cron schedule_in_database and pg_net 0.20.3 response/queue shape.
-- Rehearse on the pinned isolated PG17 first; a source proposal is not authorization.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '30s';

do $baseline$
begin
  if current_user <> 'supabase_admin'
     or not exists (select 1 from pg_roles where rolname=current_user and rolsuper and rolbypassrls) then
    raise exception 'Task 5 requires supabase_admin (SUPERUSER, BYPASSRLS)';
  end if;
  if to_regclass('private.voice_push_wake_slots') is not null
     or to_regclass('private.voice_push_wake_stats') is not null
     or to_regprocedure('private.voice_push_tick()') is not null
     or to_regprocedure('private.voice_push_cleanup()') is not null
     or to_regprocedure('public.voice_push_health()') is not null
     or exists (select 1 from cron.job where jobname in ('letscube-voice-push-recovery','letscube-voice-push-cleanup')) then
    raise exception 'Task 5 already installed or object drift';
  end if;
  if (select enabled from private.voice_push_dispatch_config where singleton) is distinct from false
     or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.voice_push_claim(integer,uuid)'::regprocedure)
       is distinct from 'dae55bf14192d11dfca2a3f98ff6f7f0'
     or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='private.voice_push_wake()'::regprocedure)
       is distinct from 'c636db0d92576c5d6ee2fcaaea3147b3'
     or exists (select 1 from pg_proc where oid in ('public.voice_push_claim(integer,uuid)'::regprocedure,
       'private.voice_push_wake()'::regprocedure) and (proowner <> 'supabase_admin'::regrole or not prosecdef)) then
    raise exception 'Task 5 requires exact disabled Task 3 baseline';
  end if;
  if to_regprocedure('cron.schedule_in_database(text,text,text,text,text,boolean)') is null
     or to_regprocedure('cron.unschedule(bigint)') is null
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regclass('net._http_response') is null or to_regclass('net.http_request_queue') is null then
    raise exception 'Task 5 cron/net dependencies unavailable';
  end if;
end
$baseline$;

create table private.voice_push_wake_slots (
  slot smallint primary key check (slot between 1 and 4),
  request_id bigint unique,
  started_at timestamptz,
  check ((request_id is null) = (started_at is null))
);
alter table private.voice_push_wake_slots owner to supabase_admin;
alter table private.voice_push_wake_slots enable row level security;
revoke all on table private.voice_push_wake_slots from public, anon, authenticated, service_role;
insert into private.voice_push_wake_slots(slot) values (1),(2),(3),(4);
comment on table private.voice_push_wake_slots is 'Task 5 fixed four-slot transactional voice wake admission; no payload or response history.';

create table private.voice_push_wake_stats (
  singleton boolean primary key default true check (singleton),
  wake_http_success_count bigint not null default 0 check (wake_http_success_count >= 0),
  wake_http_failure_count bigint not null default 0 check (wake_http_failure_count >= 0),
  wake_http_timeout_count bigint not null default 0 check (wake_http_timeout_count >= 0)
);
alter table private.voice_push_wake_stats owner to supabase_admin;
alter table private.voice_push_wake_stats enable row level security;
revoke all on table private.voice_push_wake_stats from public, anon, authenticated, service_role;
insert into private.voice_push_wake_stats(singleton) values (true);
comment on table private.voice_push_wake_stats is 'Task 5 aggregate HTTP transport acknowledgements, enqueue/HTTP failures and response timeouts; NOT phone delivery.';

-- pg_net 0.20.3 indexes response creation time, not the request ID lookup we use.
create index voice_push_response_id_idx on net._http_response(id);
create index voice_push_request_id_idx on net.http_request_queue(id);
create index voice_ring_push_events_retention_idx on public.voice_ring_push_events(expires_at,id);

create or replace function public.voice_push_claim(p_limit integer, p_claim_id uuid)
returns table(event_id uuid, push_device_id uuid, claim_id uuid)
language plpgsql security definer set search_path = '' as $function$
declare
  v_row record;
  v_now timestamptz;
  v_live integer;
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 20));
begin
  if not coalesce((select enabled from private.voice_push_dispatch_config where singleton), false) then return; end if;
  if p_claim_id is null then raise exception 'voice_push_bad_claim' using errcode = '22023'; end if;
  -- Each SQL statement must see the preceding admission's commit, not a stale
  -- repeatable-read snapshot. PostgREST uses READ COMMITTED. Busy admission exits.
  if current_setting('transaction_isolation') <> 'read committed' then return; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(193712, 6) then return; end if;
  v_now := pg_catalog.clock_timestamp();
  select count(*)::integer into v_live from (
    select 1 from public.voice_ring_push_devices d join public.voice_ring_push_events e on e.id=d.event_id
    where d.state='claimed' and d.claimed_until > v_now and e.expires_at > v_now limit 16
  ) live;
  v_limit := least(v_limit, 16 - v_live);
  if v_limit <= 0 then return; end if;
  for v_row in
    select d.event_id, d.push_device_id, e.expires_at
      from public.voice_ring_push_devices d join public.voice_ring_push_events e on e.id = d.event_id
     where d.attempts < 3 and e.state = 'pending' and e.expires_at > pg_catalog.clock_timestamp()
       and ((d.state = 'pending' and d.next_attempt_at <= pg_catalog.clock_timestamp())
         or (d.state = 'claimed' and d.claimed_until <= pg_catalog.clock_timestamp()))
       and private.voice_push_eligible(d.event_id, d.push_device_id, pg_catalog.clock_timestamp())
     order by case when e.event = 'cancel' then 0 else 1 end, e.created_at, e.id, d.push_device_id
     limit v_limit for update of d skip locked
  loop
    v_now := pg_catalog.clock_timestamp();
    if not private.voice_push_eligible(v_row.event_id, v_row.push_device_id, v_now) then continue; end if;
    return query update public.voice_ring_push_devices d
       set state = 'claimed', attempts = d.attempts + 1, claim_id = p_claim_id,
           claimed_until = least(v_now + interval '15 seconds', v_row.expires_at),
           last_attempt_at = v_now, updated_at = v_now
     where d.event_id = v_row.event_id and d.push_device_id = v_row.push_device_id
     returning d.event_id, d.push_device_id, d.claim_id;
  end loop;
end
$function$;

create function private.voice_push_tick()
returns integer language plpgsql security definer set search_path = '' as $function$
declare
  v_now timestamptz;
  v_slot record;
  v_response record;
  v_found boolean;
  v_ready integer;
  v_inflight integer;
  v_needed integer;
  v_queued integer := 0;
  v_success integer := 0;
  v_failure integer := 0;
  v_timeout integer := 0;
  v_request bigint;
  v_url text;
  v_token text;
begin
  -- The gate precedes every Vault/net access, even response reconciliation.
  if not coalesce((select enabled from private.voice_push_dispatch_config where singleton), false) then return 0; end if;
  if current_setting('transaction_isolation') <> 'read committed' then return 0; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(193712, 5) then return 0; end if;
  v_now := pg_catalog.clock_timestamp();
  for v_slot in select slot,request_id,started_at from private.voice_push_wake_slots
    where request_id is not null order by slot for update skip locked
  loop
    -- Project only status/timeout/error presence. Never fetch response/error text.
    select r.status_code, r.timed_out, r.error_msg is not null as has_error into v_response
      from net._http_response r where r.id=v_slot.request_id limit 1;
    v_found := found;
    if v_found then
      if coalesce(v_response.timed_out,false) then v_timeout := v_timeout + 1;
      elsif not v_response.has_error and v_response.status_code between 200 and 299 then v_success := v_success + 1;
      else v_failure := v_failure + 1; end if;
    elsif v_slot.started_at <= v_now - interval '30 seconds' then
      -- Remove only our stale request if still queued, never generic push work.
      -- SKIP LOCKED avoids making a caller wait behind the pg_net worker.
      delete from net.http_request_queue q where q.ctid in (
        select stale.ctid from net.http_request_queue stale where stale.id=v_slot.request_id
        limit 1 for update skip locked
      );
      -- A locked/undeleted queue row still owns capacity. It is unsafe to
      -- replace it merely because the bookkeeping deadline elapsed.
      if exists (select 1 from net.http_request_queue where id=v_slot.request_id) then continue; end if;
      v_timeout := v_timeout + 1;
    else continue;
    end if;
    update private.voice_push_wake_slots set request_id=null,started_at=null where slot=v_slot.slot;
  end loop;
  if v_success + v_failure + v_timeout > 0 then
    update private.voice_push_wake_stats set
      wake_http_success_count=wake_http_success_count+v_success,
      wake_http_failure_count=wake_http_failure_count+v_failure,
      wake_http_timeout_count=wake_http_timeout_count+v_timeout where singleton;
  end if;
  select count(*)::integer into v_inflight from private.voice_push_wake_slots where request_id is not null;
  if v_inflight >= 4 then return 0; end if;
  select count(*)::integer into v_ready from (
    select 1 from public.voice_ring_push_devices d join public.voice_ring_push_events e on e.id=d.event_id
    where e.state='pending' and e.expires_at > v_now and d.attempts < 3
      and ((d.state='pending' and d.next_attempt_at <= v_now) or (d.state='claimed' and d.claimed_until <= v_now))
      and private.voice_push_eligible(d.event_id,d.push_device_id,v_now) limit 80
  ) ready;
  v_needed := least(4-v_inflight, (v_ready+19)/20-v_inflight);
  if v_needed <= 0 then return 0; end if;
  begin
    select decrypted_secret into strict v_url from vault.decrypted_secrets where name='kub_project_url';
    select decrypted_secret into strict v_token from vault.decrypted_secrets where name='kub_push_dispatch_token';
  exception when others then
    update private.voice_push_wake_stats set wake_http_failure_count=wake_http_failure_count+1 where singleton;
    return 0;
  end;
  v_url := pg_catalog.rtrim(pg_catalog.btrim(v_url), '/');
  if v_url is null or v_url not in ('https://core.letscube.ru','http://kong:8000')
     or v_token is null or pg_catalog.btrim(v_token)='' then
    update private.voice_push_wake_stats set wake_http_failure_count=wake_http_failure_count+1 where singleton;
    return 0;
  end if;
  for v_slot in select slot from private.voice_push_wake_slots where request_id is null
    order by slot limit v_needed for update skip locked
  loop
    begin
      v_request := net.http_post(
        url := v_url || '/functions/v1/send-push-notifications',
        body := '{"scope":"voice","limit":20}'::jsonb,
        headers := pg_catalog.jsonb_build_object('Content-Type','application/json','x-kub-push-token',v_token),
        timeout_milliseconds := 25000
      );
      if v_request is null then raise exception 'voice_push_missing_request_id'; end if;
      update private.voice_push_wake_slots set request_id=v_request,started_at=pg_catalog.clock_timestamp() where slot=v_slot.slot;
      v_queued := v_queued + 1;
    exception when others then
      update private.voice_push_wake_stats set wake_http_failure_count=wake_http_failure_count+1 where singleton;
      exit;
    end;
  end loop;
  return v_queued;
exception when others then
  -- Never propagate SQLERRM, credentials or network details to a ringing client.
  -- The exception subtransaction also rolls back slot/request writes together.
  return 0;
end
$function$;
alter function private.voice_push_tick() owner to supabase_admin;
revoke all on function private.voice_push_tick() from public, anon, authenticated, service_role;

create or replace function private.voice_push_wake()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if not coalesce((select enabled from private.voice_push_dispatch_config where singleton), false) then return null; end if;
  if exists (select 1 from voice_push_new_rows d join public.voice_ring_push_events e on e.id=d.event_id
    where d.state='pending' and e.state='pending' and e.expires_at > pg_catalog.clock_timestamp()) then
    perform private.voice_push_tick();
  end if;
  return null;
exception when others then return null;
end
$function$;

create function private.voice_push_cleanup()
returns table(outcomes_deleted integer, events_deleted integer)
language plpgsql security definer set search_path = '' as $function$
declare
  v_cutoff timestamptz := pg_catalog.transaction_timestamp() - interval '24 hours';
  v_event record;
  v_deleted integer;
begin
  outcomes_deleted := 0; events_deleted := 0;
  if not coalesce((select enabled from private.voice_push_dispatch_config where singleton), false) then return next; return; end if;
  if current_setting('transaction_isolation') <> 'read committed' then return next; return; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(193712, 7) then return next; return; end if;
  with doomed as (
    select d.event_id,d.push_device_id from public.voice_ring_push_events e
    join public.voice_ring_push_devices d on d.event_id=e.id
    where e.expires_at < v_cutoff order by e.expires_at,e.id,d.push_device_id
    limit 500 for update of d skip locked
  ) delete from public.voice_ring_push_devices d using doomed old
    where d.event_id=old.event_id and d.push_device_id=old.push_device_id;
  get diagnostics outcomes_deleted = row_count;
  -- Hold the parent lock, THEN recheck children using a new READ COMMITTED
  -- statement snapshot. A child may commit between selection and this lock.
  for v_event in
    select e.id from public.voice_ring_push_events e where e.expires_at < v_cutoff
      and not exists (select 1 from public.voice_ring_push_devices d where d.event_id=e.id)
    order by e.expires_at,e.id limit 500 for update of e skip locked
  loop
    delete from public.voice_ring_push_events e where e.id=v_event.id and e.expires_at < v_cutoff
      and not exists (select 1 from public.voice_ring_push_devices child where child.event_id=e.id);
    get diagnostics v_deleted = row_count;
    events_deleted := events_deleted + v_deleted;
  end loop;
  return next;
end
$function$;
alter function private.voice_push_cleanup() owner to supabase_admin;
revoke all on function private.voice_push_cleanup() from public, anon, authenticated, service_role;

create function public.voice_push_health()
returns table (
  enabled boolean, ready_count bigint, live_claimed_count bigint, oldest_ready_age_seconds double precision,
  expired_count bigint, wake_http_success_count bigint, wake_http_failure_count bigint,
  wake_http_timeout_count bigint, inflight_slots integer
)
language sql volatile security definer set search_path = '' as $function$
  with moment as materialized (select pg_catalog.clock_timestamp() as t),
  ready as (
    select e.created_at from public.voice_ring_push_devices d join public.voice_ring_push_events e on e.id=d.event_id
    cross join moment m where e.state='pending' and e.expires_at > m.t and d.attempts < 3
      and ((d.state='pending' and d.next_attempt_at <= m.t) or (d.state='claimed' and d.claimed_until <= m.t))
      and private.voice_push_eligible(d.event_id,d.push_device_id,m.t)
  )
  select coalesce((select c.enabled from private.voice_push_dispatch_config c where c.singleton),false),
    (select count(*) from ready),
    (select count(*) from public.voice_ring_push_devices d join public.voice_ring_push_events e on e.id=d.event_id
      where d.state='claimed' and d.claimed_until > m.t and e.expires_at > m.t),
    (select greatest(0,extract(epoch from m.t-min(created_at)))::double precision from ready having count(*)>0),
    (select count(*) from public.voice_ring_push_devices d join public.voice_ring_push_events e on e.id=d.event_id where e.expires_at <= m.t),
    s.wake_http_success_count,s.wake_http_failure_count,s.wake_http_timeout_count,
    (select count(*)::integer from private.voice_push_wake_slots where request_id is not null)
  from private.voice_push_wake_stats s cross join moment m where s.singleton;
$function$;
alter function public.voice_push_health() owner to supabase_admin;
revoke all on function public.voice_push_health() from public, anon, authenticated;
grant execute on function public.voice_push_health() to service_role;
comment on function public.voice_push_health() is 'Aggregate voice queue health. HTTP counts are transport acknowledgements, not provider acceptance or phone delivery; expired_count counts retained expired targets.';

select cron.schedule_in_database('letscube-voice-push-recovery','5 seconds',
  'select private.voice_push_tick();',current_database(),'supabase_admin',false);
select cron.schedule_in_database('letscube-voice-push-cleanup','* * * * *',
  'select private.voice_push_cleanup();',current_database(),'supabase_admin',false);

do $check$
declare v_table regclass; v_function regprocedure;
begin
  if (select enabled from private.voice_push_dispatch_config where singleton) is distinct from false
     or (select count(*) from private.voice_push_wake_slots) <> 4
     or exists (select 1 from private.voice_push_wake_slots where request_id is not null or started_at is not null)
     or (select count(*) from private.voice_push_wake_stats) <> 1 then
    raise exception 'Task 5 disabled gate/fixed slots self-check failed';
  end if;
  foreach v_table in array array['private.voice_push_wake_slots'::regclass,'private.voice_push_wake_stats'::regclass] loop
    if not exists (select 1 from pg_class where oid=v_table and relrowsecurity and relowner='supabase_admin'::regrole)
       or exists (select 1 from pg_class c,lateral aclexplode(c.relacl) a where c.oid=v_table and a.grantee<>'supabase_admin'::regrole::oid) then
      raise exception 'Task 5 private table owner/RLS/ACL self-check failed';
    end if;
  end loop;
  foreach v_function in array array['private.voice_push_tick()'::regprocedure,'private.voice_push_cleanup()'::regprocedure,
    'private.voice_push_wake()'::regprocedure,'public.voice_push_health()'::regprocedure,'public.voice_push_claim(integer,uuid)'::regprocedure] loop
    if not exists (select 1 from pg_proc where oid=v_function and proowner='supabase_admin'::regrole and prosecdef
       and proconfig @> array['search_path=""'])
       or has_function_privilege('anon',v_function,'EXECUTE') or has_function_privilege('authenticated',v_function,'EXECUTE')
       or (v_function::text like 'private.%' and has_function_privilege('service_role',v_function,'EXECUTE')) then
      raise exception 'Task 5 function owner/security/ACL self-check failed';
    end if;
  end loop;
  if not has_function_privilege('service_role','public.voice_push_health()','EXECUTE')
     or not has_function_privilege('service_role','public.voice_push_claim(integer,uuid)','EXECUTE')
     or (select count(*) from cron.job where jobname in ('letscube-voice-push-recovery','letscube-voice-push-cleanup')) <> 2
     or exists (select 1 from cron.job where jobname in ('letscube-voice-push-recovery','letscube-voice-push-cleanup')
       and (active or username<>'supabase_admin' or database<>current_database()
         or (jobname='letscube-voice-push-recovery' and (schedule<>'5 seconds' or command<>'select private.voice_push_tick();'))
         or (jobname='letscube-voice-push-cleanup' and (schedule<>'* * * * *' or command<>'select private.voice_push_cleanup();')))) then
    raise exception 'Task 5 inactive schedules/service RPC self-check failed';
  end if;
end
$check$;
commit;
