-- Task 2b proposal only. Apply as supabase_admin after Task 2a and a verified
-- before-schema backup / isolated PG17 rehearsal. No sender or scheduler here.
-- Rollback: 20260921114127_android_voice_ring_outbox.rollback.sql.
-- Repeat policy: refuse ANY existing owned object before DDL (including an
-- identical install); inspect/rollback explicitly, never mask drift with IF NOT EXISTS.
-- Locks: finite DDL/FK locks on chats/voice_channels; no changes to existing RPCs.
-- Queue data is transient. Cascades only flow INTO these two new tables.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local idle_in_transaction_session_timeout = '30s';

do $baseline$
declare v_name text;
begin
  if current_user <> 'supabase_admin'
     or not exists (select 1 from pg_roles where rolname = current_user and rolsuper and rolbypassrls) then
    raise exception 'Task 2b requires supabase_admin (SUPERUSER, BYPASSRLS)';
  end if;
  if (select relowner from pg_class where oid = 'public.voice_channels'::regclass) <> 'supabase_admin'::regrole
     or (select relowner from pg_class where oid = 'public.user_session_settings'::regclass) <> 'supabase_admin'::regrole
     or (select relowner from pg_class where oid = 'public.user_push_devices'::regclass) <> 'postgres'::regrole
     or (select nspowner from pg_namespace where nspname = 'private') is distinct from 'postgres'::regrole::oid then
    raise exception 'Task 2b baseline owner drift';
  end if;
  for v_name in select unnest(array[
    'public.voice_call_ring(uuid)', 'public.voice_call_answer(uuid)',
    'public.voice_call_stop(uuid,text)', 'public.voice_rings_sweep_expired(integer,integer)',
    'public.blocked_from_chat(uuid,uuid)', 'public.is_banned(uuid)', 'public.is_muted(uuid,uuid)'
  ]) loop
    if to_regprocedure(v_name) is null then raise exception 'Task 2b missing baseline function: %', v_name; end if;
  end loop;
  if exists (
    select 1 from (values
      ('public.voice_channels', 'ring_started_at', 'timestamptz'::regtype),
      ('public.voice_channels', 'ring_answered_at', 'timestamptz'::regtype),
      ('public.voice_channels', 'ring_caller', 'uuid'::regtype),
      ('public.user_push_devices', 'session_id', 'uuid'::regtype),
      ('public.user_push_devices', 'voice_call_protocol', 'int2'::regtype),
      ('auth.sessions', 'not_after', 'timestamptz'::regtype),
      ('auth.sessions', 'user_id', 'uuid'::regtype)
    ) expected(tbl, col, typ)
    where not exists (select 1 from pg_attribute a where a.attrelid = to_regclass(expected.tbl)
      and a.attname = expected.col and a.atttypid = expected.typ and not a.attisdropped)
  ) then raise exception 'Task 2b prerequisite columns missing or incompatible'; end if;
  if not exists (select 1 from pg_constraint k
    where k.conrelid = 'public.user_push_devices'::regclass and k.contype = 'f'
      and k.confrelid = 'auth.sessions'::regclass and k.confdeltype = 'n'
      and k.conkey = array[(select attnum from pg_attribute where attrelid = k.conrelid and attname = 'session_id')]) then
    raise exception 'Task 2b requires Task 2a session binding FK with ON DELETE SET NULL';
  end if;
  if to_regclass('public.voice_ring_push_events') is not null
     or to_regclass('public.voice_ring_push_devices') is not null
     or exists (select 1 from pg_proc where pronamespace = 'private'::regnamespace
       and proname in ('voice_ring_push_finish', 'voice_ring_push_capture', 'voice_ring_push_chat_changed'))
     or exists (select 1 from pg_trigger where tgrelid in ('public.voice_channels'::regclass, 'public.chats'::regclass)
       and tgname in ('trg_voice_ring_push_capture', 'trg_voice_ring_push_chat_changed')) then
    raise exception 'Task 2b already installed or object drift; inspect and explicitly rollback before replay';
  end if;
end
$baseline$;

