-- Run after the migration inside a transaction that will be rolled back.
-- Uses one existing active group membership; outputs no IDs or messages.
do $$
declare
  v_chat uuid;
  v_bot uuid;
  v_admin uuid;
  v_old_mode text;
  v_old_joined_at timestamptz;
  v_new_joined_at timestamptz;
  v_refused boolean := false;
begin
  select member_row.chat_id, member_row.bot_id, human.user_id,
         member_row.privacy_mode, member_row.joined_at
    into v_chat, v_bot, v_admin, v_old_mode, v_old_joined_at
  from public.chat_bot_members member_row
  join public.chats chat on chat.id = member_row.chat_id and chat.type = 'group'
  join public.bots bot on bot.id = member_row.bot_id and bot.state = 'active'
  join public.chat_members human on human.chat_id = member_row.chat_id
    and human.role in ('owner', 'admin')
  where member_row.removed_at is null
  order by member_row.chat_id, member_row.bot_id
  limit 1;
  if v_chat is null then
    raise exception 'no_active_group_bot_for_privacy_smoke';
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
  perform public.chat_bot_set_privacy(v_chat, v_bot, v_old_mode <> 'full');
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
end;
$$;
