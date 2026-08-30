\set ON_ERROR_STOP on

begin;

create temporary table bot_sender_rewrite_probe(
  message_id uuid not null
) on commit drop;

create or replace function pg_temp.bot_sender_rewrite_probe()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  update public.messages
  set user_id = null
  where id = new.message_id;
  return new;
end
$function$;

create trigger trg_bot_sender_rewrite_probe
  before insert on bot_sender_rewrite_probe
  for each row execute function pg_temp.bot_sender_rewrite_probe();

do $smoke$
declare
  v_actor_id uuid;
  v_recipient_id uuid;
  v_profile_delete_id uuid := gen_random_uuid();
  v_bulk_profile_one_id uuid := gen_random_uuid();
  v_bulk_profile_two_id uuid := gen_random_uuid();
  v_chat_id uuid := gen_random_uuid();
  v_full_chat_id uuid := gen_random_uuid();
  v_private_chat_id uuid := gen_random_uuid();
  v_other_chat_id uuid := gen_random_uuid();
  v_lifecycle_chat_id uuid := gen_random_uuid();
  v_delete_chat_id uuid := gen_random_uuid();
  v_bot_id uuid;
  v_second_bot_id uuid;
  v_third_bot_id uuid;
  v_message_id uuid;
  v_plain_message_id uuid;
  v_restricted_plain_message_id uuid;
  v_mention_message_id uuid;
  v_command_message_id uuid;
  v_full_message_id uuid;
  v_private_message_id uuid;
  v_other_message_id uuid;
  v_bulk_message_one_id uuid;
  v_bulk_message_two_id uuid;
  v_bulk_control_message_id uuid;
  v_topic_id uuid;
  v_other_topic_id uuid;
  v_media_message_id uuid;
  v_muted_message_id uuid;
  v_history_message_id uuid;
  v_system_message_id uuid;
  v_first_send jsonb;
  v_duplicate_send jsonb;
  v_legacy_tombstone_count integer;
  v_notification_count integer;
  v_bot_message_count integer;
  v_update_count integer;
  v_update_count_before integer;
  v_active_token_count integer;
  v_outbox_count integer;
  v_notification_id uuid;
  v_upload_grant_id uuid;
  v_media_path text;
  v_claim_token uuid := gen_random_uuid();
  v_stale_retry_attempt_id bigint;
  v_stale_dead_attempt_id bigint;
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
      ('public.bot_upload_authorize_internal(uuid,uuid,text,text,text,bigint,integer)'),
      ('public.bot_send_message_internal(uuid,uuid,text,jsonb,text)'),
      ('public.bot_updates_poll_internal(uuid,bigint,integer,uuid)'),
      ('public.bot_updates_ack_internal(uuid,bigint)'),
      ('public.bot_webhook_set_internal(uuid,text,text,text)'),
      ('public.bot_webhook_delete_internal(uuid)'),
      ('public.bot_update_enqueue_internal(uuid,text,uuid,jsonb)'),
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

  insert into auth.users(
    id, aud, role, email, email_confirmed_at, created_at, updated_at
  ) values (
    v_profile_delete_id,
    'authenticated',
    'authenticated',
    'bot-smoke-' || v_profile_delete_id::text || '@invalid',
    pg_catalog.now(),
    pg_catalog.now(),
    pg_catalog.now()
  );
  insert into public.profiles(id, full_name, username)
  values (v_profile_delete_id, 'Tombstone smoke', 'tombstone_' || pg_catalog.substr(v_profile_delete_id::text, 1, 8));
  insert into public.chats(id, type, name, created_by)
  values (v_delete_chat_id, 'group', 'Tombstone smoke', v_profile_delete_id);
  insert into public.messages(id, chat_id, user_id, content, type)
  values (
    gen_random_uuid(),
    v_delete_chat_id,
    v_profile_delete_id,
    'profile delete tombstone probe',
    'text'
  ) returning id into v_other_message_id;

  v_rejected := false;
  begin
    update public.messages
    set user_id = null
    where id = v_other_message_id;
  exception
    when check_violation then
      if sqlerrm = 'message_sender_immutable' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'direct_sender_tombstone_succeeded';
  end if;

  delete from public.profiles where id = v_profile_delete_id;
  if not exists (
    select 1
    from public.messages message_row
    where message_row.id = v_other_message_id
      and message_row.user_id is null
      and message_row.bot_id is null
  ) then
    raise exception 'profile_delete_tombstone_not_preserved';
  end if;

  insert into auth.users(
    id, aud, role, email, email_confirmed_at, created_at, updated_at
  ) values
    (
      v_bulk_profile_one_id,
      'authenticated',
      'authenticated',
      'bot-smoke-' || v_bulk_profile_one_id::text || '@invalid',
      pg_catalog.now(),
      pg_catalog.now(),
      pg_catalog.now()
    ),
    (
      v_bulk_profile_two_id,
      'authenticated',
      'authenticated',
      'bot-smoke-' || v_bulk_profile_two_id::text || '@invalid',
      pg_catalog.now(),
      pg_catalog.now(),
      pg_catalog.now()
    );
  insert into public.profiles(id, full_name, username)
  values
    (
      v_bulk_profile_one_id,
      'Bulk tombstone one',
      'bulk_one_' || pg_catalog.substr(v_bulk_profile_one_id::text, 1, 8)
    ),
    (
      v_bulk_profile_two_id,
      'Bulk tombstone two',
      'bulk_two_' || pg_catalog.substr(v_bulk_profile_two_id::text, 1, 8)
    );
  insert into public.messages(chat_id, user_id, content, type)
  values (v_delete_chat_id, v_bulk_profile_one_id, 'bulk tombstone one', 'text')
  returning id into v_bulk_message_one_id;
  insert into public.messages(chat_id, user_id, content, type)
  values (v_delete_chat_id, v_bulk_profile_two_id, 'bulk tombstone two', 'text')
  returning id into v_bulk_message_two_id;
  insert into public.messages(chat_id, user_id, content, type)
  values (v_delete_chat_id, v_recipient_id, 'exact marker control', 'text')
  returning id into v_bulk_control_message_id;

  delete from public.profiles
  where id in (v_bulk_profile_one_id, v_bulk_profile_two_id);
  if (
    select pg_catalog.count(*)
    from public.messages message_row
    where message_row.id in (v_bulk_message_one_id, v_bulk_message_two_id)
      and message_row.user_id is null
      and message_row.bot_id is null
  ) <> 2 then
    raise exception 'bulk_profile_delete_tombstones_not_preserved';
  end if;

  v_rejected := false;
  begin
    insert into bot_sender_rewrite_probe(message_id)
    values (v_bulk_control_message_id);
  exception
    when check_violation then
      if sqlerrm = 'message_sender_immutable' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'nested_sender_rewrite_succeeded';
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
    'enc:v1:' || pg_catalog.repeat('B', 64),
    pg_catalog.repeat('b', 16)
  );
  delete from private.bot_delivery_leases lease
  where lease.bot_id = v_bot_id;
  select public.bot_webhook_delete_internal(v_bot_id)
  into v_webhook_disabled;
  if v_webhook_disabled is not true then
    raise exception 'bot_webhook_disable_depended_on_lease';
  end if;

  select created.bot_id into v_second_bot_id
  from public.bot_create_internal(
    v_actor_id,
    'smoke_' || pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12),
    'Smoke bot two',
    'Rollback-only owner limit probe',
    pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12),
    pg_catalog.repeat('c', 64)
  ) created;
  select created.bot_id into v_third_bot_id
  from public.bot_create_internal(
    v_actor_id,
    'smoke_' || pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12),
    'Smoke bot three',
    'Rollback-only owner limit probe',
    pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12),
    pg_catalog.repeat('d', 64)
  ) created;

  v_rejected := false;
  begin
    perform public.bot_create_internal(
      v_actor_id,
      'smoke_' || pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12),
      'Smoke bot four',
      'Must be rejected by owner limit',
      pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12),
      pg_catalog.repeat('e', 64)
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'bot_creation_not_allowed' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'bot_owner_limit_not_enforced';
  end if;

  perform public.bot_rotate_token_internal(
    v_actor_id,
    v_bot_id,
    pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12),
    pg_catalog.repeat('f', 64)
  );
  perform public.bot_rotate_token_internal(
    v_actor_id,
    v_bot_id,
    pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12),
    pg_catalog.repeat('1', 64)
  );
  select pg_catalog.count(*) into v_active_token_count
  from private.bot_tokens stored_token
  where stored_token.bot_id = v_bot_id
    and stored_token.revoked_at is null;
  if v_active_token_count <> 1 then
    raise exception 'active_token_count_invalid: %', v_active_token_count;
  end if;

  insert into public.chats(id, type, name, created_by)
  values (v_lifecycle_chat_id, 'group', 'Bot lifecycle smoke', v_actor_id);
  insert into public.chat_members(chat_id, user_id, role)
  values
    (v_lifecycle_chat_id, v_actor_id, 'owner'),
    (v_lifecycle_chat_id, v_recipient_id, 'member');
  insert into public.chat_bot_members(chat_id, bot_id, joined_at)
  values (v_lifecycle_chat_id, v_second_bot_id, pg_catalog.now());

  update public.bots
  set state = 'paused'
  where id = v_second_bot_id;
  select pg_catalog.count(*)
  into v_update_count_before
  from private.bot_updates queued
  where queued.bot_id = v_second_bot_id
    and queued.update_type = 'membership';

  update public.chat_bot_members
  set removed_at = pg_catalog.now()
  where chat_id = v_lifecycle_chat_id
    and bot_id = v_second_bot_id;
  update public.chat_bot_members
  set removed_at = null
  where chat_id = v_lifecycle_chat_id
    and bot_id = v_second_bot_id;
  select pg_catalog.count(*)
  into v_update_count
  from private.bot_updates queued
  where queued.bot_id = v_second_bot_id
    and queued.update_type = 'membership';
  if v_update_count <> v_update_count_before then
    raise exception 'inactive_membership_update_was_queued';
  end if;

  update public.bots
  set state = 'suspended'
  where id = v_second_bot_id;
  update public.chat_bot_members
  set removed_at = pg_catalog.now()
  where chat_id = v_lifecycle_chat_id
    and bot_id = v_second_bot_id;
  update public.chat_bot_members
  set removed_at = null
  where chat_id = v_lifecycle_chat_id
    and bot_id = v_second_bot_id;
  select pg_catalog.count(*)
  into v_update_count
  from private.bot_updates queued
  where queued.bot_id = v_second_bot_id
    and queued.update_type = 'membership';
  if v_update_count <> v_update_count_before then
    raise exception 'suspended_membership_update_was_queued';
  end if;

  update public.bots
  set state = 'active'
  where id = v_second_bot_id;
  update public.chat_bot_members
  set removed_at = pg_catalog.now()
  where chat_id = v_lifecycle_chat_id
    and bot_id = v_second_bot_id;
  if not exists (
    select 1
    from private.bot_updates queued
    where queued.bot_id = v_second_bot_id
      and queued.update_type = 'membership'
      and queued.payload->'membership'->>'chat_id' = v_lifecycle_chat_id::text
      and queued.payload->'membership'->>'action' = 'removed'
  ) then
    raise exception 'active_membership_removal_not_projected';
  end if;
  select pg_catalog.count(*)
  into v_update_count_before
  from private.bot_updates queued
  where queued.bot_id = v_second_bot_id
    and queued.update_type = 'membership'
    and queued.payload->'membership'->>'chat_id' = v_lifecycle_chat_id::text
    and queued.payload->'membership'->>'action' = 'added';
  update public.chat_bot_members
  set removed_at = null
  where chat_id = v_lifecycle_chat_id
    and bot_id = v_second_bot_id;
  select pg_catalog.count(*)
  into v_update_count
  from private.bot_updates queued
  where queued.bot_id = v_second_bot_id
    and queued.update_type = 'membership'
    and queued.payload->'membership'->>'chat_id' = v_lifecycle_chat_id::text
    and queued.payload->'membership'->>'action' = 'added';
  if v_update_count <> v_update_count_before + 1 then
    raise exception 'active_membership_readd_not_projected';
  end if;

  insert into public.chats(id, type, name, created_by)
  values (v_chat_id, 'group', 'Bot platform rollback smoke', v_actor_id);
  insert into public.chat_members(chat_id, user_id, role)
  values
    (v_chat_id, v_actor_id, 'owner'),
    (v_chat_id, v_recipient_id, 'member');

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
  if not exists (
    select 1
    from private.bot_updates queued
    where queued.bot_id = v_bot_id
      and queued.update_type = 'membership'
      and queued.payload->'membership'->>'chat_id' = v_chat_id::text
      and queued.payload->'membership'->>'action' = 'added'
  ) then
    raise exception 'restricted_membership_not_projected';
  end if;

  v_rejected := false;
  begin
    perform public.bot_update_enqueue_internal(
      v_bot_id,
      'message',
      v_history_message_id,
      '{}'::jsonb
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

  perform pg_catalog.set_config('request.jwt.claim.sub', v_recipient_id::text, true);
  execute 'set local role authenticated';
  v_rejected := false;
  begin
    insert into public.messages(chat_id, user_id, bot_id, content, type)
    values (v_chat_id, null, v_bot_id, 'forged bot message', 'text');
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  execute 'reset role';
  if not v_rejected then
    raise exception 'authenticated_bot_forgery_succeeded';
  end if;

  insert into public.messages(chat_id, user_id, content, type)
  values (v_chat_id, v_recipient_id, 'ordinary restricted message', 'text')
  returning id into v_restricted_plain_message_id;
  select pg_catalog.count(*) into v_update_count
  from private.bot_updates queued
  where queued.bot_id = v_bot_id
    and queued.update_type = 'message'
    and queued.payload->'message'->>'id' = v_restricted_plain_message_id::text;
  if v_update_count <> 0 then
    raise exception 'restricted_plain_message_was_projected';
  end if;

  insert into public.messages(chat_id, user_id, content, type)
  select
    v_chat_id,
    v_recipient_id,
    'hello @' || bot.username,
    'text'
  from public.bots bot
  where bot.id = v_bot_id
  returning id into v_mention_message_id;
  select pg_catalog.count(*) into v_update_count
  from private.bot_updates queued
  where queued.bot_id = v_bot_id
    and queued.update_type = 'message'
    and queued.payload->'message'->>'id' = v_mention_message_id::text
    and queued.payload->'message'->'from' ? 'display_name'
    and not (queued.payload::text ~* '(email|phone|support|security)');
  if v_update_count <> 1 then
    raise exception 'restricted_mention_not_projected';
  end if;

  update public.messages
  set content = content || ' edited'
  where id = v_mention_message_id;
  select pg_catalog.count(*) into v_update_count
  from private.bot_updates queued
  where queued.bot_id = v_bot_id
    and queued.update_type = 'edited_message'
    and queued.payload->'message'->>'id' = v_mention_message_id::text
    and queued.payload->'message'->>'text' like '% edited';
  if v_update_count <> 1 then
    raise exception 'restricted_message_edit_not_projected';
  end if;

  update public.messages
  set content = content
  where id = v_mention_message_id;
  update public.messages
  set client_message_id = gen_random_uuid()
  where id = v_mention_message_id;
  select pg_catalog.count(*) into v_update_count
  from private.bot_updates queued
  where queued.bot_id = v_bot_id
    and queued.update_type = 'edited_message'
    and queued.payload->'message'->>'id' = v_mention_message_id::text;
  if v_update_count <> 1 then
    raise exception 'message_edit_noop_or_internal_update_was_projected';
  end if;

  update public.messages
  set content = content || ' edited'
  where id = v_restricted_plain_message_id;
  if exists (
    select 1
    from private.bot_updates queued
    where queued.bot_id = v_bot_id
      and queued.update_type = 'edited_message'
      and queued.payload->'message'->>'id' = v_restricted_plain_message_id::text
  ) then
    raise exception 'restricted_plain_message_edit_was_projected';
  end if;

  v_rejected := false;
  begin
    update public.messages
    set type = 'system'
    where id = v_mention_message_id;
  exception
    when check_violation then
      if sqlerrm = 'message_sender_immutable' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'edited_message_sender_system_transition_succeeded';
  end if;

  insert into public.messages(chat_id, user_id, content, type)
  select
    v_chat_id,
    v_recipient_id,
    '/start@' || bot.username,
    'text'
  from public.bots bot
  where bot.id = v_bot_id
  returning id into v_command_message_id;
  if not exists (
    select 1 from private.bot_updates queued
    where queued.bot_id = v_bot_id
      and queued.update_type = 'message'
      and queued.payload->'message'->>'id' = v_command_message_id::text
  ) then
    raise exception 'restricted_command_not_projected';
  end if;

  v_rejected := false;
  begin
    perform public.bot_update_enqueue_internal(
      v_bot_id,
      'callback_query',
      v_mention_message_id,
      pg_catalog.jsonb_build_object(
        'callback_id', gen_random_uuid(),
        'actor_id', v_recipient_id,
        'data', 'confirm',
        'email', 'forbidden@example.invalid'
      )
    );
  exception
    when invalid_parameter_value then
      if sqlerrm = 'bot_update_context_invalid' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'bot_update_arbitrary_payload_accepted';
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

  perform public.bot_update_enqueue_internal(
    v_bot_id,
    'callback_query',
    v_message_id,
    pg_catalog.jsonb_build_object(
      'callback_id', gen_random_uuid(),
      'actor_id', v_recipient_id,
      'data', 'confirm'
    )
  );
  if not exists (
    select 1
    from private.bot_updates queued
    where queued.bot_id = v_bot_id
      and queued.update_type = 'callback_query'
      and queued.payload->'callback_query'->'message'->>'id' = v_message_id::text
      and queued.payload->'callback_query'->'from'->>'id' = v_recipient_id::text
      and not (queued.payload::text ~* '(email|phone|support|security)')
  ) then
    raise exception 'restricted_callback_not_projected';
  end if;

  insert into public.messages(chat_id, user_id, content, type, reply_to_id)
  values (v_chat_id, v_recipient_id, 'reply to bot', 'text', v_message_id)
  returning id into v_plain_message_id;
  if not exists (
    select 1
    from private.bot_updates queued
    where queued.bot_id = v_bot_id
      and queued.update_type = 'message'
      and queued.payload->'message'->>'id' = v_plain_message_id::text
  ) then
    raise exception 'restricted_reply_not_projected';
  end if;

  insert into public.chats(id, type, name, created_by)
  values
    (v_full_chat_id, 'group', 'Full bot smoke', v_actor_id),
    (v_private_chat_id, 'private', 'Private bot smoke', v_actor_id),
    (v_other_chat_id, 'group', 'Other bot smoke', v_actor_id);
  insert into public.chat_members(chat_id, user_id, role)
  values
    (v_full_chat_id, v_actor_id, 'owner'),
    (v_full_chat_id, v_recipient_id, 'member'),
    (v_private_chat_id, v_actor_id, 'owner'),
    (v_private_chat_id, v_recipient_id, 'member'),
    (v_other_chat_id, v_actor_id, 'owner'),
    (v_other_chat_id, v_recipient_id, 'member');
  insert into public.chat_bot_members(
    chat_id,
    bot_id,
    privacy_mode,
    full_visibility_requested_at,
    full_visibility_approved_by,
    joined_at
  ) values (
    v_full_chat_id,
    v_bot_id,
    'full',
    pg_catalog.now(),
    v_actor_id,
    pg_catalog.now()
  );
  insert into public.chat_bot_members(chat_id, bot_id, privacy_mode, joined_at)
  values (v_private_chat_id, v_bot_id, 'restricted', pg_catalog.now());
  insert into public.chat_bot_members(
    chat_id,
    bot_id,
    privacy_mode,
    full_visibility_requested_at,
    full_visibility_approved_by,
    joined_at
  ) values (
    v_other_chat_id,
    v_bot_id,
    'full',
    pg_catalog.now(),
    v_actor_id,
    pg_catalog.now()
  );

  insert into public.messages(chat_id, user_id, content, type)
  values (v_full_chat_id, v_recipient_id, 'ordinary full message', 'text')
  returning id into v_full_message_id;
  if not exists (
    select 1 from private.bot_updates queued
    where queued.bot_id = v_bot_id
      and queued.payload->'message'->>'id' = v_full_message_id::text
  ) then
    raise exception 'full_message_not_projected';
  end if;
  update public.messages
  set content = content || ' edited'
  where id = v_full_message_id;
  if not exists (
    select 1
    from private.bot_updates queued
    where queued.bot_id = v_bot_id
      and queued.update_type = 'edited_message'
      and queued.payload->'message'->>'id' = v_full_message_id::text
      and queued.payload->'message'->>'text' = 'ordinary full message edited'
  ) then
    raise exception 'full_message_edit_not_projected';
  end if;

  insert into public.messages(chat_id, user_id, content, type)
  values (v_private_chat_id, v_recipient_id, 'ordinary private message', 'text')
  returning id into v_private_message_id;
  if not exists (
    select 1 from private.bot_updates queued
    where queued.bot_id = v_bot_id
      and queued.payload->'message'->>'id' = v_private_message_id::text
  ) then
    raise exception 'private_message_not_projected';
  end if;

  insert into public.messages(chat_id, user_id, content, type)
  values (v_other_chat_id, v_recipient_id, 'cross-chat reply source', 'text')
  returning id into v_other_message_id;
  insert into public.topics(chat_id, name, created_by)
  values (v_chat_id, 'Bot smoke topic', v_actor_id)
  returning id into v_topic_id;
  insert into public.topics(chat_id, name, created_by)
  values (v_other_chat_id, 'Other topic', v_actor_id)
  returning id into v_other_topic_id;

  v_rejected := false;
  begin
    perform public.bot_send_message_internal(
      v_bot_id,
      v_chat_id,
      'sendMessage',
      pg_catalog.jsonb_build_object('text', 'bad reply', 'reply_to_id', v_other_message_id),
      'cross-chat-reply-key'
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'bot_reply_forbidden' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'cross_chat_reply_succeeded';
  end if;

  v_rejected := false;
  begin
    perform public.bot_send_message_internal(
      v_bot_id,
      v_chat_id,
      'sendMessage',
      pg_catalog.jsonb_build_object('text', 'bad topic', 'topic_id', v_other_topic_id),
      'cross-chat-topic-key'
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'bot_topic_forbidden' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'cross_chat_topic_succeeded';
  end if;

  v_rejected := false;
  begin
    perform public.bot_send_message_internal(
      v_bot_id,
      v_chat_id,
      'sendMessage',
      pg_catalog.jsonb_build_object('text', 'pre-join reply', 'reply_to_id', v_history_message_id),
      'pre-join-reply-key'
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'bot_reply_forbidden' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'pre_join_reply_succeeded';
  end if;

  v_media_path := v_chat_id::text || '/bots/' || v_bot_id::text || '/' || gen_random_uuid()::text || '.jpg';
  insert into storage.objects(bucket_id, name)
  values ('chat-media', v_media_path);

  insert into private.bot_upload_grants(
    bot_id,
    chat_id,
    bucket_id,
    object_path,
    content_type,
    byte_size,
    created_at,
    expires_at
  ) values (
    v_bot_id,
    v_chat_id,
    'chat-media',
    v_media_path,
    'image/jpeg',
    1024,
    pg_catalog.now() - interval '10 minutes',
    pg_catalog.now() - interval '1 minute'
  );

  v_rejected := false;
  begin
    perform public.bot_send_message_internal(
      v_bot_id,
      v_chat_id,
      'sendPhoto',
      pg_catalog.jsonb_build_object(
        'text', 'photo without grant',
        'media_bucket', 'chat-media',
        'media_path', v_media_path,
        'media_metadata', pg_catalog.jsonb_build_object('mime_type', 'image/jpeg')
      ),
      'media-without-grant-key'
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'bot_media_grant_required' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'bot_media_without_grant_succeeded';
  end if;

  select authorized.grant_id into v_upload_grant_id
  from public.bot_upload_authorize_internal(
    v_bot_id,
    v_chat_id,
    'chat-media',
    v_media_path,
    'image/jpeg',
    1024,
    300
  ) authorized;
  if exists (
    select 1
    from private.bot_upload_grants upload_grant
    where upload_grant.bot_id = v_bot_id
      and upload_grant.chat_id = v_chat_id
      and upload_grant.object_path = v_media_path
      and upload_grant.id <> v_upload_grant_id
  ) then
    raise exception 'expired_upload_grant_not_replaced';
  end if;
  select (public.bot_send_message_internal(
    v_bot_id,
    v_chat_id,
    'sendPhoto',
    pg_catalog.jsonb_build_object(
      'text', 'authorized photo',
      'media_bucket', 'chat-media',
      'media_path', v_media_path,
      'media_metadata', pg_catalog.jsonb_build_object('mime_type', 'image/jpeg')
    ),
    'authorized-media-key'
  )->>'message_id')::uuid into v_media_message_id;
  if not exists (
    select 1 from private.bot_upload_grants upload_grant
    where upload_grant.id = v_upload_grant_id
      and upload_grant.consumed_message_id = v_media_message_id
      and upload_grant.consumed_at is not null
  ) then
    raise exception 'bot_media_grant_not_consumed';
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

  insert into public.push_subscriptions(
    user_id,
    endpoint,
    p256dh,
    auth,
    platform,
    is_active
  ) values (
    v_recipient_id,
    'https://push-smoke.invalid/' || gen_random_uuid()::text,
    'bot-smoke-p256dh',
    'bot-smoke-auth',
    'bot-smoke',
    true
  );
  insert into public.notification_preferences(
    user_id,
    push_enabled,
    message_push_enabled
  ) values (
    v_recipient_id,
    true,
    true
  )
  on conflict (user_id) do update
  set push_enabled = true,
      message_push_enabled = true;
  insert into public.chat_notification_preferences(
    chat_id,
    user_id,
    push_enabled,
    muted_until
  ) values (
    v_chat_id,
    v_recipient_id,
    true,
    pg_catalog.now() + interval '1 hour'
  )
  on conflict (chat_id, user_id) do update
  set push_enabled = true,
      muted_until = excluded.muted_until;

  select (public.bot_send_message_internal(
    v_bot_id,
    v_chat_id,
    'sendMessage',
    pg_catalog.jsonb_build_object('text', 'muted push probe'),
    'muted-push-probe-key'
  )->>'message_id')::uuid into v_muted_message_id;
  select notification_row.id into v_notification_id
  from public.notifications notification_row
  where notification_row.user_id = v_recipient_id
    and notification_row.kind = 'message'
    and notification_row.payload->>'message_id' = v_muted_message_id::text;
  if v_notification_id is null then
    raise exception 'muted_bot_in_app_notification_missing';
  end if;
  select pg_catalog.count(*) into v_outbox_count
  from public.notifications_push_outbox outbox_row
  where outbox_row.notification_id = v_notification_id;
  if v_outbox_count <> 0 then
    raise exception 'muted_bot_notification_enqueued_push';
  end if;

  perform public.bot_webhook_set_internal(
    v_bot_id,
    'https://bot-smoke.invalid/webhook',
    'enc:v1:' || pg_catalog.repeat('C', 64),
    pg_catalog.repeat('c', 16)
  );
  select attempt.id into v_stale_retry_attempt_id
  from private.bot_delivery_attempts attempt
  where attempt.bot_id = v_bot_id
  order by attempt.id
  limit 1;
  select attempt.id into v_stale_dead_attempt_id
  from private.bot_delivery_attempts attempt
  where attempt.bot_id = v_bot_id
    and attempt.id <> v_stale_retry_attempt_id
  order by attempt.id
  limit 1;
  if v_stale_retry_attempt_id is null or v_stale_dead_attempt_id is null then
    raise exception 'stale_claim_probe_requires_two_attempts';
  end if;
  update private.bot_delivery_attempts attempt
  set status = 'claimed',
      attempt_count = case
        when attempt.id = v_stale_retry_attempt_id then 11
        else 12
      end,
      claim_token = gen_random_uuid(),
      claimed_at = pg_catalog.now() - interval '3 minutes',
      available_at = pg_catalog.now() - interval '3 minutes'
  where attempt.id in (v_stale_retry_attempt_id, v_stale_dead_attempt_id);

  perform *
  from public.bot_delivery_claim_internal(100, v_claim_token);
  if not exists (
    select 1 from private.bot_delivery_attempts attempt
    where attempt.id = v_stale_retry_attempt_id
      and attempt.status = 'claimed'
      and attempt.attempt_count = 12
      and attempt.claim_token = v_claim_token
  ) or not exists (
    select 1 from private.bot_delivery_attempts attempt
    where attempt.id = v_stale_dead_attempt_id
      and attempt.status = 'dead_letter'
      and attempt.completed_at is not null
      and attempt.claim_token is null
  ) then
    raise exception 'stale_claim_not_recovered';
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
