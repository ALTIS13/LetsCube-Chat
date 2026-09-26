-- Rollback before activation: drop function public.album_push_enqueue(uuid),
-- then drop the album push tables in dependency order. After activation, first
-- disable public.album_push_runtime.enabled and drain/quarantine its outbox.
begin;

create table public.album_push_runtime (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  legacy_wns_enabled boolean not null default false,
  activated_at timestamptz
);
insert into public.album_push_runtime(singleton, enabled) values (true, false);

create table public.album_push_legacy_keys (
  chat_id uuid not null,
  sender_kind text not null check (sender_kind in ('user', 'bot')),
  sender_id uuid not null,
  album_id text not null,
  primary key (chat_id, sender_kind, sender_id, album_id)
);

create table public.album_push_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  chat_id uuid not null,
  sender_kind text not null check (sender_kind in ('user', 'bot')),
  sender_id uuid not null,
  album_id text not null check (length(album_id) between 8 and 80),
  expected_count smallint not null check (expected_count between 2 and 10),
  observed_count smallint not null default 0
    check (observed_count between 0 and 10 and observed_count <= expected_count),
  first_at timestamptz not null default clock_timestamp(),
  last_at timestamptz not null default clock_timestamp(),
  ready_at timestamptz not null default clock_timestamp() + interval '5 seconds',
  unique (user_id, chat_id, sender_kind, sender_id, album_id)
);

create table public.album_push_members (
  group_id uuid not null references public.album_push_groups(id) on delete cascade,
  notification_id uuid not null unique references public.notifications(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  album_index smallint not null check (album_index between 0 and 9),
  primary key (group_id, album_index)
);

create table public.notifications_album_push_outbox (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.album_push_groups(id) on delete cascade,
  subscription_id uuid references public.push_subscriptions(id) on delete cascade,
  device_id uuid references public.user_push_devices(id) on delete cascade,
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  suppressed_at timestamptz,
  suppression_reason text,
  last_error text,
  claim_token uuid,
  claimed_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((subscription_id is not null) <> (device_id is not null)),
  check (sent_at is null or suppressed_at is null)
);
create unique index album_push_outbox_web_unique
  on public.notifications_album_push_outbox(group_id, subscription_id)
  where subscription_id is not null;
create unique index album_push_outbox_device_unique
  on public.notifications_album_push_outbox(group_id, device_id)
  where device_id is not null;
create index album_push_outbox_pending_idx
  on public.notifications_album_push_outbox(next_attempt_at, id)
  where sent_at is null and suppressed_at is null;
create index album_push_groups_ready_idx on public.album_push_groups(ready_at, id);

alter table public.album_push_runtime enable row level security;
alter table public.album_push_legacy_keys enable row level security;
alter table public.album_push_groups enable row level security;
alter table public.album_push_members enable row level security;
alter table public.notifications_album_push_outbox enable row level security;
revoke all on public.album_push_runtime, public.album_push_legacy_keys,
  public.album_push_groups, public.album_push_members,
  public.notifications_album_push_outbox
  from public, anon, authenticated, service_role;

create function public.album_push_enqueue(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
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
$$;

revoke all on function public.album_push_enqueue(uuid)
  from public, anon, authenticated, service_role;

create function public.album_push_claim(p_limit integer, p_claim_token uuid)
returns table (
  id uuid,
  subscription_id uuid,
  device_id uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 20));
begin
  if p_claim_token is null then
    raise exception 'invalid_album_push_claim_token' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select o.id
    from public.notifications_album_push_outbox o
    join public.album_push_groups g on g.id = o.group_id
    where o.sent_at is null and o.suppressed_at is null
      and o.attempt_count < 5
      and o.next_attempt_at <= v_now and g.ready_at <= v_now
      and (o.claimed_until is null or o.claimed_until <= v_now)
    order by g.ready_at, o.id
    for update of o skip locked
    limit v_limit
  ), claimed as (
    update public.notifications_album_push_outbox o
    set claim_token = p_claim_token,
        claimed_until = v_now + interval '5 minutes',
        updated_at = v_now
    from candidates c
    where o.id = c.id
    returning o.id, o.subscription_id, o.device_id, o.attempt_count
  )
  select c.id, c.subscription_id, c.device_id, c.attempt_count
  from claimed c;
end
$$;

create function public.album_push_recheck(p_outbox_id uuid, p_claim_token uuid)
returns table (status text, payload jsonb)
language plpgsql
security definer
set search_path = pg_catalog
as $$
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
$$;

create function public.album_push_ack(
  p_outbox_id uuid, p_claim_token uuid, p_outcome text, p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_outbox_id is null or p_claim_token is null or p_outcome is null
      or p_outcome not in ('sent', 'retry', 'gone', 'release') then
    raise exception 'invalid_album_push_ack' using errcode = '22023';
  end if;

  update public.notifications_album_push_outbox o
  set sent_at = case when p_outcome = 'sent' then v_now else null end,
      suppressed_at = case
        when p_outcome = 'gone' or (p_outcome = 'retry' and o.attempt_count + 1 >= 5)
          then v_now else null end,
      suppression_reason = case
        when p_outcome = 'gone' then 'target_inactive'
        when p_outcome = 'retry' and o.attempt_count + 1 >= 5 then 'retry_exhausted'
        else null end,
      attempt_count = case when p_outcome = 'retry'
        then o.attempt_count + 1 else o.attempt_count end,
      next_attempt_at = case
        when p_outcome = 'retry' then v_now + interval '15 seconds' * (1 << o.attempt_count)
        when p_outcome = 'release' then v_now + interval '1 minute'
        else o.next_attempt_at end,
      last_error = case when p_outcome = 'sent' then null
        else pg_catalog.left(coalesce(p_error, p_outcome), 160) end,
      claim_token = null, claimed_until = null, updated_at = v_now
  where o.id = p_outbox_id and o.claim_token = p_claim_token
    and o.claimed_until > v_now and o.sent_at is null and o.suppressed_at is null;
  return found;
end
$$;

revoke all on function public.album_push_claim(integer, uuid),
  public.album_push_recheck(uuid, uuid),
  public.album_push_ack(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.album_push_claim(integer, uuid),
  public.album_push_recheck(uuid, uuid),
  public.album_push_ack(uuid, uuid, text, text)
  to service_role;

do $$
begin
  if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'notifications_album_push_outbox'
        and c.relrowsecurity
    )
    or pg_catalog.has_function_privilege(
      'anon', 'public.album_push_enqueue(uuid)', 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated', 'public.album_push_enqueue(uuid)', 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role', 'public.album_push_enqueue(uuid)', 'EXECUTE'
    )
    or not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = 'public.album_push_enqueue(uuid)'::regprocedure
        and p.prosecdef
        and p.proconfig @> array['search_path=pg_catalog']
    )
    or not pg_catalog.has_function_privilege(
      'service_role', 'public.album_push_claim(integer,uuid)', 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated', 'public.album_push_claim(integer,uuid)', 'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'service_role', 'public.album_push_recheck(uuid,uuid)', 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon', 'public.album_push_recheck(uuid,uuid)', 'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'service_role', 'public.album_push_ack(uuid,uuid,text,text)', 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated', 'public.album_push_ack(uuid,uuid,text,text)', 'EXECUTE'
    ) then
    raise exception 'album_push_outbox_self_check_failed';
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
