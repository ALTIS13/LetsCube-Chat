-- 20260724_windows_wns_push_devices.sql
-- Proposal only. Apply manually after reviewing the Microsoft package identity,
-- Entra application and WNS credentials. This migration must not be applied
-- before the Windows client can create a real WNS channel URI.
--
-- Extends the existing native push model without changing Browser Web Push:
--   android + fcm
--   ios     + apns (reserved compatibility pair; registration remains external)
--   windows + wns

do $$
begin
  if to_regclass('public.user_push_devices') is null then
    raise exception 'user_push_devices_missing';
  end if;
  if to_regclass('public.notifications_native_push_outbox') is null then
    raise exception 'notifications_native_push_outbox_missing';
  end if;
  if exists (
    select 1
    from public.user_push_devices
    where not (
      (platform = 'android' and provider = 'fcm')
      or (platform = 'ios' and provider = 'apns')
      or (platform = 'windows' and provider = 'wns')
    )
  ) then
    raise exception 'unsupported_existing_push_device_pair';
  end if;
end
$$;

alter table public.user_push_devices
  drop constraint if exists user_push_devices_platform_provider_check,
  drop constraint if exists user_push_devices_platform_check,
  drop constraint if exists user_push_devices_provider_check;

alter table public.user_push_devices
  add constraint user_push_devices_platform_check
    check (platform in ('android', 'ios', 'windows')),
  add constraint user_push_devices_provider_check
    check (provider in ('fcm', 'apns', 'wns')),
  add constraint user_push_devices_platform_provider_check
    check (
      (platform = 'android' and provider = 'fcm')
      or (platform = 'ios' and provider = 'apns')
      or (platform = 'windows' and provider = 'wns')
    );

alter table public.user_push_devices enable row level security;
revoke all on table public.user_push_devices from public, anon, authenticated;

create or replace function public.register_push_device(
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
  v_platform text := lower(btrim(coalesce(p_platform, '')));
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_token text := btrim(coalesce(p_token, ''));
  v_token_hash text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- APNS remains reserved in the table contract but is not accepted by this
  -- RPC until the iOS owner provides and validates its client registration.
  if not (
    (v_platform = 'android' and v_provider = 'fcm')
    or (v_platform = 'windows' and v_provider = 'wns')
  ) then
    raise exception 'unsupported_push_provider';
  end if;

  if (
    (v_provider = 'fcm' and (length(v_token) < 20 or length(v_token) > 4096))
    or (v_provider = 'wns' and (length(v_token) < 30 or length(v_token) > 8192))
  ) then
    raise exception 'invalid_push_token';
  end if;

  -- Reject non-Microsoft schemes, userinfo, ports, fragments and lookalike
  -- domains before a WNS channel URI reaches the trusted delivery worker.
  -- The Edge Function repeats URL parsing and host validation before sending.
  if v_provider = 'wns' and (
    v_token !~* '^https://([a-z0-9-]+\.)*notify\.windows\.com(/|\?|$)'
    or v_token ~ '[[:space:]]'
    or v_token like '%#%'
  ) then
    raise exception 'invalid_wns_channel';
  end if;

  -- p_token_hash is retained for RPC signature compatibility and is never
  -- trusted. Dedupe uses a server-side digest of the opaque provider token.
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
    v_platform,
    v_provider,
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

create or replace function public.unregister_push_device(
  p_provider text,
  p_token text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_token text := btrim(coalesce(p_token, ''));
  v_token_hash text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if v_provider not in ('fcm', 'wns') then
    raise exception 'unsupported_push_provider';
  end if;
  if length(v_token) < 20 or length(v_token) > 8192 then
    raise exception 'invalid_push_token';
  end if;

  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  update public.user_push_devices
  set enabled = false,
      revoked_at = coalesce(revoked_at, now()),
      updated_at = now()
  where user_id = auth.uid()
    and provider = v_provider
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
    and (
      (pd.platform = 'android' and pd.provider = 'fcm')
      or (pd.platform = 'windows' and pd.provider = 'wns')
    )
    and pd.enabled is true
    and pd.revoked_at is null
  on conflict (notification_id, device_id) do nothing;

  return null;
end
$$;

revoke all on function public._enqueue_push_after_notification_insert()
  from public, anon, authenticated;
