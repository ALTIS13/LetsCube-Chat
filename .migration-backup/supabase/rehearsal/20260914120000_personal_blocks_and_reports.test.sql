-- Rehearsal: 20260914120000_personal_blocks_and_reports.sql
--
-- Run on a throwaway copy of production's schema, after that migration:
--   psql -X -v ON_ERROR_STOP=1 -f .migration-backup/supabase/rehearsal/20260914120000_personal_blocks_and_reports.test.sql
--
-- One transaction that ends in ROLLBACK, with its own people and its own chat.
-- Everything is measured as `authenticated` with real claims, never as the
-- owner of the tables: a policy measured as its own table's owner is not
-- measured at all.

begin;

do $rehearsal$
declare
  -- Whatever role this is being run as. Hardcoding `supabase_admin` failed on
  -- the first rehearsal, which ran as `postgres` on a throwaway copy and could
  -- not become it — «permission denied to set role».
  v_owner text := current_user;
  v_anna uuid := gen_random_uuid();
  v_boris uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_chat uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_message uuid := gen_random_uuid();
  v_report uuid;
  v_seen integer;
  v_refused boolean;
begin
  perform set_config('role', v_owner, true);

  -- **The duty officer is created first, on purpose.**
  -- `trg_bootstrap_first_admin` makes the first profile in an empty database an
  -- administrator, which is how this product bootstraps itself. On a throwaway
  -- copy that made *Anna* staff, and the queue she is not supposed to be able to
  -- read was readable — the first rehearsal reported that as a policy failure
  -- when it was the fixture promoting her. Letting the rule land on the person
  -- who is meant to be staff uses the product's own mechanism instead of
  -- fighting it, and leaves Anna and Boris ordinary.
  insert into auth.users (id, email) values
    (v_staff, 'staff@rehearsal.invalid'),
    (v_anna, 'anna@rehearsal.invalid'),
    (v_boris, 'boris@rehearsal.invalid');
  -- A trigger on `auth.users` already makes the profile row, so this is an
  -- upsert rather than an insert: the first rehearsal collided on
  -- `profiles_pkey` and that collision is the schema telling us so.
  -- A trigger on `auth.users` already makes the profile row, so this is an
  -- upsert rather than an insert: the first rehearsal collided on
  -- `profiles_pkey` and that collision is the schema telling us so. The role
  -- column is deliberately not touched — whatever the bootstrap decided stands.
  insert into public.profiles (id, full_name, username) values
    (v_staff, 'Дежурный', 'staff_rehearsal'),
    (v_anna, 'Анна', 'anna_rehearsal'),
    (v_boris, 'Борис', 'boris_rehearsal')
  on conflict (id) do update
    set full_name = excluded.full_name, username = excluded.username;

  -- And the fixture says so out loud, so a future failure here is read as what
  -- it is rather than as a policy defect.
  if public.is_manager_or_admin(v_anna) then
    raise exception 'the fixture made the reporter staff; the queue test below would prove nothing';
  end if;
  if not public.is_manager_or_admin(v_staff) then
    raise exception 'the fixture has no staff account, so the positive case cannot be measured';
  end if;

  insert into public.chats (id, type, name, created_by) values
    (v_chat, 'private', null, v_anna),
    (v_group, 'group', 'Комната', v_anna);
  -- Creating a chat already enrols its creator, so these are upserts too.
  insert into public.chat_members (chat_id, user_id, role) values
    (v_chat, v_anna, 'owner'), (v_chat, v_boris, 'member'),
    (v_group, v_anna, 'owner'), (v_group, v_boris, 'member')
  on conflict (chat_id, user_id) do update set role = excluded.role;

  insert into public.messages (id, chat_id, user_id, content, type)
    values (v_message, v_chat, v_boris, 'первое сообщение', 'text');

  -- 1. Before any block, Boris may write to Anna.
  perform set_config('request.jwt.claims', json_build_object('sub', v_boris::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.messages (chat_id, user_id, content, type)
    values (v_chat, v_boris, 'до блокировки', 'text');
  perform set_config('role', v_owner, true);
  raise notice 'before the block, the message goes through';

  -- 2. Anna blocks Boris. Nobody else may write that row for her.
  perform set_config('request.jwt.claims', json_build_object('sub', v_anna::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.user_blocks (blocker_id, blocked_id) values (v_anna, v_boris);
  begin
    insert into public.user_blocks (blocker_id, blocked_id) values (v_boris, v_anna);
    v_refused := false;
  exception when others then
    v_refused := true;
  end;
  perform set_config('role', v_owner, true);
  if not v_refused then
    raise exception 'somebody wrote a block on behalf of another person';
  end if;
  raise notice 'a block is the blocker''s own row and nobody else''s';

  -- 3. Boris cannot see that he was blocked.
  perform set_config('request.jwt.claims', json_build_object('sub', v_boris::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_seen from public.user_blocks;
  perform set_config('role', v_owner, true);
  if v_seen <> 0 then
    raise exception 'a blocked person can see the block, which is the one thing it must not do';
  end if;
  raise notice 'the person blocked cannot find the row';

  -- 4. And cannot write in the private chat any more.
  perform set_config('request.jwt.claims', json_build_object('sub', v_boris::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.messages (chat_id, user_id, content, type)
      values (v_chat, v_boris, 'после блокировки', 'text');
    v_refused := false;
  exception when others then
    v_refused := true;
  end;
  perform set_config('role', v_owner, true);
  if not v_refused then
    raise exception 'a blocked person still writes to the person who blocked them';
  end if;
  raise notice 'the refusal holds in the private chat';

  -- 5. The group is somebody else's room: the block does not reach it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_boris::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.messages (chat_id, user_id, content, type)
    values (v_group, v_boris, 'в группе можно', 'text');
  perform set_config('role', v_owner, true);
  raise notice 'a group is not silenced by one member''s block';

  -- 6. Anna may still write to Boris: she refused him, not herself.
  perform set_config('request.jwt.claims', json_build_object('sub', v_anna::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.messages (chat_id, user_id, content, type)
    values (v_chat, v_anna, 'а я писать могу', 'text');
  perform set_config('role', v_owner, true);
  raise notice 'the block is one-directional';

  -- 7. Unblocking gives the way back.
  perform set_config('request.jwt.claims', json_build_object('sub', v_anna::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  delete from public.user_blocks where blocker_id = v_anna and blocked_id = v_boris;
  perform set_config('role', v_owner, true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_boris::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.messages (chat_id, user_id, content, type)
    values (v_chat, v_boris, 'снова можно', 'text');
  perform set_config('role', v_owner, true);
  raise notice 'unblocking restores the conversation';

  -- 8. A report is written by its author and read by nobody but staff.
  perform set_config('request.jwt.claims', json_build_object('sub', v_anna::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  -- **No RETURNING, and that is the contract.** Reading the row back needs the
  -- SELECT policy, which the reporter deliberately does not have, so
  -- `insert … returning` is refused — measured, and step 8a below pins it. The
  -- error Postgres gives is «new row violates row-level security policy», which
  -- reads like a failing WITH CHECK and is not one; an hour went into chasing
  -- that on 2026-09-14. A client must report with a bare insert and no
  -- `.select()` after it.
  insert into public.content_reports (reporter_id, kind, target_user_id, message_id, chat_id, reason, note)
    values (v_anna, 'message', v_boris, v_message, v_chat, 'spam', 'рассылает одно и то же');
  select count(*) into v_seen from public.content_reports;
  perform set_config('role', v_owner, true);
  if v_seen <> 0 then
    raise exception 'the person who reported can read the queue';
  end if;
  raise notice 'a report goes in and does not come back out';

  -- 8a. And asking for it back is refused rather than quietly returning
  -- nothing, so a client that chains `.select()` fails loudly in a test instead
  -- of silently in production.
  perform set_config('request.jwt.claims', json_build_object('sub', v_anna::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.content_reports (reporter_id, kind, target_user_id, reason)
      values (v_anna, 'user', v_boris, 'abuse') returning id into v_report;
    v_refused := false;
  exception when others then
    v_refused := true;
  end;
  perform set_config('role', v_owner, true);
  if not v_refused then
    raise exception 'the reporter read their own report back, which the read policy forbids';
  end if;
  raise notice 'asking for the report back is refused';

  -- 8b. And staff can read it — otherwise «nobody can read it» would be true
  -- for a queue nobody can act on.
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_seen from public.content_reports;
  perform set_config('role', v_owner, true);
  if v_seen <> 1 then
    raise exception 'staff cannot read the report queue: saw % rows', v_seen;
  end if;
  raise notice 'staff read the queue, which is the point of it';

  -- 9. The same message twice from the same person is the same report.
  perform set_config('request.jwt.claims', json_build_object('sub', v_anna::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.content_reports (reporter_id, kind, target_user_id, message_id, chat_id, reason)
      values (v_anna, 'message', v_boris, v_message, v_chat, 'abuse');
    v_refused := false;
  exception when others then
    v_refused := true;
  end;
  perform set_config('role', v_owner, true);
  if not v_refused then
    raise exception 'the same message was reported twice by the same person';
  end if;
  raise notice 'one report per message per person';

  -- 10. Nobody can file a report in somebody else's name, or pre-resolved.
  perform set_config('request.jwt.claims', json_build_object('sub', v_boris::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.content_reports (reporter_id, kind, target_user_id, reason)
      values (v_anna, 'user', v_boris, 'spam');
    v_refused := false;
  exception when others then
    v_refused := true;
  end;
  perform set_config('role', v_owner, true);
  if not v_refused then
    raise exception 'a report was filed in somebody else''s name';
  end if;
  raise notice 'a report carries the name of whoever made it';

  -- 11. A report about a person must not pretend to be about a message.
  perform set_config('role', v_owner, true);
  begin
    insert into public.content_reports (reporter_id, kind, target_user_id, message_id, reason)
      values (v_staff, 'user', v_boris, v_message, 'spam');
    v_refused := false;
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'a report about a person carried a message id';
  end if;
  raise notice 'the kind and the subject agree';

  raise notice 'ALL BLOCK AND REPORT RULES PASSED';
end
$rehearsal$;

rollback;
