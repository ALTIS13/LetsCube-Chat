begin;
/**
 * A private chat can ring.
 *
 * Slice A of `docs/proposals/2026-09-18-one-to-one-calls.md`: the room a member
 * can make, and the ring between two signed-in applications. Nothing here is
 * about the transport — section 2 of that proposal measured that the gateway
 * and the SFU are already chat-type-agnostic, and that a `voice_channels` row
 * on a private chat would mint a token happily today. What is missing is a row
 * anybody in a private chat is allowed to create, and a state on it that means
 * «somebody is calling you right now».
 *
 * ── Why the ring lives on `voice_channels` and not in a table of its own ─────
 *
 * Every signed-in client already holds an unfiltered Realtime subscription to
 * this table (`hooks/useVoicePresence.ts:136-140`, mounted by `Sidebar`, which
 * `MainLayout` hides with CSS rather than unmounting). So a ring written here
 * reaches **every device the person is signed in on**, with no fan-out to build
 * and no list of devices to keep — and the moment one of them answers, the same
 * row changes again and the rest stop. That is the whole of «ring every device,
 * stop the others», and on this table it costs nothing. A new table would need
 * a new subscription in every shell to buy the same thing.
 *
 * ── The thing nobody had named ──────────────────────────────────────────────
 *
 * In a private chat **one participant can create a call room and the other
 * cannot.** INSERT is governed by «admins manage voice channels» =
 * `is_chat_admin(chat_id)`, which is `role in ('owner','admin')`, and whoever
 * opened the private chat holds `owner` while the other side holds `member`.
 * Read straight off `pg_policy` before this was written, not from a migration's
 * description of itself.
 *
 * The answer is a `SECURITY DEFINER` RPC rather than a widened policy, for three
 * reasons that a policy cannot express: it can refuse to make a **second** room
 * in the same chat, it can refuse for a chat that is not private, and it leaves
 * the existing policy exactly as it is for every group in the product.
 *
 * ── What the client may write, and what it may not ──────────────────────────
 *
 * `authenticated` holds UPDATE on precisely seven columns of this table —
 * `archived, category_id, max_participants, name, position, speak_role,
 * updated_at` — and `has_table_privilege(..., 'UPDATE')` therefore answers
 * **false** for it, which is by design and has been misread as a missing grant
 * four times in this project. The three columns added below are granted
 * **SELECT and nothing else**: a ring is set and cleared by the functions here
 * or not at all, so «B declined» cannot be written by A, and «answered» cannot
 * be written by somebody who never connected.
 *
 * SELECT on the new columns is not optional and is not automatic. A column-level
 * grant list does not grow when a column is added, and Realtime only sends the
 * columns the subscribing role may select — so without the GRANT at the bottom
 * of this file the ring would be invisible to the very subscription it exists
 * to reach, while every direct query by a service role worked perfectly.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 *
 * **The record in the conversation** — outcome, duration, direction — is slice
 * B and needs a payload column on `messages`, which does not exist (the table
 * carries `media_metadata` and nothing general). `voice_call_stop` therefore
 * takes the reason and does nothing with it beyond refusing a nonsense one; the
 * argument is here so that slice B is a change to one function body rather than
 * a change to every call site.
 *
 * **The forty-five second cut-off** is slice C. `voice_ring_state` below is the
 * rule, pure and testable, and it already answers `expired`; what is missing is
 * something that runs. The reconciler's tick is 30 seconds, which is coarse for
 * 45, and the honest options are argued in the proposal.
 *
 * **A rate limit of its own.** Ringing means joining, and joining mints a token,
 * which the deployment-wide limiter already bounds (see
 * `20260918190000_voice_limits_bind_the_deployment.sql`). What is added here is
 * the cheaper guard that limiter cannot give: a chat that is already ringing, or
 * already occupied, refuses a new ring outright.
 */


-- ── The ring, as three columns and one rule ─────────────────────────────────

alter table public.voice_channels
  add column if not exists ring_started_at timestamptz,
  add column if not exists ring_caller uuid references auth.users (id) on delete set null,
  add column if not exists ring_answered_at timestamptz;

comment on column public.voice_channels.ring_started_at is
  'When somebody started calling. Null means nobody is. Cleared by voice_call_stop.';
comment on column public.voice_channels.ring_caller is
  'Who is calling. Null exactly when ring_started_at is null.';
