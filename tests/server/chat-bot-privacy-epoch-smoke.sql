-- Run only inside an explicit transaction followed by ROLLBACK.
-- Uses existing group bots, emits no IDs or message content.
do $$
declare
  v_chat uuid;
  v_bot uuid;
  v_admin uuid;
  v_old_message uuid;
  v_new_message uuid;
  v_created_at timestamptz;
  v_update_id bigint;
  v_payload jsonb;
  v_lease uuid := pg_catalog.gen_random_uuid();
  v_webhook_enabled boolean;
begin
  select member_row.chat_id, member_row.bot_id, human.user_id
    into v_chat, v_bot, v_admin
  from public.chat_bot_members member_row
  join public.chats chat on chat.id = member_row.chat_id and chat.type = 'group'
  join public.bots bot on bot.id = member_row.bot_id and bot.state = 'active'
  join public.chat_members human on human.chat_id = member_row.chat_id
    and human.role in ('owner', 'admin')
  where member_row.removed_at is null and member_row.privacy_mode = 'restricted'
  order by member_row.chat_id, member_row.bot_id
  limit 1;
  if v_chat is null then
    raise exception 'no_group_bot_for_epoch_smoke';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  execute 'set local role authenticated';
  insert into public.messages(chat_id, user_id, content, created_at)
  values (v_chat, v_admin, 'privacy epoch smoke old', pg_catalog.clock_timestamp() + interval '1 day')
  returning id, created_at into v_old_message, v_created_at;
  if v_created_at > pg_catalog.clock_timestamp() + interval '1 minute' then
    raise exception 'client_inserted_future_message';
  end if;
  update public.messages set created_at = pg_catalog.clock_timestamp() + interval '1 day'
  where id = v_old_message;
  if (select created_at from public.messages where id = v_old_message) <> v_created_at then
    raise exception 'client_moved_message_into_future';
  end if;
  perform public.chat_bot_set_privacy(v_chat, v_bot, true);
  execute 'reset role';
  if private.bot_can_receive_message(v_bot, v_old_message) then
    raise exception 'full_mode_exposed_preexisting_message';
  end if;

  insert into public.messages(chat_id, user_id, content)
  values (v_chat, v_admin, 'privacy epoch smoke new') returning id into v_new_message;
  select queued.update_id, queued.payload into v_update_id, v_payload
  from private.bot_updates queued
  where queued.bot_id = v_bot and queued.update_type = 'message'
    and queued.payload #>> '{message,id}' = v_new_message::text;
  if v_update_id is null or not private.bot_update_still_visible(v_bot, 'message', v_payload) then
    raise exception 'full_mode_new_message_not_queued';
  end if;

  execute 'set local role authenticated';
  perform public.chat_bot_set_privacy(v_chat, v_bot, false);
  execute 'reset role';
  if exists (
    select 1 from private.bot_updates queued
    where queued.bot_id = v_bot and queued.update_id = v_update_id
  ) or private.bot_update_still_visible(v_bot, 'message', v_payload) then
    raise exception 'revocation_left_readable_update';
  end if;

  insert into private.bot_updates(bot_id, update_id, update_type, payload)
  values (v_bot, v_update_id, 'message', v_payload);
  select exists (
    select 1 from private.bot_webhooks webhook
    where webhook.bot_id = v_bot and webhook.state = 'enabled'
  ) into v_webhook_enabled;
  if v_webhook_enabled then
    update private.bot_webhooks set state = 'disabled' where bot_id = v_bot;
    delete from private.bot_delivery_leases where bot_id = v_bot;
  end if;
  if exists (
    select 1 from public.bot_updates_poll_internal(
      v_bot, v_update_id, 10, array['message']::text[], v_lease
    ) polled where polled.update_id = v_update_id
  ) then
    raise exception 'poll_returned_revoked_message';
  end if;
  perform public.bot_updates_poll_release_internal(v_bot, v_lease);
  if v_webhook_enabled then
    update private.bot_webhooks set state = 'enabled' where bot_id = v_bot;
  end if;
end;
$$;

do $$
declare
  v_chat uuid;
  v_bot uuid;
  v_admin uuid;
  v_message uuid;
  v_update_id bigint;
  v_payload jsonb;
  v_attempt bigint;
  v_claim uuid := pg_catalog.gen_random_uuid();
  v_epoch bigint;
begin
  select member_row.chat_id, member_row.bot_id, human.user_id, webhook.webhook_epoch
    into v_chat, v_bot, v_admin, v_epoch
  from public.chat_bot_members member_row
  join public.chats chat on chat.id = member_row.chat_id and chat.type = 'group'
  join public.bots bot on bot.id = member_row.bot_id and bot.state = 'active'
  join private.bot_webhooks webhook on webhook.bot_id = member_row.bot_id
    and webhook.state = 'enabled'
  join public.chat_members human on human.chat_id = member_row.chat_id
    and human.role in ('owner', 'admin')
  where member_row.removed_at is null and member_row.privacy_mode = 'restricted'
  order by member_row.chat_id, member_row.bot_id
  limit 1;
  if v_chat is null then
    raise exception 'no_webhook_group_bot_for_epoch_smoke';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin::text, true);
  execute 'set local role authenticated';
  perform public.chat_bot_set_privacy(v_chat, v_bot, true);
  execute 'reset role';
  insert into public.messages(chat_id, user_id, content)
  values (v_chat, v_admin, 'privacy epoch webhook smoke') returning id into v_message;
  select queued.update_id, queued.payload into v_update_id, v_payload
  from private.bot_updates queued
  where queued.bot_id = v_bot and queued.update_type = 'message'
    and queued.payload #>> '{message,id}' = v_message::text;
  if v_update_id is null or not exists (
    select 1 from private.bot_delivery_attempts attempt
    where attempt.bot_id = v_bot and attempt.update_id = v_update_id
  ) then
    raise exception 'webhook_message_not_queued';
  end if;

  execute 'set local role authenticated';
  perform public.chat_bot_set_privacy(v_chat, v_bot, false);
  execute 'reset role';
  if exists (
    select 1 from private.bot_delivery_attempts attempt
    where attempt.bot_id = v_bot and attempt.update_id = v_update_id
  ) then
    raise exception 'revocation_left_webhook_attempt';
  end if;

  insert into private.bot_updates(bot_id, update_id, update_type, payload)
  values (v_bot, v_update_id, 'message', v_payload);
  insert into private.bot_delivery_attempts(
    bot_id, update_id, status, attempt_count, claim_token, claimed_at, webhook_epoch
  ) values (
    v_bot, v_update_id, 'claimed', 1, v_claim, pg_catalog.clock_timestamp(), v_epoch
  ) returning id into v_attempt;
  if public.bot_delivery_prepare_internal(v_attempt, v_claim, v_epoch) is not null then
    raise exception 'webhook_prepared_revoked_message';
  end if;
  if not exists (
    select 1 from private.bot_delivery_attempts attempt
    join private.bot_updates queued
      on queued.bot_id = attempt.bot_id and queued.update_id = attempt.update_id
    where attempt.id = v_attempt and attempt.status = 'dead_letter'
      and queued.acknowledged_at is not null
  ) then
    raise exception 'webhook_revocation_did_not_retire_attempt';
  end if;
end;
$$;
