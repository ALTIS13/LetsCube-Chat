-- Rehearsal: 20260911140000_chat_read_marks_forward_only.sql
--
-- Run on the throwaway copy of production's schema, after that migration:
--   psql -X -v ON_ERROR_STOP=1 -f .migration-backup/supabase/rehearsal/20260911140000_chat_read_marks_forward_only.test.sql
--
-- One transaction that ends in ROLLBACK. It creates its own users, chat and
-- memberships, acts as each person through `set local role authenticated` and
-- the JWT claims, and raises on the first expectation that does not hold. The
-- pass line is printed only when every block ran.

begin;

do $compatibility$
begin
  if pg_catalog.to_regclass('public.registration_invite_settings') is not null then
    execute 'update public.registration_invite_settings set invite_only_enabled = false where id = true';
  end if;
end
$compatibility$;

-- Which claim this server's auth.uid() reads. The blocks below set both.
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
  v_chat uuid := gen_random_uuid();
  v_now constant timestamptz := pg_catalog.now();
  v_mark timestamptz;
  v_role text;
  v_rows integer;
begin
  -- Only columns that the auth.users of production and of the rehearsal image both have.
  insert into auth.users (id, aud, role, email, created_at, updated_at)
  select person.id, 'authenticated', 'authenticated', 'rehearsal-' || person.id::text || '@invalid', v_now, v_now
    from pg_catalog.unnest(array[v_alice, v_bob, v_carol, v_stranger]) as person(id);
  insert into public.profiles (id, full_name, username)
  select person.id, 'Rehearsal ' || person.label, 'rh_' || person.label || '_' || pg_catalog.substr(pg_catalog.replace(person.id::text, '-', ''), 1, 8)
    from (values (v_alice, 'alice'), (v_bob, 'bob'), (v_carol, 'carol'), (v_stranger, 'stranger')) as person(id, label)
  on conflict (id) do update set full_name = excluded.full_name, username = excluded.username;
  insert into public.chats (id, type, name, created_by) values (v_chat, 'group', 'Rehearsal read marks', v_carol);
  insert into public.chat_members (chat_id, user_id, role)
  values (v_chat, v_carol, 'owner'), (v_chat, v_alice, 'member'), (v_chat, v_bob, 'member')
  on conflict (chat_id, user_id) do update set role = excluded.role;

  -- (a) Alice moves her own read mark: stored as given.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.chat_members set last_read_at = v_now - interval '1 hour'
   where chat_id = v_chat and user_id = v_alice;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception '(a) alice could not update her own membership row (% rows)', v_rows;
  end if;
  select last_read_at into v_mark from public.chat_members where chat_id = v_chat and user_id = v_alice;
  if v_mark is distinct from v_now - interval '1 hour' then
    raise exception '(a) alice''s read mark is % instead of an hour ago', v_mark;
  end if;

  -- (b) A stale device reports an older mark: it stays where it was.
  update public.chat_members set last_read_at = v_now - interval '2 hours'
   where chat_id = v_chat and user_id = v_alice;
  select last_read_at into v_mark from public.chat_members where chat_id = v_chat and user_id = v_alice;
  if v_mark is distinct from v_now - interval '1 hour' then
    raise exception '(b) an older report moved the read mark backwards to %', v_mark;
  end if;

  -- (c) NULL does not clear it.
  update public.chat_members set last_read_at = null
   where chat_id = v_chat and user_id = v_alice;
  select last_read_at into v_mark from public.chat_members where chat_id = v_chat and user_id = v_alice;
  if v_mark is distinct from v_now - interval '1 hour' then
    raise exception '(c) a NULL changed the read mark to %', v_mark;
  end if;

  -- (d) mark_chat_read still moves it forward, to now.
  perform public.mark_chat_read(v_chat);
  select last_read_at into v_mark from public.chat_members where chat_id = v_chat and user_id = v_alice;
  if v_mark is distinct from v_now then
    raise exception '(d) mark_chat_read left the read mark at %', v_mark;
  end if;

  -- (e) The delivered mark follows the same rule.
  update public.chat_members set last_delivered_at = v_now - interval '3 hours'
   where chat_id = v_chat and user_id = v_alice;
  select last_delivered_at into v_mark from public.chat_members where chat_id = v_chat and user_id = v_alice;
  if v_mark is distinct from v_now then
    raise exception '(e) an older delivered mark moved it backwards to %', v_mark;
  end if;

  -- (f) Bob, who never read, writes a mark a day ahead: clamped to now.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_bob::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.chat_members set last_read_at = v_now + interval '1 day'
   where chat_id = v_chat and user_id = v_bob;
  select last_read_at into v_mark from public.chat_members where chat_id = v_chat and user_id = v_bob;
  if v_mark is distinct from v_now then
    raise exception '(f) a read mark a day ahead was stored as %', v_mark;
  end if;

  -- (g) Carol owns the chat. Her policy reaches Bob's row, and she can change
  --     his role, but not his marks. Bob starts again from a fresh membership
  --     with no marks, since no update — the session user's included — can
  --     clear a mark once it is set.
  execute 'reset role';
  delete from public.chat_members where chat_id = v_chat and user_id = v_bob;
  insert into public.chat_members (chat_id, user_id, role) values (v_chat, v_bob, 'member');

  perform pg_catalog.set_config('request.jwt.claim.sub', v_carol::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_carol, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.chat_members
     set last_read_at = v_now - interval '10 minutes',
         last_delivered_at = v_now - interval '10 minutes'
   where chat_id = v_chat and user_id = v_bob;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception '(g) the fixture is wrong: carol''s policy did not reach bob''s row (% rows), so this proves nothing', v_rows;
  end if;
  select last_read_at into v_mark from public.chat_members where chat_id = v_chat and user_id = v_bob;
  if v_mark is not null then
    raise exception '(g) the chat''s owner forged bob''s read mark: %', v_mark;
  end if;
  select last_delivered_at into v_mark from public.chat_members where chat_id = v_chat and user_id = v_bob;
  if v_mark is not null then
    raise exception '(g) the chat''s owner forged bob''s delivered mark: %', v_mark;
  end if;
  update public.chat_members set role = 'admin' where chat_id = v_chat and user_id = v_bob;
  select role::text into v_role from public.chat_members where chat_id = v_chat and user_id = v_bob;
  if v_role is distinct from 'admin' then
    raise exception '(g) the chat''s owner can no longer change a role (bob is %)', v_role;
  end if;

  -- (h) Someone outside the chat reaches no membership row at all.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.chat_members set last_read_at = v_now - interval '5 minutes'
   where chat_id = v_chat and user_id = v_alice;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception '(h) a stranger updated a membership row of a chat they are not in';
  end if;

  -- (i) A session without a user is held to forward-only too.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);
  update public.chat_members set last_read_at = v_now - interval '5 hours'
   where chat_id = v_chat and user_id = v_alice;
  select last_read_at into v_mark from public.chat_members where chat_id = v_chat and user_id = v_alice;
  if v_mark is distinct from v_now then
    raise exception '(i) a session without a user moved alice''s mark backwards to %', v_mark;
  end if;
end
$test$;

select 'rehearsal passed: 20260911140000_chat_read_marks_forward_only' as result;

rollback;
