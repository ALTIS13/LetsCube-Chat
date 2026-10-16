-- Exact read-only PG17.6 capture,2026-10-16. Synthetic delivery fixture, not a full restore.
CREATE OR REPLACE FUNCTION public._enqueue_push_after_notification_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$
;
ALTER FUNCTION public._enqueue_push_after_notification_insert() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.enqueue_message_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sender_kind text;
  v_sender_name text;
  v_sender_avatar_url text;
  v_chat_name text;
  v_chat_type text;
  v_chat_named boolean;
  v_preview text;
  v_message_type text := coalesce(new.type, 'text');
begin
  if v_message_type = 'system'
     or (new.user_id is null and new.bot_id is null) then
    return null;
  end if;

  if new.bot_id is not null then
    v_sender_kind := 'bot';
    select
      coalesce(
        nullif(pg_catalog.btrim(b.display_name), ''),
        nullif('@' || b.username, '@'),
        'Бот'
      ),
      b.avatar_url
    into v_sender_name, v_sender_avatar_url
    from public.bots b where b.id = new.bot_id;
  else
    v_sender_kind := 'user';
    select
      coalesce(
        nullif(pg_catalog.btrim(p.full_name), ''),
        nullif('@' || p.username, '@'),
        'Участник'
      ),
      p.avatar_url
    into v_sender_name, v_sender_avatar_url
    from public.profiles p where p.id = new.user_id;
  end if;

  v_sender_avatar_url := public._sanitize_notification_avatar_url(v_sender_avatar_url);

  select
    coalesce(nullif(pg_catalog.btrim(chat.name), ''), v_sender_name, 'Чат'),
    coalesce(nullif(chat.type, ''), 'private'),
    nullif(pg_catalog.btrim(chat.name), '') is not null
  into v_chat_name, v_chat_type, v_chat_named
  from public.chats chat
  where chat.id = new.chat_id;

  v_preview := case
    when v_message_type = 'text' then nullif(
      pg_catalog.left(
        pg_catalog.regexp_replace(coalesce(new.content, ''), '\s+', ' ', 'g'),
        160
      ),
      ''
    )
    when v_message_type = 'image' then 'Фото'
    when v_message_type = 'video'
         and coalesce(new.media_metadata->>'kind', '') = 'video_message'
      then 'Видеосообщение'
    when v_message_type = 'video' then 'Видео'
    when v_message_type = 'audio' then 'Голосовое'
    when v_message_type = 'file' then 'Файл'
    when v_message_type = 'location' then 'Местоположение'
    else 'Сообщение'
  end;
  v_preview := coalesce(v_preview, 'Сообщение');

  -- In-app notifications remain the source of truth.
  -- Push mutes and notification preferences remain enforced by public._notification_push_allowed.
  -- The existing outbox trigger alone projects an OS/browser delivery.
  insert into public.notifications(user_id, kind, payload)
  select
    member_row.user_id,
    'message',
    pg_catalog.jsonb_build_object(
      'chat_id', new.chat_id,
      'message_id', new.id,
      'sender_kind', v_sender_kind,
      'sender_id', new.user_id,
      'bot_id', new.bot_id,
      'sender_name', coalesce(v_sender_name, 'Участник'),
      'sender_avatar_url', v_sender_avatar_url,
      -- A micro-group with no name is called what its reader sees it called:
      -- the others' first names, which differ from one reader to the next.
      'chat_name', case
        when v_chat_type = 'dm_group' and not coalesce(v_chat_named, false)
          then public.micro_group_drawn_name(new.chat_id, member_row.user_id)
        else coalesce(v_chat_name, 'Чат')
      end,
      'chat_type', coalesce(v_chat_type, 'private'),
      'preview', v_preview,
      'message_type', v_message_type,
      'route', '/?chat=' || new.chat_id::text || '&message=' || new.id::text,
      'group_tag', 'message:chat:' || new.chat_id::text,
      'mentioned', private.message_mentions_targeted(new.mention_entities, 'user', member_row.user_id)
    )
  from public.chat_members member_row
  where member_row.chat_id = new.chat_id
    and private.message_notification_visible_to(new.id, member_row.user_id)
    and (new.user_id is null or member_row.user_id <> new.user_id)
    and member_row.hidden_at is null
    and (member_row.cleared_at is null or new.created_at > member_row.cleared_at)
    and not exists (
      select 1
      from public.message_hidden_for_users hidden
      where hidden.message_id = new.id
        and hidden.user_id = member_row.user_id
    )
  on conflict do nothing;
  return null;
