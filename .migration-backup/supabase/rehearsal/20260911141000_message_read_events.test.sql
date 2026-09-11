-- Rehearsal: 20260911141000_message_read_events.sql
--
-- Run on the throwaway copy of production's schema, after that migration:
--   psql -X -v ON_ERROR_STOP=1 -f .migration-backup/supabase/rehearsal/20260911141000_message_read_events.test.sql
--
-- One transaction that ends in ROLLBACK. It creates its own users, a private
-- chat and a group, messages with fixed send times, and acts as each person
-- through `set local role authenticated` and the JWT claims. Every block raises
-- on the first expectation that does not hold.

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
  v_dave uuid := gen_random_uuid();
  v_erin uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_private uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_now constant timestamptz := pg_catalog.now();
  v_p1 uuid := gen_random_uuid();
  v_p2 uuid := gen_random_uuid();
  v_p3 uuid := gen_random_uuid();
  v_pb uuid := gen_random_uuid();
  v_old uuid := gen_random_uuid();
  v_g1 uuid := gen_random_uuid();
  v_p1_at constant timestamptz := pg_catalog.now() - interval '40 minutes';
  v_p2_at constant timestamptz := pg_catalog.now() - interval '30 minutes';
  v_p3_at constant timestamptz := pg_catalog.now() - interval '20 minutes';
  v_pb_at constant timestamptz := pg_catalog.now() - interval '35 minutes';
  v_old_at constant timestamptz := pg_catalog.now() - interval '8 days';
  v_g1_at constant timestamptz := pg_catalog.now() - interval '25 minutes';
  v_pointer timestamptz;
  v_t1 timestamptz;
  v_t2 timestamptz;
  v_t3 timestamptz;
  v_tb timestamptz;
  v_td timestamptz;
  v_count integer;
  v_row record;
  v_order uuid[];
  v_failed boolean;
  v_deleted bigint;