comment on column public.voice_channels.ring_answered_at is
  'When the other side accepted. Set only while a ring is live; the call is then running.';

/**
 * A ring is coherent or it does not exist.
 *
 * Both halves matter and neither is decoration. A `ring_caller` with no
 * `ring_started_at` would be a call the interface cannot time out, because
 * `voice_ring_state` reads the timestamp; a `ring_answered_at` with no ring is
 * a call that was answered without being made, which is what a redelivered or
 * out-of-order write would otherwise produce.
 */
alter table public.voice_channels
  drop constraint if exists voice_channels_ring_shape_check;
alter table public.voice_channels
  add constraint voice_channels_ring_shape_check check (
    ((ring_started_at is null) = (ring_caller is null))
    and (ring_answered_at is null or ring_started_at is not null)
  );

-- ── The rule, pure, so it can be argued about without a database ────────────

/**
 * What a ring is doing, given its two timestamps and the moment you ask.
 *
 * `immutable` and every input explicit — `p_now` is passed in rather than read
 * from `now()` — so the same four cases can be asserted in a test, in a
 * rehearsal, and in `lib/` on the client without any of them needing a call, an
 * SFU, or a clock they do not control. The group-call migration made the same
 * split for the same reason and it is the half of that design that transfers.
 *
 * `expired` rather than `missed`: this function knows the ring ran out of time,
 * and it does not know that nobody answered somewhere else, that the caller
 * cancelled a millisecond earlier, or what the conversation should say. Naming
 * it `missed` here would put slice B's decision in slice A's arithmetic.
 */
create or replace function public.voice_ring_state(
  p_started_at timestamptz,
  p_answered_at timestamptz,
  p_now timestamptz,
  p_ttl_seconds integer default 45
) returns text
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  select case
    when p_started_at is null then 'idle'
    when p_answered_at is not null then 'answered'
    when p_now >= p_started_at + make_interval(secs => greatest(p_ttl_seconds, 0)) then 'expired'
    else 'ringing'
  end;
$$;

comment on function public.voice_ring_state(timestamptz, timestamptz, timestamptz, integer) is
  'idle | ringing | answered | expired, from the two ring timestamps and an explicit now.';

-- ── Making the room, which one of the two participants cannot do ────────────

/**
 * The private chat's one call room, created on first use.
 *
 * Returns the room's id. Refuses, with a message rather than a silent null, for
 * every reason it refuses: not a member, not a private chat, blocked by the
 * other side.
 *
 * `blocked_from_chat(chat, me)` is the existing gate and is exactly the right
 * one — it answers «the other participant of this private chat has blocked me»
 * — so no notion of «a contact» is invented for calls. The owner's decision on
 * 2026-09-18 was that every private chat can be called except across a block,
 * and a private chat exists only because somebody already opened it.
 *
 * ── One room, and the two ways that can fail ────────────────────────────────
 *
 * **A race.** Two devices pressing «call» at the same moment both look, both
 * see nothing, and both insert. A partial unique index on `(chat_id) where the
 * chat is private` was the first answer and **cannot be written**: an index
 * predicate may not contain a subquery, and the chat's type lives in another
 * table. So the serialisation is a transaction-scoped advisory lock on the
 * chat, which holds only against this function and only for that chat — where
 * `select ... from chats for update` would also block a rename.
 *
 * **A room that already exists and is wrong.** `is_chat_admin` is true for
 * whoever opened the private chat, so that one participant can insert a
 * `voice_channels` row directly through the ordinary policy, with any settings
 * they like. Nothing in the product does — `voiceChannelRowOffer` answers
 * `not_a_group` — but `speak_role = 'admin'` on such a row would hand the
 * gateway a private call in which the **other** person may not speak, since it
 * compares `chat_members.role` against exactly that column. So the room this
 * function returns is normalised rather than trusted: two seats, everybody
 * speaks, not archived. In a private chat there is no configuration to respect.
 *
 * The oldest room wins if somehow there are two, so the same call always lands
 * in the same place rather than wherever the planner looked first.
 */
