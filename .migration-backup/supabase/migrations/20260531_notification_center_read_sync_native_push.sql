-- 20260531_notification_center_read_sync_native_push.sql
-- Proposal only. Do not apply automatically from Codex.
--
-- Goals:
-- - connect chat read state to message-notification read state;
-- - keep sender/actor message notifications out of the unread bell;
-- - add a separate native push device-token model for future FCM/APNS work.
--
-- This proposal intentionally does not change browser Web Push subscriptions.

-- Mark any historical self-message notifications as read. The message trigger
-- already excludes senders, but old rows or earlier trigger versions may remain.
update public.notifications n
set read_at = coalesce(n.read_at, now())
where n.kind like '%message%'
  and n.read_at is null
  and (n.payload->>'sender_id') ~* '^[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12}$'
  and (n.payload->>'sender_id')::uuid = n.user_id;

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
    and (n.payload->>'chat_id') ~* '^[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12}$'
    and (n.payload->>'chat_id')::uuid = p_chat_id
    and (
      p_read_until is null
      or not (n.payload ? 'message_id')
      or not ((n.payload->>'message_id') ~* '^[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12}$')
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

revoke all on function public.notifications_mark_chat_messages_read(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.notifications_mark_chat_messages_read(uuid, timestamptz) to authenticated;

create index if not exists notifications_message_chat_unread_idx
  on public.notifications (((payload->>'chat_id')), user_id, created_at desc)
  where read_at is null and kind like '%message%';

-- Future native push token model. Browser Web Push stays in
-- public.push_subscriptions; native Android/iOS tokens live here.
create table if not exists public.user_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios', 'web')),
  provider text not null check (provider in ('fcm', 'apns', 'webpush')),
  token text not null,
  token_hash text,
  device_id text,
  device_model text,
  app_version text,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_push_devices_provider_token_uidx
  on public.user_push_devices (provider, token);

create index if not exists user_push_devices_user_enabled_idx
  on public.user_push_devices (user_id, enabled, last_seen_at desc);

alter table public.user_push_devices enable row level security;

drop policy if exists "user_push_devices own select" on public.user_push_devices;
drop policy if exists "user_push_devices own insert" on public.user_push_devices;
drop policy if exists "user_push_devices own update" on public.user_push_devices;
drop policy if exists "user_push_devices own delete" on public.user_push_devices;

create policy "user_push_devices own select"
  on public.user_push_devices for select
  using (auth.uid() = user_id);

create policy "user_push_devices own insert"
  on public.user_push_devices for insert
  with check (auth.uid() = user_id);

create policy "user_push_devices own update"
  on public.user_push_devices for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_push_devices own delete"
  on public.user_push_devices for delete
  using (auth.uid() = user_id);

create or replace function public.register_push_device(
  p_platform text,
  p_provider text,
  p_token text,
  p_token_hash text default null,
  p_device_id text default null,
  p_device_model text default null,
  p_app_version text default null
)
returns public.user_push_devices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_push_devices%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.user_push_devices (
    user_id, platform, provider, token, token_hash, device_id,
    device_model, app_version, enabled, revoked_at, last_seen_at
  )
  values (
    auth.uid(), p_platform, p_provider, p_token, p_token_hash, p_device_id,
    p_device_model, p_app_version, true, null, now()
  )
  on conflict (provider, token) do update
  set user_id = excluded.user_id,
      platform = excluded.platform,
      token_hash = excluded.token_hash,
      device_id = excluded.device_id,
      device_model = excluded.device_model,
      app_version = excluded.app_version,
      enabled = true,
      revoked_at = null,
      last_seen_at = now(),
      updated_at = now()
  returning * into v_row;

  return v_row;
end
$$;

create or replace function public.unregister_push_device(
  p_provider text,
  p_token text
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

  update public.user_push_devices
  set enabled = false,
      revoked_at = coalesce(revoked_at, now()),
      updated_at = now()
  where user_id = auth.uid()
    and provider = p_provider
    and token = p_token;
end
$$;

revoke all on function public.register_push_device(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.unregister_push_device(text, text) from public, anon, authenticated;
grant execute on function public.register_push_device(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.unregister_push_device(text, text) to authenticated;
