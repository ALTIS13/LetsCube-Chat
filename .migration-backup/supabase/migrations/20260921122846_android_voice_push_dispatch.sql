-- Task 3, disabled proposal. Apply ONLY as supabase_admin after Tasks 2a/2b.
-- Rollback: 20260921122846_android_voice_push_dispatch.rollback.sql, before 2b/2a.
-- Existing Task 2 sources/functions and minute cron are not replaced.
-- Repeats/drift are refused before DDL. No runtime activation is performed here.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '30s';

do $baseline$
declare v_table regclass; v_columns text[];
begin
  if current_user <> 'supabase_admin'
     or not exists (select 1 from pg_roles where rolname = current_user and rolsuper and rolbypassrls) then
    raise exception 'Task 3 requires supabase_admin (SUPERUSER, BYPASSRLS)';
  end if;
  if to_regclass('private.voice_push_dispatch_config') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where (n.nspname = 'public' and p.proname in ('voice_push_claim', 'voice_push_prepare', 'voice_push_complete'))
          or (n.nspname = 'private' and p.proname in ('voice_push_eligible', 'voice_push_wake')))
     or exists (select 1 from pg_trigger where tgrelid = 'public.voice_ring_push_devices'::regclass
       and tgname = 'trg_voice_push_wake') then
    raise exception 'Task 3 already installed or object drift; inspect and explicitly rollback';
  end if;
  if (select nspowner from pg_namespace where nspname = 'private') is distinct from 'postgres'::regrole::oid
     or (select relowner from pg_class where oid = 'public.user_push_devices'::regclass) <> 'postgres'::regrole then
    raise exception 'Task 3 private/device owner drift';
  end if;
  foreach v_table in array array['public.voice_ring_push_events'::regclass, 'public.voice_ring_push_devices'::regclass] loop
    if not exists (select 1 from pg_class where oid = v_table and relrowsecurity and relowner = 'supabase_admin'::regrole)
       or has_table_privilege('service_role', v_table, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or not has_table_privilege('service_role', v_table, 'SELECT') then
      raise exception 'Task 3 Task 2 table owner/RLS/ACL baseline mismatch';
    end if;
    select array_agg(attname::text order by attname) into v_columns from pg_attribute
      where attrelid = v_table and attnum > 0 and not attisdropped
        and has_column_privilege('service_role', v_table, attnum, 'UPDATE');
    if (v_table = 'public.voice_ring_push_events'::regclass and v_columns is distinct from array['state','terminal_at','updated_at'])
       or (v_table = 'public.voice_ring_push_devices'::regclass and v_columns is distinct from
         array['attempts','claim_id','claimed_until','last_attempt_at','next_attempt_at','state','updated_at']) then
      raise exception 'Task 3 Task 2 operational UPDATE baseline mismatch';
    end if;
  end loop;
end
$baseline$;

create table private.voice_push_dispatch_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
alter table private.voice_push_dispatch_config owner to supabase_admin;
alter table private.voice_push_dispatch_config enable row level security;
revoke all on table private.voice_push_dispatch_config from public, anon, authenticated, service_role;
insert into private.voice_push_dispatch_config(singleton) values (true);
comment on table private.voice_push_dispatch_config is 'Task 3 owner-only SQL dispatch gate; disabled on install. No client/service setter.';

revoke update (state, terminal_at, updated_at) on public.voice_ring_push_events from service_role;
revoke update (state, attempts, next_attempt_at, claim_id, claimed_until, last_attempt_at, updated_at)
  on public.voice_ring_push_devices from service_role;

create function private.voice_push_eligible(p_event_id uuid, p_push_device_id uuid, p_now timestamptz)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1
      from public.voice_ring_push_events e
      join public.voice_ring_push_devices captured on captured.event_id = e.id and captured.push_device_id = p_push_device_id
      join public.voice_channels vc on vc.id = e.channel_id and vc.chat_id = e.chat_id
      join public.chats chat on chat.id = e.chat_id
      join public.chat_members caller on caller.chat_id = e.chat_id and caller.user_id = e.caller_user_id
      join public.chat_members recipient on recipient.chat_id = e.chat_id and recipient.user_id = e.recipient_user_id
      join auth.sessions session on session.id = e.recipient_session_id and session.user_id = e.recipient_user_id
      left join public.user_session_settings settings on settings.session_id = session.id
      join public.user_push_devices device on device.id = captured.push_device_id
        and device.user_id = e.recipient_user_id and device.session_id = e.recipient_session_id
     where e.id = p_event_id and e.state = 'pending'
       and e.ring_started_at <= p_now and e.expires_at > p_now
       and e.expires_at > e.ring_started_at and e.expires_at <= e.ring_started_at + interval '45 seconds'
       and e.caller_user_id <> e.recipient_user_id and chat.type = 'private' and not vc.archived
       and not public.is_banned(e.caller_user_id) and not public.is_banned(e.recipient_user_id)
       and not public.is_muted(e.caller_user_id, e.chat_id) and not public.is_muted(e.recipient_user_id, e.chat_id)
       and not public.blocked_from_chat(e.chat_id, e.caller_user_id)
       and not public.blocked_from_chat(e.chat_id, e.recipient_user_id)
       and (session.not_after is null or session.not_after > p_now)
       and coalesce(settings.calls_enabled, true)
       and device.platform = 'android' and device.provider = 'fcm' and device.voice_call_protocol = 1
       and device.enabled and device.revoked_at is null
       and (e.event = 'cancel' or (e.event = 'ring'
         and vc.ring_caller = e.caller_user_id and vc.ring_started_at = e.ring_started_at
         and vc.ring_answered_at is null and vc.ring_started_at + interval '45 seconds' > p_now))
  );