end
$function$
;
ALTER FUNCTION public.enqueue_message_notifications() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.album_push_enqueue(p_notification_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_notification record;
  v_message record;
  v_album_id text;
  v_index integer;
  v_count integer;
  v_sender_kind text;
  v_sender_id uuid;
  v_group_id uuid;
  v_group record;
  v_now timestamptz;
begin
  if p_notification_id is null or not exists (
    select 1 from public.album_push_runtime where singleton and enabled
  ) then
    return false;
  end if;

  select n.user_id, n.kind, n.payload into v_notification
  from public.notifications n where n.id = p_notification_id;
  if not found or v_notification.kind <> 'message'
      or v_notification.payload->>'message_id' !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  select m.id, m.chat_id, m.user_id, m.bot_id, m.type, m.media_url,
         m.media_metadata, m.deleted_at, m.created_at
  into v_message
  from public.messages m
  where m.id = (v_notification.payload->>'message_id')::uuid;
  if not found or v_message.type is null or v_message.type not in ('image', 'video')
      or v_message.deleted_at is not null
      or nullif(btrim(v_message.media_url), '') is null
      or v_notification.payload->>'chat_id' is distinct from v_message.chat_id::text
      or public._notification_push_allowed(
        v_notification.user_id, v_notification.kind, v_notification.payload
      ) is not true then
    return false;
  end if;

  if v_message.user_id is not null and v_message.bot_id is null then
    v_sender_kind := 'user';
    v_sender_id := v_message.user_id;
    if v_notification.payload->>'sender_kind' is distinct from 'user'
        or v_notification.payload->>'sender_id' is distinct from v_sender_id::text then
      return false;
    end if;
  elsif v_message.bot_id is not null and v_message.user_id is null then
    v_sender_kind := 'bot';
    v_sender_id := v_message.bot_id;
    if v_notification.payload->>'sender_kind' is distinct from 'bot'
        or v_notification.payload->>'bot_id' is distinct from v_sender_id::text then
      return false;
    end if;
  else
    return false;
  end if;

  v_album_id := v_message.media_metadata->>'album_id';
  if pg_catalog.jsonb_typeof(v_message.media_metadata->'album_id') is distinct from 'string'
      or v_album_id !~ '^[A-Za-z0-9][A-Za-z0-9-]{6,78}[A-Za-z0-9]$'
      or pg_catalog.jsonb_typeof(v_message.media_metadata->'album_count') is distinct from 'number'
      or v_message.media_metadata->>'album_count' !~ '^(10|[2-9])$'
      or pg_catalog.jsonb_typeof(v_message.media_metadata->'album_index') is distinct from 'number'
      or v_message.media_metadata->>'album_index' !~ '^[0-9]$' then
    return false;
  end if;
  v_count := (v_message.media_metadata->>'album_count')::integer;
  v_index := (v_message.media_metadata->>'album_index')::integer;
  if v_index >= v_count
      or not exists (
        select 1 from public.chat_members cm
        where cm.chat_id = v_message.chat_id
          and cm.user_id = v_notification.user_id
          and cm.hidden_at is null
          and (cm.cleared_at is null or v_message.created_at > cm.cleared_at)
      )
      or exists (
        select 1 from public.message_hidden_for_users h
        where h.message_id = v_message.id and h.user_id = v_notification.user_id
      )
      or exists (
        select 1 from public.album_push_legacy_keys old
        where old.chat_id = v_message.chat_id
          and old.sender_kind = v_sender_kind
          and old.sender_id = v_sender_id
          and old.album_id = v_album_id
      ) then
    return false;
  end if;

  v_now := pg_catalog.clock_timestamp();
  insert into public.album_push_groups (
    user_id, chat_id, sender_kind, sender_id, album_id,
    expected_count, first_at, last_at, ready_at
  ) values (
    v_notification.user_id, v_message.chat_id, v_sender_kind, v_sender_id,
    v_album_id, v_count, v_now, v_now, v_now + interval '5 seconds'
  ) on conflict (user_id, chat_id, sender_kind, sender_id, album_id) do nothing;

  select g.id, g.expected_count, g.observed_count, g.first_at
  into v_group
  from public.album_push_groups g
  where g.user_id = v_notification.user_id
    and g.chat_id = v_message.chat_id
    and g.sender_kind = v_sender_kind
    and g.sender_id = v_sender_id
    and g.album_id = v_album_id
  for update;
  if not found or v_group.expected_count <> v_count
      or v_group.observed_count >= v_count then
    return false;
  end if;
  v_group_id := v_group.id;

  insert into public.album_push_members(group_id, notification_id, message_id, album_index)
  values (v_group_id, p_notification_id, v_message.id, v_index)
  on conflict do nothing;
  if not found then
    return false;
  end if;

  update public.album_push_groups g
  set observed_count = g.observed_count + 1,
      last_at = v_now,
      ready_at = case
        when g.observed_count + 1 = g.expected_count then v_now
        else least(g.first_at + interval '30 seconds', v_now + interval '5 seconds')
      end
  where g.id = v_group_id;

  insert into public.notifications_album_push_outbox(group_id, subscription_id)
  select v_group_id, ps.id
  from public.push_subscriptions ps
  where ps.user_id = v_notification.user_id and ps.is_active is true
  on conflict do nothing;

  insert into public.notifications_album_push_outbox(group_id, device_id)
  select v_group_id, d.id
  from public.user_push_devices d
  where d.user_id = v_notification.user_id
    and d.platform = 'android' and d.provider = 'fcm'
    and d.enabled is true and d.revoked_at is null
  on conflict do nothing;
  return true;
end
$function$
;
ALTER FUNCTION public.album_push_enqueue(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.album_push_recheck(p_outbox_id uuid, p_claim_token uuid)
 RETURNS TABLE(status text, payload jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_outbox record;
  v_member record;
  v_payload jsonb;
  v_has_unread boolean;
begin
  if p_outbox_id is null or p_claim_token is null then
    raise exception 'invalid_album_push_recheck' using errcode = '22023';
  end if;

  select o.group_id, o.subscription_id, o.device_id, o.claimed_until,
         g.user_id, g.chat_id, g.sender_kind, g.sender_id,
         g.observed_count, g.expected_count, g.first_at
  into v_outbox
  from public.notifications_album_push_outbox o
  join public.album_push_groups g on g.id = o.group_id
  where o.id = p_outbox_id and o.claim_token = p_claim_token
    and o.sent_at is null and o.suppressed_at is null and o.attempt_count < 5
  for update of o;
  if not found or v_outbox.claimed_until is null
      or v_outbox.claimed_until <= v_now then
    return query select 'claim_lost'::text, null::jsonb;
    return;
  end if;

  if (v_outbox.subscription_id is not null and not exists (
        select 1 from public.push_subscriptions s
        where s.id = v_outbox.subscription_id and s.user_id = v_outbox.user_id
          and s.is_active is true
      ))
      or (v_outbox.device_id is not null and not exists (
        select 1 from public.user_push_devices d
        where d.id = v_outbox.device_id and d.user_id = v_outbox.user_id
          and d.platform = 'android' and d.provider = 'fcm'
          and d.enabled is true and d.revoked_at is null
      )) then
    update public.notifications_album_push_outbox o
    set suppressed_at = v_now, suppression_reason = 'target_inactive',
        claim_token = null, claimed_until = null, updated_at = v_now
    where o.id = p_outbox_id;
    return query select 'target_inactive'::text, null::jsonb;
    return;
  end if;

  if exists (
    select 1 from public.privacy_preferences p
    where p.user_id = v_outbox.user_id and p.manual_status = 'dnd'
      and (p.manual_status_until is null or p.manual_status_until > v_now)
  ) then
    update public.notifications_album_push_outbox o
    set suppressed_at = v_now, suppression_reason = 'not_eligible',
        claim_token = null, claimed_until = null, updated_at = v_now
    where o.id = p_outbox_id;
    return query select 'not_eligible'::text, null::jsonb;
    return;
  end if;

  select exists (
    select 1 from public.album_push_members am
    join public.notifications n on n.id = am.notification_id
    where am.group_id = v_outbox.group_id
      and n.user_id = v_outbox.user_id and n.read_at is null
  ) into v_has_unread;
  if not v_has_unread then
    update public.notifications_album_push_outbox o
    set suppressed_at = case when v_outbox.observed_count = v_outbox.expected_count
          or v_now >= v_outbox.first_at + interval '30 seconds'
          then v_now else null end,
        suppression_reason = case when v_outbox.observed_count = v_outbox.expected_count
          or v_now >= v_outbox.first_at + interval '30 seconds'
          then 'read' else null end,
        next_attempt_at = v_now + interval '1 minute',
        claim_token = null, claimed_until = null, updated_at = v_now
    where o.id = p_outbox_id;
    return query select 'read'::text, null::jsonb;
    return;
  end if;

  if v_outbox.subscription_id is not null and exists (
    select 1 from public.push_foreground_sessions s
    where s.user_id = v_outbox.user_id and s.expires_at > v_now
  ) then
    update public.notifications_album_push_outbox o
    set claim_token = null, claimed_until = null,
        next_attempt_at = v_now + interval '1 minute', updated_at = v_now
    where o.id = p_outbox_id;
    return query select 'foreground'::text, null::jsonb;
    return;
  end if;

  for v_member in
    select n.id as notification_id, n.kind, n.payload as notification_payload,
           m.id as message_id
    from public.album_push_members am
    join public.notifications n on n.id = am.notification_id
    join public.messages m on m.id = am.message_id
    join public.chat_members cm on cm.chat_id = m.chat_id
      and cm.user_id = v_outbox.user_id
    where am.group_id = v_outbox.group_id
      and n.user_id = v_outbox.user_id and n.kind = 'message'
      and n.read_at is null and m.deleted_at is null
      and m.chat_id = v_outbox.chat_id
      and n.payload->>'message_id' = m.id::text
      and n.payload->>'chat_id' = m.chat_id::text
      and private.message_notification_visible_to(m.id, v_outbox.user_id)
      and cm.hidden_at is null
      and (cm.cleared_at is null or m.created_at > cm.cleared_at)
      and not exists (
        select 1 from public.message_hidden_for_users h
        where h.message_id = m.id and h.user_id = v_outbox.user_id
      )
    order by am.album_index desc
  loop
    if public._notification_push_allowed(
      v_outbox.user_id, v_member.kind, v_member.notification_payload
    ) then
      v_payload := pg_catalog.jsonb_build_object(
        'kind', 'message',
        'title', 'LETSCUBE',
        'body', 'Новое сообщение',
        'chatId', v_outbox.chat_id::text,
        'messageId', v_member.message_id::text,
        'notificationId', v_member.notification_id::text,
        'url', '/?chat=' || v_outbox.chat_id::text || '&message=' || v_member.message_id::text,
        'tag', 'message:chat:' || v_outbox.chat_id::text
      );
      update public.notifications_album_push_outbox o
      set claimed_until = v_now + interval '5 minutes', updated_at = v_now
      where o.id = p_outbox_id;
      return query select 'deliver'::text, v_payload;
      return;
    end if;
  end loop;

  update public.notifications_album_push_outbox o
  set suppressed_at = case when v_outbox.observed_count = v_outbox.expected_count
        or v_now >= v_outbox.first_at + interval '30 seconds'
        then v_now else null end,
      suppression_reason = case when v_outbox.observed_count = v_outbox.expected_count
        or v_now >= v_outbox.first_at + interval '30 seconds'
        then 'not_eligible' else null end,
      next_attempt_at = v_now + interval '1 minute',
      claim_token = null, claimed_until = null, updated_at = v_now
  where o.id = p_outbox_id;
  return query select 'not_eligible'::text, null::jsonb;
end
$function$
;
ALTER FUNCTION public.album_push_recheck(uuid,uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.push_outbox_delivery_recheck(p_outbox_id uuid, p_claim_token uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz := now();
  v_user_id uuid;
  v_read_at timestamptz;
  v_subscription_active boolean;
  v_subscription_user_id uuid;
  v_note_owner uuid;
  v_kind text;
  v_payload jsonb;
begin
  if p_outbox_id is null or p_claim_token is null then
    raise exception 'invalid_web_push_delivery_recheck' using errcode = '22023';
  end if;

  select o.user_id, n.read_at, s.is_active, s.user_id, n.user_id, n.kind, n.payload
  into v_user_id, v_read_at, v_subscription_active, v_subscription_user_id, v_note_owner, v_kind, v_payload
  from public.notifications_push_outbox o
  join public.notifications n on n.id = o.notification_id
  left join public.push_subscriptions s on s.id = o.subscription_id
  where o.id = p_outbox_id
    and o.claim_token = p_claim_token
    and o.sent_at is null
    and o.suppressed_at is null
  for update of o;

  if not found then
    return 'claim_lost';
  end if;

  if v_read_at is not null then
    update public.notifications_push_outbox
    set suppressed_at = v_now,
        suppression_reason = 'read',
        claim_token = null,
        claimed_until = null
    where id = p_outbox_id
      and claim_token = p_claim_token;
    return 'read';
  end if;

  if v_subscription_active is not true
      or v_subscription_user_id is distinct from v_user_id then
    update public.notifications_push_outbox
    set suppressed_at = v_now,
        suppression_reason = 'subscription_inactive',
        claim_token = null,
        claimed_until = null
    where id = p_outbox_id
      and claim_token = p_claim_token;
    return 'subscription_inactive';
  end if;

  if v_note_owner is distinct from v_user_id
      or not public._notification_push_allowed(v_user_id, v_kind, v_payload) then
    update public.notifications_push_outbox
    set suppressed_at = v_now, suppression_reason = NULL,
        claim_token = null, claimed_until = null
    where id = p_outbox_id and claim_token = p_claim_token;
    return 'not_eligible';
  end if;

  if exists (
    select 1
    from public.push_foreground_sessions s
    where s.user_id = v_user_id
      and s.expires_at > v_now
  ) then
    update public.notifications_push_outbox
    set claim_token = null,
        claimed_until = null
    where id = p_outbox_id
      and claim_token = p_claim_token;
    return 'foreground';
  end if;

  update public.notifications_push_outbox
  set claimed_until = v_now + interval '60 seconds'
  where id = p_outbox_id
    and claim_token = p_claim_token;
  return 'deliver';
end
$function$
;
ALTER FUNCTION public.push_outbox_delivery_recheck(uuid,uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.native_push_outbox_delivery_recheck(p_outbox_id uuid, p_claim_token uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_now timestamptz;
  v_claimed_until timestamptz;
  v_read_at timestamptz;
  v_device_active boolean;
  v_user_id uuid;
  v_kind text;
  v_payload jsonb;
begin
  if p_outbox_id is null or p_claim_token is null then
    raise exception 'invalid_native_push_delivery_recheck' using errcode = '22023';
  end if;

  select o.claimed_until, n.read_at, o.user_id, n.kind, n.payload,
    (n.user_id = o.user_id and d.user_id = o.user_id
      and d.enabled is true and d.revoked_at is null)
  into v_claimed_until, v_read_at, v_user_id, v_kind, v_payload, v_device_active
  from public.notifications_native_push_outbox o
  join public.notifications n on n.id = o.notification_id
  left join public.user_push_devices d on d.id = o.device_id
  where o.id = p_outbox_id
    and o.claim_token = p_claim_token
    and o.sent_at is null
    and o.attempt_count < 5
  for update of o;

  if not found then
    return 'claim_lost';
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_read_at is not null then
    update public.notifications_native_push_outbox
    set sent_at = v_now,
        last_error = 'suppressed:read',
        claim_token = null,
        claimed_until = null
    where id = p_outbox_id and claim_token = p_claim_token;
    return 'read';
  end if;

  if v_device_active is not true then
    update public.notifications_native_push_outbox
    set sent_at = v_now,
        last_error = 'suppressed:device_inactive',
        claim_token = null,
        claimed_until = null
    where id = p_outbox_id and claim_token = p_claim_token;
    return 'device_inactive';
  end if;

  if v_claimed_until is null or v_claimed_until <= v_now then
    return 'claim_lost';
  end if;

  if not public._notification_push_allowed(v_user_id, v_kind, v_payload) then
    update public.notifications_native_push_outbox
    set sent_at = v_now, last_error = 'suppressed:not_eligible',
        claim_token = null, claimed_until = null
    where id = p_outbox_id and claim_token = p_claim_token;
    return 'not_eligible';
  end if;

  update public.notifications_native_push_outbox
  set claimed_until = v_now + interval '5 minutes'
  where id = p_outbox_id and claim_token = p_claim_token;
  return 'deliver';
end
$function$
;
ALTER FUNCTION public.native_push_outbox_delivery_recheck(uuid,uuid) OWNER TO postgres;
