-- Rehearsal: 20260911142000_one_reaction_per_person.sql
--
-- Run on the throwaway copy of production's schema, after that migration:
--   psql -X -v ON_ERROR_STOP=1 -f .migration-backup/supabase/rehearsal/20260911142000_one_reaction_per_person.test.sql
--
-- One transaction that ends in ROLLBACK, with its own users, group and
-- messages. What one session cannot show is two devices racing; the advisory
-- lock that serialises them is covered by the migration's own description and
-- by the trigger holding the limit for a second insert.

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
  v_mallory uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_chat uuid := gen_random_uuid();
  v_message uuid := gen_random_uuid();
  v_deleted uuid := gen_random_uuid();
  v_system uuid := gen_random_uuid();
  v_now constant timestamptz := pg_catalog.now();
  v_total integer;
  v_mine integer;
  v_emoji text;
  v_failed boolean;
begin
  -- Only columns that the auth.users of production and of the rehearsal image both have.
  insert into auth.users (id, aud, role, email, created_at, updated_at)
  select person.id, 'authenticated', 'authenticated', 'rehearsal-' || person.id::text || '@invalid', v_now, v_now
    from pg_catalog.unnest(array[v_alice, v_bob, v_mallory, v_stranger]) as person(id);
  insert into public.profiles (id, full_name, username)
  select person.id, 'Rehearsal ' || person.label, 'rh_' || person.label || '_' || pg_catalog.substr(pg_catalog.replace(person.id::text, '-', ''), 1, 8)
    from (values (v_alice, 'alice'), (v_bob, 'bob'), (v_mallory, 'mallory'), (v_stranger, 'stranger')) as person(id, label)
  on conflict (id) do update set full_name = excluded.full_name, username = excluded.username;
  insert into public.chats (id, type, name, created_by) values (v_chat, 'group', 'Rehearsal reactions', v_bob);
  insert into public.chat_members (chat_id, user_id, role)
  values (v_chat, v_bob, 'owner'), (v_chat, v_alice, 'member'), (v_chat, v_mallory, 'member')
  on conflict (chat_id, user_id) do update set role = excluded.role;
  insert into public.messages (id, chat_id, user_id, content, type) values
    (v_message, v_chat, v_bob, 'rehearsal reactable', 'text'),
    (v_deleted, v_chat, v_bob, 'rehearsal deleted', 'text');
  insert into public.messages (id, chat_id, user_id, content, type) values
    (v_system, v_chat, null, 'rehearsal notice', 'system');
  update public.messages set deleted_at = v_now where id = v_deleted;

  -- (a) Alice puts 👍.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (where reaction.user_id = v_alice and reaction.emoji = '👍')::integer
    into v_total, v_mine
    from public.set_message_reaction(v_message, '👍') as reaction;
  if v_total <> 1 or v_mine <> 1 then
    raise exception '(a) after 👍 the message has % reactions, % of them alice''s 👍', v_total, v_mine;
  end if;

  -- (b) Another emoji replaces it.
  perform * from public.set_message_reaction(v_message, '❤️');
  select pg_catalog.count(*)::integer, pg_catalog.min(reaction.emoji) into v_mine, v_emoji
    from public.reactions as reaction
   where reaction.message_id = v_message and reaction.user_id = v_alice;
  if v_mine <> 1 or v_emoji <> '❤️' then
    raise exception '(b) choosing ❤️ left alice with % reactions (%)', v_mine, v_emoji;
  end if;

  -- (c) The same emoji again removes it.
  perform * from public.set_message_reaction(v_message, '❤️');
  if exists (select 1 from public.reactions as reaction where reaction.message_id = v_message and reaction.user_id = v_alice) then
    raise exception '(c) choosing ❤️ again did not remove it';
  end if;

  -- (d) Someone else's reaction is not touched.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_bob::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform * from public.set_message_reaction(v_message, '👍');
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform * from public.set_message_reaction(v_message, '😂');
  if not exists (select 1 from public.reactions as reaction where reaction.message_id = v_message and reaction.user_id = v_bob and reaction.emoji = '👍') then
    raise exception '(d) alice''s reaction removed bob''s';
  end if;

  -- (e) An unupdated client inserts a second emoji directly: refused.
  v_failed := false;
  begin
    insert into public.reactions (message_id, user_id, emoji) values (v_message, v_alice, '🔥');
  exception
    when raise_exception then
      v_failed := sqlerrm = 'reaction_limit_reached';
  end;
  if not v_failed then
    raise exception '(e) a direct insert gave alice a second reaction on the message';
  end if;

  -- (f) Its own flow — delete, then insert — still works.
  delete from public.reactions where message_id = v_message and user_id = v_alice;
  insert into public.reactions (message_id, user_id, emoji) values (v_message, v_alice, '🔥');
  select pg_catalog.count(*)::integer into v_mine from public.reactions as reaction
   where reaction.message_id = v_message and reaction.user_id = v_alice;
  if v_mine <> 1 then
    raise exception '(f) the old client''s delete-then-insert left alice with % reactions', v_mine;
  end if;

  -- (g) The limit, as the caller sees it.
  if public.reaction_limit_per_message() <> 1 then
    raise exception '(g) reaction_limit_per_message() is not 1';
  end if;

  -- (h) A deleted message, a system notice and a bad emoji are refused.
  v_failed := false;
  begin
    perform * from public.set_message_reaction(v_deleted, '👍');
  exception
    when invalid_parameter_value then
      v_failed := sqlerrm = 'message_not_reactable';
  end;
  if not v_failed then
    raise exception '(h) a reaction was put on a deleted message';
  end if;
  v_failed := false;
  begin
    perform * from public.set_message_reaction(v_system, '👍');
  exception
    when invalid_parameter_value then
      v_failed := sqlerrm = 'message_not_reactable';
  end;
  if not v_failed then
    raise exception '(h) a reaction was put on a system notice';
  end if;
  v_failed := false;
  begin
    perform * from public.set_message_reaction(v_message, '   ');
  exception
    when invalid_parameter_value then
      v_failed := sqlerrm = 'invalid_emoji';
  end;
  if not v_failed then
    raise exception '(h) a blank emoji was accepted';
  end if;
  v_failed := false;
  begin
    perform * from public.set_message_reaction(v_message, pg_catalog.repeat('a', 17));
  exception
    when invalid_parameter_value then
      v_failed := sqlerrm = 'invalid_emoji';
  end;
  if not v_failed then
    raise exception '(h) a seventeen-character "emoji" was accepted';
  end if;

  -- (i) A stranger, and an unknown id, get the same answer.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    perform * from public.set_message_reaction(v_message, '👍');
  exception
    when no_data_found then
      v_failed := sqlerrm = 'message_not_found';
  end;
  if not v_failed then
    raise exception '(i) a stranger reacted to a message in a chat they are not in';
  end if;
  v_failed := false;
  begin
    perform * from public.set_message_reaction(gen_random_uuid(), '👍');
  exception
    when no_data_found then
      v_failed := sqlerrm = 'message_not_found';
  end;
  if not v_failed then
    raise exception '(i) an unknown message id was not answered like a stranger''s';
  end if;

  -- (j) A banned member is refused.
  execute 'reset role';
  -- A sanction is made by a session without a user, which enforce_sanction_matrix lets through.
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);
  insert into public.bans (user_id, reason) values (v_mallory, 'rehearsal');
  perform pg_catalog.set_config('request.jwt.claim.sub', v_mallory::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_mallory, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    perform * from public.set_message_reaction(v_message, '👍');
  exception
    when insufficient_privilege then
      v_failed := sqlerrm = 'user_banned';
  end;
  if not v_failed then
    raise exception '(j) a banned member reacted';
  end if;

  -- (k) The uniqueness on (message, person, emoji) is still there.
  execute 'reset role';
  v_failed := false;
  begin
    insert into public.reactions (message_id, user_id, emoji) values (v_message, v_alice, '🔥');
  exception
    when unique_violation then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(k) the same emoji from the same person was stored twice';
  end if;

  -- (l) anon cannot call it.
  execute 'set local role anon';
  v_failed := false;
  begin
    perform * from public.set_message_reaction(v_message, '👍');
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(l) anon can call set_message_reaction';
  end if;
  execute 'reset role';
end
$test$;

select 'rehearsal passed: 20260911142000_one_reaction_per_person' as result;

rollback;
