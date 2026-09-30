/**
 * Rollback of 20260930150000_micro_groups.sql.
 *
 * Refuses while any micro-group exists: narrowing the type check would fail on
 * those rows, and deleting them is not a rollback's business. Past that point,
 * the rollback is the interface no longer offering the gesture.
 *
 * The three changed functions are restored from their definitions as read off
 * production before the migration (2026-09-30).
 */
begin;
set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from public.chats where type = 'dm_group') then
    raise exception 'micro-groups exist; the rollback would have to delete them';
  end if;
end;
$$;

drop function if exists public.micro_group_leave(uuid);
drop function if exists public.micro_group_rename(uuid, text);
drop function if exists public.micro_group_add(uuid, uuid[]);
drop function if exists public.micro_group_create(uuid, uuid[]);

drop policy if exists "micro-group has no administrators" on public.chat_members;
drop policy if exists "micro-group members only through its functions" on public.chat_members;

drop policy if exists "Users create chats with self as creator" on public.chats;
create policy "Users create chats with self as creator"
  on public.chats
  for insert
  to authenticated
  with check ((created_by = auth.uid()) and (type is not null) and (type <> 'private'::text));

alter table public.chats drop constraint chats_type_check;
alter table public.chats add constraint chats_type_check
  check (type = any (array['private'::text, 'group'::text, 'channel'::text]));

CREATE OR REPLACE FUNCTION private.enforce_chat_role_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type text;
begin
  if tg_op = 'UPDATE' and new.chat_id is distinct from old.chat_id then
    raise exception 'chat_role_chat_immutable' using errcode = '42501';
  end if;

  select chat_row.type into v_type
    from public.chats as chat_row
   where chat_row.id = new.chat_id;

  if v_type is null then
    raise exception 'chat_role_chat_missing' using errcode = 'P0001';
  end if;

  if v_type = 'private' then
    raise exception 'chat_role_private_chat' using errcode = '42501';
  end if;

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.write_membership_service_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_chat_id    uuid;
  v_subject    uuid;
  v_actor      uuid := auth.uid();
  v_chat_type  text;
  v_members    bigint;
  v_subject_nm text;
  v_actor_nm   text;
  v_line       text;
begin
  if tg_op = 'DELETE' then
    v_chat_id := old.chat_id;
    v_subject := old.user_id;
  else
    v_chat_id := new.chat_id;
    v_subject := new.user_id;
  end if;

  -- `is distinct from` rather than `<>`: a cascading chat delete leaves no row
  -- here, v_chat_type is null, and `null <> 'group'` is null — which would fall
  -- through and try to write a message into a chat that no longer exists.
  select chat_row.type into v_chat_type
    from public.chats chat_row where chat_row.id = v_chat_id;
  if v_chat_type is distinct from 'group' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    -- The creator's own row, written by `trg_add_chat_creator_as_owner` while
    -- the group is being made. That is a group appearing, not a person joining.
    select pg_catalog.count(*) into v_members
      from public.chat_members member_row where member_row.chat_id = v_chat_id;
    if v_members <= 1 then
      return null;
    end if;
  end if;

  v_subject_nm := public.chat_member_service_name(v_subject);
  if v_actor is not null and v_actor is distinct from v_subject then
    v_actor_nm := public.chat_member_service_name(v_actor);
  end if;

  -- Russian needs the accusative for a direct object — «добавил Ольгу», not
  -- «добавил Ольга Крылова» — and there is no declension to be had in SQL. So
  -- where a name would be an object it is introduced by a colon instead, which
  -- licenses the nominative and stays grammatical for every name. Where the
  -- person is the subject the plain form already works.
  if tg_op = 'INSERT' then
    if v_actor_nm is null then
      v_line := v_subject_nm || ' присоединился(ась) к группе';
    else
      v_line := v_actor_nm || ' добавил(а) в группу: ' || v_subject_nm;
    end if;
  else
    if v_actor_nm is not null then
      v_line := v_actor_nm || ' исключил(а) из группы: ' || v_subject_nm;
    elsif v_actor is not null then
      v_line := v_subject_nm || ' вышел(а) из группы';
    else
      -- Nobody to name. Saying «вышел» here would be a guess about somebody
      -- who may well have been removed by the service.
      v_line := v_subject_nm || ' больше не в группе';
    end if;
  end if;

  insert into public.messages (chat_id, type, content)
    values (v_chat_id, 'system', v_line);

  return null;
end
$function$;

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
    coalesce(nullif(chat.type, ''), 'private')
  into v_chat_name, v_chat_type
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
      'chat_name', coalesce(v_chat_name, 'Чат'),
      'chat_type', coalesce(v_chat_type, 'private'),
      'preview', v_preview,
      'message_type', v_message_type,
      'route', '/?chat=' || new.chat_id::text || '&message=' || new.id::text,
      'group_tag', 'message:chat:' || new.chat_id::text
    )
  from public.chat_members member_row
  where member_row.chat_id = new.chat_id
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
$function$;

drop function if exists public.micro_group_drawn_name(uuid, uuid);
drop function if exists public.users_blocked_either(uuid, uuid);

do $$
begin
  if pg_catalog.to_regprocedure('public.micro_group_create(uuid, uuid[])') is not null
    or pg_catalog.pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.chats'::regclass and conname = 'chats_type_check')) like '%dm_group%'
    or pg_catalog.pg_get_functiondef('public.enqueue_message_notifications()'::regprocedure) like '%micro_group_drawn_name%'
  then
    raise exception 'micro_groups survived the rollback';
  end if;
end;
$$;

commit;
