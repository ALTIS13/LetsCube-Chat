-- Rollback for 20260926193000_bot_viewer_interface.sql.
-- The guard must not be removed while any marked callback can still be delivered.
begin;
set local lock_timeout = '5s';

do $prestate$
begin
  if pg_catalog.to_regclass('private.bot_viewer_interfaces') is null
     or pg_catalog.to_regclass('private.bot_callback_interface_grants') is null
     or pg_catalog.to_regprocedure('public.bot_viewer_interface_press(uuid,integer,text)') is null
     or exists (select 1 from private.bot_viewer_interfaces)
     or exists (select 1 from private.bot_callback_interface_grants)
     or exists (select 1 from private.bot_updates u
                where u.update_type = 'callback_query'
                  and u.payload #>> '{callback_query,viewer_interface_id}' is not null)
     or exists (select 1 from private.bot_operation_idempotency i
                where i.method in ('setViewerInterface','editViewerInterface','closeViewerInterface')) then
    raise exception 'bot_viewer_rollback_prestate_unsafe';
  end if;
end
$prestate$;

create or replace function private.bot_update_still_visible(
  p_bot_id uuid, p_update_type text, p_payload jsonb
) returns boolean
language plpgsql stable security definer
set search_path to ''
as $function$
declare
  v_message_id text;
  v_chat_id text;
begin
  if p_bot_id is null or p_update_type is null or p_payload is null then
    return false;
  end if;
  if p_update_type not in ('message', 'edited_message') then
    return true;
  end if;
  v_message_id := p_payload #>> '{message,id}';
  v_chat_id := p_payload #>> '{message,chat_id}';
  if v_message_id is null
     or v_message_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_chat_id is null
     or v_chat_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or not exists (
       select 1 from public.messages message_row
       where message_row.id = v_message_id::uuid
         and message_row.chat_id = v_chat_id::uuid
     ) then
    return false;
  end if;
  return private.bot_can_receive_message(p_bot_id, v_message_id::uuid);
end
$function$;
revoke all on function private.bot_update_still_visible(uuid,text,jsonb)
  from public, anon, authenticated, service_role;

drop trigger trg_bot_viewer_grant_on_callback on private.bot_updates;
drop trigger trg_bot_viewer_human_revoke on public.chat_members;
drop trigger trg_bot_viewer_bot_member_revoke on public.chat_bot_members;
drop trigger trg_bot_viewer_source_revoke on public.messages;
drop trigger trg_bot_viewer_bot_state_revoke on public.bots;
drop trigger trg_bot_viewer_token_revoke on private.bot_tokens;

drop function public.bot_viewer_interface_set_internal(uuid,uuid,uuid,jsonb,text,text);
drop function public.bot_viewer_interface_edit_internal(uuid,uuid,uuid,integer,jsonb,text,text);
drop function public.bot_viewer_interface_close_internal(uuid,uuid,uuid,integer,text,text);
drop function public.bot_viewer_interfaces_for_actor(uuid);
drop function public.bot_viewer_interface_dismiss(uuid,integer);
drop function public.bot_viewer_interface_press(uuid,integer,text);
drop function public.bot_viewer_interface_cleanup_internal(timestamptz,integer);
drop function public.bot_viewer_delivery_recheck_internal(bigint,uuid);
drop function private.bot_viewer_grant_on_callback();
drop function private.bot_viewer_revoke_on_change();

drop table private.bot_viewer_interface_actions;
drop table private.bot_viewer_interfaces;
drop table private.bot_callback_interface_grants;

drop function private.bot_viewer_interface_valid(uuid);
drop function private.bot_viewer_source_valid(uuid,uuid,uuid,uuid,timestamptz,timestamptz);
drop function private.bot_viewer_state_valid(jsonb);

alter table private.bot_operation_idempotency
  drop constraint bot_operation_idempotency_method_check;
alter table private.bot_operation_idempotency
  add constraint bot_operation_idempotency_method_check check (method in (
    'sendMessage','sendPhoto','sendVideo','sendDocument','sendVoice',
    'sendChatAction','editMessageText','deleteMessage',
    'setMyCommands','answerCallbackQuery','setWebhook','deleteWebhook'
  ));

notify pgrst, 'reload schema';
commit;
