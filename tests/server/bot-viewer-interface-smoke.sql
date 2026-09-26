\set ON_ERROR_STOP on

-- Synthetic, rollback-only contract probe. Run against an isolated database.
begin;
set local lock_timeout = '5s';

-- Synthetic accounts are created only inside this rollback-only transaction.
-- Keep registration policy out of this bot-interface contract probe.
do $compatibility$
begin
  if pg_catalog.to_regclass('public.registration_invite_settings') is not null then
    execute 'update public.registration_invite_settings set invite_only_enabled = false where id = true';
  end if;
end
$compatibility$;

-- This is the first red assertion on main: the current guard allows every
-- callback_query, including a marked callback with no live interface.
do $red$
begin
  if private.bot_update_still_visible(
    pg_catalog.gen_random_uuid(),
    'callback_query',
    pg_catalog.jsonb_build_object('callback_query', pg_catalog.jsonb_build_object(
      'viewer_interface_id', pg_catalog.gen_random_uuid()
    ))
  ) then
    raise exception 'orphan_viewer_callback_would_reach_bot';
  end if;
end
$red$;

do $contract$
declare
  v_signature text;
  v_role text;
  v_table text;
begin
  if not exists (
    select 1 from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(p.proacl) acl
    where p.oid = 'private.bot_viewer_interface_valid(uuid)'::regprocedure
      and acl.grantee = 'postgres'::regrole
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'delivery_guard_owner_cannot_execute_viewer_validator';
  end if;
  foreach v_table in array array[
    'private.bot_callback_interface_grants',
    'private.bot_viewer_interfaces',
    'private.bot_viewer_interface_actions'
  ] loop
    if pg_catalog.to_regclass(v_table) is null then
      raise exception 'viewer_interface_table_missing: %', v_table;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_class relation
      where relation.oid = v_table::regclass and relation.relrowsecurity
    ) then
      raise exception 'viewer_interface_table_rls_disabled: %', v_table;
    end if;
    if exists (
      select 1 from pg_catalog.pg_publication_tables published
      where published.pubname = 'supabase_realtime'
        and published.schemaname = 'private'
        and published.tablename = pg_catalog.split_part(v_table, '.', 2)
    ) then
      raise exception 'viewer_interface_table_published: %', v_table;
    end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_table_privilege(
        v_role, v_table, 'SELECT, INSERT, UPDATE, DELETE'
      ) then
        raise exception 'viewer_interface_direct_table_grant: % %', v_role, v_table;
      end if;
    end loop;
  end loop;

  -- The extra UUID is the creator token ID. The older plan signatures without
  -- it cannot enforce revocation between gateway auth and the DB writer.
  foreach v_signature in array array[
    'public.bot_viewer_interface_set_internal(uuid,uuid,uuid,jsonb,text,text)',
    'public.bot_viewer_interface_edit_internal(uuid,uuid,uuid,integer,jsonb,text,text)',
    'public.bot_viewer_interface_close_internal(uuid,uuid,uuid,integer,text,text)',
    'public.bot_viewer_interfaces_for_actor(uuid)',
    'public.bot_viewer_interface_press(uuid,integer,text)',
    'public.bot_viewer_interface_dismiss(uuid,integer)',
    'public.bot_viewer_delivery_recheck_internal(bigint,uuid)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'viewer_interface_rpc_missing: %', v_signature;
    end if;
  end loop;
  foreach v_signature in array array[
    'public.bot_viewer_interface_set_internal(uuid,uuid,uuid,jsonb,text,text)',
    'public.bot_viewer_interface_edit_internal(uuid,uuid,uuid,integer,jsonb,text,text)',
    'public.bot_viewer_interface_close_internal(uuid,uuid,uuid,integer,text,text)',
    'public.bot_viewer_delivery_recheck_internal(bigint,uuid)'
  ] loop
    if not pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') then
      raise exception 'viewer_interface_writer_grant_invalid: %', v_signature;
    end if;
  end loop;
  foreach v_signature in array array[
    'public.bot_viewer_interfaces_for_actor(uuid)',
    'public.bot_viewer_interface_press(uuid,integer,text)',
    'public.bot_viewer_interface_dismiss(uuid,integer)'
  ] loop
    if not pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') then
      raise exception 'viewer_interface_actor_grant_invalid: %', v_signature;
    end if;
  end loop;
end
$contract$;

do $smoke$
declare
  v_actor uuid := pg_catalog.gen_random_uuid();
  v_other uuid := pg_catalog.gen_random_uuid();
  v_bot uuid := pg_catalog.gen_random_uuid();
  v_other_bot uuid := pg_catalog.gen_random_uuid();
  v_token uuid := pg_catalog.gen_random_uuid();
  v_other_token uuid := pg_catalog.gen_random_uuid();
  v_next_token uuid := pg_catalog.gen_random_uuid();
  v_chat uuid := pg_catalog.gen_random_uuid();
  v_source uuid;
  v_callback uuid;
  v_pending_callback uuid;
  v_action_callback uuid;
  v_panel uuid;
  v_second_panel uuid;
  v_version integer;
  v_message_count bigint;
  v_update_id bigint;
  v_stale_update_id bigint;
  v_attempt_id bigint;
  v_epoch bigint;
  v_lease uuid := pg_catalog.gen_random_uuid();
  v_claim uuid := pg_catalog.gen_random_uuid();
  v_marked_payload jsonb;
  v_grant jsonb;
  v_result jsonb;
  v_value jsonb;
  v_list jsonb;
  v_state jsonb := '{"title":"Private","body":"Ready","progress":25,"buttons":[[{"text":"Next","key":"next","callback_data":"opaque-private-action"}]]}'::jsonb;
  v_edit_state jsonb := '{"title":"Private","body":"Working","progress":50,"buttons":[[{"text":"Next","key":"next","callback_data":"opaque-private-action"}]]}'::jsonb;
  v_markup jsonb := '{"inline_keyboard":[[{"text":"Open","callback_data":"open"}]]}'::jsonb;
  v_capacity_panels uuid[] := '{}'::uuid[];
  v_index integer;
  v_rejected boolean;
begin
  insert into auth.users(id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (v_actor, 'authenticated', 'authenticated', 'viewer-smoke-' || v_actor::text || '@invalid',
     pg_catalog.now(), pg_catalog.now() - interval '2 days', pg_catalog.now()),
    (v_other, 'authenticated', 'authenticated', 'viewer-smoke-' || v_other::text || '@invalid',
     pg_catalog.now(), pg_catalog.now() - interval '2 days', pg_catalog.now());
  insert into public.profiles(id, full_name, username)
  values
    (v_actor, 'Viewer smoke A', 'viewer_a_' || pg_catalog.substr(v_actor::text, 1, 8)),
    (v_other, 'Viewer smoke B', 'viewer_b_' || pg_catalog.substr(v_other::text, 1, 8))
  on conflict (id) do update set
    full_name = excluded.full_name, username = excluded.username;
  insert into public.bots(id, username, display_name)
  values
    (v_bot, 'viewer_' || pg_catalog.substr(pg_catalog.replace(v_bot::text, '-', ''), 1, 12), 'Viewer smoke bot'),
    (v_other_bot, 'viewer_' || pg_catalog.substr(pg_catalog.replace(v_other_bot::text, '-', ''), 1, 12), 'Other smoke bot');
  insert into private.bot_tokens(id, bot_id, token_prefix, token_hash)
  values
    (v_token, v_bot, 'v' || pg_catalog.substr(pg_catalog.replace(v_token::text, '-', ''), 1, 12), pg_catalog.repeat('a', 64)),
    (v_other_token, v_other_bot, 'v' || pg_catalog.substr(pg_catalog.replace(v_other_token::text, '-', ''), 1, 12), pg_catalog.repeat('b', 64));
  insert into public.chats(id, type, name, created_by)
  values (v_chat, 'group', 'Viewer interface rollback smoke', v_actor);
  insert into public.chat_members(chat_id, user_id, role)
  values (v_chat, v_other, 'member');
  insert into public.chat_bot_members(
    chat_id, bot_id, joined_at, privacy_mode
  ) values (
    v_chat, v_bot, pg_catalog.clock_timestamp() - interval '1 minute', 'restricted'
  );

  v_result := public.bot_send_message_internal(
    v_bot, v_chat, 'sendMessage',
    pg_catalog.jsonb_build_object('text', 'Open the private panel', 'reply_markup', v_markup),
    'viewer-source-initial'
  );
  v_source := (v_result->>'message_id')::uuid;
  if v_source is null then
    raise exception 'viewer_source_bot_message_missing';
  end if;
  select pg_catalog.count(*) into v_message_count
  from public.messages message_row where message_row.chat_id = v_chat;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  select pg_catalog.to_jsonb(grant_row) into v_grant
  from private.bot_callback_interface_grants grant_row
  where grant_row.callback_query_id = v_callback;
  if v_grant is null
     or v_grant->>'bot_id' is distinct from v_bot::text
     or v_grant->>'viewer_id' is distinct from v_actor::text
     or v_grant->>'chat_id' is distinct from v_chat::text
     or v_grant->>'source_message_id' is distinct from v_source::text
     or (v_grant->>'expires_at')::timestamptz >
        (v_grant->>'created_at')::timestamptz + interval '10 minutes' then
    raise exception 'callback_issuance_grant_provenance_invalid';
  end if;

  -- ACK cleanup is not permission to forget who pressed the original button.
  update private.bot_updates queued
  set acknowledged_at = pg_catalog.clock_timestamp()
  where queued.bot_id = v_bot
    and queued.payload #>> '{callback_query,id}' = v_callback::text;
  delete from private.bot_updates queued
  where queued.bot_id = v_bot
    and queued.payload #>> '{callback_query,id}' = v_callback::text;
  if not exists (
    select 1 from private.bot_callback_interface_grants grant_row
    where grant_row.callback_query_id = v_callback
  ) then
    raise exception 'ack_cleanup_erased_callback_grant';
  end if;

  -- Poison auth.uid() while the bot writer runs: recipient authority is the
  -- persisted grant, not a service request's JWT or a bot-supplied viewer ID.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_other::text, true);
  execute 'set local role service_role';
  select public.bot_viewer_interface_set_internal(
    v_bot, v_token, v_callback, v_state, 'viewer-set-first', pg_catalog.repeat('a', 64)
  ) into v_result;
  execute 'reset role';
  v_value := coalesce(v_result->'result', v_result);
  v_panel := coalesce(v_value->>'interface_id', v_value->>'id')::uuid;
  v_version := (v_value->>'version')::integer;
  if v_panel is null or v_version <> 1 then
    raise exception 'valid_callback_did_not_create_panel';
  end if;
  if not exists (
    select 1 from private.bot_viewer_interfaces panel
    where panel.id = v_panel and panel.bot_id = v_bot
      and panel.viewer_id = v_actor and panel.chat_id = v_chat
      and panel.source_message_id = v_source
      and panel.source_callback_id = v_callback
      and panel.expires_at = panel.created_at + interval '15 minutes'
  ) then
    raise exception 'panel_authority_or_fixed_ttl_invalid';
  end if;
  if (select pg_catalog.count(*) from public.messages message_row
      where message_row.chat_id = v_chat) <> v_message_count then
    raise exception 'private_panel_created_public_message';
  end if;

  v_result := public.bot_viewer_interface_set_internal(
    v_bot, v_token, v_callback, v_state, 'viewer-set-first', pg_catalog.repeat('a', 64)
  );
  v_value := coalesce(v_result->'result', v_result);
  if coalesce(v_value->>'interface_id', v_value->>'id')::uuid <> v_panel
     or (v_value->>'version')::integer <> 1
     or coalesce((v_result->>'duplicate')::boolean, false) is not true
     or (select pg_catalog.count(*) from private.bot_viewer_interfaces panel
         where panel.source_callback_id = v_callback and panel.bot_id = v_bot) <> 1 then
    raise exception 'panel_identical_retry_not_idempotent';
  end if;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_set_internal(
      v_bot, v_token, v_callback, v_edit_state, 'viewer-set-first', pg_catalog.repeat('b', 64)
    );
  exception when sqlstate '23505' or sqlstate '40001' or sqlstate '42501' or sqlstate '55000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'panel_divergent_retry_was_accepted';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_viewer_interfaces_for_actor(v_chat) into v_list;
  execute 'reset role';
  if pg_catalog.jsonb_typeof(v_list) is distinct from 'array' then
    raise exception 'actor_reader_did_not_return_array';
  end if;
  if pg_catalog.jsonb_array_length(v_list) <> 1
     or coalesce(v_list->0->>'interface_id', v_list->0->>'id')::uuid <> v_panel
     or v_list::text like '%opaque-private-action%' then
    raise exception 'actor_reader_panel_or_projection_invalid';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_other::text, true);
  execute 'set local role authenticated';
  select public.bot_viewer_interfaces_for_actor(v_chat) into v_list;
  execute 'reset role';
  if v_list is distinct from '[]'::jsonb then
    raise exception 'panel_leaked_to_other_chat_member';
  end if;

  v_rejected := false;
  begin
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    execute 'set local role anon';
    perform public.bot_viewer_interfaces_for_actor(v_chat);
    execute 'reset role';
  exception when insufficient_privilege then
    v_rejected := true;
    execute 'reset role';
  end;
  if not v_rejected then
    raise exception 'anon_read_viewer_panel';
  end if;
  v_rejected := false;
  begin
    perform pg_catalog.set_config('request.jwt.claim.sub', v_other::text, true);
    execute 'set local role authenticated';
    perform 1 from private.bot_viewer_interfaces panel where panel.id = v_panel;
    execute 'reset role';
  exception when insufficient_privilege then
    v_rejected := true;
    execute 'reset role';
  end;
  if not v_rejected then
    raise exception 'authenticated_direct_panel_table_read';
  end if;

  -- A member cannot fabricate a private action by naming an arbitrary key.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_press(v_panel, 1, 'forged');
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate 'P0002' then
    v_rejected := true;
  end;
  execute 'reset role';
  if not v_rejected or exists (
    select 1 from private.bot_updates queued
    where queued.payload #>> '{callback_query,viewer_interface_id}' = v_panel::text
  ) then
    raise exception 'forged_panel_button_enqueued';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_other::text, true);
  execute 'set local role authenticated';
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_press(v_panel, 1, 'next');
  exception when sqlstate '42501' or sqlstate 'P0002' then
    v_rejected := true;
  end;
  execute 'reset role';
  if not v_rejected then
    raise exception 'other_actor_pressed_private_button';
  end if;

  v_result := public.bot_viewer_interface_edit_internal(
    v_bot, v_token, v_panel, 1, v_edit_state, 'viewer-edit-first', pg_catalog.repeat('c', 64)
  );
  v_value := coalesce(v_result->'result', v_result);
  if (v_value->>'version')::integer <> 2 or not exists (
    select 1 from private.bot_viewer_interfaces panel
    where panel.id = v_panel and panel.version = 2
      and panel.expires_at = panel.created_at + interval '15 minutes'
  ) then
    raise exception 'panel_edit_version_or_expiry_invalid';
  end if;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_edit_internal(
      v_bot, v_token, v_panel, 1, v_state, 'viewer-edit-stale', pg_catalog.repeat('d', 64)
    );
  exception when sqlstate '23505' or sqlstate '40001' or sqlstate '42501' or sqlstate '55000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'stale_panel_edit_overwrote_newer_state';
  end if;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_close_internal(
      v_bot, v_token, v_panel, 1, 'viewer-close-stale', pg_catalog.repeat('e', 64)
    );
  exception when sqlstate '23505' or sqlstate '40001' or sqlstate '42501' or sqlstate '55000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'stale_panel_close_won_edit_race';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_press(v_panel, 1, 'next');
  exception when sqlstate '40001' or sqlstate '42501' or sqlstate 'P0002' or sqlstate '55000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'stale_panel_press_enqueued';
  end if;
  select public.bot_viewer_interface_press(v_panel, 2, 'next') into v_action_callback;
  execute 'reset role';
  select queued.update_id, queued.payload into v_update_id, v_marked_payload
  from private.bot_updates queued
  where queued.bot_id = v_bot and queued.update_type = 'callback_query'
    and queued.payload #>> '{callback_query,id}' = v_action_callback::text;
  if v_update_id is null
     or v_marked_payload #>> '{callback_query,viewer_interface_id}' is distinct from v_panel::text
     or v_marked_payload #>> '{callback_query,from,id}' is distinct from v_actor::text
     or v_marked_payload #>> '{callback_query,data}' is distinct from 'opaque-private-action'
     or not private.bot_update_still_visible(v_bot, 'callback_query', v_marked_payload) then
    raise exception 'private_press_payload_or_live_delivery_invalid';
  end if;
  perform public.bot_viewer_interface_edit_internal(
    v_bot, v_token, v_panel, 2, v_state,
    'viewer-edit-after-press', pg_catalog.repeat('7', 64)
  );
  if not private.bot_update_still_visible(v_bot, 'callback_query', v_marked_payload) then
    raise exception 'editing_panel_dropped_queued_private_action';
  end if;
  insert into private.bot_webhooks(bot_id, target_url, secret_ciphertext, secret_fingerprint)
  values (
    v_bot, 'https://viewer-smoke.invalid/hook',
    'enc:v1:' || pg_catalog.repeat('B', 64), pg_catalog.repeat('b', 16)
  ) returning webhook_epoch into v_epoch;
  insert into private.bot_delivery_attempts(
    bot_id, update_id, status, attempt_count, claim_token, claimed_at, webhook_epoch
  ) values (
    v_bot, v_update_id, 'claimed', 1, v_claim, pg_catalog.clock_timestamp(), v_epoch
  ) returning id into v_attempt_id;
  if public.bot_delivery_prepare_internal(v_attempt_id, v_claim, v_epoch) is null
     or public.bot_viewer_delivery_recheck_internal(v_attempt_id, v_claim) <> 'allowed' then
    raise exception 'live_private_action_not_prepared_for_webhook';
  end if;
  update private.bot_delivery_attempts attempt
  set claimed_at = pg_catalog.clock_timestamp() - interval '3 minutes'
  where attempt.id = v_attempt_id;
  if public.bot_viewer_delivery_recheck_internal(v_attempt_id, v_claim) <> 'stale' then
    raise exception 'expired_claim_was_mistaken_for_panel_revocation';
  end if;
  update private.bot_delivery_attempts attempt
  set claimed_at = pg_catalog.clock_timestamp()
  where attempt.id = v_attempt_id;

  perform public.bot_viewer_interface_close_internal(
    v_bot, v_token, v_panel, 3, 'viewer-close-first', pg_catalog.repeat('f', 64)
  );
  if private.bot_update_still_visible(v_bot, 'callback_query', v_marked_payload)
     or exists (
       select 1 from private.bot_viewer_interfaces panel
       where panel.id = v_panel and panel.closed_at is null
     ) then
    raise exception 'closed_panel_or_queued_action_still_visible';
  end if;
  if public.bot_viewer_delivery_recheck_internal(v_attempt_id, v_claim) <> 'revoked' then
    raise exception 'prepared_webhook_still_dispatchable_after_panel_close';
  end if;
  if not public.bot_delivery_finish_internal(
    v_attempt_id, v_claim, 'dead_letter', 'privacy_revoked', null
  ) then
    raise exception 'prepared_webhook_could_not_be_retired_after_revocation';
  end if;
  delete from private.bot_webhooks webhook where webhook.bot_id = v_bot;
  perform public.bot_viewer_interface_close_internal(
    v_bot, v_token, v_panel, 3, 'viewer-close-first', pg_catalog.repeat('f', 64)
  );
  if (select pg_catalog.count(*) from public.messages message_row
      where message_row.chat_id = v_chat) <> v_message_count then
    raise exception 'private_panel_action_created_public_message';
  end if;
  select coalesce(pg_catalog.max(queued.update_id), 0) + 1000000
  into v_stale_update_id from private.bot_updates queued where queued.bot_id = v_bot;
  insert into private.bot_updates(bot_id, update_id, update_type, payload)
  values (v_bot, v_stale_update_id, 'callback_query', v_marked_payload);
  if exists (
    select 1 from public.bot_updates_poll_internal(
      v_bot, v_stale_update_id, 10, array['callback_query']::text[], v_lease
    ) polled where polled.update_id = v_stale_update_id
  ) then
    raise exception 'poll_delivered_revoked_private_action';
  end if;
  perform public.bot_updates_poll_release_internal(v_bot, v_lease);

  insert into private.bot_webhooks(bot_id, target_url, secret_ciphertext, secret_fingerprint)
  values (
    v_bot, 'https://viewer-smoke.invalid/hook',
    'enc:v1:' || pg_catalog.repeat('B', 64), pg_catalog.repeat('b', 16)
  ) returning webhook_epoch into v_epoch;
  insert into private.bot_delivery_attempts(
    bot_id, update_id, status, attempt_count, claim_token, claimed_at, webhook_epoch
  ) values (
    v_bot, v_stale_update_id, 'claimed', 1, v_claim, pg_catalog.clock_timestamp(), v_epoch
  ) returning id into v_attempt_id;
  if public.bot_delivery_prepare_internal(v_attempt_id, v_claim, v_epoch) is not null then
    raise exception 'webhook_prepared_revoked_private_action';
  end if;
  if not exists (
    select 1 from private.bot_delivery_attempts attempt
    where attempt.id = v_attempt_id and attempt.status = 'dead_letter'
  ) then
    raise exception 'webhook_did_not_retire_revoked_private_action';
  end if;
  delete from private.bot_webhooks webhook where webhook.bot_id = v_bot;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  select queued.payload into v_marked_payload from private.bot_updates queued
  where queued.bot_id = v_bot
    and queued.payload #>> '{callback_query,id}' = v_callback::text;
  if not private.bot_update_still_visible(v_bot, 'callback_query', v_marked_payload) then
    raise exception 'ordinary_unmarked_callback_was_revoked';
  end if;

  -- The remaining cases exercise provenance and irreversible lifecycle gates.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_set_internal(
      v_other_bot, v_other_token, v_callback, v_state,
      'viewer-wrong-bot', pg_catalog.repeat('1', 64)
    );
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate 'P0002' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'other_bot_used_callback_grant';
  end if;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_set_internal(
      v_bot, v_token, pg_catalog.gen_random_uuid(), v_state,
      'viewer-forged-id', pg_catalog.repeat('2', 64)
    );
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate 'P0002' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'forged_callback_created_panel';
  end if;
  v_result := public.bot_viewer_interface_set_internal(
    v_bot, v_token, v_callback, v_state,
    'viewer-second-panel', pg_catalog.repeat('3', 64)
  );
  v_value := coalesce(v_result->'result', v_result);
  v_second_panel := coalesce(v_value->>'interface_id', v_value->>'id')::uuid;
  if v_second_panel is null then
    raise exception 'correct_bot_could_not_use_own_callback';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_other::text, true);
  execute 'set local role authenticated';
  select public.bot_viewer_interface_dismiss(v_second_panel, 1) into v_rejected;
  execute 'reset role';
  if v_rejected is distinct from false then
    raise exception 'other_actor_dismissed_panel';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  perform public.bot_viewer_interface_dismiss(v_second_panel, 1);
  select public.bot_viewer_interfaces_for_actor(v_chat) into v_list;
  execute 'reset role';
  if v_list is distinct from '[]'::jsonb then
    raise exception 'dismissed_panel_still_visible';
  end if;

  -- A raw queue row naming a missing source message cannot mint a grant.
  -- The normal enqueue function already validates source provenance.
  v_callback := pg_catalog.gen_random_uuid();
  select coalesce(pg_catalog.max(queued.update_id), 0) + 1000000
  into v_stale_update_id from private.bot_updates queued where queued.bot_id = v_bot;
  insert into private.bot_updates(bot_id, update_id, update_type, payload)
  values (
    v_bot, v_stale_update_id, 'callback_query',
    pg_catalog.jsonb_build_object('callback_query', pg_catalog.jsonb_build_object(
      'id', v_callback,
      'data', 'open',
      'from', pg_catalog.jsonb_build_object('id', v_actor),
      'message', pg_catalog.jsonb_build_object(
        'id', pg_catalog.gen_random_uuid(), 'chat_id', v_chat)
    ))
  );
  if exists (
    select 1 from private.bot_callback_interface_grants grant_row
    where grant_row.callback_query_id = v_callback
  ) then
    raise exception 'unknown_source_minted_callback_grant';
  end if;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_set_internal(
      v_bot, v_token, v_callback, v_state,
      'viewer-raw-queue', pg_catalog.repeat('4', 64)
    );
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate 'P0002' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'unknown_source_queue_row_created_panel';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  v_rejected := false;
  begin
    perform public.bot_callback_press(pg_catalog.gen_random_uuid(), 'open');
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  execute 'reset role';
  if not v_rejected then
    raise exception 'unknown_source_message_issued_callback';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  with earlier as (
    select pg_catalog.clock_timestamp() - interval '11 minutes' as at
  )
  update private.bot_callback_interface_grants grant_row
  set created_at = earlier.at, expires_at = earlier.at + interval '10 minutes'
  from earlier where grant_row.callback_query_id = v_callback;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_set_internal(
      v_bot, v_token, v_callback, v_state,
      'viewer-expired-grant', pg_catalog.repeat('5', 64)
    );
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate 'P0002' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'expired_callback_grant_created_panel';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_set_internal(
      v_bot, v_token, v_callback,
      v_state || pg_catalog.jsonb_build_object('body', pg_catalog.repeat('x', 513)),
      'viewer-oversize', pg_catalog.repeat('6', 64)
    );
  exception when sqlstate '22023' or sqlstate '23514' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'oversize_panel_state_accepted';
  end if;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_set_internal(
      v_bot, v_token, v_callback, v_state || '{"html":"<b>bad</b>"}'::jsonb,
      'viewer-extra-key', pg_catalog.repeat('7', 64)
    );
  exception when sqlstate '22023' or sqlstate '23514' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'unknown_panel_state_key_accepted';
  end if;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_set_internal(
      v_bot, v_token, v_callback,
      '{"title":"Private","body":"Ready","buttons":[[{"text":"One","key":"same","callback_data":"one"},{"text":"Two","key":"same","callback_data":"two"}]]}'::jsonb,
      'viewer-duplicate-key', pg_catalog.repeat('8', 64)
    );
  exception when sqlstate '22023' or sqlstate '23514' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'duplicate_panel_button_key_accepted';
  end if;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_set_internal(
      v_bot, v_token, v_callback,
      '{"title":"Private","buttons":[[{"text":"One","key":"bad key","callback_data":"one"}]]}'::jsonb,
      'viewer-invalid-key', pg_catalog.repeat('9', 64)
    );
  exception when sqlstate '22023' or sqlstate '23514' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'invalid_panel_button_key_accepted';
  end if;

  for v_index in 1..3 loop
    perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
    execute 'set local role authenticated';
    select public.bot_callback_press(v_source, 'open') into v_callback;
    execute 'reset role';
    v_result := public.bot_viewer_interface_set_internal(
      v_bot, v_token, v_callback, v_state,
      'viewer-capacity-' || v_index::text, pg_catalog.repeat('a', 64)
    );
    v_value := coalesce(v_result->'result', v_result);
    v_panel := coalesce(v_value->>'interface_id', v_value->>'id')::uuid;
    v_capacity_panels := pg_catalog.array_append(v_capacity_panels, v_panel);
  end loop;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_set_internal(
      v_bot, v_token, v_callback, v_state,
      'viewer-capacity-four', pg_catalog.repeat('b', 64)
    );
  exception when sqlstate '54000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'fourth_active_panel_was_accepted';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  foreach v_panel in array v_capacity_panels loop
    if public.bot_viewer_interface_dismiss(v_panel, 1) is not true then
      raise exception 'capacity_fixture_panel_was_not_dismissed';
    end if;
  end loop;
  select public.bot_viewer_interfaces_for_actor(v_chat) into v_list;
  execute 'reset role';
  if v_list is distinct from '[]'::jsonb then
    raise exception 'capacity_fixture_left_visible_panel';
  end if;

  -- The fixed lifetime is enforced at read, action and delivery time, not by
  -- waiting for the hourly physical cleanup job. Move only this fixture row's
  -- clock fields while preserving the fifteen-minute invariant.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  v_result := public.bot_viewer_interface_set_internal(
    v_bot, v_token, v_callback, v_state,
    'viewer-ttl-panel', pg_catalog.repeat('9', 64)
  );
  v_value := coalesce(v_result->'result', v_result);
  v_panel := coalesce(v_value->>'interface_id', v_value->>'id')::uuid;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_viewer_interface_press(v_panel, 1, 'next') into v_action_callback;
  execute 'reset role';
  select queued.payload into v_marked_payload from private.bot_updates queued
  where queued.bot_id = v_bot
    and queued.payload #>> '{callback_query,id}' = v_action_callback::text;
  with earlier as (
    select pg_catalog.clock_timestamp() - interval '16 minutes' as at
  )
  update private.bot_viewer_interfaces panel
  set created_at = earlier.at, expires_at = earlier.at + interval '15 minutes'
  from earlier where panel.id = v_panel;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_viewer_interfaces_for_actor(v_chat) into v_list;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_press(v_panel, 1, 'next');
  exception when sqlstate '42501' or sqlstate 'P0002' or sqlstate '55000' then
    v_rejected := true;
  end;
  execute 'reset role';
  if not v_rejected or v_list is distinct from '[]'::jsonb
     or private.bot_update_still_visible(v_bot, 'callback_query', v_marked_payload) then
    raise exception 'expired_panel_remained_readable_or_actionable';
  end if;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_edit_internal(
      v_bot, v_token, v_panel, 1, v_edit_state,
      'viewer-expired-edit', pg_catalog.repeat('c', 64)
    );
  exception when sqlstate '42501' or sqlstate 'P0002' or sqlstate '55000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'expired_panel_was_edited';
  end if;

  -- A callback grant issued before hiding must not survive hide/unhide.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_pending_callback;
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  update public.chat_members member_row
  set hidden_at = pg_catalog.clock_timestamp()
  where member_row.chat_id = v_chat and member_row.user_id = v_actor;
  update public.chat_members member_row
  set hidden_at = null
  where member_row.chat_id = v_chat and member_row.user_id = v_actor;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_set_internal(
      v_bot, v_token, v_pending_callback, v_state,
      'viewer-hide-pending-grant', pg_catalog.repeat('8', 64)
    );
  exception when sqlstate '42501' or sqlstate 'P0002' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'hide_unhide_revived_pending_callback_grant';
  end if;

  -- Hiding is an irreversible panel revocation, even if the same membership
  -- row is unhidden before the panel's original TTL would have elapsed.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  v_result := public.bot_viewer_interface_set_internal(
    v_bot, v_token, v_callback, v_state,
    'viewer-hide-panel', pg_catalog.repeat('a', 64)
  );
  v_value := coalesce(v_result->'result', v_result);
  v_panel := coalesce(v_value->>'interface_id', v_value->>'id')::uuid;
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  update public.chat_members member_row
  set hidden_at = pg_catalog.clock_timestamp()
  where member_row.chat_id = v_chat and member_row.user_id = v_actor;
  update public.chat_members member_row
  set hidden_at = null
  where member_row.chat_id = v_chat and member_row.user_id = v_actor;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_viewer_interfaces_for_actor(v_chat) into v_list;
  execute 'reset role';
  if v_list is distinct from '[]'::jsonb or exists (
    select 1 from private.bot_viewer_interfaces panel
    where panel.id = v_panel and panel.closed_at is null
  ) then
    raise exception 'unhide_revived_private_panel';
  end if;

  -- A true leave/rejoin uses a second participant; source deletion is not
  -- involved, so permanent closure must come from membership revocation.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_other::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  v_result := public.bot_viewer_interface_set_internal(
    v_bot, v_token, v_callback, v_state,
    'viewer-leave-panel', pg_catalog.repeat('b', 64)
  );
  v_value := coalesce(v_result->'result', v_result);
  v_panel := coalesce(v_value->>'interface_id', v_value->>'id')::uuid;
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  delete from public.chat_members member_row
  where member_row.chat_id = v_chat and member_row.user_id = v_other;
  insert into public.chat_members(chat_id, user_id, role)
  values (v_chat, v_other, 'member');
  perform pg_catalog.set_config('request.jwt.claim.sub', v_other::text, true);
  execute 'set local role authenticated';
  select public.bot_viewer_interfaces_for_actor(v_chat) into v_list;
  execute 'reset role';
  if v_list is distinct from '[]'::jsonb or exists (
    select 1 from private.bot_viewer_interfaces panel
    where panel.id = v_panel and panel.closed_at is null
  ) then
    raise exception 'rejoin_revived_private_panel';
  end if;

  -- The privacy toggle advances the bot's joined_at epoch. A panel sourced
  -- before that boundary must not survive either direction of the toggle.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  v_result := public.bot_viewer_interface_set_internal(
    v_bot, v_token, v_callback, v_state,
    'viewer-epoch-panel', pg_catalog.repeat('c', 64)
  );
  v_value := coalesce(v_result->'result', v_result);
  v_panel := coalesce(v_value->>'interface_id', v_value->>'id')::uuid;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_viewer_interface_press(v_panel, 1, 'next') into v_action_callback;
  execute 'reset role';
  select queued.payload into v_marked_payload from private.bot_updates queued
  where queued.bot_id = v_bot
    and queued.payload #>> '{callback_query,id}' = v_action_callback::text;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  perform public.chat_bot_set_privacy(v_chat, v_bot, true);
  select public.bot_viewer_interfaces_for_actor(v_chat) into v_list;
  execute 'reset role';
  if v_list is distinct from '[]'::jsonb
     or private.bot_update_still_visible(v_bot, 'callback_query', v_marked_payload) then
    raise exception 'bot_privacy_epoch_kept_private_panel_or_action';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  perform public.chat_bot_set_privacy(v_chat, v_bot, false);
  select public.bot_viewer_interfaces_for_actor(v_chat) into v_list;
  execute 'reset role';
  if v_list is distinct from '[]'::jsonb then
    raise exception 'second_bot_epoch_revived_private_panel';
  end if;

  v_result := public.bot_send_message_internal(
    v_bot, v_chat, 'sendMessage',
    pg_catalog.jsonb_build_object('text', 'After bot epoch', 'reply_markup', v_markup),
    'viewer-source-after-epoch'
  );
  v_source := (v_result->>'message_id')::uuid;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  v_result := public.bot_viewer_interface_set_internal(
    v_bot, v_token, v_callback, v_state,
    'viewer-remove-panel', pg_catalog.repeat('d', 64)
  );
  v_value := coalesce(v_result->'result', v_result);
  v_panel := coalesce(v_value->>'interface_id', v_value->>'id')::uuid;
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  update public.chat_bot_members member_row
  set removed_at = pg_catalog.clock_timestamp()
  where member_row.chat_id = v_chat and member_row.bot_id = v_bot;
  update public.chat_bot_members member_row
  set removed_at = null, joined_at = pg_catalog.clock_timestamp()
  where member_row.chat_id = v_chat and member_row.bot_id = v_bot;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_viewer_interfaces_for_actor(v_chat) into v_list;
  execute 'reset role';
  if v_list is distinct from '[]'::jsonb or exists (
    select 1 from private.bot_viewer_interfaces panel
    where panel.id = v_panel and panel.closed_at is null
  ) then
    raise exception 'bot_readd_revived_private_panel';
  end if;

  v_result := public.bot_send_message_internal(
    v_bot, v_chat, 'sendMessage',
    pg_catalog.jsonb_build_object('text', 'Deletable source', 'reply_markup', v_markup),
    'viewer-source-delete'
  );
  v_source := (v_result->>'message_id')::uuid;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  v_result := public.bot_viewer_interface_set_internal(
    v_bot, v_token, v_callback, v_state,
    'viewer-source-panel', pg_catalog.repeat('e', 64)
  );
  v_value := coalesce(v_result->'result', v_result);
  v_panel := coalesce(v_value->>'interface_id', v_value->>'id')::uuid;
  perform public.bot_message_command_internal(
    v_bot, v_chat, 'deleteMessage',
    pg_catalog.jsonb_build_object('message_id', v_source),
    'viewer-delete-source', pg_catalog.repeat('f', 64)
  );
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_viewer_interfaces_for_actor(v_chat) into v_list;
  execute 'reset role';
  if v_list is distinct from '[]'::jsonb or exists (
    select 1 from private.bot_viewer_interfaces panel
    where panel.id = v_panel and panel.closed_at is null
  ) then
    raise exception 'deleted_source_left_private_panel_open';
  end if;

  v_result := public.bot_send_message_internal(
    v_bot, v_chat, 'sendMessage',
    pg_catalog.jsonb_build_object('text', 'Suspension source', 'reply_markup', v_markup),
    'viewer-source-suspension'
  );
  v_source := (v_result->>'message_id')::uuid;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_pending_callback;
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  v_result := public.bot_viewer_interface_set_internal(
    v_bot, v_token, v_callback, v_state,
    'viewer-suspend-panel', pg_catalog.repeat('1', 64)
  );
  v_value := coalesce(v_result->'result', v_result);
  v_panel := coalesce(v_value->>'interface_id', v_value->>'id')::uuid;
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  update public.bots bot set state = 'suspended' where bot.id = v_bot;
  update public.bots bot set state = 'active' where bot.id = v_bot;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_set_internal(
      v_bot, v_token, v_pending_callback, v_state,
      'viewer-suspend-pending-grant', pg_catalog.repeat('8', 64)
    );
  exception when sqlstate '42501' or sqlstate 'P0002' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'bot_resume_revived_pending_callback_grant';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_viewer_interfaces_for_actor(v_chat) into v_list;
  execute 'reset role';
  if v_list is distinct from '[]'::jsonb or exists (
    select 1 from private.bot_viewer_interfaces panel
    where panel.id = v_panel and panel.closed_at is null
  ) then
    raise exception 'bot_resume_revived_private_panel';
  end if;

  -- Token revocation after gateway authentication must still fail at the
  -- writer. It also invalidates an already-open panel and its queued action.
  v_result := public.bot_send_message_internal(
    v_bot, v_chat, 'sendMessage',
    pg_catalog.jsonb_build_object('text', 'Token source', 'reply_markup', v_markup),
    'viewer-source-token'
  );
  v_source := (v_result->>'message_id')::uuid;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  v_result := public.bot_viewer_interface_set_internal(
    v_bot, v_token, v_callback, v_state,
    'viewer-token-panel', pg_catalog.repeat('2', 64)
  );
  v_value := coalesce(v_result->'result', v_result);
  v_panel := coalesce(v_value->>'interface_id', v_value->>'id')::uuid;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_viewer_interface_press(v_panel, 1, 'next') into v_action_callback;
  select public.bot_callback_press(v_source, 'open') into v_callback;
  execute 'reset role';
  select queued.payload into v_marked_payload from private.bot_updates queued
  where queued.bot_id = v_bot
    and queued.payload #>> '{callback_query,id}' = v_action_callback::text;
  update private.bot_tokens token_row
  set revoked_at = pg_catalog.clock_timestamp()
  where token_row.id = v_token;
  select panel.version into v_version
  from private.bot_viewer_interfaces panel where panel.id = v_panel;
  if v_version is null then
    raise exception 'revoked_token_panel_missing_before_authority_check';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_viewer_interfaces_for_actor(v_chat) into v_list;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_press(v_panel, v_version, 'next');
  exception when sqlstate '42501' or sqlstate 'P0002' or sqlstate '55000' then
    v_rejected := true;
  end;
  execute 'reset role';
  if not v_rejected or v_list is distinct from '[]'::jsonb
     or private.bot_update_still_visible(v_bot, 'callback_query', v_marked_payload) then
    raise exception 'revoked_creator_token_left_panel_or_action_live';
  end if;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_set_internal(
      v_bot, v_token, v_callback, v_state,
      'viewer-revoked-token-set', pg_catalog.repeat('3', 64)
    );
  exception when sqlstate '42501' or sqlstate 'P0002' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'revoked_token_created_panel_after_auth';
  end if;
  insert into private.bot_tokens(id, bot_id, token_prefix, token_hash)
  values (
    v_next_token, v_bot,
    'v' || pg_catalog.substr(pg_catalog.replace(v_next_token::text, '-', ''), 1, 12),
    pg_catalog.repeat('c', 64)
  );
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_set_internal(
      v_bot, v_next_token, v_callback, v_state,
      'viewer-new-token-old-callback', pg_catalog.repeat('6', 64)
    );
  exception when sqlstate '42501' or sqlstate 'P0002' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'new_token_reused_pre_rotation_callback_grant';
  end if;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_edit_internal(
      v_bot, v_next_token, v_panel, v_version, v_edit_state,
      'viewer-new-token-edit', pg_catalog.repeat('4', 64)
    );
  exception when sqlstate '42501' or sqlstate 'P0002' or sqlstate '55000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'new_token_edited_old_token_panel';
  end if;
  v_rejected := false;
  begin
    perform public.bot_viewer_interface_close_internal(
      v_bot, v_next_token, v_panel, v_version,
      'viewer-new-token-close', pg_catalog.repeat('5', 64)
    );
  exception when sqlstate '42501' or sqlstate 'P0002' or sqlstate '55000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'new_token_closed_old_token_panel';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_actor::text, true);
  execute 'set local role authenticated';
  select public.bot_viewer_interfaces_for_actor(v_chat) into v_list;
  execute 'reset role';
  if v_list is distinct from '[]'::jsonb then
    raise exception 'new_token_revived_old_token_panel';
  end if;
end
$smoke$;

select 'bot_viewer_interface_smoke_ok' as result;

rollback;
