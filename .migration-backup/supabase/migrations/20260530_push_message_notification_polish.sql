-- 20260530_push_message_notification_polish.sql
-- Proposal only. Do not apply automatically from Codex.
--
-- Polishes browser/PWA message push notifications:
-- - private first-message auto-created chats no longer emit chat_added;
-- - message notifications carry chat_type for private/group copy;
-- - private messages render as sender + preview, group messages as chat + sender: preview;
-- - message push tags collapse by chat instead of creating one OS card per message.

create or replace function public._notify_chat_members_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chat public.chats%rowtype;
begin
  select * into v_chat from public.chats where id = new.chat_id;
  if not found then
    return null;
  end if;

  -- Private one-to-one chats can be auto-created by the first message.
  -- The recipient should get the message notification only, not a fake
  -- "added to chat" system notification.
  if coalesce(v_chat.type, '') = 'private' then
    return null;
  end if;

  if v_chat.created_by is not null and v_chat.created_by = new.user_id then
    return null;
  end if;

  if auth.uid() is not null and auth.uid() = new.user_id then
    return null;
  end if;

  perform public._notify(
    new.user_id,
    'chat_added',
    jsonb_build_object(
      'chat_id',   v_chat.id,
      'chat_name', v_chat.name,
      'chat_type', v_chat.type,
      'actor_id',  auth.uid()
    )
  );
  return null;
end $$;

revoke all on function public._notify_chat_members_after_insert() from public, anon, authenticated;

create or replace function public.enqueue_message_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text;
  v_chat_name text;
  v_chat_type text;
  v_preview text;
  v_message_type text := coalesce(new.type, 'text');
begin
  if new.user_id is null or v_message_type = 'system' then
    return null;
  end if;

  select coalesce(nullif(p.full_name, ''), nullif('@' || p.username, '@'), 'Участник')
    into v_sender_name
  from public.profiles p
  where p.id = new.user_id;

  select coalesce(nullif(c.name, ''), v_sender_name, 'Чат'), coalesce(nullif(c.type, ''), 'private')
    into v_chat_name, v_chat_type
  from public.chats c
  where c.id = new.chat_id;

  v_preview := case
    when v_message_type = 'text'
      then nullif(left(regexp_replace(coalesce(new.content, ''), '\s+', ' ', 'g'), 160), '')
    when v_message_type = 'image' then 'Фото'
    when v_message_type = 'video' and coalesce(new.media_metadata->>'kind', '') = 'video_message' then 'Видеосообщение'
    when v_message_type = 'video' then 'Видео'
    when v_message_type = 'audio' then 'Голосовое'
    when v_message_type = 'file' then 'Файл'
    when v_message_type = 'location' then 'Местоположение'
    else 'Сообщение'
  end;
  v_preview := coalesce(v_preview, 'Сообщение');

  insert into public.notifications (user_id, kind, payload)
  select
    cm.user_id,
    'message',
    jsonb_build_object(
      'chat_id', new.chat_id,
      'message_id', new.id,
      'sender_id', new.user_id,
      'sender_name', coalesce(v_sender_name, 'Участник'),
      'chat_name', coalesce(v_chat_name, 'Чат'),
      'chat_type', coalesce(v_chat_type, 'private'),
      'preview', v_preview,
      'message_type', v_message_type
    )
  from public.chat_members cm
  where cm.chat_id = new.chat_id
    and cm.user_id <> new.user_id
    and cm.hidden_at is null
    and (cm.cleared_at is null or new.created_at > cm.cleared_at)
    and not exists (
      select 1
      from public.message_hidden_for_users mh
      where mh.message_id = new.id
        and mh.user_id = cm.user_id
    )
  on conflict do nothing;

  return null;
end $$;

revoke all on function public.enqueue_message_notifications() from public, anon, authenticated;

create or replace function public._notification_push_payload(
  p_kind text,
  p_payload jsonb
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_title text := 'КУБ';
  v_body text := 'Новое уведомление';
  v_url text := '/';
  v_tag text := 'kub-notification:' || p_kind;
  v_task_id text := nullif(p_payload->>'task_id', '');
  v_task_title text := nullif(p_payload->>'title', '');
  v_invite_id text := nullif(p_payload->>'invite_id', '');
  v_chat_name text := nullif(p_payload->>'chat_name', '');
  v_chat_type text := nullif(p_payload->>'chat_type', '');
  v_chat_id text := nullif(p_payload->>'chat_id', '');
  v_message_id text := nullif(p_payload->>'message_id', '');
  v_preview text := nullif(p_payload->>'preview', '');
  v_sender_name text := nullif(p_payload->>'sender_name', '');
begin
  if p_kind like 'task_%' then
    v_body := coalesce('Задача: «' || v_task_title || '»', 'Обновление задачи');
    v_url := '/tasks';
    v_tag := 'task:' || coalesce(v_task_id, p_kind);
  elsif p_kind = 'group_invite' then
    v_body := coalesce('Приглашение в «' || v_chat_name || '»', 'Новое приглашение');
    v_url := '/?notifications=1';
    v_tag := 'invite:' || coalesce(v_invite_id, v_chat_id, p_kind);
  elsif p_kind = 'chat_added' then
    v_body := coalesce('Вас добавили в «' || v_chat_name || '»', 'Вас добавили в чат');
    v_url := case when v_chat_id is not null then '/?chat=' || v_chat_id else '/' end;
    v_tag := 'chat-added:' || coalesce(v_chat_id, p_kind);
  elsif p_kind like '%message%' then
    if v_chat_type = 'private' then
      v_title := coalesce(v_sender_name, 'Новое сообщение');
      v_body := coalesce(v_preview, 'Новое сообщение');
    else
      v_title := coalesce(v_chat_name, 'Новое сообщение');
      v_body := case
        when v_sender_name is not null and v_preview is not null then v_sender_name || ': ' || v_preview
        when v_preview is not null then v_preview
        else 'Новое сообщение'
      end;
    end if;
    v_url := case
      when v_chat_id is not null and v_message_id is not null then '/?chat=' || v_chat_id || '&message=' || v_message_id
      when v_chat_id is not null then '/?chat=' || v_chat_id
      else '/'
    end;
    v_tag := 'message:chat:' || coalesce(v_chat_id, v_message_id, 'unknown');
  end if;

  return jsonb_build_object(
    'title', v_title,
    'body', v_body,
    'url', v_url,
    'tag', v_tag,
    'kind', p_kind,
    'chatId', v_chat_id,
    'messageId', v_message_id
  );
end $$;
