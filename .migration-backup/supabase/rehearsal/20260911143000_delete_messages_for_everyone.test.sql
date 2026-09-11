-- Rehearsal: 20260911143000_delete_messages_for_everyone.sql
--
-- Run on the throwaway copy of production's schema, after that migration:
--   psql -X -v ON_ERROR_STOP=1 -f .migration-backup/supabase/rehearsal/20260911143000_delete_messages_for_everyone.test.sql
--
-- One transaction that ends in ROLLBACK, with its own users, a private chat, a
-- group, and messages of every author.

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
  v_private uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_pa1 uuid := gen_random_uuid();
  v_pa2 uuid := gen_random_uuid();
  v_pb1 uuid := gen_random_uuid();
  v_psys uuid := gen_random_uuid();
  v_ga1 uuid := gen_random_uuid();
  v_ga2 uuid := gen_random_uuid();
  v_gb1 uuid := gen_random_uuid();
  v_now constant timestamptz := pg_catalog.now();
  v_ids uuid[];
  v_deleted_at timestamptz;
  v_first_deleted_at timestamptz;
  v_count integer;
  v_log record;
  v_failed boolean;
  v_many uuid[];
begin
  -- Only columns that the auth.users of production and of the rehearsal image both have.
  insert into auth.users (id, aud, role, email, created_at, updated_at)
  select person.id, 'authenticated', 'authenticated', 'rehearsal-' || person.id::text || '@invalid', v_now, v_now
    from pg_catalog.unnest(array[v_alice, v_bob, v_carol, v_stranger]) as person(id);
  insert into public.profiles (id, full_name, username)
  select person.id, 'Rehearsal ' || person.label, 'rh_' || person.label || '_' || pg_catalog.substr(pg_catalog.replace(person.id::text, '-', ''), 1, 8)
    from (values (v_alice, 'alice'), (v_bob, 'bob'), (v_carol, 'carol'), (v_stranger, 'stranger')) as person(id, label)
  on conflict (id) do update set full_name = excluded.full_name, username = excluded.username;
  insert into public.chats (id, type, name, created_by) values (v_private, 'private', 'Rehearsal private', v_alice);
  insert into public.chats (id, type, name, created_by) values (v_group, 'group', 'Rehearsal group', v_carol);
  insert into public.chat_members (chat_id, user_id, role)
  values (v_private, v_alice, 'owner'), (v_private, v_bob, 'member'),
         (v_group, v_carol, 'owner'), (v_group, v_alice, 'member'), (v_group, v_bob, 'member')
  on conflict (chat_id, user_id) do update set role = excluded.role;
  insert into public.messages (id, chat_id, user_id, content, type) values
    (v_pa1, v_private, v_alice, 'rehearsal pa1', 'text'),
    (v_pa2, v_private, v_alice, 'rehearsal pa2', 'text'),
    (v_pb1, v_private, v_bob, 'rehearsal pb1', 'text'),
    (v_ga1, v_group, v_alice, 'rehearsal ga1', 'text'),
    (v_ga2, v_group, v_alice, 'rehearsal ga2', 'text'),
    (v_gb1, v_group, v_bob, 'rehearsal gb1', 'text');
  insert into public.messages (id, chat_id, user_id, content, type) values
    (v_psys, v_private, null, 'rehearsal notice', 'system');

  -- (a) Alice deletes Bob's message in their private chat, for both.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select pg_catalog.array_agg(deleted.id) into v_ids from public.delete_messages_for_everyone(array[v_pb1]) as deleted(id);
  if v_ids is distinct from array[v_pb1] then
    raise exception '(a) deleting pb1 returned %', v_ids;
  end if;
  execute 'reset role';
  select deleted_at into v_first_deleted_at from public.messages where id = v_pb1;
  if v_first_deleted_at is null then
    raise exception '(a) bob''s message was not deleted';
  end if;
  select * into v_log from private.message_deletions where message_id = v_pb1;
  if not found or v_log.deleted_by <> v_alice or v_log.author_id <> v_bob or v_log.chat_type <> 'private'
     or v_log.chat_id <> v_private or v_log.deleted_at <> v_first_deleted_at then
    raise exception '(a) the deletion of pb1 was not recorded as alice deleting bob''s message: %', row_to_json(v_log);
  end if;

  -- (b) Bob deletes Alice's, the other way round.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_bob::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform * from public.delete_messages_for_everyone(array[v_pa1]);
  execute 'reset role';
  if (select deleted_at from public.messages where id = v_pa1) is null then
    raise exception '(b) bob could not delete alice''s message in their private chat';
  end if;

  -- (c) Deleting again changes nothing and is still reported.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select pg_catalog.array_agg(deleted.id) into v_ids from public.delete_messages_for_everyone(array[v_pb1, v_pb1]) as deleted(id);
  if v_ids is distinct from array[v_pb1] then
    raise exception '(c) deleting pb1 again returned %', v_ids;
  end if;
  execute 'reset role';
  select deleted_at into v_deleted_at from public.messages where id = v_pb1;
  select pg_catalog.count(*)::integer into v_count from private.message_deletions where message_id = v_pb1;
  if v_deleted_at is distinct from v_first_deleted_at or v_count <> 1 then
    raise exception '(c) a second deletion rewrote the first (deleted_at %, % log rows)', v_deleted_at, v_count;
  end if;

  -- (d) A system notice in a private chat is not anyone's to delete.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    perform * from public.delete_messages_for_everyone(array[v_psys]);
  exception
    when insufficient_privilege then
      v_failed := sqlerrm = 'message_not_deletable';
  end;
  if not v_failed then
    raise exception '(d) a system notice was deleted for everyone';
  end if;

  -- (e) In a group, someone else's message is refused and left alone.
  v_failed := false;
  begin
    perform * from public.delete_messages_for_everyone(array[v_gb1]);
  exception
    when insufficient_privilege then
      v_failed := sqlerrm = 'message_not_deletable';
  end;
  if not v_failed then
    raise exception '(e) alice deleted bob''s message in a group';
  end if;

  -- (f) Her own group message goes.
  perform * from public.delete_messages_for_everyone(array[v_ga1]);

  -- (g) One call, one chat.
  v_failed := false;
  begin
    perform * from public.delete_messages_for_everyone(array[v_ga2, v_pa2]);
  exception
    when invalid_parameter_value then
      v_failed := sqlerrm = 'messages_span_chats';
  end;
  if not v_failed then
    raise exception '(g) one call deleted messages from two chats';
  end if;

  -- (h) All or nothing: a batch with an unknown id deletes none of it.
  v_failed := false;
  begin
    perform * from public.delete_messages_for_everyone(array[v_pa2, gen_random_uuid()]);
  exception
    when no_data_found then
      v_failed := sqlerrm = 'message_not_found';
  end;
  if not v_failed then
    raise exception '(h) a batch with an unknown id was accepted';
  end if;

  -- (i) Size limits and an empty call.
  select pg_catalog.array_agg(gen_random_uuid()) into v_many from pg_catalog.generate_series(1, 101);
  v_failed := false;
  begin
    perform * from public.delete_messages_for_everyone(v_many);
  exception
    when invalid_parameter_value then
      v_failed := sqlerrm = 'too_many_messages';
  end;
  if not v_failed then
    raise exception '(i) a batch of 101 ids was accepted';
  end if;
  if exists (select 1 from public.delete_messages_for_everyone('{}'::uuid[]))
     or exists (select 1 from public.delete_messages_for_everyone(null)) then
    raise exception '(i) an empty call returned ids';
  end if;

  -- (j) Direct updates are still author-only: the function widened nothing.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_bob::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.messages set deleted_at = v_now where id = v_pa2;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception '(j) bob soft-deleted alice''s message with a direct update';
  end if;
  v_failed := false;
  begin
    perform 1 from private.message_deletions limit 1;
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(j) an authenticated user can read private.message_deletions';
  end if;

  -- (k) A stranger is answered as if the messages did not exist.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    perform * from public.delete_messages_for_everyone(array[v_pa2]);
  exception
    when no_data_found then
      v_failed := sqlerrm = 'message_not_found';
  end;
  if not v_failed then
    raise exception '(k) a stranger deleted a message in a chat they are not in';
  end if;

  -- (l) A banned participant is refused.
  execute 'reset role';
  -- A sanction is made by a session without a user, which enforce_sanction_matrix lets through.
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);
  insert into public.bans (user_id, reason) values (v_bob, 'rehearsal');
  perform pg_catalog.set_config('request.jwt.claim.sub', v_bob::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    perform * from public.delete_messages_for_everyone(array[v_pa2]);
  exception
    when insufficient_privilege then
      v_failed := sqlerrm = 'user_banned';
  end;
  if not v_failed then
    raise exception '(l) a banned participant deleted a message';
  end if;

  -- (m) anon cannot call it.
  execute 'reset role';
  execute 'set local role anon';
  v_failed := false;
  begin
    perform * from public.delete_messages_for_everyone(array[v_pa2]);
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(m) anon can call delete_messages_for_everyone';
  end if;

  -- (n) Nothing that was refused was deleted, and a deletion can be reversed
  --     exactly from the log.
  execute 'reset role';
  if exists (select 1 from public.messages where id in (v_pa2, v_ga2, v_gb1, v_psys) and deleted_at is not null) then
    raise exception '(n) a refused deletion deleted something';
  end if;
  update public.messages as m
     set deleted_at = null
    from private.message_deletions as d
   where d.message_id = m.id
     and d.deleted_at = m.deleted_at
     and d.deleted_by = v_alice
     and d.message_id = v_pb1;
  if (select deleted_at from public.messages where id = v_pb1) is not null then
    raise exception '(n) the documented reversal did not restore pb1';
  end if;
end
$test$;

select 'rehearsal passed: 20260911143000_delete_messages_for_everyone' as result;

rollback;