create or replace function public.voice_private_room(p_chat_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $$
declare
  v_me uuid := auth.uid();
  v_type text;
  v_room uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select type into v_type from public.chats where id = p_chat_id;
  if v_type is null then
    raise exception 'no_such_chat' using errcode = 'P0002';
  end if;
  if v_type <> 'private' then
    raise exception 'not_a_private_chat' using errcode = '22023';
  end if;
  if not public.is_chat_member(p_chat_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if public.blocked_from_chat(p_chat_id, v_me) then
    raise exception 'blocked' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_chat_id::text, 0));

  select id into v_room
    from public.voice_channels
   where chat_id = p_chat_id
   order by created_at, id
   limit 1;

  if v_room is not null then
    update public.voice_channels
       set max_participants = 2,
           speak_role = 'member',
           archived = false,
           updated_at = pg_catalog.now()
     where id = v_room
       and (max_participants <> 2 or speak_role <> 'member' or archived);
    return v_room;
  end if;

  insert into public.voice_channels (chat_id, name, max_participants, created_by)
  values (p_chat_id, 'Звонок', 2, v_me)
  returning id into v_room;

  return v_room;
end;
$$;

comment on function public.voice_private_room(uuid) is
  'The private chat''s one call room, created on first use. Refuses a group, a non-member and a block.';

-- ── Ringing, answering, stopping ────────────────────────────────────────────

/**
 * Start calling.
 *
 * Returns the room and the moment the ring started, which is what the caller's
 * own interface counts down from — the same number the callee's does, taken
 * from the row rather than from either clock.
 *
 * It refuses a chat that is **already ringing** and one that is **already
 * occupied**. The second is not the same refusal wearing another name: a room
 * with somebody in it is a call in progress, and «call» on it should join, not
 * ring. The client is expected to make that distinction before pressing; the
 * function makes it anyway, because two devices belonging to the same person
 * can press at once.
 */
create or replace function public.voice_call_ring(p_chat_id uuid)
returns table (channel_id uuid, ring_started_at timestamptz)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $$
declare
  v_me uuid := auth.uid();
  v_room uuid;
  v_now timestamptz := pg_catalog.now();
  v_state text;
  v_count integer;
begin
  v_room := public.voice_private_room(p_chat_id);

  select public.voice_ring_state(vc.ring_started_at, vc.ring_answered_at, v_now),
         vc.participant_count
    into v_state, v_count
    from public.voice_channels as vc
   where vc.id = v_room
     for update;

  if v_state in ('ringing', 'answered') then
    raise exception 'already_ringing' using errcode = '55006';
  end if;
  if v_count > 0 then
    raise exception 'already_in_call' using errcode = '55006';
  end if;

  update public.voice_channels as vc
     set ring_started_at = v_now,
         ring_caller = v_me,
         ring_answered_at = null,
         updated_at = v_now
   where vc.id = v_room;

  return query select v_room, v_now;
end;
$$;

comment on function public.voice_call_ring(uuid) is
  'Start ringing the other participant of a private chat. Refuses a live ring and an occupied room.';

/**
 * Answer.
 *
 * Only the side that is **not** calling may answer, and that is the whole of
 * the check: a caller whose own device answered its own ring would produce a
 * call with one person in it and a duration, which is the shape slice B writes
 * down as a conversation that happened.
 *
 * Answering does not connect anybody. It says the ring is over and the call is
 * running; the transport follows on both sides through the gateway exactly as
 * it does for a group room.
 */
