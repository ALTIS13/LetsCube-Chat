\set ON_ERROR_STOP on

begin;

do $smoke$
declare
  v_actor_id uuid;
  v_recipient_id uuid;
  v_chat_id uuid := gen_random_uuid();
  v_bot_id uuid;
  v_message_id uuid;
  v_history_message_id uuid;
  v_system_message_id uuid;
  v_first_send jsonb;
  v_duplicate_send jsonb;
  v_legacy_tombstone_count integer;
  v_notification_count integer;
  v_bot_message_count integer;
  v_function regprocedure;
  v_rejected boolean;
  v_webhook_disabled boolean;
begin
  select pg_catalog.count(*)
  into v_legacy_tombstone_count
  from public.messages message_row
  where coalesce(message_row.type, 'text') <> 'system'
    and message_row.user_id is null
    and message_row.bot_id is null;

  if exists (
    select 1
    from public.messages message_row
    where message_row.type = 'system'
      and (message_row.user_id is not null or message_row.bot_id is not null)
  ) then
    raise exception 'system_sender_history_invalid';
  end if;
  if exists (
    select 1
    from public.messages message_row
    where coalesce(message_row.type, 'text') <> 'system'
      and message_row.user_id is not null
      and message_row.bot_id is not null
  ) then
    raise exception 'dual_sender_history_invalid';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.messages'::regclass
      and constraint_row.conname = 'messages_sender_shape_check'
      and constraint_row.convalidated
  ) then
    raise exception 'message_sender_constraint_not_validated';
  end if;
  raise notice 'legacy_tombstone_count=%', v_legacy_tombstone_count;

  if pg_catalog.has_table_privilege('anon', 'private.bot_tokens', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'private.bot_tokens', 'SELECT')
     or pg_catalog.has_table_privilege('service_role', 'private.bot_tokens', 'SELECT') then
    raise exception 'anon_can_access_private_bot_table';
  end if;

  for v_function in
    select function_signature::regprocedure
    from (values
      ('public.bot_create_internal(uuid,text,text,text,text,text)'),
      ('public.bot_list_owned_internal(uuid)'),
      ('public.bot_rotate_token_internal(uuid,uuid,text,text)'),
      ('public.bot_token_lookup_internal(text)'),
      ('public.bot_token_touch_internal(uuid,timestamptz)'),
      ('public.bot_membership_authorize_internal(uuid,uuid,text)'),
      ('public.bot_send_message_internal(uuid,uuid,text,jsonb,text)'),
      ('public.bot_updates_poll_internal(uuid,bigint,integer,uuid)'),
      ('public.bot_updates_ack_internal(uuid,bigint)'),
      ('public.bot_webhook_set_internal(uuid,text,text)'),
      ('public.bot_webhook_delete_internal(uuid)'),
      ('public.bot_update_enqueue_internal(uuid,text,jsonb)'),
      ('public.bot_delivery_claim_internal(integer,uuid)'),
      ('public.bot_delivery_finish_internal(bigint,uuid,text,text)'),
      ('public.bot_delivery_cleanup_internal(timestamptz,integer)')
    ) signatures(function_signature)
  loop
    if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'authenticated_can_execute_bot_internal_rpc: %', v_function;
    end if;
    if not pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'service_role_cannot_execute_bot_internal_rpc: %', v_function;
    end if;
  end loop;

  select profile.id
  into v_actor_id
  from public.profiles profile
  join auth.users auth_user on auth_user.id = profile.id
  join public.profile_contacts contact on contact.user_id = profile.id
  where auth_user.email_confirmed_at is not null
    and auth_user.created_at <= pg_catalog.now() - interval '24 hours'
    and contact.phone_verified is true
    and contact.phone_verified_at is not null
    and not exists (
      select 1
      from public.bans ban
      where ban.user_id = profile.id
        and (ban.expires_at is null or ban.expires_at > pg_catalog.now())
    )
    and (
      select pg_catalog.count(*)
      from public.bot_owners owner_row
      join public.bots bot on bot.id = owner_row.bot_id
      where owner_row.user_id = profile.id
        and owner_row.role = 'owner'
        and bot.state <> 'deleted'
    ) < 3
  order by auth_user.created_at
  limit 1;

  select profile.id
  into v_recipient_id
  from public.profiles profile
  where profile.id <> v_actor_id
  order by profile.created_at
  limit 1;

  if v_actor_id is null or v_recipient_id is null then
    raise exception 'bot_smoke_requires_two_profiles_and_one_eligible_owner';
  end if;

  select created.bot_id
  into v_bot_id
  from public.bot_create_internal(
    v_actor_id,
    'smoke_' || pg_catalog.substr(
      pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12
    ),
    'Smoke bot',
    'Rollback-only schema smoke',
    pg_catalog.substr(
      pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12
    ),
    pg_catalog.repeat('a', 64)
  ) created;

  perform public.bot_webhook_set_internal(
    v_bot_id,
    'https://bot-smoke.invalid/webhook',
    pg_catalog.repeat('b', 64)
  );
  delete from private.bot_delivery_leases lease
  where lease.bot_id = v_bot_id;
  select public.bot_webhook_delete_internal(v_bot_id)
  into v_webhook_disabled;
  if v_webhook_disabled is not true then
    raise exception 'bot_webhook_disable_depended_on_lease';
  end if;

  insert into public.chats(id, type, name, created_by)
  values (v_chat_id, 'group', 'Bot platform rollback smoke', v_actor_id);
  insert into public.chat_members(chat_id, user_id, role)
  values (v_chat_id, v_recipient_id, 'owner');

  insert into public.messages(
    chat_id,
    user_id,
    content,
    type,
    created_at
  ) values (
    v_chat_id,
    v_recipient_id,
    'pre-join smoke message',
    'text',
    pg_catalog.now() - interval '1 minute'
  ) returning id into v_history_message_id;

  insert into public.chat_bot_members(chat_id, bot_id, joined_at)
  values (v_chat_id, v_bot_id, pg_catalog.now());

  v_rejected := false;
  begin
    perform public.bot_update_enqueue_internal(
      v_bot_id,
      'message',
      jsonb_build_object(
        'chat_id', v_chat_id,
        'message_id', v_history_message_id
      )
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'bot_update_history_forbidden' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'bot_pre_join_history_was_enqueued';
  end if;

  v_rejected := false;
  begin
    insert into public.messages(chat_id, user_id, bot_id, content, type)
    values (v_chat_id, null, null, 'invalid sender', 'text');
  exception
    when check_violation then
      if sqlerrm = 'message_sender_required' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'message_sender_required_guard_failed';
  end if;

  select public.bot_send_message_internal(
    v_bot_id,
    v_chat_id,
    'sendMessage',
    jsonb_build_object('text', 'Bot smoke message'),
    'smoke-idempotency-key'
  ) into v_first_send;
  select public.bot_send_message_internal(
    v_bot_id,
    v_chat_id,
    'sendMessage',
    jsonb_build_object('text', 'Bot smoke message'),
    'smoke-idempotency-key'
  ) into v_duplicate_send;

  v_message_id := (v_first_send->>'message_id')::uuid;
  if v_message_id is distinct from (v_duplicate_send->>'message_id')::uuid
     or coalesce((v_duplicate_send->>'duplicate')::boolean, false) is not true then
    raise exception 'bot_idempotency_failed';
  end if;

  select pg_catalog.count(*)
  into v_bot_message_count
  from public.messages message_row
  where message_row.chat_id = v_chat_id
    and message_row.bot_id = v_bot_id
    and message_row.user_id is null
    and message_row.id = v_message_id;
  if v_bot_message_count <> 1 then
    raise exception 'bot_sender_shape_invalid';
  end if;
  if exists (
    select 1
    from public.messages message_row
    where message_row.id = v_message_id
      and message_row.client_message_id is not null
  ) then
    raise exception 'bot_overloaded_human_client_message_id';
  end if;

  select pg_catalog.count(*)
  into v_notification_count
  from public.notifications notification_row
  where notification_row.user_id = v_recipient_id
    and notification_row.kind = 'message'
    and notification_row.payload->>'message_id' = v_message_id::text
    and notification_row.payload->>'sender_kind' = 'bot'
    and notification_row.payload->>'bot_id' = v_bot_id::text;
  if v_notification_count <> 1 then
    raise exception 'bot_notification_fanout_invalid: %', v_notification_count;
  end if;

  insert into public.messages(chat_id, user_id, bot_id, content, type)
  values (v_chat_id, null, null, 'system smoke', 'system')
  returning id into v_system_message_id;
  if exists (
    select 1
    from public.notifications notification_row
    where notification_row.payload->>'message_id' = v_system_message_id::text
  ) then
    raise exception 'system_message_notification_created';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.messages'::regclass
      and constraint_row.conname = 'messages_bot_id_fkey'
      and constraint_row.confdeltype = 'r'
  ) then
    raise exception 'bot_history_delete_not_restricted';
  end if;

  v_rejected := false;
  begin
    delete from public.bots bot where bot.id = v_bot_id;
  exception
    when foreign_key_violation then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_history_delete_not_restricted';
  end if;
end
$smoke$;

select 'bot_platform_db_smoke_ok' as result;

rollback;