$function$;
alter function private.voice_push_eligible(uuid, uuid, timestamptz) owner to supabase_admin;
revoke all on function private.voice_push_eligible(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;

-- ACL is the trusted-call boundary, not current_user inside SECURITY DEFINER.
-- The owner can rehearse directly; PostgREST exposes EXECUTE only to service_role.
create function public.voice_push_claim(p_limit integer, p_claim_id uuid)
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
alter function public.voice_push_claim(integer, uuid) owner to supabase_admin;
revoke all on function public.voice_push_claim(integer, uuid) from public, anon, authenticated;
grant execute on function public.voice_push_claim(integer, uuid) to service_role;

create function public.voice_push_prepare(p_event_id uuid, p_push_device_id uuid, p_claim_id uuid)
returns table (
  event_id uuid, push_device_id uuid, claim_id uuid, protocol_version integer, event text,
  chat_id uuid, channel_id uuid, caller_id uuid, recipient_id uuid, recipient_session_id uuid,
  ring_started_at timestamptz, expires_at timestamptz, claimed_until timestamptz, token text, token_hash text
)
language plpgsql security definer set search_path = '' as $function$
declare v_claim public.voice_ring_push_devices%rowtype; v_now timestamptz;
begin
  if not coalesce((select enabled from private.voice_push_dispatch_config where singleton), false) then return; end if;
  -- Match Task 2 lock order: channel before outcome. A concurrent stop either
  -- precedes this validation or waits for this transaction, never a lock cycle.
  perform 1 from public.voice_channels vc join public.voice_ring_push_events e on e.channel_id = vc.id
    where e.id = p_event_id for share of vc;
  select d.* into v_claim from public.voice_ring_push_devices d
    where d.event_id = p_event_id and d.push_device_id = p_push_device_id for update;
  if not found or v_claim.state <> 'claimed' or v_claim.claim_id is distinct from p_claim_id then return; end if;
  -- Hold the binding between validation and token projection. Registration may
  -- rotate/rebind after commit, but cannot substitute a different account here.
  perform 1 from public.user_push_devices where id = p_push_device_id for share;
  v_now := pg_catalog.clock_timestamp();
  if not private.voice_push_eligible(p_event_id, p_push_device_id, v_now) then
    update public.voice_ring_push_devices d set state = 'terminal', claim_id = null, claimed_until = null, updated_at = v_now
      where d.event_id = p_event_id and d.push_device_id = p_push_device_id;
    return;
  end if;
  if v_claim.claimed_until <= v_now then return; end if;
  return query select e.id, d.push_device_id, d.claim_id, 1, e.event, e.chat_id, e.channel_id,
      e.caller_user_id, e.recipient_user_id, e.recipient_session_id, e.ring_started_at, e.expires_at,
      d.claimed_until, device.token, device.token_hash
    from public.voice_ring_push_events e join public.voice_ring_push_devices d on d.event_id = e.id
    join public.user_push_devices device on device.id = d.push_device_id
    where e.id = p_event_id and d.push_device_id = p_push_device_id;
end
$function$;
alter function public.voice_push_prepare(uuid, uuid, uuid) owner to supabase_admin;
revoke all on function public.voice_push_prepare(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.voice_push_prepare(uuid, uuid, uuid) to service_role;

create function public.voice_push_complete(
  p_event_id uuid, p_push_device_id uuid, p_claim_id uuid, p_result text, p_retry_after_ms integer, p_token_hash text
) returns boolean language plpgsql security definer set search_path = '' as $function$
declare
  v_claim public.voice_ring_push_devices%rowtype;
  v_event public.voice_ring_push_events%rowtype;
  v_now timestamptz;
  v_next timestamptz;
  v_delay integer;
  v_state text := 'terminal';
begin
  if not coalesce((select enabled from private.voice_push_dispatch_config where singleton), false) then return false; end if;
  if p_result is null or p_result not in ('accepted', 'retry', 'invalid_token', 'discarded') then
    raise exception 'voice_push_bad_result' using errcode = '22023';
  end if;
  perform 1 from public.voice_channels vc join public.voice_ring_push_events e on e.channel_id = vc.id
    where e.id = p_event_id for share of vc;
  select d.* into v_claim from public.voice_ring_push_devices d
    where d.event_id = p_event_id and d.push_device_id = p_push_device_id for update;
  v_now := pg_catalog.clock_timestamp();
  if not found or v_claim.state <> 'claimed' or v_claim.claim_id is distinct from p_claim_id
     or v_claim.claimed_until <= v_now then return false; end if;
  -- Serialize a provider rejection with registration rotation/rebind. The hash
  -- is the server-produced value from prepare, used only as opaque CAS equality.
  perform 1 from public.user_push_devices where id = p_push_device_id for update;
  v_now := pg_catalog.clock_timestamp();
  if v_claim.claimed_until <= v_now then return false; end if;
  if not private.voice_push_eligible(p_event_id, p_push_device_id, v_now) then
    update public.voice_ring_push_devices d set state = 'terminal', claim_id = null, claimed_until = null, updated_at = v_now
      where d.event_id = p_event_id and d.push_device_id = p_push_device_id;
    return false;
  end if;
  select e.* into v_event from public.voice_ring_push_events e where e.id = p_event_id;
  if p_result = 'accepted' then
    v_state := 'accepted';
  elsif p_result = 'retry' and v_claim.attempts < 3 then
    v_delay := greatest(2000 * (1 << greatest(v_claim.attempts - 1, 0)), coalesce(p_retry_after_ms, 0));
    v_next := v_now + pg_catalog.make_interval(secs => v_delay::double precision / 1000.0);
    if v_next < v_event.expires_at then v_state := 'pending'; end if;
  elsif p_result = 'invalid_token' then
    update public.user_push_devices device set enabled = false, revoked_at = v_now, updated_at = v_now
      where device.id = p_push_device_id and device.token_hash = p_token_hash
        and device.user_id = v_event.recipient_user_id and device.session_id = v_event.recipient_session_id
        and device.platform = 'android' and device.provider = 'fcm' and device.voice_call_protocol = 1;
  end if;
  update public.voice_ring_push_devices d
     set state = v_state, claim_id = null, claimed_until = null,
         next_attempt_at = case when v_state = 'pending' then v_next else d.next_attempt_at end, updated_at = v_now
   where d.event_id = p_event_id and d.push_device_id = p_push_device_id;
  return true;
end
$function$;
alter function public.voice_push_complete(uuid, uuid, uuid, text, integer, text) owner to supabase_admin;
revoke all on function public.voice_push_complete(uuid, uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.voice_push_complete(uuid, uuid, uuid, text, integer, text) to service_role;

create function private.voice_push_wake()
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
alter function private.voice_push_wake() owner to supabase_admin;
revoke all on function private.voice_push_wake() from public, anon, authenticated, service_role;
create trigger trg_voice_push_wake after insert on public.voice_ring_push_devices
  referencing new table as voice_push_new_rows for each statement execute function private.voice_push_wake();

do $check$
declare v_function regprocedure; v_table regclass;
begin
  if (select count(*) from private.voice_push_dispatch_config) <> 1
     or (select enabled from private.voice_push_dispatch_config where singleton) is distinct from false
     or not exists (select 1 from pg_class where oid = 'private.voice_push_dispatch_config'::regclass
       and relrowsecurity and relowner = 'supabase_admin'::regrole)
     or exists (select 1 from pg_class c, lateral aclexplode(c.relacl) a
       where c.oid = 'private.voice_push_dispatch_config'::regclass and a.grantee <> 'supabase_admin'::regrole::oid) then
    raise exception 'Task 3 config gate/owner/RLS/ACL self-check failed';
  end if;
  foreach v_table in array array['public.voice_ring_push_events'::regclass, 'public.voice_ring_push_devices'::regclass] loop
    if has_any_column_privilege('service_role', v_table, 'UPDATE')
       or has_table_privilege('service_role', v_table, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or not has_table_privilege('service_role', v_table, 'SELECT') then
      raise exception 'Task 3 direct service write privilege self-check failed';
    end if;
  end loop;
  foreach v_function in array array[
    'private.voice_push_eligible(uuid,uuid,timestamptz)'::regprocedure, 'private.voice_push_wake()'::regprocedure,
    'public.voice_push_claim(integer,uuid)'::regprocedure, 'public.voice_push_prepare(uuid,uuid,uuid)'::regprocedure,
    'public.voice_push_complete(uuid,uuid,uuid,text,integer,text)'::regprocedure
  ] loop
    if not exists (select 1 from pg_proc where oid = v_function and prosecdef and proowner = 'supabase_admin'::regrole
      and proconfig = array['search_path=""'])
      or exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = v_function and (a.grantee = 0 or a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid))) then
      raise exception 'Task 3 function owner/security/ACL self-check failed';
    end if;
    if (select pronamespace = 'public'::regnamespace from pg_proc where oid = v_function)
       is distinct from has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'Task 3 scoped service EXECUTE self-check failed';
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.voice_ring_push_devices'::regclass
    and tgname = 'trg_voice_push_wake' and tgfoid = 'private.voice_push_wake()'::regprocedure
    and tgtype = 4 and tgenabled = 'O' and tgnewtable = 'voice_push_new_rows') then
    raise exception 'Task 3 statement wake trigger self-check failed';
  end if;
end
$check$;
commit;