create or replace function public.voice_call_answer(p_channel_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $$
declare
  v_me uuid := auth.uid();
  v_chat uuid;
  v_caller uuid;
  v_state text;
  v_now timestamptz := pg_catalog.now();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select vc.chat_id, vc.ring_caller,
         public.voice_ring_state(vc.ring_started_at, vc.ring_answered_at, v_now)
    into v_chat, v_caller, v_state
    from public.voice_channels as vc
   where vc.id = p_channel_id
     for update;

  if v_chat is null then
    raise exception 'no_such_room' using errcode = 'P0002';
  end if;
  if not public.is_chat_member(v_chat) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if v_state <> 'ringing' then
    -- `expired` included: a ring that ran out is not answerable, and saying so
    -- is better than accepting a call the other side stopped waiting for.
    raise exception 'not_ringing' using errcode = '55006';
  end if;
  if v_caller = v_me then
    raise exception 'caller_cannot_answer' using errcode = '42501';
  end if;

  update public.voice_channels as vc
     set ring_answered_at = v_now,
         updated_at = v_now
   where vc.id = p_channel_id;

  return v_now;
end;
$$;

comment on function public.voice_call_answer(uuid) is
  'Accept a ring. Only the side that is not calling, and only while it is still ringing.';

/**
 * Stop — cancelled by the caller, declined by the callee, or simply over.
 *
 * The reason is checked and then, in this slice, discarded. It is taken now
 * rather than later because the alternative is adding an argument to every call
 * site in three shells once slice B exists, and because a refusal here is the
 * cheapest place to find out that a shell is sending a word nobody agreed on.
 *
 * Either participant may stop a ring. Deliberately: a caller cancels, a callee
 * declines, and a callee whose other device already declined should not get an
 * error for saying so twice — which is why a ring that is already `idle` is
 * **not** an error. Stopping is idempotent; starting is not.
 */
create or replace function public.voice_call_stop(p_channel_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $$
declare
  v_me uuid := auth.uid();
  v_chat uuid;
  v_state text;
  v_now timestamptz := pg_catalog.now();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_reason is null or p_reason not in ('cancelled', 'declined', 'answered', 'missed') then
    raise exception 'bad_reason' using errcode = '22023';
  end if;

  select vc.chat_id,
         public.voice_ring_state(vc.ring_started_at, vc.ring_answered_at, v_now)
    into v_chat, v_state
    from public.voice_channels as vc
   where vc.id = p_channel_id
     for update;

  if v_chat is null then
    raise exception 'no_such_room' using errcode = 'P0002';
  end if;
  if not public.is_chat_member(v_chat) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  if v_state = 'idle' then
    return v_state;
  end if;

  update public.voice_channels as vc
     set ring_started_at = null,
         ring_caller = null,
         ring_answered_at = null,
         updated_at = v_now
   where vc.id = p_channel_id;

  return v_state;
end;
$$;

comment on function public.voice_call_stop(uuid, text) is
  'Clear a ring, whatever ended it. Idempotent: stopping an idle room is not an error.';

-- ── Who may see and who may call ────────────────────────────────────────────

/**
 * SELECT on the three new columns, and nothing else.
 *
 * A column grant list does not grow when a column is added, and Realtime sends
 * only the columns the subscribing role may select — so this line is what makes
 * the ring visible to the subscription the whole design rests on. Without it,
 * every service-role query would show the ring and no client would ever see one.
 *
 * No UPDATE, deliberately. The three functions above are the only way to move
 * this state, which is what keeps «B declined» out of A's hands.
 */
grant select (ring_started_at, ring_caller, ring_answered_at)
  on public.voice_channels to authenticated;

revoke all on function public.voice_private_room(uuid) from public;
revoke all on function public.voice_call_ring(uuid) from public;
revoke all on function public.voice_call_answer(uuid) from public;
revoke all on function public.voice_call_stop(uuid, text) from public;
revoke all on function public.voice_ring_state(timestamptz, timestamptz, timestamptz, integer) from public;

grant execute on function public.voice_private_room(uuid) to authenticated;
grant execute on function public.voice_call_ring(uuid) to authenticated;
grant execute on function public.voice_call_answer(uuid) to authenticated;
grant execute on function public.voice_call_stop(uuid, text) to authenticated;
grant execute on function public.voice_ring_state(timestamptz, timestamptz, timestamptz, integer) to authenticated;

-- ── The self-check, which raises rather than reporting a half-applied state ──

do $$
declare
  v_missing text;
begin
  select string_agg(c, ', ') into v_missing
    from unnest(array['ring_started_at', 'ring_caller', 'ring_answered_at']) as c
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'voice_channels' and column_name = c
   );
  if v_missing is not null then
    raise exception 'columns missing after apply: %', v_missing;
  end if;

  select string_agg(c, ', ') into v_missing
    from unnest(array['ring_started_at', 'ring_caller', 'ring_answered_at']) as c
   where not exists (
     select 1 from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'voice_channels'
        and column_name = c and grantee = 'authenticated' and privilege_type = 'SELECT'
   );
  if v_missing is not null then
    raise exception 'authenticated cannot read: % — the ring would be invisible to Realtime', v_missing;
  end if;

  -- And the grant that must NOT exist: UPDATE on a ring column would let one
  -- side write the other's answer.
  if exists (
    select 1 from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'voice_channels'
       and column_name in ('ring_started_at', 'ring_caller', 'ring_answered_at')
       and grantee in ('authenticated', 'anon') and privilege_type = 'UPDATE'
  ) then
    raise exception 'a ring column is directly writable by a client';
  end if;

  -- The rule, at its four boundaries, before anything depends on it.
  if public.voice_ring_state(null, null, pg_catalog.now()) <> 'idle'
     or public.voice_ring_state(pg_catalog.now(), null, pg_catalog.now()) <> 'ringing'
     or public.voice_ring_state(pg_catalog.now(), pg_catalog.now(), pg_catalog.now()) <> 'answered'
     or public.voice_ring_state(
          pg_catalog.now() - interval '46 seconds', null, pg_catalog.now()) <> 'expired'
     or public.voice_ring_state(
          pg_catalog.now() - interval '44 seconds', null, pg_catalog.now()) <> 'ringing' then
    raise exception 'voice_ring_state does not answer its own four cases';
  end if;
end;
$$;



-- ══ Probes, on synthetic rows only. No real account is read or written. ══

-- The registration trigger demands an invite, which a rehearsal account has
-- no business having. Disabled for this transaction only, and rolled back
-- with everything else; `profiles` rows are then written by hand below.
alter table auth.users disable trigger on_auth_user_created;
alter table public.profiles disable trigger trg_registration_invite_apply_from_profile;
alter table public.profiles disable trigger trg_bootstrap_first_admin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.id || '@rehearsal.invalid', '', now(), now(), '{}'::jsonb, '{}'::jsonb
  from (values ('aaaaaaaa-0000-4000-8000-00000000000a'::uuid), ('bbbbbbbb-0000-4000-8000-00000000000b'::uuid)) as u(id);

insert into public.profiles (id, full_name)
values ('aaaaaaaa-0000-4000-8000-00000000000a', 'Репетиция А'), ('bbbbbbbb-0000-4000-8000-00000000000b', 'Репетиция Б');

insert into public.chats (id, type, name, created_by)
values ('cccccccc-0000-4000-8000-00000000000c', 'private', null, 'aaaaaaaa-0000-4000-8000-00000000000a'),
       ('dddddddd-0000-4000-8000-00000000000d', 'group', 'Репетиция', 'aaaaaaaa-0000-4000-8000-00000000000a');

insert into public.chat_members (chat_id, user_id, role)
values ('cccccccc-0000-4000-8000-00000000000c', 'aaaaaaaa-0000-4000-8000-00000000000a', 'owner'),
       ('cccccccc-0000-4000-8000-00000000000c', 'bbbbbbbb-0000-4000-8000-00000000000b', 'member'),
       ('dddddddd-0000-4000-8000-00000000000d', 'aaaaaaaa-0000-4000-8000-00000000000a', 'owner'),
       ('dddddddd-0000-4000-8000-00000000000d', 'bbbbbbbb-0000-4000-8000-00000000000b', 'member')
on conflict (chat_id, user_id) do update set role = excluded.role;

\echo
\echo ══ 1. the asymmetry this slice exists for: B cannot insert a room, A can ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated"}';
select case when pg_catalog.has_table_privilege('public.voice_channels', 'INSERT')
            then 'grant present (policy decides)' else 'no insert grant' end as b_grant;
select 'B insert refused by policy: ' || (not exists (
  select 1 from pg_policies where tablename = 'voice_channels'
    and policyname = 'admins manage voice channels')) as never_reached;
reset role;

\echo
\echo ══ 2. B makes the room through the RPC, which is the point ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated"}';
select public.voice_private_room('cccccccc-0000-4000-8000-00000000000c') is not null as b_made_a_room;
select count(*) as rooms_after_b from public.voice_channels where chat_id = 'cccccccc-0000-4000-8000-00000000000c';
reset role;

\echo
\echo ══ 3. and A asking for it gets the same room, not a second one ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.voice_private_room('cccccccc-0000-4000-8000-00000000000c') is not null as a_got_a_room;
reset role;
select count(*) as rooms_total from public.voice_channels where chat_id = 'cccccccc-0000-4000-8000-00000000000c';

\echo
\echo ══ 4. a group is refused, in the RPC, whatever the policy says ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}';
do $probe$ begin
  perform public.voice_private_room('dddddddd-0000-4000-8000-00000000000d');
  raise notice 'UNEXPECTED: a group was accepted';
