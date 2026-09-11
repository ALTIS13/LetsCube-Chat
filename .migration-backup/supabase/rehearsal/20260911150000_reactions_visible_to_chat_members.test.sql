-- Rehearsal: 20260911150000_reactions_visible_to_chat_members.sql
--
-- Run on the throwaway copy of production's schema, after that migration:
--   psql -X -v ON_ERROR_STOP=1 -f .migration-backup/supabase/rehearsal/20260911150000_reactions_visible_to_chat_members.test.sql
--
-- One transaction that ends in ROLLBACK, with its own people, chats and
-- messages. What one session cannot show is Realtime's delivery, which applies
-- the same read policy per subscriber.

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
  v_stranger uuid := gen_random_uuid();
  v_chat uuid := gen_random_uuid();
  v_other_chat uuid := gen_random_uuid();
  v_message uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_deleted uuid := gen_random_uuid();
  v_system uuid := gen_random_uuid();
  v_elsewhere uuid := gen_random_uuid();
  v_now constant timestamptz := pg_catalog.now();
  v_count integer;
  v_emoji text;
  v_failed boolean;
begin
  -- Only columns that the auth.users of production and of the rehearsal image both have.
  insert into auth.users (id, aud, role, email, created_at, updated_at)
  select person.id, 'authenticated', 'authenticated', 'rehearsal-' || person.id::text || '@invalid', v_now, v_now
    from pg_catalog.unnest(array[v_alice, v_bob, v_stranger]) as person(id);
  insert into public.profiles (id, full_name, username)
  select person.id, 'Rehearsal ' || person.label, 'rh_' || person.label || '_' || pg_catalog.substr(pg_catalog.replace(person.id::text, '-', ''), 1, 8)
    from (values (v_alice, 'alice'), (v_bob, 'bob'), (v_stranger, 'stranger')) as person(id, label)
  on conflict (id) do update set full_name = excluded.full_name, username = excluded.username;
  insert into public.chats (id, type, name, created_by) values
    (v_chat, 'group', 'Rehearsal reaction visibility', v_bob),
    (v_other_chat, 'group', 'Rehearsal elsewhere', v_stranger);
  insert into public.chat_members (chat_id, user_id, role)
  values (v_chat, v_bob, 'owner'), (v_chat, v_alice, 'member'), (v_other_chat, v_stranger, 'owner')
  on conflict (chat_id, user_id) do update set role = excluded.role;
  insert into public.messages (id, chat_id, user_id, content, type) values
    (v_message, v_chat, v_bob, 'rehearsal reactable', 'text'),
    (v_second, v_chat, v_bob, 'rehearsal second', 'text'),
    (v_deleted, v_chat, v_bob, 'rehearsal deleted', 'text'),
    (v_elsewhere, v_other_chat, v_stranger, 'rehearsal elsewhere', 'text');
  insert into public.messages (id, chat_id, user_id, content, type) values
    (v_system, v_chat, null, 'rehearsal notice', 'system');
  update public.messages set deleted_at = v_now where id = v_deleted;
  insert into public.reactions (message_id, user_id, emoji) values
    (v_message, v_bob, '👍'),
    (v_elsewhere, v_stranger, '🔥');

  -- (a) A member reads the reactions on their chat's message.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select pg_catalog.count(*)::integer into v_count from public.reactions where message_id = v_message;
  if v_count <> 1 then
    raise exception '(a) a member of the chat sees % reactions on its message, expected 1', v_count;
  end if;

  -- (b) Not those of a chat they are not in, even asked for by id.
  select pg_catalog.count(*)::integer into v_count from public.reactions where message_id = v_elsewhere;
  if v_count <> 0 then
    raise exception '(b) a member of one chat reads % reactions of a chat they are not in', v_count;
  end if;
  select pg_catalog.count(*)::integer into v_count from public.reactions;
  if v_count <> 1 then
    raise exception '(b) a member of one chat reads % reactions in all, expected the 1 of their chat', v_count;
  end if;

  -- (c) The page a chat loads, messages with their reactions, carries them.
  select pg_catalog.count(*)::integer into v_count
    from public.messages as message
    join public.reactions as reaction on reaction.message_id = message.id
   where message.chat_id = v_chat;
  if v_count <> 1 then
    raise exception '(c) the chat''s messages come with % reactions, expected 1', v_count;
  end if;

  -- (d) A member adds their own reaction.
  insert into public.reactions (message_id, user_id, emoji) values (v_message, v_alice, '❤️');
  select pg_catalog.count(*)::integer into v_count from public.reactions where message_id = v_message;
  if v_count <> 2 then
    raise exception '(d) after alice''s reaction the message has % reactions, expected 2', v_count;
  end if;

  -- (e) Not in someone else's name.
  v_failed := false;
  begin
    insert into public.reactions (message_id, user_id, emoji) values (v_second, v_bob, '😂');
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(e) alice put a reaction in bob''s name';
  end if;

  -- (f) Not on a deleted message, and not on a system notice.
  v_failed := false;
  begin
    insert into public.reactions (message_id, user_id, emoji) values (v_deleted, v_alice, '👍');
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(f) a reaction was put on a deleted message';
  end if;
  v_failed := false;
  begin
    insert into public.reactions (message_id, user_id, emoji) values (v_system, v_alice, '👍');
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(f) a reaction was put on a system notice';
  end if;

  -- (g) A stranger to the chat neither reads its reactions nor adds one.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select pg_catalog.count(*)::integer into v_count from public.reactions where message_id = v_message;
  if v_count <> 0 then
    raise exception '(g) a stranger reads % reactions on a message of a chat they are not in', v_count;
  end if;
  v_failed := false;
  begin
    insert into public.reactions (message_id, user_id, emoji) values (v_message, v_stranger, '👍');
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(g) a stranger put a reaction on a message of a chat they are not in';
  end if;

  -- (h) ... while their own chat's reactions are theirs to read.
  select pg_catalog.count(*)::integer into v_count from public.reactions where message_id = v_elsewhere;
  if v_count <> 1 then
    raise exception '(h) the stranger sees % reactions in their own chat, expected 1', v_count;
  end if;

  -- (i) Nobody signed out reads or writes a reaction.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  v_failed := false;
  begin
    perform 1 from public.reactions limit 1;
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(i) anon can read public.reactions';
  end if;
  v_failed := false;
  begin
    insert into public.reactions (message_id, user_id, emoji) values (v_second, v_bob, '👍');
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(i) anon can insert into public.reactions';
  end if;

  -- (j) The one-call toggle still works for a member, where it is deployed.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if pg_catalog.to_regprocedure('public.set_message_reaction(uuid,text)') is not null then
    perform * from public.set_message_reaction(v_message, '👍');
    select pg_catalog.count(*)::integer, pg_catalog.min(reaction.emoji) into v_count, v_emoji
      from public.reactions as reaction
     where reaction.message_id = v_message and reaction.user_id = v_alice;
    if v_count <> 1 or v_emoji <> '👍' then
      raise exception '(j) set_message_reaction left alice with % reactions (%)', v_count, v_emoji;
    end if;
  end if;

  -- (k) A member removes their own reaction, and only their own.
  delete from public.reactions where message_id = v_message;
  execute 'reset role';
  select pg_catalog.count(*)::integer into v_count from public.reactions where message_id = v_message and user_id = v_alice;
  if v_count <> 0 then
    raise exception '(k) alice''s reaction was not removed';
  end if;
  select pg_catalog.count(*)::integer into v_count from public.reactions where message_id = v_message and user_id = v_bob;
  if v_count <> 1 then
    raise exception '(k) alice removed bob''s reaction';
  end if;
end
$test$;

select 'rehearsal passed: 20260911150000_reactions_visible_to_chat_members' as result;

rollback;
