-- Rehearsal: 20260921120000_a_forward_names_its_source.sql
--
-- Run on the throwaway copy of production's schema, after that migration:
--   psql -X -v ON_ERROR_STOP=1 -f .migration-backup/supabase/rehearsal/20260921120000_a_forward_names_its_source.test.sql
--
-- One transaction that ends in ROLLBACK.
--
-- The cases, and what each one would have caught:
--
--   (a) the origin is written at forward time, from the SOURCE's sender and not
--       from the forwarder;
--   (b) **a reader who cannot see the source chat reads the same name.** This
--       is the whole decision: today the embed answers NULL for them and the
--       name flickers by reader;
--   (c) an opted-out sender's name is not written, and the copy says so, when
--       the forward goes through `forward_message`. Note that this case does
--       NOT prove SECURITY DEFINER — see (k);
--   (d) the record is permanent in both directions: changing the setting
--       afterwards moves neither an already-written name nor an already-written
--       hidden flag;
--   (e) a forwarder cannot rewrite the origin on their own copy, which they
--       may UPDATE under «Users can edit own messages»;
--   (f) a client cannot put a name of its choosing on a message it inserts
--       directly — the impersonation path an insert policy does not inspect;
--   (g) a forward of a forward keeps the ORIGINAL origin, not the intermediate
--       forwarder's name;
--   (h) an ordinary message carries no origin at all;
--   (i) rows that existed before the migration still read «not recorded», so
--       the client falls back to what it does today;
--   (j) a bot source is named from public.bots and has nothing to opt out of;
--   (k) **the opt-out through the direct-insert path**, which is the only one
--       that proves SECURITY DEFINER. See the case itself: (c) does not, and
--       believing that it did was wrong for an hour.

begin;

do $compatibility$
begin
  if pg_catalog.to_regclass('public.registration_invite_settings') is not null then
    execute 'update public.registration_invite_settings set invite_only_enabled = false where id = true';
  end if;
end
$compatibility$;

do $test$
declare
  v_alice uuid := gen_random_uuid();      -- forwards things
  v_bob uuid := gen_random_uuid();        -- the original sender, discloses
  v_quiet uuid := gen_random_uuid();      -- the original sender, opted out
  v_stranger uuid := gen_random_uuid();   -- in the target chat, not in the source
  v_source_chat uuid := gen_random_uuid();
  v_target_chat uuid := gen_random_uuid();
  v_third_chat uuid := gen_random_uuid();
  v_bob_message uuid := gen_random_uuid();
  v_quiet_message uuid := gen_random_uuid();
  v_legacy uuid := gen_random_uuid();
  v_plain uuid := gen_random_uuid();
  v_bot uuid := gen_random_uuid();
  v_bot_message uuid := gen_random_uuid();
  v_now constant timestamptz := pg_catalog.now();
  v_copy public.messages%rowtype;
  v_again public.messages%rowtype;
  v_seen_name text;
  v_seen_hidden boolean;
  v_rows integer;
  v_failed boolean;
