-- Run after the migration inside a transaction that will be rolled back.
-- Uses one existing active group membership; outputs no IDs or messages.
do $$
declare
  v_chat uuid;
  v_bot uuid;
  v_admin uuid;
  v_sender uuid;
  v_old_joined_at timestamptz;
  v_new_joined_at timestamptz;
  v_full_message uuid;
  v_restricted_message uuid;
  v_refused boolean := false;
begin
  select member_row.chat_id, member_row.bot_id, human.user_id,
         sender.user_id, member_row.joined_at
    into v_chat, v_bot, v_admin, v_sender, v_old_joined_at
  from public.chat_bot_members member_row
  join public.chats chat on chat.id = member_row.chat_id and chat.type = 'group'
  join public.bots bot on bot.id = member_row.bot_id and bot.state = 'active'
  join public.chat_members human on human.chat_id = member_row.chat_id
    and human.role in ('owner', 'admin')
  join public.chat_members sender on sender.chat_id = member_row.chat_id
    and sender.role = 'member' and sender.user_id <> human.user_id
  where member_row.removed_at is null
    and member_row.privacy_mode = 'restricted'
  order by member_row.chat_id, member_row.bot_id
  limit 1;
  if v_chat is null or v_sender is null then
    raise exception 'no_active_group_bot_with_ordinary_member_for_privacy_smoke';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', pg_catalog.gen_random_uuid()::text, true);
  execute 'set local role authenticated';
  begin
    perform public.chat_bot_set_privacy(v_chat, v_bot, true);
  exception when insufficient_privilege then
    v_refused := true;
  end;
  execute 'reset role';
  if not v_refused then
    raise exception 'non_admin_changed_bot_privacy';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  execute 'set local role authenticated';
  perform public.chat_bot_set_privacy(v_chat, v_bot, true);
  execute 'reset role';

  select joined_at into v_new_joined_at
  from public.chat_bot_members
  where chat_id = v_chat and bot_id = v_bot;
  if v_new_joined_at < v_old_joined_at or v_new_joined_at < pg_catalog.transaction_timestamp() then
    raise exception 'bot_privacy_history_boundary_not_reset';
  end if;
  if not exists (
    select 1 from private.bot_audit_events
    where bot_id = v_bot and action = 'bot_privacy_changed'
      and metadata ->> 'chat_id' = v_chat::text
  ) then
    raise exception 'bot_privacy_audit_missing';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_sender::text, true);
  execute 'set local role authenticated';
  insert into public.messages(chat_id, user_id, content)
  values (v_chat, v_sender, 'privacy smoke ordinary member message')
  returning id into v_full_message;
  execute 'reset role';
  if not private.bot_can_receive_message(v_bot, v_full_message) then
    raise exception 'full_bot_cannot_receive_new_member_message';
  end if;
  if not exists (
    select 1 from private.bot_updates queued
    where queued.bot_id = v_bot and queued.update_type = 'message'
      and queued.payload #>> '{message,id}' = v_full_message::text
  ) then
    raise exception 'full_bot_member_message_not_queued';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  execute 'set local role authenticated';
  perform public.chat_bot_set_privacy(v_chat, v_bot, false);
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_sender::text, true);
  execute 'set local role authenticated';
  insert into public.messages(chat_id, user_id, content)
  values (v_chat, v_sender, 'privacy smoke ordinary member message')
  returning id into v_restricted_message;
  execute 'reset role';
  if private.bot_can_receive_message(v_bot, v_restricted_message) then
    raise exception 'restricted_bot_received_ordinary_member_message';
  end if;
  if exists (
    select 1 from private.bot_updates queued
    where queued.bot_id = v_bot and queued.update_type = 'message'
      and queued.payload #>> '{message,id}' = v_restricted_message::text
  ) then
    raise exception 'restricted_bot_member_message_was_queued';
  end if;
end;
$$;
