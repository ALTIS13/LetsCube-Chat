-- Rehearsal: 20260911144000_forward_message_with_media.sql
--
-- Run on the throwaway copy of production's schema, after that migration:
--   psql -X -v ON_ERROR_STOP=1 -f .migration-backup/supabase/rehearsal/20260911144000_forward_message_with_media.test.sql
--
-- One transaction that ends in ROLLBACK. A photo with metadata and preview
-- variants sits in a source chat; it is forwarded into a chat whose other member
-- is not in the source, and that member's view is checked from their own RLS.

begin;

do $compatibility$
begin
  if pg_catalog.to_regclass('public.registration_invite_settings') is not null then
    execute 'update public.registration_invite_settings set invite_only_enabled = false where id = true';
  end if;
end
$compatibility$;

do $preflight$
declare
  v_probe uuid := gen_random_uuid();
  v_seen uuid;
  v_claims_ok boolean;
  v_sub_ok boolean;
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_probe, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_seen := auth.uid();
  execute 'reset role';
  v_claims_ok := v_seen is not distinct from v_probe;

  perform pg_catalog.set_config('request.jwt.claims', '', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_probe::text, true);
  execute 'set local role authenticated';
  v_seen := auth.uid();
  execute 'reset role';
  v_sub_ok := v_seen is not distinct from v_probe;

  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  raise notice 'auth.uid() reads request.jwt.claims: %; request.jwt.claim.sub: %', v_claims_ok, v_sub_ok;
  if not v_claims_ok and not v_sub_ok then
    raise exception 'preflight: auth.uid() reads neither request.jwt.claims nor request.jwt.claim.sub; read pg_get_functiondef(''auth.uid()''::regprocedure)';
  end if;
end
$preflight$;