exception when others then raise notice 'group refused: %', sqlerrm; end $probe$;
reset role;

\echo
\echo ══ 5. a block refuses the room ══
insert into public.user_blocks (blocker_id, blocked_id) values ('bbbbbbbb-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-00000000000a');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}';
do $probe$ begin
  perform public.voice_private_room('cccccccc-0000-4000-8000-00000000000c');
  raise notice 'UNEXPECTED: a blocked caller got a room';
exception when others then raise notice 'blocked refused: %', sqlerrm; end $probe$;
reset role;
delete from public.user_blocks where blocker_id = 'bbbbbbbb-0000-4000-8000-00000000000b' and blocked_id = 'aaaaaaaa-0000-4000-8000-00000000000a';

\echo
\echo ══ 6. the ring: A rings, the row says so, B sees the columns ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}';
select channel_id is not null as rang, ring_started_at is not null as stamped from public.voice_call_ring('cccccccc-0000-4000-8000-00000000000c');
reset role;
select public.voice_ring_state(ring_started_at, ring_answered_at, now()) as state,
       ring_caller = 'aaaaaaaa-0000-4000-8000-00000000000a' as caller_is_a
  from public.voice_channels where chat_id = 'cccccccc-0000-4000-8000-00000000000c';

\echo
\echo ══ 7. a second ring is refused while one is live ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}';
do $probe$ begin
  perform public.voice_call_ring('cccccccc-0000-4000-8000-00000000000c');
  raise notice 'UNEXPECTED: a second ring was accepted';
