-- Rollback: update public.album_push_runtime set enabled=false where singleton;
-- the trigger then uses the legacy per-message outboxes. Keep the album Edge
-- dispatcher running until already queued album rows drain or are quarantined.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Wait for every in-flight message transaction before marking old album keys.
lock table public.messages in share row exclusive mode;

do $$
declare
  v_source text;
begin
  v_source := pg_catalog.pg_get_functiondef(
    'public._enqueue_push_after_notification_insert()'::regprocedure
  );
  if v_source not like '%pd.platform = ''android''%'
      or v_source not like '%pd.provider = ''fcm''%'
      or v_source like '%album_push_enqueue%'
      or (v_source like '%pd.platform = ''windows''%'
        and v_source not like '%pd.provider = ''wns''%') then
    raise exception 'album_push_activation_trigger_drift';
  end if;
end
$$;

insert into public.album_push_legacy_keys(chat_id, sender_kind, sender_id, album_id)
select distinct m.chat_id,
  case when m.user_id is not null then 'user' else 'bot' end,
  coalesce(m.user_id, m.bot_id),
  m.media_metadata->>'album_id'
from public.messages m
where (m.user_id is not null) <> (m.bot_id is not null)
  and m.media_metadata->>'album_id' ~ '^[A-Za-z0-9][A-Za-z0-9-]{6,78}[A-Za-z0-9]$'
on conflict do nothing;

update public.album_push_runtime
set enabled = true,
    legacy_wns_enabled = pg_catalog.pg_get_functiondef(
      'public._enqueue_push_after_notification_insert()'::regprocedure
    ) like '%pd.platform = ''windows''%',
    activated_at = pg_catalog.clock_timestamp()
where singleton and enabled is false;

create or replace function public._enqueue_push_after_notification_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_payload jsonb;
  v_album_handled boolean := false;
begin
  if not public._notification_push_allowed(new.user_id, new.kind, new.payload) then
    return null;
  end if;

  if new.kind = 'message' then
    begin
      v_album_handled := public.album_push_enqueue(new.id);
    exception when others then
      raise warning 'album_push_enqueue_fallback:%', sqlstate;
    end;
  end if;

  v_payload := public._notification_push_payload(new.kind, new.payload);
  v_payload := v_payload || pg_catalog.jsonb_build_object(
    'notificationId', new.id,
    'taskId', nullif(new.payload->>'task_id', ''),
    'inviteId', nullif(new.payload->>'invite_id', '')
  );
  if v_payload->>'title' in ('KUB', 'КУБ') then
    v_payload := pg_catalog.jsonb_set(v_payload, '{title}', pg_catalog.to_jsonb('LETSCUBE'::text));
  end if;

  if not v_album_handled then
    insert into public.notifications_push_outbox (
      notification_id, subscription_id, user_id, payload
    )
    select new.id, ps.id, new.user_id, v_payload
    from public.push_subscriptions ps
    where ps.user_id = new.user_id and ps.is_active is true
    on conflict (notification_id, subscription_id) do nothing;
  end if;

  insert into public.notifications_native_push_outbox (
    notification_id, device_id, user_id, payload
  )
  select new.id, d.id, new.user_id, v_payload
  from public.user_push_devices d
  where d.user_id = new.user_id
    and (
      (not v_album_handled and d.platform = 'android' and d.provider = 'fcm')
      or (
        d.platform = 'windows' and d.provider = 'wns'
        and exists (
          select 1 from public.album_push_runtime r
          where r.singleton and r.legacy_wns_enabled
        )
      )
    )
    and d.enabled is true and d.revoked_at is null
  on conflict (notification_id, device_id) do nothing;
  return null;
end
$$;

revoke all on function public._enqueue_push_after_notification_insert()
  from public, anon, authenticated, service_role;

do $$
begin
  if not exists (
      select 1 from public.album_push_runtime
      where singleton and enabled and activated_at is not null
    )
    or not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = 'public._enqueue_push_after_notification_insert()'::regprocedure
        and p.prosecdef
        and p.proconfig @> array['search_path=pg_catalog']
        and pg_catalog.pg_get_functiondef(p.oid) like '%public.album_push_enqueue(new.id)%'
        and pg_catalog.pg_get_functiondef(p.oid) like '%r.legacy_wns_enabled%'
    )
    or exists (
      select 1 from public.messages m
      where (m.user_id is not null) <> (m.bot_id is not null)
        and m.media_metadata->>'album_id' ~ '^[A-Za-z0-9][A-Za-z0-9-]{6,78}[A-Za-z0-9]$'
        and not exists (
          select 1 from public.album_push_legacy_keys old
          where old.chat_id = m.chat_id
            and old.sender_kind = case when m.user_id is not null then 'user' else 'bot' end
            and old.sender_id = coalesce(m.user_id, m.bot_id)
            and old.album_id = m.media_metadata->>'album_id'
        )
    ) then
    raise exception 'album_push_activation_self_check_failed';
  end if;
end
$$;

commit;
