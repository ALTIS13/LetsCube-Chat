-- Roll back Task 5 BEFORE Task 3. No CASCADE, no outcome/event data reset.
-- Quiesce jobs, reconcile outstanding slots with tick while enabled, then disable
-- SQL dispatch. This refuses live slots instead of orphaning outstanding HTTP.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '30s';
do $guard$
begin
  if current_user <> 'supabase_admin' then raise exception 'Task 5 rollback requires supabase_admin'; end if;
  if (select enabled from private.voice_push_dispatch_config where singleton) is distinct from false
     or exists(select 1 from private.voice_push_wake_slots where request_id is not null) then
    raise exception 'Task 5 rollback requires disabled gate and reconciled slots';
  end if;
  if obj_description('private.voice_push_wake_slots'::regclass,'pg_class') is distinct from
    'Task 5 fixed four-slot transactional voice wake admission; no payload or response history.'
    or not exists(select 1 from pg_class where oid='private.voice_push_wake_slots'::regclass and relowner='supabase_admin'::regrole)
    or (select count(*) from cron.job where jobname in ('letscube-voice-push-recovery','letscube-voice-push-cleanup')) <> 2
    or exists(select 1 from cron.job where jobname in ('letscube-voice-push-recovery','letscube-voice-push-cleanup')
      and (username<>'supabase_admin' or database<>current_database()
        or (jobname='letscube-voice-push-recovery' and command<>'select private.voice_push_tick();')
        or (jobname='letscube-voice-push-cleanup' and command<>'select private.voice_push_cleanup();'))) then
    raise exception 'Task 5 rollback object/owner/job drift';
  end if;
end
$guard$;
select cron.unschedule(jobid) from cron.job
  where jobname in ('letscube-voice-push-recovery','letscube-voice-push-cleanup')
    and username='supabase_admin' and database=current_database();

create or replace function public.voice_push_claim(p_limit integer, p_claim_id uuid)
returns table(event_id uuid, push_device_id uuid, claim_id uuid)
language plpgsql security definer set search_path = '' as $function$
declare
  v_row record;
  v_now timestamptz;
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 20));
begin
  if not coalesce((select enabled from private.voice_push_dispatch_config where singleton), false) then return; end if;
  if p_claim_id is null then raise exception 'voice_push_bad_claim' using errcode = '22023'; end if;
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

create or replace function private.voice_push_wake()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_url text; v_token text;
begin
  -- This branch must precede ANY Vault/net access, including dependency probes.
  if not coalesce((select enabled from private.voice_push_dispatch_config where singleton), false) then return null; end if;
  if not exists (select 1 from voice_push_new_rows d join public.voice_ring_push_events e on e.id = d.event_id
    where d.state = 'pending' and e.state = 'pending' and e.expires_at > pg_catalog.clock_timestamp()) then return null; end if;
  select decrypted_secret into strict v_url from vault.decrypted_secrets where name = 'kub_project_url';
  select decrypted_secret into strict v_token from vault.decrypted_secrets where name = 'kub_push_dispatch_token';
  v_url := pg_catalog.rtrim(pg_catalog.btrim(v_url), '/');
  if v_url is null or v_url not in ('https://core.letscube.ru', 'http://kong:8000')
     or v_token is null or pg_catalog.btrim(v_token) = '' then return null; end if;
  perform net.http_post(
    url := v_url || '/functions/v1/send-push-notifications',
    body := '{"scope":"voice","limit":20}'::jsonb,
    headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json', 'x-kub-push-token', v_token),
    timeout_milliseconds := 25000
  );
  return null;
exception when others then
  -- Wake is an optimization. Never log SQLERRM/secret/provider details or fail
  -- the authoritative call. Minute polling cannot guarantee the 45-second TTL.
  return null;
end
$function$;

drop function public.voice_push_health();
drop function private.voice_push_tick();
drop function private.voice_push_cleanup();
drop table private.voice_push_wake_slots;
drop table private.voice_push_wake_stats;
drop index net.voice_push_response_id_idx;
drop index net.voice_push_request_id_idx;
drop index public.voice_ring_push_events_retention_idx;
do $check$
begin
  if to_regclass('private.voice_push_wake_slots') is not null
     or to_regclass('private.voice_push_wake_stats') is not null
     or to_regprocedure('private.voice_push_tick()') is not null
     or to_regprocedure('private.voice_push_cleanup()') is not null
     or to_regprocedure('public.voice_push_health()') is not null
     or exists(select 1 from cron.job where jobname in ('letscube-voice-push-recovery','letscube-voice-push-cleanup'))
     or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.voice_push_claim(integer,uuid)'::regprocedure)
       is distinct from 'dae55bf14192d11dfca2a3f98ff6f7f0'
     or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='private.voice_push_wake()'::regprocedure)
       is distinct from 'c636db0d92576c5d6ee2fcaaea3147b3' then
    raise exception 'Task 5 rollback failed exact Task 3 restore';
  end if;
end
$check$;
commit;
