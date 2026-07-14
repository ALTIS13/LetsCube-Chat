-- 20260714_push_foreground_sessions.sql
-- Global foreground leases and atomic Web Push outbox claiming.
-- Idempotent and additive so the currently deployed dispatcher remains
-- compatible until its Edge Function rollout completes.

begin;

create table if not exists public.push_foreground_sessions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null,
  current_chat_id uuid references public.chats(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, client_id)
);

create index if not exists push_foreground_sessions_expires_idx
  on public.push_foreground_sessions (expires_at);

create index if not exists push_foreground_sessions_user_expires_idx
  on public.push_foreground_sessions (user_id, expires_at desc);

alter table public.push_foreground_sessions enable row level security;
revoke all on table public.push_foreground_sessions from public, anon, authenticated;

alter table public.notifications_push_outbox
  add column if not exists suppressed_at timestamptz,
  add column if not exists suppression_reason text,
  add column if not exists claim_token uuid,
  add column if not exists claimed_until timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.notifications_push_outbox'::regclass
      and conname = 'notifications_push_outbox_suppression_reason_check'
  ) then
    alter table public.notifications_push_outbox
      add constraint notifications_push_outbox_suppression_reason_check
      check (
        suppression_reason is null
        or suppression_reason in ('read', 'coalesced', 'subscription_inactive')
      );
  end if;
end
$$;

drop index if exists public.notifications_push_outbox_pending_idx;
create index notifications_push_outbox_pending_idx
  on public.notifications_push_outbox (created_at)
  where sent_at is null
    and suppressed_at is null
    and attempt_count < 5;

create index if not exists notifications_push_outbox_claim_idx
  on public.notifications_push_outbox (claimed_until, created_at)
  where sent_at is null
    and suppressed_at is null
    and attempt_count < 5;

create or replace function public.push_foreground_session_touch(
  p_client_id uuid,
  p_current_chat_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_client_id is null then
    raise exception 'invalid_client_id' using errcode = '22023';
  end if;

  delete from public.push_foreground_sessions
  where user_id = v_user_id
    and expires_at <= now();

  insert into public.push_foreground_sessions (
    user_id,
    client_id,
    current_chat_id,
    last_seen_at,
    expires_at
  )
  values (
    v_user_id,
    p_client_id,
    p_current_chat_id,
    now(),
    now() + interval '20 seconds'
  )
  on conflict (user_id, client_id) do update
  set current_chat_id = excluded.current_chat_id,
      last_seen_at = now(),
      expires_at = now() + interval '20 seconds';
end
$$;

create or replace function public.push_foreground_session_close(
  p_client_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_client_id is null then
    raise exception 'invalid_client_id' using errcode = '22023';
  end if;

  delete from public.push_foreground_sessions
  where user_id = v_user_id
    and client_id = p_client_id;
end
$$;

revoke all on function public.push_foreground_session_touch(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.push_foreground_session_close(uuid)
  from public, anon, authenticated;
grant execute on function public.push_foreground_session_touch(uuid, uuid)
  to authenticated;
grant execute on function public.push_foreground_session_close(uuid)
  to authenticated;

-- The frontend already uses this RPC. Restore it independently from the
-- proposal-only native push migration that originally introduced it.
create or replace function public.notifications_mark_chat_messages_read(
  p_chat_id uuid,
  p_read_until timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_chat_id is null then
    raise exception 'invalid_chat_id' using errcode = '22023';
  end if;

  update public.notifications n
  set read_at = coalesce(n.read_at, now())
  where n.user_id = v_user_id
    and n.read_at is null
    and n.kind like '%message%'
    and n.payload->>'chat_id' = p_chat_id::text
    and (
      p_read_until is null
      or not (n.payload ? 'message_id')
      or not ((n.payload->>'message_id') ~* '^[0-9a-f-]{36}$')
      or exists (
        select 1
        from public.messages m
        where m.id = (n.payload->>'message_id')::uuid
          and m.chat_id = p_chat_id
          and m.created_at <= p_read_until
      )
    );
end
$$;

revoke all on function public.notifications_mark_chat_messages_read(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.notifications_mark_chat_messages_read(uuid, timestamptz)
  to authenticated;

create index if not exists notifications_message_chat_unread_idx
  on public.notifications ((payload->>'chat_id'), user_id, created_at desc)
  where read_at is null and kind like '%message%';

create or replace function public.push_outbox_claim(
  p_limit integer,
  p_claim_token uuid
)
returns table (
  id uuid,
  subscription_id uuid,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  if p_claim_token is null then
    raise exception 'invalid_claim_token' using errcode = '22023';
  end if;

  delete from public.push_foreground_sessions
  where expires_at <= v_now;

  update public.notifications_push_outbox o
  set suppressed_at = coalesce(o.suppressed_at, v_now),
      suppression_reason = coalesce(o.suppression_reason, 'read'),
      claim_token = null,
      claimed_until = null
  from public.notifications n
  where n.id = o.notification_id
    and n.read_at is not null
    and o.sent_at is null
    and o.suppressed_at is null;

  update public.notifications_push_outbox o
  set suppressed_at = coalesce(o.suppressed_at, v_now),
      suppression_reason = coalesce(o.suppression_reason, 'subscription_inactive'),
      claim_token = null,
      claimed_until = null
  where o.sent_at is null
    and o.suppressed_at is null
    and not exists (
      select 1
      from public.push_subscriptions ps
      where ps.id = o.subscription_id
        and ps.is_active is true
    );

  with ranked as (
    select
      o.id,
      row_number() over (
        partition by
          o.subscription_id,
          coalesce(nullif(o.payload->>'tag', ''), o.id::text)
        order by o.created_at desc, o.id desc
      ) as position
    from public.notifications_push_outbox o
    join public.notifications n on n.id = o.notification_id
    where o.sent_at is null
      and o.suppressed_at is null
      and o.attempt_count < 5
      and n.read_at is null
      and (o.claimed_until is null or o.claimed_until <= v_now)
  )
  update public.notifications_push_outbox o
  set suppressed_at = v_now,
      suppression_reason = 'coalesced',
      claim_token = null,
      claimed_until = null
  from ranked r
  where r.id = o.id
    and r.position > 1;

  return query
  with candidates as (
    select o.id
    from public.notifications_push_outbox o
    join public.notifications n on n.id = o.notification_id
    join public.push_subscriptions ps on ps.id = o.subscription_id
    where o.sent_at is null
      and o.suppressed_at is null
      and o.attempt_count < 5
      and n.read_at is null
      and ps.is_active is true
      and (o.claimed_until is null or o.claimed_until <= v_now)
      and not exists (
        select 1
        from public.push_foreground_sessions s
        where s.user_id = o.user_id
          and s.expires_at > v_now
      )
    order by o.created_at asc, o.id asc
    for update of o skip locked
    limit v_limit
  ), claimed as (
    update public.notifications_push_outbox o
    set claim_token = p_claim_token,
        claimed_until = v_now + interval '60 seconds'
    from candidates c
    where c.id = o.id
    returning o.id, o.subscription_id, o.payload, o.attempt_count
  )
  select c.id, c.subscription_id, c.payload, c.attempt_count
  from claimed c;
end
$$;

revoke all on function public.push_outbox_claim(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.push_outbox_claim(integer, uuid) to service_role;

-- These helpers are trigger/internal implementation details. Retain owner and
-- service-role access while removing inherited client EXECUTE privileges.
revoke all on function public._enqueue_push_after_notification_insert()
  from public, anon, authenticated;
revoke all on function public._notification_push_allowed(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public._notification_push_payload(text, jsonb)
  from public, anon, authenticated;

commit;
