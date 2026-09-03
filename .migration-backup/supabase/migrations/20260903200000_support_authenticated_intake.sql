-- Support intake for people who are already signed in.
--
-- The schema was built for this from the start — `support_tickets.source`
-- already allows 'authenticated' and `requester_user_id` already exists, and
-- the read policies already let a person see their own tickets and their
-- messages. What was missing was any way to write one: the only intake path is
-- the guest gateway, which demands a captcha, a name, an email and a phone from
-- someone the application has already identified.
--
-- So this adds the two writes, and nothing else. Reads stay on RLS, status
-- transitions and events stay on the existing triggers, and operators keep
-- working the same queue.
--
-- Additive and idempotent: two new functions and one widened CHECK.

-- The rate-limit ledger scopes a signal by what it can attribute an action to.
-- For a signed-in person that is the account, which the existing list has no
-- name for. `scope_hash` stays a 64-hex digest, so the shape is unchanged.
alter table public.support_rate_limit_signals
  drop constraint if exists support_rate_limit_signals_scope_kind_check;
alter table public.support_rate_limit_signals
  add constraint support_rate_limit_signals_scope_kind_check
  check (scope_kind = any (array['ip', 'ip_prefix', 'email', 'phone', 'session', 'user']));

create or replace function public.support_user_scope_hash(p_user_id uuid)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $function$
  select encode(sha256(('support-user:' || p_user_id::text)::bytea), 'hex');
$function$;