exception when others then raise notice 'second ring refused: %', sqlerrm; end $probe$;
reset role;

\echo
\echo ══ 8. the caller cannot answer their own ring ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}';
do $probe$ declare r uuid; begin
  select id into r from public.voice_channels where chat_id = 'cccccccc-0000-4000-8000-00000000000c';
  perform public.voice_call_answer(r);
  raise notice 'UNEXPECTED: the caller answered themselves';
exception when others then raise notice 'self-answer refused: %', sqlerrm; end $probe$;
reset role;

\echo
\echo ══ 9. B answers, and the state moves ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated"}';
do $probe$ declare r uuid; begin
  select id into r from public.voice_channels where chat_id = 'cccccccc-0000-4000-8000-00000000000c';
  perform public.voice_call_answer(r);
end $probe$;
reset role;
select public.voice_ring_state(ring_started_at, ring_answered_at, now()) as state_after_answer
  from public.voice_channels where chat_id = 'cccccccc-0000-4000-8000-00000000000c';

\echo
\echo ══ 10. stopping clears it, and stopping twice is not an error ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}';
do $probe$ declare r uuid; declare s text; begin
  select id into r from public.voice_channels where chat_id = 'cccccccc-0000-4000-8000-00000000000c';
  s := public.voice_call_stop(r, 'answered');
  raise notice 'first stop returned %', s;
  s := public.voice_call_stop(r, 'answered');
  raise notice 'second stop returned %', s;
  begin
    perform public.voice_call_stop(r, 'nonsense');
    raise notice 'UNEXPECTED: a nonsense reason was accepted';
  exception when others then raise notice 'bad reason refused: %', sqlerrm; end;
end $probe$;
reset role;
select public.voice_ring_state(ring_started_at, ring_answered_at, now()) as state_after_stop
  from public.voice_channels where chat_id = 'cccccccc-0000-4000-8000-00000000000c';

\echo
\echo ══ 11. a room whose settings drifted is normalised, not trusted ══
update public.voice_channels set speak_role = 'admin', max_participants = 10
 where chat_id = 'cccccccc-0000-4000-8000-00000000000c';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}';
select public.voice_private_room('cccccccc-0000-4000-8000-00000000000c') is not null as reopened;
reset role;
select speak_role::text as speak_role, max_participants, archived
  from public.voice_channels where chat_id = 'cccccccc-0000-4000-8000-00000000000c';

\echo
\echo ══ 12. the constraint refuses an incoherent ring ══
do $probe$ begin
  update public.voice_channels set ring_caller = 'aaaaaaaa-0000-4000-8000-00000000000a' where chat_id = 'cccccccc-0000-4000-8000-00000000000c';
  raise notice 'UNEXPECTED: a caller with no ring was accepted';
exception when others then raise notice 'incoherent ring refused: %', sqlerrm; end $probe$;

\echo
\echo ══ 13. no group anywhere in the deployment gained or lost a room ══
select count(*) as group_rooms from public.voice_channels vc
  join public.chats c on c.id = vc.chat_id where c.type = 'group';

rollback;
\echo
\echo ══ rolled back ══
select count(*) as rooms_left_behind from public.voice_channels vc
  join public.chats c on c.id = vc.chat_id where c.type = 'private';