create table public.voice_ring_push_events (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null,
  recipient_session_id uuid not null,
  channel_id uuid not null references public.voice_channels(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  caller_user_id uuid not null,
  ring_started_at timestamptz not null,
  event text not null check (event in ('ring', 'cancel')),
  expires_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending', 'terminal')),
  terminal_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint voice_ring_push_events_recipient_check check (caller_user_id <> recipient_user_id),
  constraint voice_ring_push_events_expiry_check check (
    expires_at > ring_started_at and expires_at <= ring_started_at + interval '45 seconds'),
  constraint voice_ring_push_events_terminal_check check ((state = 'terminal') = (terminal_at is not null)),
  constraint voice_ring_push_events_identity unique (recipient_user_id, recipient_session_id, channel_id, ring_started_at, event)
);
alter table public.voice_ring_push_events owner to supabase_admin;
alter table public.voice_ring_push_events enable row level security;
revoke all on table public.voice_ring_push_events from public, anon, authenticated, service_role;
grant select on table public.voice_ring_push_events to service_role;
grant update (state, terminal_at, updated_at) on public.voice_ring_push_events to service_role;

create table public.voice_ring_push_devices (
  event_id uuid not null references public.voice_ring_push_events(id) on delete cascade,
  -- Not an FK: account rebind/device deletion must not rewrite captured targets.
  -- Task 3 MUST join this id to the event's user/session/protocol again at send.
  push_device_id uuid not null,
  state text not null default 'pending' check (state in ('pending', 'claimed', 'accepted', 'terminal')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  claim_id uuid,
  claimed_until timestamptz,
  last_attempt_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint voice_ring_push_devices_lease_check check (
    (state = 'claimed' and claim_id is not null and claimed_until is not null)
    or (state <> 'claimed' and claim_id is null and claimed_until is null)),
  constraint voice_ring_push_devices_identity primary key (event_id, push_device_id)
);
alter table public.voice_ring_push_devices owner to supabase_admin;
alter table public.voice_ring_push_devices enable row level security;
revoke all on table public.voice_ring_push_devices from public, anon, authenticated, service_role;
grant select on table public.voice_ring_push_devices to service_role;
grant update (state, attempts, next_attempt_at, claim_id, claimed_until, last_attempt_at, updated_at)
  on public.voice_ring_push_devices to service_role;
create index voice_ring_push_events_pending_idx on public.voice_ring_push_events(expires_at, id) where state = 'pending';
create index voice_ring_push_events_channel_idx on public.voice_ring_push_events(channel_id, ring_started_at);
create index voice_ring_push_events_chat_idx on public.voice_ring_push_events(chat_id);
create index voice_ring_push_devices_pending_idx on public.voice_ring_push_devices(next_attempt_at, event_id) where state = 'pending';
create index voice_ring_push_devices_lease_idx on public.voice_ring_push_devices(claimed_until) where state = 'claimed';

comment on table public.voice_ring_push_events is 'Task 2b: transient server-authored ring/cancel generations; not notifications or delivery receipts.';
comment on table public.voice_ring_push_devices is 'Task 2b: captured device ids and at-least-once attempt leases. accepted means provider acceptance, not delivery.';

create function private.voice_ring_push_finish(p_channel_id uuid, p_started_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $function$
declare v_now timestamptz := pg_catalog.clock_timestamp();
begin
  -- Snapshot recipients from the old event, never from current registrations.
  insert into public.voice_ring_push_events (
    recipient_user_id, recipient_session_id, channel_id, chat_id, caller_user_id,
    ring_started_at, event, expires_at, state, terminal_at
  )
  select recipient_user_id, recipient_session_id, channel_id, chat_id, caller_user_id,
         ring_started_at, 'cancel', expires_at,
         case when expires_at <= v_now then 'terminal' else 'pending' end,
         case when expires_at <= v_now then v_now else null end
    from public.voice_ring_push_events
   where channel_id = p_channel_id and ring_started_at = p_started_at and event = 'ring'
  on conflict on constraint voice_ring_push_events_identity do nothing;

  insert into public.voice_ring_push_devices (event_id, push_device_id, state)
  select cancelled.id, device.push_device_id,
         case when cancelled.state = 'terminal' then 'terminal' else 'pending' end
    from public.voice_ring_push_events original
    join public.voice_ring_push_devices device on device.event_id = original.id
    join public.voice_ring_push_events cancelled
      on cancelled.recipient_user_id = original.recipient_user_id
     and cancelled.recipient_session_id = original.recipient_session_id
     and cancelled.channel_id = original.channel_id
     and cancelled.ring_started_at = original.ring_started_at and cancelled.event = 'cancel'
   where original.channel_id = p_channel_id and original.ring_started_at = p_started_at and original.event = 'ring'
  on conflict on constraint voice_ring_push_devices_identity do nothing;

  update public.voice_ring_push_events
     set state = 'terminal', terminal_at = coalesce(terminal_at, v_now), updated_at = v_now
   where channel_id = p_channel_id and ring_started_at = p_started_at and event = 'ring';
  update public.voice_ring_push_devices d
     set state = 'terminal', claim_id = null, claimed_until = null, updated_at = v_now
    from public.voice_ring_push_events e
   where d.event_id = e.id and e.channel_id = p_channel_id
     and e.ring_started_at = p_started_at and e.event = 'ring';
end
$function$;
alter function private.voice_ring_push_finish(uuid, timestamptz) owner to supabase_admin;
revoke all on function private.voice_ring_push_finish(uuid, timestamptz) from public, anon, authenticated, service_role;

create function private.voice_ring_push_capture()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_type text;
begin
  if TG_OP = 'UPDATE' then
    if row(new.chat_id, new.archived, new.ring_started_at, new.ring_caller, new.ring_answered_at)
       is not distinct from row(old.chat_id, old.archived, old.ring_started_at, old.ring_caller, old.ring_answered_at) then
      return new;
    end if;
    if old.ring_started_at is not null then
      perform private.voice_ring_push_finish(old.id, old.ring_started_at);
    end if;
    -- Reopening/moving/relabeling an old generation never adds fresh recipients.
    if new.ring_started_at is not distinct from old.ring_started_at then return new; end if;
  end if;
  if new.archived or new.ring_started_at is null or new.ring_caller is null
     or new.ring_answered_at is not null or new.ring_started_at > v_now
     or new.ring_started_at + interval '45 seconds' <= v_now then return new; end if;

  -- Hold against concurrent type changes until the RPC transaction commits.
  select chat.type into v_type from public.chats chat where chat.id = new.chat_id for share;
  if v_type is distinct from 'private' then return new; end if;
  v_now := pg_catalog.clock_timestamp();
  if new.ring_started_at + interval '45 seconds' <= v_now then return new; end if;

  -- Explicit identities: auth.uid() here would be the caller, not the recipient.
  with eligible as materialized (
    select member.user_id, session.id as session_id, device.id as device_id
      from public.chats chat
      join public.chat_members caller on caller.chat_id = chat.id and caller.user_id = new.ring_caller
      join public.chat_members member on member.chat_id = chat.id
      join auth.sessions session on session.user_id = member.user_id
      left join public.user_session_settings settings on settings.session_id = session.id
      join public.user_push_devices device on device.user_id = member.user_id and device.session_id = session.id
     where chat.id = new.chat_id and chat.type = 'private'
       and member.user_id <> new.ring_caller
       and not public.is_banned(new.ring_caller) and not public.is_muted(new.ring_caller, new.chat_id)
       and not public.blocked_from_chat(new.chat_id, new.ring_caller)
       and not public.is_banned(member.user_id) and not public.is_muted(member.user_id, new.chat_id)
       and not public.blocked_from_chat(new.chat_id, member.user_id)
       and (session.not_after is null or session.not_after > v_now)
       and coalesce(settings.calls_enabled, true)
       and device.enabled and device.revoked_at is null
       and device.platform = 'android' and device.provider = 'fcm' and device.voice_call_protocol = 1
  ), captured as (
    insert into public.voice_ring_push_events (
      recipient_user_id, recipient_session_id, channel_id, chat_id, caller_user_id, ring_started_at, event, expires_at
    )
    select distinct user_id, session_id, new.id, new.chat_id, new.ring_caller, new.ring_started_at,
           'ring', new.ring_started_at + interval '45 seconds' from eligible
    on conflict on constraint voice_ring_push_events_identity do nothing
    returning id, recipient_user_id, recipient_session_id
  )
  insert into public.voice_ring_push_devices(event_id, push_device_id)
  select captured.id, eligible.device_id from captured join eligible
    on eligible.user_id = captured.recipient_user_id and eligible.session_id = captured.recipient_session_id
  on conflict on constraint voice_ring_push_devices_identity do nothing;
  return new;
end
$function$;
alter function private.voice_ring_push_capture() owner to supabase_admin;
revoke all on function private.voice_ring_push_capture() from public, anon, authenticated, service_role;

create trigger trg_voice_ring_push_capture
  after insert or update of chat_id, archived, ring_started_at, ring_caller, ring_answered_at
  on public.voice_channels for each row execute function private.voice_ring_push_capture();

-- Changing chat identity must not leave a ring queued for a now non-private chat.
-- Deletes use the owned-table FK cascades, so no privileged deletion hook is needed.
create function private.voice_ring_push_chat_changed()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_ring record;
begin
  if old.type is distinct from new.type then
    for v_ring in select distinct channel_id, ring_started_at from public.voice_ring_push_events
      where chat_id = old.id and event = 'ring' and state = 'pending'
    loop
      perform private.voice_ring_push_finish(v_ring.channel_id, v_ring.ring_started_at);
    end loop;
  end if;
  return new;
end
$function$;
alter function private.voice_ring_push_chat_changed() owner to supabase_admin;
revoke all on function private.voice_ring_push_chat_changed() from public, anon, authenticated, service_role;
create trigger trg_voice_ring_push_chat_changed after update of type on public.chats
  for each row execute function private.voice_ring_push_chat_changed();

do $check$
declare v_table regclass; v_function regprocedure; v_role text;
begin
  foreach v_table in array array['public.voice_ring_push_events'::regclass, 'public.voice_ring_push_devices'::regclass] loop
    if not exists (select 1 from pg_class where oid = v_table and relrowsecurity and relowner = 'supabase_admin'::regrole) then
      raise exception 'Task 2b RLS/owner self-check failed: %', v_table;
    end if;
    if exists (select 1 from pg_policy where polrelid = v_table)
       or exists (select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
         where c.oid = v_table and a.grantee = 0) then
      raise exception 'Task 2b unexpected policy/PUBLIC privilege: %', v_table;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_table_privilege(v_role, v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_any_column_privilege(v_role, v_table, 'SELECT,INSERT,UPDATE,REFERENCES') then
        raise exception 'Task 2b client privilege self-check failed: % %', v_role, v_table;
      end if;
    end loop;
    if not has_table_privilege('service_role', v_table, 'SELECT')
       or has_table_privilege('service_role', v_table, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or not has_column_privilege('service_role', v_table, 'state', 'UPDATE') then
      raise exception 'Task 2b service grant self-check failed: %', v_table;
    end if;
  end loop;
  foreach v_function in array array[
    'private.voice_ring_push_finish(uuid,timestamptz)'::regprocedure,
    'private.voice_ring_push_capture()'::regprocedure,
    'private.voice_ring_push_chat_changed()'::regprocedure
  ] loop
    if not exists (select 1 from pg_proc where oid = v_function and prosecdef
      and proowner = 'supabase_admin'::regrole and proconfig = array['search_path=""'])
      or exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = v_function and a.grantee <> 'supabase_admin'::regrole::oid) then
      raise exception 'Task 2b private function owner/security/EXECUTE self-check failed: %', v_function;
    end if;
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.voice_ring_push_events'::regclass
       and conname = 'voice_ring_push_events_identity' and contype = 'u')
     or not exists (select 1 from pg_constraint where conrelid = 'public.voice_ring_push_devices'::regclass
       and conname = 'voice_ring_push_devices_identity' and contype = 'p') then
    raise exception 'Task 2b unique identity self-check failed';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.voice_channels'::regclass
       and tgname = 'trg_voice_ring_push_capture' and tgfoid = 'private.voice_ring_push_capture()'::regprocedure
       and tgtype = 21 and tgenabled = 'O' and cardinality(tgattr::smallint[]) = 5)
     or not exists (select 1 from pg_trigger where tgrelid = 'public.chats'::regclass
       and tgname = 'trg_voice_ring_push_chat_changed' and tgfoid = 'private.voice_ring_push_chat_changed()'::regprocedure
       and tgtype = 17 and tgenabled = 'O' and cardinality(tgattr::smallint[]) = 1) then
    raise exception 'Task 2b narrow AFTER triggers self-check failed';
  end if;
end
$check$;
commit;