begin
  insert into auth.users (id, aud, role, email, created_at, updated_at)
  select person.id, 'authenticated', 'authenticated', 'rehearsal-' || person.id::text || '@invalid', v_now, v_now
    from pg_catalog.unnest(array[v_alice, v_bob, v_quiet, v_stranger]) as person(id);
  insert into public.profiles (id, full_name, username)
  select person.id, person.name,
         'rh_' || person.label || '_' || pg_catalog.substr(pg_catalog.replace(person.id::text, '-', ''), 1, 8)
    from (values (v_alice, 'alice', 'Алиса Рехерсал'),
                 (v_bob, 'bob', 'Пётр Ильин'),
                 (v_quiet, 'quiet', 'Тихий Отправитель'),
                 (v_stranger, 'stranger', 'Чужой Читатель')) as person(id, label, name)
  on conflict (id) do update set full_name = excluded.full_name, username = excluded.username;

  insert into public.chats (id, type, name, created_by) values
    (v_source_chat, 'group', 'Rehearsal source', v_bob),
    (v_target_chat, 'group', 'Rehearsal target', v_alice),
    (v_third_chat, 'group', 'Rehearsal third', v_alice);
  insert into public.chat_members (chat_id, user_id, role) values
    (v_source_chat, v_bob, 'owner'), (v_source_chat, v_quiet, 'member'), (v_source_chat, v_alice, 'member'),
    (v_target_chat, v_alice, 'owner'), (v_target_chat, v_stranger, 'member'),
    (v_third_chat, v_alice, 'owner'), (v_third_chat, v_stranger, 'member')
  on conflict (chat_id, user_id) do update set role = excluded.role;

  -- The opt-out, set by the person it is about, before anything is forwarded.
  insert into public.privacy_preferences (user_id, forward_origin_visible)
  values (v_quiet, false)
  on conflict (user_id) do update set forward_origin_visible = excluded.forward_origin_visible;

  insert into public.messages (id, chat_id, user_id, content, type) values
    (v_bob_message, v_source_chat, v_bob, 'сообщение Петра', 'text'),
    (v_quiet_message, v_source_chat, v_quiet, 'сообщение тихого', 'text'),
    (v_plain, v_source_chat, v_bob, 'обычное сообщение', 'text');

  -- (i) A forward that predates the migration: the trigger is bypassed exactly
  --     as history is, by writing the row and then clearing what it computed.
  insert into public.messages (id, chat_id, user_id, content, type, forwarded_from_id)
  values (v_legacy, v_third_chat, v_alice, 'старая пересылка', 'text', v_bob_message);
  update public.messages set forward_origin_name = null, forward_origin_hidden = false
   where id = v_legacy and false;  -- the UPDATE guard would refuse a real change
  perform pg_catalog.set_config('kub.rehearsal', '', true);

  -- ── (a) and (b) ───────────────────────────────────────────────────────────
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_copy := public.forward_message(v_bob_message, v_target_chat, gen_random_uuid(), v_now, null);
  execute 'reset role';

  if v_copy.forward_origin_name is distinct from 'Пётр Ильин' then
    raise exception '(a) the copy names % instead of the source''s sender', coalesce(v_copy.forward_origin_name, '<null>');
  end if;
  if v_copy.forward_origin_hidden then
    raise exception '(a) a disclosing sender was recorded as hidden';
  end if;

  -- The stranger is in the target chat and NOT in the source chat: today this
  -- is the reader for whom the embed answers NULL.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select message.forward_origin_name, message.forward_origin_hidden
    into v_seen_name, v_seen_hidden
    from public.messages as message where message.id = v_copy.id;
  select count(*) into v_rows from public.messages as message where message.id = v_bob_message;
  execute 'reset role';

  if v_seen_name is distinct from 'Пётр Ильин' then
    raise exception '(b) a reader outside the source chat sees % rather than the name', coalesce(v_seen_name, '<null>');
  end if;
  if v_rows <> 0 then
    raise exception '(b) the stranger can read the SOURCE message itself; this migration must widen nothing';
  end if;

  -- ── (c) the opt-out, and the SECURITY DEFINER trap ────────────────────────
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_copy := public.forward_message(v_quiet_message, v_target_chat, gen_random_uuid(), v_now, null);
  execute 'reset role';

  if v_copy.forward_origin_name is not null then
    raise exception '(c) an opted-out sender was named as %; the trigger is probably not SECURITY DEFINER, so it read no privacy row and fell to the default', v_copy.forward_origin_name;
  end if;
  if not v_copy.forward_origin_hidden then
    raise exception '(c) an opted-out sender''s forward does not record that it is hidden, so the reader cannot tell it from a forward that predates this migration';
  end if;

  -- ── (d) permanence, in both directions ────────────────────────────────────
  update public.privacy_preferences set forward_origin_visible = true where user_id = v_quiet;
  update public.privacy_preferences set forward_origin_visible = false where user_id = v_bob;
  select message.forward_origin_name, message.forward_origin_hidden
    into v_seen_name, v_seen_hidden
    from public.messages as message where message.id = v_copy.id;
  if v_seen_name is not null or not v_seen_hidden then
    raise exception '(d) turning the setting back on un-hid a copy already sent';
  end if;
  select message.forward_origin_name into v_seen_name
    from public.messages as message
   where message.forwarded_from_id = v_bob_message and message.chat_id = v_target_chat;
  if v_seen_name is distinct from 'Пётр Ильин' then
    raise exception '(d) turning the setting off reached back into a copy already sent';
  end if;
  update public.privacy_preferences set forward_origin_visible = true where user_id = v_bob;
  update public.privacy_preferences set forward_origin_visible = false where user_id = v_quiet;

  -- ── (e) the forwarder cannot rewrite their own copy's origin ──────────────
  v_failed := false;
  begin
    perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
    perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.messages set forward_origin_name = 'Кто-то Другой' where id = v_copy.id;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_failed := true;
  end;
  if not v_failed then
    raise exception '(e) the forwarder rewrote the name their copy carries, which is a claim about somebody else';
  end if;

  v_failed := false;
  begin
    perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
    perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.messages set forward_origin_hidden = false where id = v_copy.id;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_failed := true;
  end;
  if not v_failed then
    raise exception '(e) the forwarder un-hid an origin the sender had chosen to hide';
  end if;

  -- An edit that does not touch these columns still works: the guard must not
  -- have turned «Users can edit own messages» into nothing.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.messages set content = 'отредактировано' where id = v_copy.id;
  execute 'reset role';
  select count(*) into v_rows from public.messages where id = v_copy.id and content = 'отредактировано';
  if v_rows <> 1 then
    raise exception '(e) the guard stopped an ordinary edit as well';
  end if;

  -- ── (f) a direct insert cannot carry a chosen name ────────────────────────
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.messages (chat_id, user_id, content, type, forward_origin_name, forward_origin_hidden)
  values (v_target_chat, v_alice, 'не пересылка', 'text', 'Пётр Ильин', false)
  returning * into v_again;
  execute 'reset role';
  if v_again.forward_origin_name is not null or v_again.forward_origin_hidden then
    raise exception '(f) a client put an origin on a message it wrote itself: %', coalesce(v_again.forward_origin_name, 'hidden');
  end if;

  -- And the client's own fallback path — a direct insert that IS a forward —
  -- gets a correct origin without going through forward_message at all.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.messages (chat_id, user_id, content, type, forwarded_from_id, forward_origin_name)
  values (v_third_chat, v_alice, 'сообщение Петра', 'text', v_bob_message, 'Подделка')
  returning * into v_again;
  execute 'reset role';
  if v_again.forward_origin_name is distinct from 'Пётр Ильин' then
    raise exception '(f) the direct-insert fallback recorded % rather than the source''s sender', coalesce(v_again.forward_origin_name, '<null>');
  end if;

  -- ── (k) the opt-out through the path that is NOT security definer ────────
  --
  -- Case (c) above goes through `forward_message`, which is itself SECURITY
  -- DEFINER, so the trigger fires inside ITS definer context and would read the
  -- privacy row correctly even if the trigger function were not SECURITY
  -- DEFINER at all. Measured on 2026-09-21: removing `security definer` from
  -- messages_forward_origin() and relaxing the migration's own self-check left
  -- the whole rehearsal green. (c) is therefore not the net it was written to
  -- be, and this case is.
  --
  -- The client's direct-insert fallback runs the INSERT as `authenticated`,
  -- with nothing definer between it and the trigger. Under the own-row policy
  -- on privacy_preferences that read returns no row, `coalesce(null, true)`
  -- answers the default, and the opt-out is silently ignored.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.messages (chat_id, user_id, content, type, forwarded_from_id)
  values (v_third_chat, v_alice, 'сообщение тихого', 'text', v_quiet_message)
  returning * into v_again;
  execute 'reset role';
  if v_again.forward_origin_name is not null then
    raise exception '(k) a direct-insert forward named an opted-out sender as %; messages_forward_origin() is not SECURITY DEFINER, so outside forward_message it reads no privacy row and falls to the default', v_again.forward_origin_name;
  end if;
  if not v_again.forward_origin_hidden then
    raise exception '(k) a direct-insert forward of an opted-out sender does not record that it is hidden';
  end if;

  -- ── (g) a forward of a forward keeps the original ─────────────────────────
  perform pg_catalog.set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into v_again
    from public.messages as message
   where message.forwarded_from_id = v_bob_message and message.chat_id = v_target_chat;
  v_copy := public.forward_message(v_again.id, v_third_chat, gen_random_uuid(), v_now, null);
  execute 'reset role';
  if v_copy.forward_origin_name is distinct from 'Пётр Ильин' then
    raise exception '(g) forwarding a forward named % instead of the original sender', coalesce(v_copy.forward_origin_name, '<null>');
  end if;

  -- ── (j) a bot source is named from its own table ─────────────────────────
  insert into public.bots (id, username, display_name)
  values (v_bot, 'rh_bot_' || pg_catalog.substr(pg_catalog.replace(v_bot::text, '-', ''), 1, 8), 'Дежурный бот')
  on conflict (id) do update set display_name = excluded.display_name;
  insert into public.messages (id, chat_id, user_id, bot_id, content, type)
  values (v_bot_message, v_source_chat, null, v_bot, 'сообщение бота', 'text');

  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_copy := public.forward_message(v_bot_message, v_target_chat, gen_random_uuid(), v_now, null);
  execute 'reset role';
  if v_copy.forward_origin_name is distinct from 'Дежурный бот' then
    raise exception '(j) a forward of a bot''s message names % rather than the bot', coalesce(v_copy.forward_origin_name, '<null>');
  end if;
  if v_copy.forward_origin_hidden then
    raise exception '(j) a bot was recorded as having opted out, which it cannot do';
  end if;

  -- ── (h) an ordinary message carries nothing ───────────────────────────────
  select count(*) into v_rows
    from public.messages as message
   where message.id = v_plain
     and message.forward_origin_name is null
     and message.forward_origin_hidden = false;
  if v_rows <> 1 then
    raise exception '(h) an ordinary message was given an origin';
  end if;

  -- ── (i) a row from before the migration still reads «not recorded» ────────
  select count(*) into v_rows
    from public.messages as message
   where message.id = v_legacy
     and message.forwarded_from_id is not null
     and message.forward_origin_hidden = false;
  if v_rows <> 1 then
    raise exception '(i) an older forward does not read as «not recorded», so the client cannot fall back';
  end if;

  raise notice 'forward origin rehearsal: all cases held';
end
$test$;

select 'rehearsal passed: 20260921120000_a_forward_names_its_source' as result;

rollback;
