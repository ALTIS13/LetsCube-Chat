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
  v_admin_id uuid := gen_random_uuid();
  v_recipient_username text;
  v_profile_delete_id uuid := gen_random_uuid();
  v_bulk_profile_one_id uuid := gen_random_uuid();
  v_bulk_profile_two_id uuid := gen_random_uuid();
  v_chat_id uuid := gen_random_uuid();
  v_full_chat_id uuid := gen_random_uuid();
  v_private_chat_id uuid := gen_random_uuid();
  v_other_chat_id uuid := gen_random_uuid();
  v_lifecycle_chat_id uuid := gen_random_uuid();
  v_delete_chat_id uuid := gen_random_uuid();
  v_task6_chat_id uuid := gen_random_uuid();
  v_bot_id uuid;
  v_second_bot_id uuid;
  v_third_bot_id uuid;
  v_message_id uuid;
  v_plain_message_id uuid;
  v_human_message_id uuid;
  v_restricted_plain_message_id uuid;
  v_mention_message_id uuid;
  v_command_message_id uuid;
  v_full_message_id uuid;
  v_oversized_message_id uuid;
  v_private_message_id uuid;
  v_other_message_id uuid;
  v_bulk_message_one_id uuid;
  v_bulk_message_two_id uuid;
  v_bulk_control_message_id uuid;
  v_topic_id uuid;
  v_other_topic_id uuid;
  v_media_message_id uuid;
  v_new_media_message_id uuid;
  v_markup_message_id uuid;
  v_delete_message_id uuid;
  v_muted_message_id uuid;
  v_history_message_id uuid;
  v_system_message_id uuid;
  v_task6_bot_message_id uuid;
  v_task6_unsafe_bot_message_id uuid;
  v_task6_human_message_id uuid;
  v_first_send jsonb;
  v_duplicate_send jsonb;
  v_first_operation jsonb;
  v_duplicate_operation jsonb;
  v_command_list jsonb;
  v_max_commands jsonb;
  v_callback_id uuid := gen_random_uuid();
  v_callback_source_update_id bigint;
  v_safe_payload jsonb;
  v_legacy_tombstone_count integer;
  v_notification_count integer;
  v_bot_message_count integer;
  v_update_count integer;
  v_update_count_before integer;
  v_active_token_count integer;
  v_outbox_count integer;
  v_notification_id uuid;
  v_upload_grant_id uuid;
  v_second_upload_grant_id uuid;
  v_new_upload_grant_id uuid;
  v_media_path text;
  v_new_media_path text;
  v_history_media_path text;
  v_claim_token uuid := gen_random_uuid();
  v_second_claim_token uuid := gen_random_uuid();
  v_poll_token uuid := gen_random_uuid();
  v_other_poll_token uuid := gen_random_uuid();
  v_stale_retry_attempt_id bigint;
  v_stale_dead_attempt_id bigint;
  v_ordered_update_one bigint;
  v_ordered_update_two bigint;
  v_ordered_update_three bigint;
  v_polled_update_id bigint;
  v_claimed_attempt_id bigint;
  v_claimed_epoch bigint;
  v_claimed_rows integer;
  v_prepared jsonb;
  v_webhook_info jsonb;
  v_admin_projection jsonb;
  v_eligibility record;
  v_current_token_prefix text;
  v_function regprocedure;
  v_rejected boolean;
  v_webhook_disabled boolean;
  v_bot_username text;
  v_task6_summary record;
  v_task6_push jsonb;
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
     or pg_catalog.has_table_privilege('service_role', 'private.bot_tokens', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'private.bot_audit_events', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'private.bot_audit_events', 'SELECT')
     or pg_catalog.has_table_privilege('service_role', 'private.bot_audit_events', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'private.bot_operation_idempotency', 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', 'private.bot_callback_answers', 'SELECT')
     or pg_catalog.has_table_privilege('service_role', 'private.bot_callback_answers', 'SELECT') then
    raise exception 'anon_can_access_private_bot_table';
  end if;

  for v_function in
    select function_signature::regprocedure
    from (values
      ('public.bot_create_internal(uuid,text,text,text,text,text,text)'),
      ('public.bot_list_owned_internal(uuid)'),
      ('public.bot_creation_eligibility_internal(uuid)'),
      ('public.bot_management_detail_internal(uuid,uuid)'),
      ('public.bot_management_diagnostics_internal(uuid,uuid)'),
      ('public.bot_update_profile_internal(uuid,uuid,text,text,text)'),
      ('public.bot_management_commands_replace_internal(uuid,uuid,jsonb,text)'),
      ('public.bot_pause_internal(uuid,uuid,text)'),
      ('public.bot_resume_internal(uuid,uuid,text)'),
      ('public.bot_developer_add_internal(uuid,uuid,text,text)'),
      ('public.bot_developer_remove_internal(uuid,uuid,uuid,text)'),
      ('public.bot_rotate_token_internal(uuid,uuid,text,text,text,text)'),
      ('public.bot_revoke_token_internal(uuid,uuid,text)'),
      ('public.bot_request_deletion_internal(uuid,uuid,text)'),
      ('public.bot_cancel_deletion_internal(uuid,uuid,text)'),
      ('public.bot_deletion_finalize_internal(integer,text)'),
      ('public.bot_privacy_request_internal(uuid,uuid,uuid,boolean,text)'),
      ('public.bot_management_webhook_set_internal(uuid,uuid,text,text,text,boolean,text)'),
      ('public.bot_management_webhook_delete_internal(uuid,uuid,boolean,text)'),
      ('public.bot_admin_list_internal(uuid)'),
      ('public.bot_suspend_internal(uuid,uuid,boolean,text)'),
      ('public.bot_token_lookup_internal(text)'),
      ('public.bot_token_touch_internal(uuid,timestamptz)'),
      ('public.bot_membership_authorize_internal(uuid,uuid,text)'),
      ('public.bot_upload_authorize_internal(uuid,uuid,text,text,text,bigint,integer)'),
      ('public.bot_send_message_internal(uuid,uuid,text,jsonb,text)'),
      ('public.bot_media_command_preflight_internal(uuid,uuid,text,text,text)'),
      ('public.bot_get_me_internal(uuid)'),
      ('public.bot_message_command_internal(uuid,uuid,text,jsonb,text,text)'),
      ('public.bot_commands_replace_internal(uuid,jsonb,text,text)'),
      ('public.bot_commands_list_internal(uuid)'),
      ('public.bot_file_lookup_internal(uuid,uuid,uuid)'),
      ('public.bot_callback_answer_internal(uuid,uuid,text,boolean,text,text)'),
      ('public.bot_updates_poll_internal(uuid,bigint,integer,text[],uuid)'),
      ('public.bot_updates_poll_release_internal(uuid,uuid)'),
      ('public.bot_updates_ack_internal(uuid,bigint)'),
      ('public.bot_webhook_set_internal(uuid,text,text,text,boolean,text,text)'),
      ('public.bot_webhook_delete_internal(uuid,boolean,text,text)'),
      ('public.bot_webhook_info_internal(uuid)'),
      ('public.bot_update_enqueue_internal(uuid,text,uuid,jsonb)'),
      ('public.bot_delivery_claim_internal(integer,uuid)'),
      ('public.bot_delivery_prepare_internal(bigint,uuid,bigint)'),
      ('public.bot_delivery_finish_internal(bigint,uuid,text,text,integer)'),
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
  select profile.username into v_recipient_username
  from public.profiles profile where profile.id = v_recipient_id;

  insert into auth.users(
    id, aud, role, email, email_confirmed_at, created_at, updated_at
  ) values (
    v_admin_id,
    'authenticated',
    'authenticated',
    'bot-admin-smoke-' || v_admin_id::text || '@invalid',
    pg_catalog.now(),
    pg_catalog.now() - interval '48 hours',
    pg_catalog.now()
  );
  insert into public.profiles(id, full_name, username)
  values (
    v_admin_id,
    'Bot admin smoke',
    'bot_admin_' || pg_catalog.substr(v_admin_id::text, 1, 8)
  );
  insert into public.user_global_roles(user_id, role_id, assigned_by)
  select v_admin_id, role_row.id, null
  from public.roles role_row
  where role_row.key = 'tech_admin';
  if not public.has_permission(v_admin_id, 'bots.suspend')
     or (
       select pg_catalog.count(*)
       from public.role_permissions role_permission
       join public.roles role_row on role_row.id = role_permission.role_id
       where role_permission.permission_key = 'bots.suspend'
         and role_row.key in ('owner','tech_admin')
         and role_row.is_system is true
     ) <> 2
     or exists (
       select 1
       from public.role_permissions role_permission
       join public.roles role_row on role_row.id = role_permission.role_id
       where role_permission.permission_key = 'bots.suspend'
         and role_row.key not in ('owner','tech_admin')
     ) then
    raise exception 'bot_suspend_permission_seed_invalid';
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
    pg_catalog.repeat('b', 16),
    false,
    'webhook-smoke-set-early',
    pg_catalog.repeat('b', 64)
  );
  delete from private.bot_delivery_leases lease
  where lease.bot_id = v_bot_id;
  select (public.bot_webhook_delete_internal(
    v_bot_id,
    false,
    'webhook-smoke-delete-early',
    pg_catalog.repeat('d', 64)
  )->>'result')::boolean
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

  select * into v_eligibility
  from public.bot_creation_eligibility_internal(v_actor_id);
  if v_eligibility.email_verified is not true
     or v_eligibility.phone_verified is not true
     or v_eligibility.account_age_met is not true
     or v_eligibility.not_banned is not true
     or v_eligibility.under_limit is not false
     or v_eligibility.active_bot_count <> 3
     or v_eligibility.max_bots <> 3
     or v_eligibility.can_create is not false then
    raise exception 'bot_management_eligibility_invalid';
  end if;

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

  select stored_token.token_prefix into v_current_token_prefix
  from private.bot_tokens stored_token
  where stored_token.bot_id = v_bot_id and stored_token.revoked_at is null;
  perform public.bot_rotate_token_internal(
    v_actor_id,
    v_bot_id,
    pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12),
    pg_catalog.repeat('f', 64),
    v_current_token_prefix,
    'smoke-rotate-one'
  );
  v_rejected := false;
  begin
    perform public.bot_rotate_token_internal(
      v_actor_id,
      v_bot_id,
      pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12),
      pg_catalog.repeat('1', 64),
      v_current_token_prefix,
      'smoke-rotate-stale'
    );
  exception
    when sqlstate '55000' then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_stale_rotation_succeeded';
  end if;
  select stored_token.token_prefix into v_current_token_prefix
  from private.bot_tokens stored_token
  where stored_token.bot_id = v_bot_id and stored_token.revoked_at is null;
  perform public.bot_rotate_token_internal(
    v_actor_id,
    v_bot_id,
    pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12),
    pg_catalog.repeat('2', 64),
    v_current_token_prefix,
    'smoke-rotate-two'
  );
  select pg_catalog.count(*) into v_active_token_count
  from private.bot_tokens stored_token
  where stored_token.bot_id = v_bot_id
    and stored_token.revoked_at is null;
  if v_active_token_count <> 1 then
    raise exception 'active_token_count_invalid: %', v_active_token_count;
  end if;

  perform public.bot_developer_add_internal(
    v_actor_id, v_bot_id, v_recipient_username, 'smoke-developer-add'
  );
  perform public.bot_management_commands_replace_internal(
    v_recipient_id,
    v_bot_id,
    '[{"command":"help","description":"Help"}]'::jsonb,
    'smoke-developer-command'
  );
  if not exists (
    select 1 from public.bot_commands command_row
    where command_row.bot_id = v_bot_id and command_row.command = 'help'
  ) then
    raise exception 'bot_developer_command_update_failed';
  end if;
  v_rejected := false;
  begin
    perform public.bot_update_profile_internal(
      v_recipient_id, v_bot_id, 'Forbidden developer edit', '', 'smoke-developer-profile'
    );
  exception
    when insufficient_privilege then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_developer_owner_action_succeeded';
  end if;

  select pg_catalog.to_jsonb(admin_bot) into v_admin_projection
  from public.bot_admin_list_internal(v_admin_id) admin_bot
  where admin_bot.bot_id = v_bot_id;
  if v_admin_projection is null
     or v_admin_projection ? 'token_prefix'
     or v_admin_projection ? 'token_hash'
     or v_admin_projection ? 'webhook_url'
     or v_admin_projection ? 'secret_ciphertext'
     or v_admin_projection ? 'payload' then
    raise exception 'bot_admin_projection_exposed_private_data';
  end if;
  perform public.bot_suspend_internal(v_admin_id, v_bot_id, true, 'smoke-suspend');
  v_rejected := false;
  begin
    perform public.bot_resume_internal(v_actor_id, v_bot_id, 'smoke-owner-resume-suspended');
  exception
    when sqlstate '55000' then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_owner_resumed_suspended_bot';
  end if;
  perform public.bot_suspend_internal(v_admin_id, v_bot_id, false, 'smoke-unsuspend');
  perform public.bot_resume_internal(v_actor_id, v_bot_id, 'smoke-resume-after-admin');

  perform public.bot_request_deletion_internal(v_actor_id, v_bot_id, 'smoke-delete-request');
  v_rejected := false;
  begin
    perform public.bot_rotate_token_internal(
      v_actor_id,
      v_bot_id,
      pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12),
      pg_catalog.repeat('3', 64),
      null,
      'smoke-pending-delete-rotate'
    );
  exception
    when sqlstate '55000' then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_pending_delete_rotation_succeeded';
  end if;
  perform public.bot_cancel_deletion_internal(v_actor_id, v_bot_id, 'smoke-delete-cancel');
  if not exists (
       select 1 from public.bots bot
       where bot.id = v_bot_id and bot.state = 'paused' and bot.delete_after is null
     ) or exists (
       select 1 from private.bot_tokens stored_token
       where stored_token.bot_id = v_bot_id and stored_token.revoked_at is null
     ) then
    raise exception 'bot_cancel_delete_token_or_state_invalid';
  end if;
  perform public.bot_rotate_token_internal(
    v_actor_id,
    v_bot_id,
    pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12),
    pg_catalog.repeat('4', 64),
    null,
    'smoke-delete-recovery-token'
  );
  perform public.bot_resume_internal(v_actor_id, v_bot_id, 'smoke-delete-recovery-resume');

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

  v_history_media_path := v_chat_id::text || '/bots/' || v_bot_id::text || '/' || gen_random_uuid()::text || '.pdf';
  insert into storage.objects(bucket_id, name)
  values ('chat-media', v_history_media_path);
  insert into public.messages(
    chat_id,
    user_id,
    content,
    type,
    media_bucket,
    media_path,
    media_metadata,
    created_at
  ) values (
    v_chat_id,
    v_recipient_id,
    'pre-join smoke message',
    'file',
    'chat-media',
    v_history_media_path,
    pg_catalog.jsonb_build_object(
      'mime_type', 'application/pdf',
      'file_name', 'pre-join.pdf',
      'size', 10
    ),
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

  insert into public.chats(id, type, name, created_by)
  values (v_other_chat_id, 'group', 'Other bot smoke', v_actor_id);
  insert into public.chat_members(chat_id, user_id, role)
  values
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
    v_other_chat_id,
    v_bot_id,
    'full',
    pg_catalog.now(),
    v_actor_id,
    pg_catalog.now()
  );

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
  begin
    insert into public.messages(
      chat_id,
      user_id,
      content,
      type,
      bot_reply_markup
    ) values (
      v_chat_id,
      v_recipient_id,
      'authenticated human message',
      'text',
      null
    ) returning id into v_human_message_id;
  exception
    when others then
      execute 'reset role';
      raise exception 'authenticated_human_message_insert_failed: [%] %', sqlstate, sqlerrm;
  end;

  v_rejected := false;
  begin
    insert into public.messages(
      chat_id,
      user_id,
      content,
      type,
      bot_reply_markup
    ) values (
      v_chat_id,
      v_recipient_id,
      'forged human keyboard',
      'text',
      pg_catalog.jsonb_build_object(
        'inline_keyboard', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('text', 'x', 'callback_data', 'x')
          )
        )
      )
    );
  exception
    when check_violation or invalid_parameter_value then
      v_rejected := true;
  end;
  if not v_rejected then
    execute 'reset role';
    raise exception 'authenticated_human_markup_insert_succeeded';
  end if;

  v_rejected := false;
  begin
    update public.messages message_row
    set bot_reply_markup = pg_catalog.jsonb_build_object(
      'inline_keyboard', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('text', 'x', 'callback_data', 'x')
        )
      )
    )
    where message_row.id = v_human_message_id;
  exception
    when check_violation or invalid_parameter_value then
      v_rejected := true;
  end;
  if not v_rejected then
    execute 'reset role';
    raise exception 'authenticated_human_markup_update_succeeded';
  end if;

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
  if not exists (
    select 1 from public.messages message_row
    where message_row.id = v_human_message_id
      and message_row.user_id = v_recipient_id
      and message_row.bot_id is null
      and message_row.bot_reply_markup is null
  ) then
    raise exception 'authenticated_human_message_insert_failed';
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

  select public.bot_message_command_internal(
    v_bot_id,
    v_chat_id,
    'sendMessage',
    pg_catalog.jsonb_build_object(
      'text', 'Keyboard message',
      'reply_markup', pg_catalog.jsonb_build_object(
        'inline_keyboard', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('text', 'Open', 'callback_data', 'open:1')
          )
        )
      )
    ),
    'markup-send-key',
    pg_catalog.repeat('1', 64)
  ) into v_first_operation;
  v_markup_message_id := (v_first_operation->'result'->>'message_id')::uuid;
  select public.bot_message_command_internal(
    v_bot_id,
    v_chat_id,
    'sendMessage',
    pg_catalog.jsonb_build_object(
      'text', 'Keyboard message',
      'reply_markup', pg_catalog.jsonb_build_object(
        'inline_keyboard', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('text', 'Open', 'callback_data', 'open:1')
          )
        )
      )
    ),
    'markup-send-key',
    pg_catalog.repeat('1', 64)
  ) into v_duplicate_operation;
  if v_first_operation->'result' is distinct from v_duplicate_operation->'result'
     or coalesce((v_duplicate_operation->>'duplicate')::boolean, false) is not true then
    raise exception 'bot_send_fingerprint_replay_failed';
  end if;

  v_rejected := false;
  begin
    perform public.bot_message_command_internal(
      v_bot_id,
      v_chat_id,
      'sendMessage',
      pg_catalog.jsonb_build_object('text', 'Changed payload'),
      'markup-send-key',
      pg_catalog.repeat('b', 64)
    );
  exception
    when unique_violation then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_send_fingerprint_conflict_missing';
  end if;

  v_rejected := false;
  begin
    perform public.bot_message_command_internal(
      v_bot_id,
      v_chat_id,
      'sendPhoto',
      pg_catalog.jsonb_build_object(
        'media_bucket', 'chat-media',
        'media_path', v_chat_id::text || '/bots/' || v_bot_id::text || '/method-conflict.jpg',
        'media_metadata', pg_catalog.jsonb_build_object(
          'mime_type', 'image/jpeg',
          'size', 10,
          'kind', 'image'
        )
      ),
      'markup-send-key',
      pg_catalog.repeat('c', 64)
    );
  exception
    when unique_violation then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_send_method_conflict_missing';
  end if;

  select private.bot_message_update_payload(v_bot_id, v_markup_message_id)
  into v_safe_payload;
  if not exists (
    select 1
    from public.messages message_row
    where message_row.id = v_markup_message_id
      and message_row.bot_reply_markup#>>'{inline_keyboard,0,0,callback_data}' = 'open:1'
  ) or v_safe_payload#>>'{message,reply_markup,inline_keyboard,0,0,callback_data}' <> 'open:1' then
    raise exception 'bot_reply_markup_projection_missing';
  end if;

  v_rejected := false;
  begin
    perform public.bot_send_message_internal(
      v_bot_id,
      v_chat_id,
      'sendMessage',
      pg_catalog.jsonb_build_object(
        'text', 'Invalid keyboard',
        'reply_markup', pg_catalog.jsonb_build_object(
          'inline_keyboard', pg_catalog.to_jsonb(array_fill(
            pg_catalog.jsonb_build_array(
              pg_catalog.jsonb_build_object('text', 'x', 'callback_data', 'x')
            ),
            array[9]
          ))
        )
      ),
      'invalid-markup-key'
    );
  exception
    when invalid_parameter_value then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_reply_markup_validation_failed';
  end if;

  v_rejected := false;
  begin
    perform public.bot_message_command_internal(
      v_bot_id,
      v_chat_id,
      'sendPhoto',
      pg_catalog.jsonb_build_object(
        'media_bucket', 'chat-media',
        'media_path', v_chat_id::text || '/bots/' || v_bot_id::text || '/wrong.ogg',
        'media_metadata', pg_catalog.jsonb_build_object(
          'mime_type', 'audio/ogg',
          'size', 10,
          'kind', 'image'
        )
      ),
      'invalid-media-method-key',
      pg_catalog.repeat('a', 64)
    );
  exception
    when invalid_parameter_value then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_media_method_allowlist_failed';
  end if;

  select public.bot_message_command_internal(
    v_bot_id,
    v_chat_id,
    'editMessageText',
    pg_catalog.jsonb_build_object(
      'message_id', v_markup_message_id,
      'text', 'Keyboard edited',
      'reply_markup', pg_catalog.jsonb_build_object(
        'inline_keyboard', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('text', 'Close', 'callback_data', 'close:1')
          )
        )
      )
    ),
    'edit-operation-key',
    pg_catalog.repeat('2', 64)
  ) into v_first_operation;
  select public.bot_message_command_internal(
    v_bot_id,
    v_chat_id,
    'editMessageText',
    pg_catalog.jsonb_build_object(
      'message_id', v_markup_message_id,
      'text', 'Keyboard edited',
      'reply_markup', pg_catalog.jsonb_build_object(
        'inline_keyboard', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('text', 'Close', 'callback_data', 'close:1')
          )
        )
      )
    ),
    'edit-operation-key',
    pg_catalog.repeat('2', 64)
  ) into v_duplicate_operation;
  if v_first_operation->'result' is distinct from v_duplicate_operation->'result'
     or coalesce((v_duplicate_operation->>'duplicate')::boolean, false) is not true
     or not exists (
       select 1
       from public.messages message_row
       where message_row.id = v_markup_message_id
         and message_row.content = 'Keyboard edited'
         and message_row.bot_reply_markup#>>'{inline_keyboard,0,0,callback_data}' = 'close:1'
         and message_row.edited_at is not null
     ) then
    raise exception 'bot_edit_idempotency_failed';
  end if;

  select public.bot_message_command_internal(
    v_bot_id,
    v_chat_id,
    'editMessageText',
    pg_catalog.jsonb_build_object(
      'message_id', v_markup_message_id,
      'text', 'Keyboard cleared'
    ),
    'edit-clear-key',
    pg_catalog.repeat('d', 64)
  ) into v_first_operation;
  if not exists (
    select 1 from public.messages message_row
    where message_row.id = v_markup_message_id
      and message_row.content = 'Keyboard cleared'
      and message_row.bot_reply_markup is null
  ) then
    raise exception 'bot_edit_without_markup_failed';
  end if;

  select public.bot_message_command_internal(
    v_bot_id,
    v_chat_id,
    'editMessageText',
    pg_catalog.jsonb_build_object(
      'message_id', v_markup_message_id,
      'text', 'Keyboard null cleared',
      'reply_markup', 'null'::jsonb
    ),
    'edit-null-clear-key',
    pg_catalog.repeat('e', 64)
  ) into v_first_operation;
  if not exists (
    select 1 from public.messages message_row
    where message_row.id = v_markup_message_id
      and message_row.content = 'Keyboard null cleared'
      and message_row.bot_reply_markup is null
  ) then
    raise exception 'bot_edit_json_null_markup_failed';
  end if;

  v_rejected := false;
  begin
    perform public.bot_message_command_internal(
      v_bot_id,
      v_chat_id,
      'editMessageText',
      pg_catalog.jsonb_build_object('message_id', v_markup_message_id, 'text', 'Changed input'),
      'edit-operation-key',
      pg_catalog.repeat('3', 64)
    );
  exception
    when unique_violation then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_edit_idempotency_conflict_missing';
  end if;

  v_rejected := false;
  begin
    perform public.bot_message_command_internal(
      v_bot_id,
      v_other_chat_id,
      'editMessageText',
      pg_catalog.jsonb_build_object('message_id', v_markup_message_id, 'text', 'Cross chat'),
      'cross-chat-edit-key',
      pg_catalog.repeat('4', 64)
    );
  exception
    when no_data_found or insufficient_privilege then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'cross_chat_edit_succeeded';
  end if;

  select (public.bot_send_message_internal(
    v_bot_id,
    v_chat_id,
    'sendMessage',
    pg_catalog.jsonb_build_object('text', 'Delete target'),
    'delete-target-key'
  )->>'message_id')::uuid into v_delete_message_id;
  v_rejected := false;
  begin
    perform public.bot_message_command_internal(
      v_bot_id,
      v_other_chat_id,
      'deleteMessage',
      pg_catalog.jsonb_build_object('message_id', v_delete_message_id),
      'cross-chat-delete-key',
      pg_catalog.repeat('5', 64)
    );
  exception
    when no_data_found or insufficient_privilege then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'cross_chat_delete_succeeded';
  end if;
  perform public.bot_message_command_internal(
    v_bot_id,
    v_chat_id,
    'deleteMessage',
    pg_catalog.jsonb_build_object('message_id', v_delete_message_id),
    'delete-operation-key',
    pg_catalog.repeat('6', 64)
  );
  if not exists (
    select 1 from public.messages message_row
    where message_row.id = v_delete_message_id
      and message_row.deleted_at is not null
  ) then
    raise exception 'bot_delete_soft_delete_failed';
  end if;

  select public.bot_commands_replace_internal(
    v_bot_id,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('command', 'start', 'description', 'Start'),
      pg_catalog.jsonb_build_object('command', 'help', 'description', 'Help')
    ),
    'commands-operation-key',
    pg_catalog.repeat('7', 64)
  ) into v_first_operation;
  select public.bot_commands_list_internal(v_bot_id) into v_command_list;
  if v_command_list#>>'{0,command}' <> 'start'
     or v_command_list#>>'{1,command}' <> 'help'
     or (select pg_catalog.count(*) from public.bot_commands command_row where command_row.bot_id = v_bot_id) <> 2 then
    raise exception 'bot_command_replace_failed';
  end if;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'command', 'c' || pg_catalog.lpad(command_number::text, 31, '0'),
      'description', pg_catalog.repeat('d', 256)
    ) order by command_number
  )
  into v_max_commands
  from pg_catalog.generate_series(1, 100) command_number;
  select public.bot_commands_replace_internal(
    v_bot_id,
    v_max_commands,
    'commands-maximum-key',
    pg_catalog.repeat('f', 64)
  ) into v_first_operation;
  select public.bot_commands_replace_internal(
    v_bot_id,
    v_max_commands,
    'commands-maximum-key',
    pg_catalog.repeat('f', 64)
  ) into v_duplicate_operation;
  if pg_catalog.jsonb_array_length(v_first_operation->'result'->'commands') <> 100
     or v_first_operation->'result' is distinct from v_duplicate_operation->'result'
     or coalesce((v_duplicate_operation->>'duplicate')::boolean, false) is not true then
    raise exception 'bot_command_maximum_replay_failed';
  end if;

  perform public.bot_update_enqueue_internal(
    v_bot_id,
    'callback_query',
    v_message_id,
    pg_catalog.jsonb_build_object(
      'callback_id', v_callback_id,
      'actor_id', v_recipient_id,
      'data', 'confirm'
    )
  );
  select queued.id
  into v_callback_source_update_id
  from private.bot_updates queued
  where queued.bot_id = v_bot_id
    and queued.update_type = 'callback_query'
    and queued.payload#>>'{callback_query,id}' = v_callback_id::text
  order by queued.id desc
  limit 1;
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

  v_rejected := false;
  begin
    perform public.bot_callback_answer_internal(
      v_second_bot_id,
      v_callback_id,
      'wrong bot',
      false,
      'wrong-callback-key',
      pg_catalog.repeat('8', 64)
    );
  exception
    when no_data_found or insufficient_privilege then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_callback_wrong_owner_succeeded';
  end if;
  select public.bot_callback_answer_internal(
    v_bot_id,
    v_callback_id,
    'Done',
    true,
    'callback-answer-key',
    pg_catalog.repeat('9', 64)
  ) into v_first_operation;
  if not exists (
       select 1 from private.bot_callback_answers answer
       where answer.bot_id = v_bot_id
         and answer.callback_query_id = v_callback_id
         and answer.text = 'Done'
         and answer.show_alert is true
     ) then
    raise exception 'bot_callback_idempotency_failed';
  end if;

  update private.bot_updates queued
  set created_at = pg_catalog.now() - interval '11 minutes',
      expires_at = pg_catalog.now() - interval '1 minute'
  where queued.id = v_callback_source_update_id;
  perform public.bot_delivery_cleanup_internal(pg_catalog.now(), 1000);
  if exists (
    select 1 from private.bot_updates queued
    where queued.id = v_callback_source_update_id
  ) or not exists (
    select 1 from private.bot_callback_answers answer
    where answer.bot_id = v_bot_id
      and answer.callback_query_id = v_callback_id
      and answer.source_update_id is null
  ) then
    raise exception 'bot_callback_answer_cascade_deleted';
  end if;
  select public.bot_callback_answer_internal(
    v_bot_id,
    v_callback_id,
    'Done',
    true,
    'callback-answer-key',
    pg_catalog.repeat('9', 64)
  ) into v_duplicate_operation;
  if v_first_operation->'result' is distinct from v_duplicate_operation->'result'
     or coalesce((v_duplicate_operation->>'duplicate')::boolean, false) is not true then
    raise exception 'bot_callback_retry_after_source_cleanup_failed';
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
    (v_private_chat_id, 'private', 'Private bot smoke', v_actor_id);
  insert into public.chat_members(chat_id, user_id, role)
  values
    (v_full_chat_id, v_actor_id, 'owner'),
    (v_full_chat_id, v_recipient_id, 'member'),
    (v_private_chat_id, v_actor_id, 'owner'),
    (v_private_chat_id, v_recipient_id, 'member');
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

  insert into public.chat_bot_members(
    chat_id,
    bot_id,
    privacy_mode,
    full_visibility_requested_at,
    full_visibility_approved_by,
    joined_at
  ) values (
    v_full_chat_id,
    v_third_bot_id,
    'full',
    pg_catalog.now(),
    v_actor_id,
    pg_catalog.now()
  );
  update private.bot_update_counters counter
  set next_update_id = 9223372036854775807
  where counter.bot_id = v_third_bot_id;

  insert into public.messages(
    chat_id,
    user_id,
    content,
    type,
    media_bucket,
    media_path,
    media_metadata
  ) values (
    v_full_chat_id,
    v_recipient_id,
    pg_catalog.repeat('x', 4096),
    'image',
    'chat-media',
    'human/oversized-metadata.jpg',
    pg_catalog.jsonb_build_object(
      'mime_type', pg_catalog.repeat('m', 20000),
      'file_name', pg_catalog.repeat('f', 20000),
      'size', pg_catalog.repeat('9', 20000),
      'width', pg_catalog.repeat('8', 20000),
      'height', pg_catalog.repeat('7', 20000),
      'duration', pg_catalog.repeat('6', 20000)
    )
  ) returning id into v_oversized_message_id;
  if not exists (
    select 1
    from public.messages message_row
    where message_row.id = v_oversized_message_id
      and pg_catalog.length(message_row.media_metadata->>'mime_type') = 20000
  ) then
    raise exception 'oversized_metadata_message_not_persisted';
  end if;

  select queued.payload
  into v_safe_payload
  from private.bot_updates queued
  where queued.bot_id = v_bot_id
    and queued.update_type = 'message'
    and queued.payload->'message'->>'id' = v_oversized_message_id::text;
  if v_safe_payload is null
     or pg_catalog.octet_length(v_safe_payload::text) >= 65536
     or pg_catalog.length(v_safe_payload#>>'{message,text}') > 4096
     or pg_catalog.length(v_safe_payload#>>'{message,from,display_name}') > 128
     or pg_catalog.length(v_safe_payload#>>'{message,from,username}') > 64
     or pg_catalog.length(v_safe_payload#>>'{message,chat,type}') > 32
     or pg_catalog.length(v_safe_payload#>>'{message,chat,name}') > 256
     or pg_catalog.length(v_safe_payload#>>'{message,attachment,kind}') > 32
     or pg_catalog.length(v_safe_payload#>>'{message,attachment,mime_type}') > 128
     or pg_catalog.length(v_safe_payload#>>'{message,attachment,file_name}') > 255
     or pg_catalog.length(v_safe_payload#>>'{message,attachment,byte_size}') > 32
     or pg_catalog.length(v_safe_payload#>>'{message,attachment,width}') > 16
     or pg_catalog.length(v_safe_payload#>>'{message,attachment,height}') > 16
     or pg_catalog.length(v_safe_payload#>>'{message,attachment,duration}') > 32 then
    raise exception 'oversized_metadata_projection_not_bounded';
  end if;
  if exists (
    select 1
    from private.bot_updates queued
    where queued.bot_id = v_third_bot_id
      and queued.payload->'message'->>'id' = v_oversized_message_id::text
  ) then
    raise exception 'broken_bot_unsafe_insert_update_queued';
  end if;

  v_rejected := false;
  begin
    perform public.bot_update_enqueue_internal(
      v_third_bot_id,
      'message',
      v_oversized_message_id,
      '{}'::jsonb
    );
  exception
    when numeric_value_out_of_range then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'direct_bot_enqueue_failure_was_swallowed';
  end if;

  update public.messages
  set media_metadata = pg_catalog.jsonb_build_object(
    'mime_type', pg_catalog.repeat('e', 22000),
    'file_name', pg_catalog.repeat('g', 22000),
    'size', pg_catalog.repeat('5', 22000),
    'width', pg_catalog.repeat('4', 22000),
    'height', pg_catalog.repeat('3', 22000),
    'duration', pg_catalog.repeat('2', 22000)
  )
  where id = v_oversized_message_id;
  if not exists (
    select 1
    from public.messages message_row
    where message_row.id = v_oversized_message_id
      and pg_catalog.length(message_row.media_metadata->>'mime_type') = 22000
  ) then
    raise exception 'oversized_metadata_edit_not_persisted';
  end if;
  select queued.payload
  into v_safe_payload
  from private.bot_updates queued
  where queued.bot_id = v_bot_id
    and queued.update_type = 'edited_message'
    and queued.payload->'message'->>'id' = v_oversized_message_id::text;
  if v_safe_payload is null
     or pg_catalog.octet_length(v_safe_payload::text) >= 65536
     or pg_catalog.length(v_safe_payload#>>'{message,attachment,mime_type}') > 128
     or pg_catalog.length(v_safe_payload#>>'{message,attachment,file_name}') > 255
     or pg_catalog.length(v_safe_payload#>>'{message,attachment,byte_size}') > 32
     or pg_catalog.length(v_safe_payload#>>'{message,attachment,width}') > 16
     or pg_catalog.length(v_safe_payload#>>'{message,attachment,height}') > 16
     or pg_catalog.length(v_safe_payload#>>'{message,attachment,duration}') > 32 then
    raise exception 'oversized_metadata_edit_projection_not_bounded';
  end if;
  if exists (
    select 1
    from private.bot_updates queued
    where queued.bot_id = v_third_bot_id
      and queued.update_type = 'edited_message'
      and queued.payload->'message'->>'id' = v_oversized_message_id::text
  ) then
    raise exception 'broken_bot_unsafe_edit_update_queued';
  end if;

  update public.chat_bot_members
  set removed_at = pg_catalog.now()
  where chat_id = v_lifecycle_chat_id
    and bot_id = v_second_bot_id;
  select pg_catalog.count(*)
  into v_update_count_before
  from private.bot_updates queued
  where queued.bot_id = v_second_bot_id
    and queued.update_type = 'membership';
  update public.chat_bot_members
  set privacy_mode = 'full',
      full_visibility_requested_at = pg_catalog.now(),
      full_visibility_approved_by = v_actor_id
  where chat_id = v_lifecycle_chat_id
    and bot_id = v_second_bot_id;
  select pg_catalog.count(*)
  into v_update_count
  from private.bot_updates queued
  where queued.bot_id = v_second_bot_id
    and queued.update_type = 'membership';
  if v_update_count <> v_update_count_before then
    raise exception 'removed_membership_privacy_update_was_queued';
  end if;
  if not exists (
    select 1
    from public.chat_bot_members member_row
    where member_row.chat_id = v_lifecycle_chat_id
      and member_row.bot_id = v_second_bot_id
      and member_row.removed_at is not null
      and member_row.privacy_mode = 'full'
      and member_row.full_visibility_approved_by = v_actor_id
  ) then
    raise exception 'removed_membership_privacy_update_not_persisted';
  end if;
  update private.bot_update_counters counter
  set next_update_id = 9223372036854775807
  where counter.bot_id = v_second_bot_id;
  select pg_catalog.count(*)
  into v_update_count_before
  from private.bot_updates queued
  where queued.bot_id = v_second_bot_id
    and queued.update_type = 'membership';
  update public.chat_bot_members
  set removed_at = null
  where chat_id = v_lifecycle_chat_id
    and bot_id = v_second_bot_id;
  select pg_catalog.count(*)
  into v_update_count
  from private.bot_updates queued
  where queued.bot_id = v_second_bot_id
    and queued.update_type = 'membership';
  if v_update_count <> v_update_count_before
     or not exists (
       select 1
       from public.chat_bot_members member_row
       where member_row.chat_id = v_lifecycle_chat_id
         and member_row.bot_id = v_second_bot_id
         and member_row.removed_at is null
     ) then
    raise exception 'membership_enqueue_failure_rolled_back_source';
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
  select authorized.grant_id into v_second_upload_grant_id
  from public.bot_upload_authorize_internal(
    v_bot_id,
    v_chat_id,
    'chat-media',
    v_media_path,
    'image/jpeg',
    1024,
    300
  ) authorized;
  if v_second_upload_grant_id is distinct from v_upload_grant_id
     or (
       select pg_catalog.count(*)
       from private.bot_upload_grants upload_grant
       where upload_grant.bot_id = v_bot_id
         and upload_grant.chat_id = v_chat_id
         and upload_grant.object_path = v_media_path
         and upload_grant.consumed_at is null
         and upload_grant.expires_at > pg_catalog.now()
     ) <> 1 then
    raise exception 'bot_upload_exact_retry_failed';
  end if;
  v_rejected := false;
  begin
    perform public.bot_upload_authorize_internal(
      v_bot_id,
      v_chat_id,
      'chat-media',
      v_media_path,
      'image/jpeg',
      1025,
      300
    );
  exception
    when unique_violation then
      if sqlerrm = 'bot_upload_grant_attribute_conflict' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'bot_upload_attribute_conflict_missing';
  end if;
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
  select public.bot_message_command_internal(
    v_bot_id,
    v_chat_id,
    'sendPhoto',
    pg_catalog.jsonb_build_object(
      'text', 'authorized photo',
      'media_bucket', 'chat-media',
      'media_path', v_media_path,
      'media_metadata', pg_catalog.jsonb_build_object('mime_type', 'image/jpeg')
    ),
    'authorized-media-key',
    pg_catalog.repeat('4', 64)
  ) into v_first_operation;
  v_media_message_id := (v_first_operation->'result'->>'message_id')::uuid;
  if not exists (
    select 1 from private.bot_upload_grants upload_grant
    where upload_grant.id = v_upload_grant_id
      and upload_grant.consumed_message_id = v_media_message_id
      and upload_grant.consumed_at is not null
  ) then
    raise exception 'bot_media_grant_not_consumed';
  end if;

  v_rejected := false;
  begin
    perform public.bot_media_command_preflight_internal(
      v_bot_id,
      v_chat_id,
      'sendPhoto',
      'authorized-media-key',
      pg_catalog.repeat('5', 64)
    );
  exception
    when unique_violation then
      if sqlerrm = 'bot_operation_idempotency_conflict' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'bot_media_preflight_changed_retry_missing';
  end if;

  v_rejected := false;
  begin
    perform public.bot_media_command_preflight_internal(
      v_bot_id,
      v_chat_id,
      'sendVideo',
      'authorized-media-key',
      pg_catalog.repeat('6', 64)
    );
  exception
    when unique_violation then
      if sqlerrm = 'bot_operation_idempotency_conflict' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'bot_media_preflight_changed_method_retry_missing';
  end if;
  if exists (
    select 1 from private.bot_upload_grants upload_grant
    where upload_grant.bot_id = v_bot_id
      and upload_grant.chat_id = v_chat_id
      and upload_grant.object_path = v_media_path
      and upload_grant.consumed_at is null
      and upload_grant.expires_at > pg_catalog.now()
  ) then
    raise exception 'bot_media_preflight_changed_retry_created_grant';
  end if;

  select public.bot_media_command_preflight_internal(
    v_bot_id,
    v_chat_id,
    'sendPhoto',
    'authorized-media-key',
    pg_catalog.repeat('4', 64)
  ) into v_duplicate_operation;
  if v_duplicate_operation->'result' is distinct from v_first_operation->'result'
     or coalesce((v_duplicate_operation->>'duplicate')::boolean, false) is not true then
    raise exception 'bot_media_preflight_exact_retry_failed';
  end if;

  v_rejected := false;
  begin
    perform public.bot_media_command_preflight_internal(
      v_third_bot_id,
      v_chat_id,
      'sendPhoto',
      'inactive-media-key',
      pg_catalog.repeat('7', 64)
    );
  exception
    when insufficient_privilege then
      if sqlerrm = 'bot_chat_forbidden' then
        v_rejected := true;
      else
        raise;
      end if;
  end;
  if not v_rejected then
    raise exception 'bot_media_preflight_inactive_membership_succeeded';
  end if;

  v_new_media_path := v_chat_id::text || '/bots/' || v_bot_id::text || '/'
    || gen_random_uuid()::text || '.jpg';
  insert into storage.objects(bucket_id, name)
  values ('chat-media', v_new_media_path);
  select public.bot_media_command_preflight_internal(
    v_bot_id,
    v_chat_id,
    'sendPhoto',
    'new-media-command-key',
    pg_catalog.repeat('8', 64)
  ) into v_first_operation;
  select public.bot_media_command_preflight_internal(
    v_bot_id,
    v_chat_id,
    'sendPhoto',
    'new-media-command-key',
    pg_catalog.repeat('8', 64)
  ) into v_duplicate_operation;
  if coalesce((v_first_operation->>'duplicate')::boolean, true)
     or coalesce((v_duplicate_operation->>'duplicate')::boolean, true)
     or v_first_operation->'result' <> 'null'::jsonb
     or v_duplicate_operation->'result' <> 'null'::jsonb then
    raise exception 'bot_media_preflight_new_request_failed';
  end if;

  select authorized.grant_id into v_new_upload_grant_id
  from public.bot_upload_authorize_internal(
    v_bot_id,
    v_chat_id,
    'chat-media',
    v_new_media_path,
    'image/jpeg',
    2048,
    60
  ) authorized;
  select authorized.grant_id into v_second_upload_grant_id
  from public.bot_upload_authorize_internal(
    v_bot_id,
    v_chat_id,
    'chat-media',
    v_new_media_path,
    'image/jpeg',
    2048,
    60
  ) authorized;
  if v_second_upload_grant_id is distinct from v_new_upload_grant_id then
    raise exception 'bot_media_preflight_new_request_failed';
  end if;

  select public.bot_message_command_internal(
    v_bot_id,
    v_chat_id,
    'sendPhoto',
    pg_catalog.jsonb_build_object(
      'media_bucket', 'chat-media',
      'media_path', v_new_media_path,
      'media_metadata', pg_catalog.jsonb_build_object(
        'mime_type', 'image/jpeg',
        'size', 2048,
        'kind', 'image'
      )
    ),
    'new-media-command-key',
    pg_catalog.repeat('8', 64)
  ) into v_first_operation;
  v_new_media_message_id := (v_first_operation->'result'->>'message_id')::uuid;
  select public.bot_message_command_internal(
    v_bot_id,
    v_chat_id,
    'sendPhoto',
    pg_catalog.jsonb_build_object(
      'media_bucket', 'chat-media',
      'media_path', v_new_media_path,
      'media_metadata', pg_catalog.jsonb_build_object(
        'mime_type', 'image/jpeg',
        'size', 2048,
        'kind', 'image'
      )
    ),
    'new-media-command-key',
    pg_catalog.repeat('8', 64)
  ) into v_duplicate_operation;
  if v_new_media_message_id is null
     or v_duplicate_operation->'result' is distinct from v_first_operation->'result'
     or coalesce((v_duplicate_operation->>'duplicate')::boolean, false) is not true
     or not exists (
       select 1 from private.bot_upload_grants upload_grant
       where upload_grant.id = v_new_upload_grant_id
         and upload_grant.consumed_message_id = v_new_media_message_id
         and upload_grant.consumed_at is not null
     ) then
    raise exception 'bot_media_command_final_authority_failed';
  end if;

  if (public.bot_file_lookup_internal(v_bot_id, v_chat_id, v_media_message_id)->>'message_id')::uuid
       is distinct from v_media_message_id then
    raise exception 'bot_file_lookup_failed';
  end if;
  v_rejected := false;
  begin
    perform public.bot_file_lookup_internal(v_bot_id, v_other_chat_id, v_media_message_id);
  exception
    when no_data_found or insufficient_privilege then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_file_cross_chat_lookup_succeeded';
  end if;
  v_rejected := false;
  begin
    perform public.bot_file_lookup_internal(v_bot_id, v_chat_id, v_history_message_id);
  exception
    when no_data_found or insufficient_privilege then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_file_pre_join_lookup_succeeded';
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

  select coalesce(pg_catalog.max(queued.update_id), 0) + 1
  into v_ordered_update_one
  from private.bot_updates queued
  where queued.bot_id = v_bot_id;
  v_ordered_update_two := v_ordered_update_one + 1;
  v_ordered_update_three := v_ordered_update_one + 2;
  insert into private.bot_updates(bot_id, update_id, update_type, payload)
  values
    (v_bot_id, v_ordered_update_one, 'message', '{"message":{"id":"order-one"}}'),
    (v_bot_id, v_ordered_update_two, 'callback_query', '{"callback_query":{"id":"order-two"}}'),
    (v_bot_id, v_ordered_update_three, 'message', '{"message":{"id":"order-three"}}');

  select polled.update_id into v_polled_update_id
  from public.bot_updates_poll_internal(
    v_bot_id,
    v_ordered_update_two,
    1,
    array['message']::text[],
    v_poll_token
  ) polled;
  if v_polled_update_id <> v_ordered_update_three
     or not exists (
       select 1 from private.bot_updates queued
       where queued.bot_id = v_bot_id
         and queued.update_id = v_ordered_update_one
         and queued.acknowledged_at is not null
     )
     or exists (
       select 1 from private.bot_updates queued
       where queued.bot_id = v_bot_id
         and queued.update_id in (v_ordered_update_two, v_ordered_update_three)
         and queued.acknowledged_at is not null
     ) then
    raise exception 'bot_poll_filter_or_ack_invalid';
  end if;

  v_rejected := false;
  begin
    perform * from public.bot_updates_poll_internal(
      v_bot_id,
      0,
      100,
      array[]::text[],
      v_other_poll_token
    );
  exception
    when sqlstate '55000' then
      v_rejected := true;
  end;
  if not v_rejected
     or public.bot_updates_poll_release_internal(v_bot_id, v_other_poll_token)
     or public.bot_updates_poll_release_internal(v_bot_id, v_poll_token) is not true then
    raise exception 'bot_poll_lease_isolation_failed';
  end if;

  perform * from public.bot_updates_poll_internal(
    v_bot_id,
    0,
    100,
    array[]::text[],
    v_poll_token
  );
  v_rejected := false;
  begin
    perform public.bot_webhook_set_internal(
      v_bot_id,
      'https://bot-smoke.invalid/webhook',
      'enc:v1:' || pg_catalog.repeat('P', 64),
      pg_catalog.repeat('f', 16),
      false,
      'webhook-smoke-poll-conflict',
      pg_catalog.repeat('f', 64)
    );
  exception
    when sqlstate '55000' then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_webhook_did_not_conflict_with_poll';
  end if;
  perform public.bot_updates_poll_release_internal(v_bot_id, v_poll_token);

  perform public.bot_webhook_set_internal(
    v_bot_id,
    'https://bot-smoke.invalid/webhook',
    'enc:v1:' || pg_catalog.repeat('C', 64),
    pg_catalog.repeat('c', 16),
    false,
    'webhook-smoke-set-delivery',
    pg_catalog.repeat('e', 64)
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
      webhook_epoch = (
        select webhook.webhook_epoch
        from private.bot_webhooks webhook
        where webhook.bot_id = attempt.bot_id
      ),
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

  select pg_catalog.count(*)::integer
  into v_claimed_rows
  from private.bot_delivery_attempts attempt
  where attempt.bot_id = v_bot_id
    and attempt.status = 'claimed'
    and attempt.claim_token = v_claim_token;
  if v_claimed_rows <> 1 then
    raise exception 'bot_claimed_multiple_updates_out_of_order';
  end if;

  select attempt.id, attempt.webhook_epoch
  into v_claimed_attempt_id, v_claimed_epoch
  from private.bot_delivery_attempts attempt
  where attempt.bot_id = v_bot_id
    and attempt.status = 'claimed'
    and attempt.claim_token = v_claim_token;
  v_prepared := public.bot_delivery_prepare_internal(
    v_claimed_attempt_id,
    v_claim_token,
    v_claimed_epoch
  );
  if v_prepared is null
     or v_prepared ? 'secret_fingerprint'
     or not (v_prepared ? 'secret_ciphertext') then
    raise exception 'bot_delivery_prepare_invalid';
  end if;

  v_rejected := false;
  begin
    perform public.bot_webhook_delete_internal(
      v_bot_id,
      false,
      'webhook-smoke-delete-in-flight',
      pg_catalog.repeat('1', 64)
    );
  exception
    when sqlstate '55000' then
      v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_webhook_mutated_during_dispatch';
  end if;
  if public.bot_delivery_finish_internal(
    v_claimed_attempt_id,
    v_claim_token,
    'retry',
    'network_error',
    null
  ) is not true then
    raise exception 'bot_delivery_finish_failed';
  end if;

  insert into private.bot_updates(bot_id, update_id, update_type, payload)
  values (
    v_bot_id,
    v_ordered_update_three + 1,
    'message',
    '{"message":{"id":"claim-invalidation"}}'
  );
  insert into private.bot_delivery_attempts(bot_id, update_id)
  values (v_bot_id, v_ordered_update_three + 1);

  select claimed.attempt_id, claimed.webhook_epoch
  into v_claimed_attempt_id, v_claimed_epoch
  from public.bot_delivery_claim_internal(100, v_second_claim_token) claimed
  limit 1;
  if v_claimed_attempt_id is null then
    raise exception 'bot_claim_invalidation_probe_missing';
  end if;
  perform public.bot_webhook_set_internal(
    v_bot_id,
    'https://bot-smoke.invalid/replaced',
    'enc:v1:' || pg_catalog.repeat('R', 64),
    pg_catalog.repeat('a', 16),
    false,
    'webhook-smoke-replace-claim',
    pg_catalog.repeat('2', 64)
  );
  if public.bot_delivery_prepare_internal(
    v_claimed_attempt_id,
    v_second_claim_token,
    v_claimed_epoch
  ) is not null then
    raise exception 'bot_replaced_claim_remained_dispatchable';
  end if;

  v_webhook_info := public.bot_webhook_info_internal(v_bot_id);
  if coalesce((v_webhook_info->>'configured')::boolean, false) is not true
     or v_webhook_info ? 'target_url'
     or v_webhook_info ? 'secret_ciphertext'
     or v_webhook_info ? 'secret_fingerprint'
     or (v_webhook_info->>'pending_update_count')::integer <> (
       select least(pg_catalog.count(*), 1000000)::integer
       from private.bot_updates queued
       where queued.bot_id = v_bot_id
         and queued.acknowledged_at is null
         and queued.expires_at > pg_catalog.now()
     ) then
    raise exception 'bot_webhook_info_exposed_private_data';
  end if;

  perform public.bot_webhook_delete_internal(
    v_bot_id,
    true,
    'webhook-smoke-delete-drop',
    pg_catalog.repeat('3', 64)
  );
  if exists (
    select 1 from private.bot_updates queued
    where queued.bot_id = v_bot_id
      and queued.acknowledged_at is null
  ) or exists (
    select 1 from private.bot_delivery_attempts attempt
    where attempt.bot_id = v_bot_id
      and attempt.status in ('pending','claimed','dispatching','retry')
  ) then
    raise exception 'bot_drop_pending_not_transactional';
  end if;

  update public.bots bot
  set avatar_url = 'https://api.letscube.ru/media/bots/smoke.webp'
  where bot.id = v_bot_id
  returning bot.username into v_bot_username;

  if pg_catalog.has_function_privilege('anon', 'public.search_public_bots(text,integer)', 'execute')
     or not pg_catalog.has_function_privilege('authenticated', 'public.search_public_bots(text,integer)', 'execute') then
    raise exception 'bot_public_search_role_grants_invalid';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_recipient_id::text, true);
  execute 'set local role authenticated';
  if (select pg_catalog.count(*) from public.search_public_bots('@' || v_bot_username, 20)) <> 1 then
    execute 'reset role';
    raise exception 'active_bot_search_failed';
  end if;
  execute 'reset role';

  update public.bots set state = 'paused' where id = v_bot_id;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_recipient_id::text, true);
  execute 'set local role authenticated';
  if (select pg_catalog.count(*) from public.search_public_bots(v_bot_username, 20)) <> 0
     or not exists (select 1 from public.bots bot where bot.id = v_bot_id) then
    execute 'reset role';
    raise exception 'inactive_shared_bot_visibility_or_search_invalid';
  end if;
  execute 'reset role';

  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor_id::text, true);
  execute 'set local role authenticated';
  if not exists (select 1 from public.bots bot where bot.id = v_bot_id) then
    execute 'reset role';
    raise exception 'inactive_owner_bot_visibility_missing';
  end if;
  execute 'reset role';

  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin_id::text, true);
  execute 'set local role authenticated';
  if exists (select 1 from public.bots bot where bot.id = v_bot_id) then
    execute 'reset role';
    raise exception 'inactive_bot_visible_to_unrelated_authenticated_user';
  end if;
  execute 'reset role';
  update public.bots set state = 'active' where id = v_bot_id;

  insert into public.chats(id, type, name, created_by)
  values (v_task6_chat_id, 'group', 'Task 6 projection smoke', v_actor_id);
  insert into public.chat_members(chat_id, user_id, role, joined_at, last_read_at)
  values
    (v_task6_chat_id, v_actor_id, 'owner', pg_catalog.now() - interval '1 minute', pg_catalog.now() - interval '1 minute'),
    (v_task6_chat_id, v_recipient_id, 'member', pg_catalog.now() - interval '1 minute', pg_catalog.now() - interval '1 minute');
  insert into public.chat_bot_members(chat_id, bot_id, joined_at)
  values (v_task6_chat_id, v_bot_id, pg_catalog.now());
  insert into public.messages(chat_id, user_id, content, type, created_at)
  values (v_task6_chat_id, v_recipient_id, 'task6 own human', 'text', pg_catalog.now() - interval '4 seconds');
  update public.profiles
  set avatar_url = 'https://app.letscube.ru/storage/v1/object/sign/avatars/human.webp?token=human-secret'
  where id = v_actor_id;
  insert into public.messages(chat_id, user_id, content, type, created_at)
  values (v_task6_chat_id, v_actor_id, 'task6 incoming human', 'text', pg_catalog.now() - interval '3 seconds')
  returning id into v_task6_human_message_id;
  select notification_row.payload
  into v_task6_push
  from public.notifications notification_row
  where notification_row.user_id = v_recipient_id
    and notification_row.payload->>'message_id' = v_task6_human_message_id::text
  order by notification_row.created_at desc
  limit 1;
  if v_task6_push is null
     or nullif(v_task6_push->>'sender_avatar_url', '') is not null then
    raise exception 'human_notification_raw_avatar_not_sanitized';
  end if;
  update public.profiles set avatar_url = null where id = v_actor_id;
  insert into public.messages(chat_id, user_id, bot_id, content, type, created_at)
  values (v_task6_chat_id, null, null, 'task6 system', 'system', pg_catalog.now() - interval '2 seconds');
  update public.bots
  set avatar_url = 'https://api.letscube.ru/media/bots/smoke.webp?password=bot-secret&authorization=bearer&signed_url=private'
  where id = v_bot_id;
  insert into public.messages(chat_id, user_id, bot_id, content, type, created_at)
  values (v_task6_chat_id, null, v_bot_id, 'task6 unsafe avatar bot', 'text', pg_catalog.now() - interval '1500 milliseconds')
  returning id into v_task6_unsafe_bot_message_id;
  select notification_row.payload
  into v_task6_push
  from public.notifications notification_row
  where notification_row.user_id = v_recipient_id
    and notification_row.payload->>'message_id' = v_task6_unsafe_bot_message_id::text
  order by notification_row.created_at desc
  limit 1;
  if v_task6_push is null
     or nullif(v_task6_push->>'sender_avatar_url', '') is not null then
    raise exception 'bot_notification_raw_avatar_not_sanitized';
  end if;
  update public.bots
  set avatar_url = 'https://api.letscube.ru/media/bots/smoke.webp'
  where id = v_bot_id;
  insert into public.messages(chat_id, user_id, bot_id, content, type, created_at)
  values (v_task6_chat_id, null, v_bot_id, 'task6 bot searchable', 'text', pg_catalog.now() - interval '1 second')
  returning id into v_task6_bot_message_id;

  select notification_row.payload
  into v_task6_push
  from public.notifications notification_row
  where notification_row.user_id = v_recipient_id
    and notification_row.payload->>'message_id' = v_task6_bot_message_id::text
  order by notification_row.created_at desc
  limit 1;
  if v_task6_push is null
     or v_task6_push->>'sender_kind' <> 'bot'
     or nullif(v_task6_push->>'sender_id', '') is not null
     or v_task6_push->>'bot_id' <> v_bot_id::text
     or v_task6_push->>'sender_avatar_url' <> 'https://api.letscube.ru/media/bots/smoke.webp'
     or v_task6_push->>'route' <> '/?chat=' || v_task6_chat_id::text || '&message=' || v_task6_bot_message_id::text
     or v_task6_push->>'group_tag' <> 'message:chat:' || v_task6_chat_id::text then
    raise exception 'bot_notification_projection_invalid';
  end if;

  v_task6_push := public._notification_push_payload('message', v_task6_push);
  if v_task6_push->>'chat_id' <> v_task6_chat_id::text
     or v_task6_push->>'message_id' <> v_task6_bot_message_id::text
     or v_task6_push->>'sender_kind' <> 'bot'
     or v_task6_push->>'bot_id' <> v_bot_id::text
     or v_task6_push->>'route' <> '/?chat=' || v_task6_chat_id::text || '&message=' || v_task6_bot_message_id::text
     or v_task6_push->>'group_tag' <> 'message:chat:' || v_task6_chat_id::text then
    raise exception 'bot_notification_push_projection_invalid';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_recipient_id::text, true);
  execute 'set local role authenticated';
  select summary.* into v_task6_summary
  from public.chat_list_summaries(array[v_task6_chat_id]) summary;
  if v_task6_summary.chat_id <> v_task6_chat_id
     or v_task6_summary.unread_count <> 3
     or v_task6_summary.last_message->>'id' <> v_task6_bot_message_id::text
     or v_task6_summary.last_message->'bot'->>'id' <> v_bot_id::text
     or v_task6_summary.last_message->'bot' ? 'delete_after' then
    execute 'reset role';
    raise exception 'bot_chat_summary_or_unread_invalid';
  end if;
  if not exists (
    select 1
    from public.search_chat_messages(v_task6_chat_id, 'task6 bot searchable', '{}'::jsonb, 20, null, true) result
    where result.message_id = v_task6_bot_message_id
      and result.sender_name = 'Smoke bot'
  ) then
    execute 'reset role';
    raise exception 'bot_chat_message_search_failed';
  end if;
  execute 'reset role';
  update public.bots set state = 'deleted' where id = v_bot_id;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_recipient_id::text, true);
  execute 'set local role authenticated';
  if not exists (
    select 1
    from public.search_chat_messages(v_task6_chat_id, 'удалённый бот', '{}'::jsonb, 20, null, true) result
    where result.message_id = v_task6_bot_message_id
      and result.sender_name = 'Удалённый бот'
      and result.rank > 0.9
  ) then
    execute 'reset role';
    raise exception 'deleted_bot_chat_search_identity_leaked';
  end if;
  if exists (
    select 1
    from public.search_chat_messages(v_task6_chat_id, 'Smoke bot', '{}'::jsonb, 20, null, true) result
    where result.message_id = v_task6_bot_message_id
  ) or exists (
    select 1
    from public.search_chat_messages(
      v_task6_chat_id,
      '',
      pg_catalog.jsonb_build_object('from', v_bot_username),
      20,
      null,
      true
    ) result
    where result.message_id = v_task6_bot_message_id
  ) then
    execute 'reset role';
    raise exception 'deleted_bot_old_identity_searchable';
  end if;
  execute 'reset role';

  insert into private.bot_updates(
    bot_id,
    update_id,
    update_type,
    payload,
    acknowledged_at
  ) values (
    v_bot_id,
    v_ordered_update_three + 2,
    'message',
    '{"message":{"id":"retention-payload"}}',
    pg_catalog.now()
  );
  insert into private.bot_delivery_attempts(
    bot_id,
    update_id,
    status,
    attempt_count,
    completed_at
  ) values (
    v_bot_id,
    v_ordered_update_three + 2,
    'succeeded',
    1,
    pg_catalog.now()
  );
  update private.bot_audit_events audit
  set created_at = pg_catalog.now() - interval '91 days'
  where audit.id = (
    select oldest.id
    from private.bot_audit_events oldest
    where oldest.bot_id = v_bot_id
    order by oldest.id
    limit 1
  );
  perform public.bot_delivery_cleanup_internal(pg_catalog.now(), 1000);
  if exists (
    select 1 from private.bot_updates queued
    where queued.bot_id = v_bot_id
      and queued.update_id = v_ordered_update_three + 2
  ) or not exists (
    select 1 from private.bot_delivery_attempts attempt
    where attempt.bot_id = v_bot_id
      and attempt.update_id = v_ordered_update_three + 2
      and attempt.status = 'succeeded'
  ) or exists (
    select 1 from private.bot_audit_events audit
    where audit.bot_id = v_bot_id
      and audit.created_at < pg_catalog.now() - interval '90 days'
  ) then
    raise exception 'bot_delivery_retention_invalid';
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
