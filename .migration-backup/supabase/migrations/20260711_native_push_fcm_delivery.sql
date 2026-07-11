-- 20260711_native_push_fcm_delivery.sql
-- Proposal for manual/application-approved rollout.
--
-- Adds the trusted native-device/outbox path used by Android FCM while keeping
-- public.push_subscriptions and notifications_push_outbox dedicated to Web Push.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.user_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  provider text not null check (provider in ('fcm', 'apns')),
  token text not null,
  token_hash text not null,
  device_id text,
  device_model text,
  app_version text,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

update public.user_push_devices
set token_hash = encode(digest(token, 'sha256'), 'hex')
where token_hash is null or token_hash = '';

alter table public.user_push_devices
  alter column token_hash set not null;

drop index if exists public.user_push_devices_provider_token_uidx;
create unique index if not exists user_push_devices_provider_token_hash_uidx
  on public.user_push_devices (provider, token_hash);
create index if not exists user_push_devices_user_enabled_idx
  on public.user_push_devices (user_id, enabled, last_seen_at desc);

alter table public.user_push_devices enable row level security;
drop policy if exists "user_push_devices own select" on public.user_push_devices;
drop policy if exists "user_push_devices own insert" on public.user_push_devices;
drop policy if exists "user_push_devices own update" on public.user_push_devices;
drop policy if exists "user_push_devices own delete" on public.user_push_devices;
revoke all on table public.user_push_devices from public, anon, authenticated;

drop function if exists public.register_push_device(text, text, text, text, text, text, text);
create function public.register_push_device(
  p_platform text,
  p_provider text,
  p_token text,
  p_token_hash text default null,
  p_device_id text default null,
  p_device_model text default null,
  p_app_version text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text := btrim(coalesce(p_token, ''));
  v_token_hash text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_platform <> 'android' or p_provider <> 'fcm' then
    raise exception 'unsupported_push_provider';
  end if;
  if length(v_token) < 20 or length(v_token) > 4096 then
    raise exception 'invalid_push_token';
  end if;

  -- Hash server-side. p_token_hash remains in the signature for backwards
  -- compatibility but is not trusted.
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  insert into public.user_push_devices (
    user_id,
    platform,
    provider,
    token,
    token_hash,
    device_id,
    device_model,
    app_version,
    enabled,
    revoked_at,
    last_seen_at,
    updated_at
  )
  values (
    auth.uid(),
    'android',
    'fcm',
    v_token,
    v_token_hash,
    nullif(left(btrim(coalesce(p_device_id, '')), 160), ''),
    nullif(left(btrim(coalesce(p_device_model, '')), 300), ''),
    nullif(left(btrim(coalesce(p_app_version, '')), 60), ''),
    true,
    null,
    now(),
    now()
  )
  on conflict (provider, token_hash) do update
  set user_id = excluded.user_id,
      platform = excluded.platform,
      token = excluded.token,
      device_id = excluded.device_id,
      device_model = excluded.device_model,
      app_version = excluded.app_version,
      enabled = true,
      revoked_at = null,
      last_seen_at = now(),
      updated_at = now();
end
$$;

drop function if exists public.unregister_push_device(text, text);
create function public.unregister_push_device(
  p_provider text,
  p_token text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token_hash text := encode(digest(btrim(coalesce(p_token, '')), 'sha256'), 'hex');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  update public.user_push_devices
  set enabled = false,
      revoked_at = coalesce(revoked_at, now()),
      updated_at = now()
  where user_id = auth.uid()
    and provider = p_provider
    and token_hash = v_token_hash;
end
$$;

revoke all on function public.register_push_device(text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.unregister_push_device(text, text)
  from public, anon, authenticated;
grant execute on function public.register_push_device(text, text, text, text, text, text, text)
  to authenticated;
grant execute on function public.unregister_push_device(text, text)
  to authenticated;

create table if not exists public.notifications_native_push_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references public.user_push_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, device_id)
);

create index if not exists notifications_native_push_outbox_pending_idx
  on public.notifications_native_push_outbox (created_at)
  where sent_at is null and attempt_count < 5;

alter table public.notifications_native_push_outbox enable row level security;
revoke all on table public.notifications_native_push_outbox from public, anon, authenticated;

-- Keep chat-read receipts and the notification center synchronized across
-- browser/PWA/Android clients without touching task/system notifications.
create or replace function public.notifications_mark_chat_messages_read(
  p_chat_id uuid,
  p_read_until timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  update public.notifications n
  set read_at = coalesce(n.read_at, now())
  where n.user_id = auth.uid()
    and n.read_at is null
    and n.kind like '%message%'
    and n.payload->>'chat_id' = p_chat_id::text
    and (
      p_read_until is null
      or not (n.payload ? 'message_id')
      or exists (
        select 1
        from public.messages m
        where m.id::text = n.payload->>'message_id'
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

create or replace function public._enqueue_push_after_notification_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  if not public._notification_push_allowed(new.user_id, new.kind, new.payload) then
    return null;
  end if;

  v_payload := public._notification_push_payload(new.kind, new.payload);
  v_payload := v_payload || jsonb_build_object(
    'notificationId', new.id,
    'taskId', nullif(new.payload->>'task_id', ''),
    'inviteId', nullif(new.payload->>'invite_id', '')
  );
  if v_payload->>'title' in ('KUB', 'КУБ') then
    v_payload := jsonb_set(v_payload, '{title}', to_jsonb('LETSCUBE'::text));
  end if;

  insert into public.notifications_push_outbox (
    notification_id, subscription_id, user_id, payload
  )
  select new.id, ps.id, new.user_id, v_payload
  from public.push_subscriptions ps
  where ps.user_id = new.user_id
    and ps.is_active is true
  on conflict (notification_id, subscription_id) do nothing;

  insert into public.notifications_native_push_outbox (
    notification_id, device_id, user_id, payload
  )
  select new.id, pd.id, new.user_id, v_payload
  from public.user_push_devices pd
  where pd.user_id = new.user_id
    and pd.platform = 'android'
    and pd.provider = 'fcm'
    and pd.enabled is true
    and pd.revoked_at is null
  on conflict (notification_id, device_id) do nothing;

  return null;
end
$$;

revoke all on function public._enqueue_push_after_notification_insert()
  from public, anon, authenticated;

drop trigger if exists trg_enqueue_push_after_notification_insert on public.notifications;
create trigger trg_enqueue_push_after_notification_insert
  after insert on public.notifications
  for each row execute function public._enqueue_push_after_notification_insert();