do $test$
declare
  v_alice uuid := gen_random_uuid();
  v_bob uuid := gen_random_uuid();
  v_carol uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_source_chat uuid := gen_random_uuid();
  v_target_chat uuid := gen_random_uuid();
  v_other_chat uuid := gen_random_uuid();
  v_photo uuid := gen_random_uuid();
  v_text uuid := gen_random_uuid();
  v_notice uuid := gen_random_uuid();
  v_gone uuid := gen_random_uuid();
  v_hidden uuid := gen_random_uuid();
  v_target_topic uuid := gen_random_uuid();
  v_other_topic uuid := gen_random_uuid();
  v_client uuid := gen_random_uuid();
  v_now constant timestamptz := pg_catalog.now();
  v_media_path text;
  v_metadata jsonb;
  v_copy public.messages%rowtype;
  v_again public.messages%rowtype;
  v_count integer;
  v_failed boolean;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
  select person.id, 'authenticated', 'authenticated', 'rehearsal-' || person.id::text || '@invalid', v_now, v_now, v_now
    from pg_catalog.unnest(array[v_alice, v_bob, v_carol, v_stranger]) as person(id);
  insert into public.profiles (id, full_name, username)
  select person.id, 'Rehearsal ' || person.label, 'rh_' || person.label || '_' || pg_catalog.substr(pg_catalog.replace(person.id::text, '-', ''), 1, 8)
    from (values (v_alice, 'alice'), (v_bob, 'bob'), (v_carol, 'carol'), (v_stranger, 'stranger')) as person(id, label)
  on conflict (id) do update set full_name = excluded.full_name, username = excluded.username;
  insert into public.chats (id, type, name, created_by) values
    (v_source_chat, 'group', 'Rehearsal source', v_bob),
    (v_target_chat, 'group', 'Rehearsal target', v_alice),
    (v_other_chat, 'group', 'Rehearsal other', v_carol);
  insert into public.chat_members (chat_id, user_id, role)
  values (v_source_chat, v_bob, 'owner'), (v_source_chat, v_alice, 'member'),
         (v_target_chat, v_alice, 'owner'), (v_target_chat, v_carol, 'member'),
         (v_other_chat, v_carol, 'owner'), (v_other_chat, v_bob, 'member')
  on conflict (chat_id, user_id) do update set role = excluded.role;
  insert into public.topics (id, chat_id, name) values
    (v_target_topic, v_target_chat, 'Rehearsal topic'),
    (v_other_topic, v_other_chat, 'Rehearsal other topic');

  v_media_path := v_bob::text || '/rehearsal-beach.jpg';
  v_metadata := pg_catalog.jsonb_build_object(
    'kind', 'image', 'width', 1200, 'height', 800,
    'uncompressed', true, 'preview_path', v_bob::text || '/rehearsal-beach.preview.webp'
  );
  insert into public.messages (id, chat_id, user_id, content, type, media_url, media_bucket, media_path, media_metadata) values
    (v_photo, v_source_chat, v_bob, 'Пляж', 'image',
     'https://example.invalid/storage/v1/object/public/media/' || v_media_path, 'media', v_media_path, v_metadata);
  insert into public.messages (id, chat_id, user_id, content, type) values
    (v_text, v_source_chat, v_bob, 'rehearsal text', 'text'),
    (v_gone, v_source_chat, v_bob, 'rehearsal gone', 'text'),
    (v_hidden, v_source_chat, v_bob, 'rehearsal hidden', 'text');
  insert into public.messages (id, chat_id, user_id, content, type) values
    (v_notice, v_source_chat, null, 'rehearsal notice', 'system');
  update public.messages set deleted_at = v_now where id = v_gone;
  insert into public.message_hidden_for_users (message_id, user_id) values (v_hidden, v_alice);
  insert into public.media_variants (
    message_id, chat_id, owner_id, source_bucket, source_path, variant_kind,
    variant_bucket, variant_path, mime_type, width, height, size_bytes, status, error_code
  ) values
    (v_photo, v_source_chat, v_bob, 'media', v_media_path, 'image_preview', 'media',
     'variants/messages/' || v_source_chat || '/' || v_photo || '/image_preview.webp', 'image/webp', 1200, 800, 90000, 'ready', null),
    (v_photo, v_source_chat, v_bob, 'media', v_media_path, 'image_thumb', 'media',
     'variants/messages/' || v_source_chat || '/' || v_photo || '/image_thumb.webp', 'image/webp', 360, 240, 9000, 'ready', null),
    (v_photo, v_source_chat, v_bob, 'media', v_media_path, 'video_poster', 'media',
     'variants/messages/' || v_source_chat || '/' || v_photo || '/video_poster.webp', 'image/webp', null, null, null, 'failed', 'rehearsal');

  -- (a) Alice forwards the photo into the target chat.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_copy := public.forward_message(v_photo, v_target_chat, v_client, v_now, null);
  if v_copy.id is null or v_copy.id = v_photo
     or v_copy.chat_id <> v_target_chat or v_copy.user_id <> v_alice
     or v_copy.forwarded_from_id is distinct from v_photo
     or v_copy.client_message_id is distinct from v_client
     or v_copy.type <> 'image' or v_copy.content is distinct from 'Пляж'
     or v_copy.media_bucket is distinct from 'media'
     or v_copy.media_path is distinct from v_media_path
     or v_copy.media_url is distinct from ('https://example.invalid/storage/v1/object/public/media/' || v_media_path)
     or v_copy.media_metadata is distinct from v_metadata then
    raise exception '(a) the forwarded copy is not the photo with its media: %', row_to_json(v_copy);
  end if;

  -- (b) Its ready previews came with it, scoped to the target chat.
  execute 'reset role';
  select pg_catalog.count(*)::integer into v_count
    from public.media_variants as copied
    join public.media_variants as original
      on original.message_id = v_photo
     and original.variant_kind = copied.variant_kind
     and original.variant_path = copied.variant_path
     and original.source_path = copied.source_path
   where copied.message_id = v_copy.id
     and copied.chat_id = v_target_chat
     and copied.status = 'ready';
  if v_count <> 2 then
    raise exception '(b) the copy has % ready previews pointing at the photo''s files, expected 2', v_count;
  end if;
  if exists (select 1 from public.media_variants where message_id = v_copy.id and status <> 'ready') then
    raise exception '(b) a failed variant row was copied';
  end if;

  -- (c) Carol, in the target chat only, sees the copy and its previews and
  --     nothing of the source.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_carol::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_carol, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if (select pg_catalog.count(*) from public.messages where id = v_copy.id) <> 1
     or (select pg_catalog.count(*) from public.media_variants where message_id = v_copy.id) <> 2 then
    raise exception '(c) the target chat''s member cannot read the copy or its previews';
  end if;
  if (select pg_catalog.count(*) from public.messages where id = v_photo) <> 0
     or (select pg_catalog.count(*) from public.media_variants where message_id = v_photo) <> 0
     or (select pg_catalog.count(*) from public.media_variants where chat_id = v_source_chat) <> 0 then
    raise exception '(c) forwarding exposed the source chat to a member of the target';
  end if;

  -- (d) A retry with the same client id returns the first copy.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_again := public.forward_message(v_photo, v_target_chat, v_client, v_now, null);
  if v_again.id is distinct from v_copy.id then
    raise exception '(d) a retry made a second copy';
  end if;

  -- (e) A text message forwards without media or previews, into a topic of
  --     the target.
  v_again := public.forward_message(v_text, v_target_chat, null, null, v_target_topic);
  if v_again.media_url is not null or v_again.topic_id is distinct from v_target_topic then
    raise exception '(e) a forwarded text is %', row_to_json(v_again);
  end if;

  -- (f) Refusals: not a member of the target, a topic of another chat, a
  --     deleted source, a source hidden for her, a system notice.
  v_failed := false;
  begin
    perform public.forward_message(v_photo, v_other_chat, null, null, null);
  exception
    when insufficient_privilege then
      v_failed := sqlerrm = 'not_chat_member';
  end;
  if not v_failed then
    raise exception '(f) alice forwarded into a chat she is not in';
  end if;
  v_failed := false;
  begin
    perform public.forward_message(v_photo, v_target_chat, null, null, v_other_topic);
  exception
    when invalid_parameter_value then
      v_failed := sqlerrm = 'invalid_topic';
  end;
  if not v_failed then
    raise exception '(f) a forward landed in a topic of another chat';
  end if;
  v_failed := false;
  begin
    perform public.forward_message(v_gone, v_target_chat, null, null, null);
  exception
    when no_data_found then
      v_failed := sqlerrm = 'message_not_found';
  end;
  if not v_failed then
    raise exception '(f) a deleted message was forwarded';
  end if;
  v_failed := false;
  begin
    perform public.forward_message(v_hidden, v_target_chat, null, null, null);
  exception
    when no_data_found then
      v_failed := sqlerrm = 'message_not_found';
  end;
  if not v_failed then
    raise exception '(f) a message hidden for alice was forwarded by her';
  end if;
  v_failed := false;
  begin
    perform public.forward_message(v_notice, v_target_chat, null, null, null);
  exception
    when invalid_parameter_value then
      v_failed := sqlerrm = 'message_not_forwardable';
  end;
  if not v_failed then
    raise exception '(f) a system notice was forwarded';
  end if;

  -- (g) A message from before her cleared history is not hers to forward.
  execute 'reset role';
  update public.chat_members set cleared_at = v_now where chat_id = v_source_chat and user_id = v_alice;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    perform public.forward_message(v_photo, v_target_chat, null, null, null);
  exception
    when no_data_found then
      v_failed := sqlerrm = 'message_not_found';
  end;
  if not v_failed then
    raise exception '(g) a message from before the cleared history was forwarded';
  end if;
  execute 'reset role';
  update public.chat_members set cleared_at = null where chat_id = v_source_chat and user_id = v_alice;

  -- (h) Muted in the target: refused, as a direct send would be.
  insert into public.mutes (user_id, chat_id, reason) values (v_alice, v_target_chat, 'rehearsal');
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    perform public.forward_message(v_photo, v_target_chat, null, null, null);
  exception
    when insufficient_privilege then
      v_failed := sqlerrm = 'user_muted';
  end;
  if not v_failed then
    raise exception '(h) a muted member forwarded into the chat';
  end if;
  execute 'reset role';
  delete from public.mutes where user_id = v_alice and chat_id = v_target_chat;

  -- (i) A stranger, and an unknown id, get the same answer.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    perform public.forward_message(v_photo, v_target_chat, null, null, null);
  exception
    when no_data_found then
      v_failed := sqlerrm = 'message_not_found';
  end;
  if not v_failed then
    raise exception '(i) a stranger forwarded a message from a chat they are not in';
  end if;
  v_failed := false;
  begin
    perform public.forward_message(gen_random_uuid(), v_target_chat, null, null, null);
  exception
    when no_data_found then
      v_failed := sqlerrm = 'message_not_found';
  end;
  if not v_failed then
    raise exception '(i) an unknown message id was not answered like a stranger''s';
  end if;

  -- (j) anon cannot call it.
  execute 'reset role';
  execute 'set local role anon';
  v_failed := false;
  begin
    perform public.forward_message(v_photo, v_target_chat, null, null, null);
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(j) anon can call forward_message';
  end if;
  execute 'reset role';
end
$test$;

select 'rehearsal passed: 20260911144000_forward_message_with_media' as result;

rollback;
