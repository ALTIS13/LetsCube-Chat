-- Exact read-only PG17.6 function capture,2026-10-16. Synthetic test schema only, not a full restore.
CREATE OR REPLACE FUNCTION private.message_notification_visible_to(p_message_id uuid, p_recipient_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS(
    SELECT 1 FROM public.messages m JOIN public.chats c ON c.id=m.chat_id
    JOIN public.chat_members cm ON cm.chat_id=m.chat_id AND cm.user_id=p_recipient_id
    WHERE m.id=p_message_id AND m.deleted_at IS NULL AND coalesce(m.type,'text') <> 'system'
      AND (m.user_id IS NOT NULL OR m.bot_id IS NOT NULL)
      AND m.user_id IS DISTINCT FROM p_recipient_id
      AND m.created_at >= cm.joined_at AND cm.hidden_at IS NULL
      AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at)
      AND NOT public.is_banned(p_recipient_id)
      AND (m.topic_id IS NULL OR EXISTS(SELECT 1 FROM public.topics t WHERE t.id=m.topic_id AND t.chat_id=m.chat_id))
      AND NOT EXISTS(SELECT 1 FROM public.message_hidden_for_users h WHERE h.message_id=m.id AND h.user_id=p_recipient_id)
      AND NOT EXISTS(SELECT 1 FROM public.user_blocks b WHERE b.blocker_id=p_recipient_id AND b.blocked_id=m.user_id));
$function$
;

CREATE OR REPLACE FUNCTION public._notification_push_allowed(p_user_id uuid, p_kind text, p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prefs public.notification_preferences%rowtype;
  v_chat_id uuid;
  v_chat_pref public.chat_notification_preferences%rowtype;
  v_sender_id uuid;
begin
  if exists (
    select 1 from public.privacy_preferences p
    where p.user_id = p_user_id and p.manual_status = 'dnd'
      and (p.manual_status_until is null or p.manual_status_until > now())
  ) then
    return false;
  end if;
  if p_kind = 'message' then
    if coalesce(p_payload->>'message_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;
    if not private.message_notification_visible_to((p_payload->>'message_id')::uuid, p_user_id)
       or not exists (select 1 from public.messages m where m.id = (p_payload->>'message_id')::uuid
           and m.chat_id::text = p_payload->>'chat_id') then
      return false;
    end if;
  end if;
  select * into v_prefs
  from public.notification_preferences
  where user_id = p_user_id;

  if coalesce(v_prefs.push_enabled, false) is not true then
    return false;
  end if;

  if p_kind like '%message%' and coalesce(v_prefs.message_push_enabled, true) is not true then
    return false;
  end if;
  if p_kind like 'task_%' and coalesce(v_prefs.task_push_enabled, true) is not true then
    return false;
  end if;
  if p_kind = 'group_invite' and coalesce(v_prefs.invite_push_enabled, true) is not true then
    return false;
  end if;

  if (p_payload->>'sender_id') ~* '^[0-9a-f-]{36}$' then
    v_sender_id := (p_payload->>'sender_id')::uuid;
    if v_sender_id = p_user_id then
      return false;
    end if;
  end if;

  if (p_payload->>'chat_id') ~* '^[0-9a-f-]{36}$' then
    v_chat_id := (p_payload->>'chat_id')::uuid;
    select * into v_chat_pref
    from public.chat_notification_preferences
    where chat_id = v_chat_id and user_id = p_user_id;

    if found then
      if v_chat_pref.push_enabled is not true then
        return false;
      end if;
      if v_chat_pref.muted_until is not null and v_chat_pref.muted_until > now() then
        return false;
      end if;
    end if;
  end if;

  return true;
end $function$
;