begin
  -- Only columns that the auth.users of production and of the rehearsal image both have.
  insert into auth.users (id, aud, role, email, created_at, updated_at)
  select person.id, 'authenticated', 'authenticated', 'rehearsal-' || person.id::text || '@invalid', v_now, v_now
    from pg_catalog.unnest(array[v_alice, v_bob, v_dave, v_erin, v_stranger]) as person(id);
  insert into public.profiles (id, full_name, username)
  select person.id, 'Rehearsal ' || person.label, 'rh_' || person.label || '_' || pg_catalog.substr(pg_catalog.replace(person.id::text, '-', ''), 1, 8)
    from (values (v_alice, 'alice'), (v_bob, 'bob'), (v_dave, 'dave'), (v_erin, 'erin'), (v_stranger, 'stranger')) as person(id, label)
  on conflict (id) do update set full_name = excluded.full_name, username = excluded.username;

  insert into public.chats (id, type, name, created_by) values (v_private, 'private', 'Rehearsal private', v_alice);
  insert into public.chats (id, type, name, created_by) values (v_group, 'group', 'Rehearsal group', v_alice);
  insert into public.chat_members (chat_id, user_id, role)
  values (v_private, v_alice, 'owner'), (v_private, v_bob, 'member'),
         (v_group, v_alice, 'owner'), (v_group, v_bob, 'member'), (v_group, v_dave, 'member'), (v_group, v_erin, 'member')
  on conflict (chat_id, user_id) do update set role = excluded.role;

  insert into public.messages (id, chat_id, user_id, content, type, created_at) values
    (v_p1, v_private, v_alice, 'rehearsal p1', 'text', v_p1_at),
    (v_pb, v_private, v_bob, 'rehearsal pb', 'text', v_pb_at),
    (v_p2, v_private, v_alice, 'rehearsal p2', 'text', v_p2_at),
    (v_p3, v_private, v_alice, 'rehearsal p3', 'text', v_p3_at),
    (v_old, v_private, v_alice, 'rehearsal old', 'text', v_old_at),
    (v_g1, v_group, v_alice, 'rehearsal g1', 'text', v_g1_at);

  -- (a) Bob reads through p1: the pointer is p1's send time and one event
  --     records when.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_bob::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_pointer := public.mark_chat_read_through(v_private, v_p1_at);
  if v_pointer is distinct from v_p1_at then
    raise exception '(a) reading through p1 left the pointer at %', v_pointer;
  end if;
  execute 'reset role';
  select pg_catalog.count(*)::integer, pg_catalog.max(event.read_at) into v_count, v_t1
    from private.message_read_events as event
   where event.chat_id = v_private and event.user_id = v_bob;
  if v_count <> 1 or v_t1 is null then
    raise exception '(a) reading through p1 recorded % events', v_count;
  end if;
  perform pg_catalog.pg_sleep(0.01);

  -- (b) Then through p2: a second, later event.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_bob::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_pointer := public.mark_chat_read_through(v_private, v_p2_at);
  if v_pointer is distinct from v_p2_at then
    raise exception '(b) reading through p2 left the pointer at %', v_pointer;
  end if;

  -- (c) A stale device reports p1 again: the pointer and the events stay.
  v_pointer := public.mark_chat_read_through(v_private, v_p1_at);
  if v_pointer is distinct from v_p2_at then
    raise exception '(c) a stale report moved the pointer to %', v_pointer;
  end if;
  execute 'reset role';
  select pg_catalog.count(*)::integer, pg_catalog.max(event.read_at) into v_count, v_t2
    from private.message_read_events as event
   where event.chat_id = v_private and event.user_id = v_bob;
  if v_count <> 2 or v_t2 <= v_t1 then
    raise exception '(c) after a stale report there are % events, the latest at % (first at %)', v_count, v_t2, v_t1;
  end if;
  perform pg_catalog.pg_sleep(0.01);

  -- (d) A report from a clock ahead of the server is clamped to now, and marks
  --     p3 read at that moment.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_bob::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_pointer := public.mark_chat_read_through(v_private, v_now + interval '1 hour');
  if v_pointer is distinct from v_now then
    raise exception '(d) a report an hour ahead left the pointer at %', v_pointer;
  end if;
  execute 'reset role';
  select pg_catalog.max(event.read_at) into v_t3
    from private.message_read_events as event
   where event.chat_id = v_private and event.user_id = v_bob;

  -- (e) Alice, the sender, asks when each message was read.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select pg_catalog.count(*)::integer into v_count from public.message_read_times(v_p1);
  if v_count <> 1 then
    raise exception '(e) p1 has % recipients in a private chat', v_count;
  end if;
  select * into v_row from public.message_read_times(v_p1);
  if v_row.reader_id <> v_bob or not v_row.has_read or v_row.read_at is distinct from v_t1 then
    raise exception '(e) p1 reads as %, expected bob read at % — the first event that reached it', row_to_json(v_row), v_t1;
  end if;
  select * into v_row from public.message_read_times(v_p2);
  if not v_row.has_read or v_row.read_at is distinct from v_t2 then
    raise exception '(e) p2 reads as %, expected read at %', row_to_json(v_row), v_t2;
  end if;
  select * into v_row from public.message_read_times(v_p3);
  if not v_row.has_read or v_row.read_at is distinct from v_t3 then
    raise exception '(e) p3 reads as %, expected read at %', row_to_json(v_row), v_t3;
  end if;
  -- Eight days old: read by the pointer, and an event does reach it — the one
  -- for p1 — so only the retention keeps a wrong time from being shown.
  select * into v_row from public.message_read_times(v_old);
  if not v_row.has_read or v_row.read_at is not null then
    raise exception '(e) a message sent eight days ago reads as %, expected read with no time', row_to_json(v_row);
  end if;

  -- (f) Bob is not the sender of p1, and his own message has not been read.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_bob::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    perform * from public.message_read_times(v_p1);
  exception
    when insufficient_privilege then
      v_failed := sqlerrm = 'not_message_sender';
  end;
  if not v_failed then
    raise exception '(f) bob was given the read times of alice''s message';
  end if;
  select * into v_row from public.message_read_times(v_pb);
  if v_row.reader_id <> v_alice or v_row.has_read or v_row.read_at is not null then
    raise exception '(f) bob''s unread message reads as %', row_to_json(v_row);
  end if;

  -- (g) A stranger, and an id that does not exist, get the same answer.
  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    perform * from public.message_read_times(v_p1);
  exception
    when no_data_found then
      v_failed := sqlerrm = 'message_not_found';
  end;
  if not v_failed then
    raise exception '(g) a stranger was answered about a message in a chat they are not in';
  end if;
  v_failed := false;
  begin
    perform * from public.message_read_times(gen_random_uuid());
  exception
    when no_data_found then
      v_failed := sqlerrm = 'message_not_found';
  end;
  if not v_failed then
    raise exception '(g) an unknown message id was not answered like a stranger''s';
  end if;
  v_failed := false;
  begin
    perform public.mark_chat_read_through(v_private, v_now);
  exception
    when insufficient_privilege then
      v_failed := sqlerrm = 'chat_member_required';
  end;
  if not v_failed then
    raise exception '(g) a stranger reported a read in a chat they are not in';
  end if;
  v_failed := false;
  begin
    perform 1 from private.message_read_events limit 1;
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(g) an authenticated user can read private.message_read_events';
  end if;

  -- (h) The group: Bob, then Dave, then Erin, who hides her presence.
  execute 'reset role';
  insert into public.privacy_preferences (user_id, presence_visible) values (v_erin, false)
  on conflict (user_id) do update set presence_visible = excluded.presence_visible;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_bob::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.mark_chat_read_through(v_group, v_g1_at);
  execute 'reset role';
  select pg_catalog.max(event.read_at) into v_tb from private.message_read_events as event
   where event.chat_id = v_group and event.user_id = v_bob;
  perform pg_catalog.pg_sleep(0.01);

  perform pg_catalog.set_config('request.jwt.claim.sub', v_dave::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_dave, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.mark_chat_read_through(v_group, v_g1_at);
  execute 'reset role';
  select pg_catalog.max(event.read_at) into v_td from private.message_read_events as event
   where event.chat_id = v_group and event.user_id = v_dave;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_erin::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_erin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.mark_chat_read_through(v_group, v_g1_at);

  execute 'reset role';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select pg_catalog.array_agg(times.reader_id order by times.ordinality) into v_order
    from public.message_read_times(v_g1) with ordinality as times;
  if v_order is distinct from array[v_dave, v_bob, v_erin] then
    raise exception '(h) the readers of g1 come back as %, expected dave, bob, then erin', v_order;
  end if;
  for v_row in select * from public.message_read_times(v_g1) loop
    if not v_row.has_read then
      raise exception '(h) % has read g1 but is reported unread', v_row.reader_id;
    end if;
    if v_row.reader_id = v_bob and v_row.read_at is distinct from v_tb then
      raise exception '(h) bob read g1 at %, reported %', v_tb, v_row.read_at;
    end if;
    if v_row.reader_id = v_dave and v_row.read_at is distinct from v_td then
      raise exception '(h) dave read g1 at %, reported %', v_td, v_row.read_at;
    end if;
    if v_row.reader_id = v_erin and v_row.read_at is not null then
      raise exception '(h) erin hides her presence and her read time was shown: %', v_row.read_at;
    end if;
    if v_row.reader_id = v_alice then
      raise exception '(h) the sender is listed among the readers of her own message';
    end if;
  end loop;

  -- (i) Alice hides hers: she sees no one's time, and still sees who read.
  execute 'reset role';
  insert into public.privacy_preferences (user_id, presence_visible) values (v_alice, false)
  on conflict (user_id) do update set presence_visible = excluded.presence_visible;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_alice::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select pg_catalog.count(*)::integer into v_count from public.message_read_times(v_g1) as times
   where times.read_at is not null or not times.has_read;
  if v_count <> 0 then
    raise exception '(i) alice hides her presence and still sees % read times, or lost who read', v_count;
  end if;
  execute 'reset role';
  update public.privacy_preferences set presence_visible = true where user_id = v_alice;

  -- (j) An unupdated client's mark_chat_read is recorded too.
  select pg_catalog.count(*)::integer into v_count from private.message_read_events as event
   where event.chat_id = v_group and event.user_id = v_dave;
  perform pg_catalog.pg_sleep(0.01);
  perform pg_catalog.set_config('request.jwt.claim.sub', v_dave::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_dave, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.mark_chat_read(v_group);
  execute 'reset role';
  if (select pg_catalog.count(*)::integer from private.message_read_events as event
       where event.chat_id = v_group and event.user_id = v_dave) <> v_count + 1 then
    raise exception '(j) mark_chat_read advanced the pointer without recording an event';
  end if;

  -- (k) anon executes neither RPC.
  execute 'set local role anon';
  v_failed := false;
  begin
    perform * from public.message_read_times(v_p1);
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(k) anon can call message_read_times';
  end if;
  v_failed := false;
  begin
    perform public.mark_chat_read_through(v_private, v_now);
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(k) anon can call mark_chat_read_through';
  end if;

  -- (l) The cleanup removes what is older than seven days, and nothing on a
  --     second run.
  execute 'reset role';
  insert into private.message_read_events (chat_id, user_id, read_through, read_at)
  values (v_private, v_bob, v_now - interval '9 days', v_now - interval '9 days' + interval '1 second');
  select pg_catalog.count(*)::integer into v_count from private.message_read_events;
  execute 'set local role service_role';
  v_deleted := public.message_read_events_cleanup(50000, 1000);
  if v_deleted <> 1 then
    raise exception '(l) the cleanup deleted % events, expected the one older than seven days', v_deleted;
  end if;
  v_deleted := public.message_read_events_cleanup(50000, 1000);
  if v_deleted <> 0 then
    raise exception '(l) a second cleanup deleted % more events', v_deleted;
  end if;
  execute 'reset role';
  if (select pg_catalog.count(*)::integer from private.message_read_events) <> v_count - 1 then
    raise exception '(l) the cleanup touched events inside the window';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_bob::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    perform public.message_read_events_cleanup(1, 1);
  exception
    when insufficient_privilege then
      v_failed := true;
  end;
  if not v_failed then
    raise exception '(l) an authenticated user can run the cleanup';
  end if;

  -- (m) A member who leaves takes their events with them.
  execute 'reset role';
  delete from public.chat_members where chat_id = v_group and user_id = v_erin;
  if exists (select 1 from private.message_read_events as event where event.chat_id = v_group and event.user_id = v_erin) then
    raise exception '(m) events outlived the membership they belong to';
  end if;
end
$test$;

select 'rehearsal passed: 20260911141000_message_read_events' as result;

rollback;
