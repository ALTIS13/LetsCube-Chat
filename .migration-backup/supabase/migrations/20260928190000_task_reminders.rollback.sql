-- Rollback of 20260928190000_task_reminders.sql. Revert the web client first
-- (it reads the table and calls the functions). Dropping the table loses every
-- reminder not yet delivered; read them first:
--   select task_id, created_by, recipient, remind_at, note from public.task_reminders where status = 'pending';
-- The push payload function goes back to its text before the migration: the
-- `task_reminder` branch is removed and nothing else changes.
begin;

select cron.unschedule('letscube-task-reminders')
 where exists (select 1 from cron.job where jobname = 'letscube-task-reminders');

create or replace function public._notification_push_payload(p_kind text, p_payload jsonb)
 returns jsonb
 language plpgsql
 immutable
 set search_path to ''
as $function$
declare
  v_title text := 'LETSCUBE';
  v_body text := 'Новое уведомление';
  v_route text := '/';
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
  v_sender_avatar_url text := public._sanitize_notification_avatar_url(
    nullif(p_payload->>'sender_avatar_url', '')
  );
begin
  if p_kind like 'task_%' then
    v_body := coalesce('Задача: «' || v_task_title || '»', 'Обновление задачи');
    v_route := '/tasks';
    v_tag := 'task:' || coalesce(v_task_id, p_kind);
  elsif p_kind = 'group_invite' then
    v_body := coalesce('Приглашение в «' || v_chat_name || '»', 'Новое приглашение');
    v_route := '/?notifications=1';
    v_tag := 'invite:' || coalesce(v_invite_id, v_chat_id, p_kind);
  elsif p_kind = 'chat_added' then
    v_body := coalesce('Вас добавили в «' || v_chat_name || '»', 'Вас добавили в чат');
    v_route := case when v_chat_id is not null then '/?chat=' || v_chat_id else '/' end;
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
    v_route := case
      when v_chat_id is not null and v_message_id is not null then '/?chat=' || v_chat_id || '&message=' || v_message_id
      when v_chat_id is not null then '/?chat=' || v_chat_id
      else '/'
    end;
    v_tag := 'message:chat:' || coalesce(v_chat_id, v_message_id, 'unknown');
  end if;

  return pg_catalog.jsonb_build_object(
    'title', v_title,
    'body', v_body,
    'url', v_route,
    'tag', v_tag,
    'kind', p_kind,
    'chatId', v_chat_id,
    'messageId', v_message_id,
    'chat_id', v_chat_id,
    'message_id', v_message_id,
    'sender_kind', nullif(p_payload->>'sender_kind', ''),
    'sender_id', nullif(p_payload->>'sender_id', ''),
    'bot_id', nullif(p_payload->>'bot_id', ''),
    'sender_name', v_sender_name,
    'sender_avatar_url', v_sender_avatar_url,
    'message_type', nullif(p_payload->>'message_type', ''),
    'preview', v_preview,
    'route', v_route,
    'group_tag', v_tag
  );
end
$function$;

drop function if exists public.task_reminders_deliver_due(integer);
drop function if exists public.task_reminder_remove(uuid);
drop function if exists public.task_reminder_add(uuid, timestamptz, text, text);
drop function if exists public._task_reminder_may_hold(public.tasks, uuid);
drop table if exists public.task_reminders;

do $$
begin
  if to_regclass('public.task_reminders') is not null
     or exists (select 1 from cron.job where jobname = 'letscube-task-reminders')
     or position('task_reminder' in pg_get_functiondef('public._notification_push_payload(text, jsonb)'::regprocedure)) > 0
  then
    raise exception 'task_reminders_rollback_incomplete';
  end if;
end;
$$;

commit;