create or replace function public.support_user_ticket_create(
  p_category text,
  p_subject text,
  p_message text,
  p_client text default 'web'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_user uuid := auth.uid();
  v_settings public.support_settings%rowtype;
  v_scope text;
  v_ticket_id uuid;
  v_reference text;
  v_short_count bigint;
  v_day_count bigint;
  v_open_count bigint;
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_subject text := btrim(coalesce(p_subject, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_client text := lower(btrim(coalesce(p_client, 'web')));
begin
  if v_user is null then
    raise exception 'support_not_authenticated' using errcode = 'P0001';
  end if;

  if length(v_subject) not between 3 and 180
     or length(v_message) not between 1 and 8000
     or v_client not in ('web', 'android', 'windows')
     or v_category not in (
       'account',
       'access',
       'technical',
       'messages',
       'media',
       'tasks',
       'privacy',
       'abuse',
       'other'
     ) then
    raise exception 'support_request_invalid' using errcode = 'P0001';
  end if;

  select settings.*
  into v_settings
  from public.support_settings settings
  where settings.id is true
  for share;

  -- `guest_intake_enabled` deliberately does not apply here: closing the door
  -- to anonymous requests should not cut off the people who are signed in.
  if not found or not v_settings.intake_enabled then
    raise exception 'support_intake_closed' using errcode = 'P0001';
  end if;

  v_scope := public.support_user_scope_hash(v_user);
  perform pg_advisory_xact_lock(hashtextextended('support:user:' || v_scope, 0));

  select count(*)
  into v_short_count
  from public.support_rate_limit_signals signal
  where signal.scope_kind = 'user'
    and signal.scope_hash = v_scope
    and signal.action = 'ticket_create'
    and signal.created_at >= v_now - interval '15 minutes';

  select count(*)
  into v_day_count
  from public.support_rate_limit_signals signal
  where signal.scope_kind = 'user'
    and signal.scope_hash = v_scope
    and signal.action = 'ticket_create'
    and signal.created_at >= v_now - interval '1 day';

  if v_short_count >= v_settings.ticket_limit_15m
     or v_day_count >= v_settings.ticket_limit_day then
    raise exception 'support_rate_limited' using errcode = 'P0001';
  end if;

  -- A guest is bounded by their address and phone number; an account is not,
  -- so an open-ticket cap keeps one person from filling the operators' queue.
  select count(*)
  into v_open_count
  from public.support_tickets ticket
  where ticket.requester_user_id = v_user
    and ticket.status not in ('resolved', 'closed', 'spam');

  if v_open_count >= 5 then
    raise exception 'support_open_ticket_limit' using errcode = 'P0001';
  end if;

  insert into public.support_tickets (
    requester_user_id,
    source,
    status,
    category,
    subject,
    priority,
    last_activity_at
  )
  values (v_user, 'authenticated', 'new', v_category, v_subject, 'normal', v_now)
  returning id, public_reference into v_ticket_id, v_reference;

  insert into public.support_rate_limit_signals (
    scope_kind, scope_hash, action, ticket_id, expires_at, created_at
  )
  values ('user', v_scope, 'ticket_create', v_ticket_id, v_now + interval '90 days', v_now);

  perform public._support_append_event(
    v_ticket_id,
    'ticket_created',
    v_user,
    jsonb_build_object('source', 'authenticated')
  );

  -- The trigger on this insert sets the status, the activity timestamps and
  -- the requester_message event, exactly as it does for a guest.
  insert into public.support_ticket_messages (
    ticket_id, author_user_id, author_kind, source, body
  )
  values (v_ticket_id, v_user, 'requester', v_client, v_message);

  return jsonb_build_object('id', v_ticket_id, 'publicReference', v_reference);
end
$function$;

create or replace function public.support_user_message_create(
  p_ticket_id uuid,
  p_body text,
  p_client text default 'web'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_user uuid := auth.uid();
  v_settings public.support_settings%rowtype;
  v_ticket public.support_tickets%rowtype;
  v_scope text;
  v_message_id uuid;
  v_short_count bigint;
  v_day_count bigint;
  v_body text := btrim(coalesce(p_body, ''));
  v_client text := lower(btrim(coalesce(p_client, 'web')));
begin
  if v_user is null then
    raise exception 'support_not_authenticated' using errcode = 'P0001';
  end if;

  if length(v_body) not between 1 and 8000
     or v_client not in ('web', 'android', 'windows') then
    raise exception 'support_message_invalid' using errcode = 'P0001';
  end if;

  -- Ownership is checked here rather than trusted from the caller: this
  -- function is security definer, so RLS does not apply inside it.
  select ticket.*
  into v_ticket
  from public.support_tickets ticket
  where ticket.id = p_ticket_id
  for update;

  if not found or v_ticket.requester_user_id is distinct from v_user then
    raise exception 'support_ticket_not_found' using errcode = 'P0001';
  end if;

  if v_ticket.status in ('closed', 'spam') then
    raise exception 'support_ticket_closed' using errcode = 'P0001';
  end if;

  select settings.*
  into v_settings
  from public.support_settings settings
  where settings.id is true;

  if not found or not v_settings.intake_enabled then
    raise exception 'support_intake_closed' using errcode = 'P0001';
  end if;

  v_scope := public.support_user_scope_hash(v_user);
  perform pg_advisory_xact_lock(hashtextextended('support:user:' || v_scope, 0));

  select count(*)
  into v_short_count
  from public.support_rate_limit_signals signal
  where signal.scope_kind = 'user'
    and signal.scope_hash = v_scope
    and signal.action = 'message_create'
    and signal.created_at >= v_now - interval '5 minutes';

  select count(*)
  into v_day_count
  from public.support_rate_limit_signals signal
  where signal.scope_kind = 'user'
    and signal.scope_hash = v_scope
    and signal.action = 'message_create'
    and signal.created_at >= v_now - interval '1 day';

  if v_short_count >= v_settings.message_limit_5m
     or v_day_count >= v_settings.message_limit_day then
    raise exception 'support_message_rate_limited' using errcode = 'P0001';
  end if;

  insert into public.support_ticket_messages (
    ticket_id, author_user_id, author_kind, source, body
  )
  values (p_ticket_id, v_user, 'requester', v_client, v_body)
  returning id into v_message_id;

  insert into public.support_rate_limit_signals (
    scope_kind, scope_hash, action, ticket_id, expires_at, created_at
  )
  values ('user', v_scope, 'message_create', p_ticket_id, v_now + interval '90 days', v_now);

  return jsonb_build_object('id', v_message_id, 'createdAt', v_now);
end
$function$;

revoke all on function public.support_user_scope_hash(uuid) from public;
revoke all on function public.support_user_ticket_create(text, text, text, text) from public;
revoke all on function public.support_user_message_create(uuid, text, text) from public;

-- Supabase's default privileges hand `anon` execute on new functions, and
-- revoking from PUBLIC does not take a direct grant away. Both functions would
-- refuse an anonymous caller anyway — `auth.uid()` is null — but the guest
-- intake is the anonymous path and this one should not be reachable at all.
revoke all on function public.support_user_scope_hash(uuid) from anon;
revoke all on function public.support_user_ticket_create(text, text, text, text) from anon;
revoke all on function public.support_user_message_create(uuid, text, text) from anon;

grant execute on function public.support_user_ticket_create(text, text, text, text) to authenticated;
grant execute on function public.support_user_message_create(uuid, text, text) to authenticated;
