/**
 * «Once per call, not once per join», run in a real PostgreSQL.
 *
 * Slice 3 of `docs/proposals/2026-09-13-voice-channels.md:1141-1150` states its
 * gate in one sentence and that sentence is the only thing this file is about.
 * A test that passes for a path writing one row per *arrival* would be
 * worthless, so the first case below joins four people and leaves three, and
 * the mutation that turns a transition into an arrival is listed in the header
 * of every assertion it must break.
 *
 * PGlite is PostgreSQL in process, no Docker. The stub is a copy of the
 * production objects this migration touches, transcribed from the recorded
 * migrations -- **except** for the voice tables, the four RPCs and
 * `private.voice_channel_recount`, which are applied from
 * `.migration-backup/supabase/migrations/` verbatim. Those are the objects the
 * new trigger hangs off, and transcribing them would have meant measuring the
 * transcription rather than the thing. What this proves is that the SQL parses,
 * that the self-check passes and refuses what it should, that the rollback
 * removes what the migration adds, and that the behaviour holds against the
 * schema as the migrations record it. It proves nothing about an object
 * production has and the migrations do not show; that is what a rehearsal on a
 * schema copy is for.
 *
 * ── Two bases, and why (D-252) ─────────────────────────────────────────────
 *
 * «The schema as the migrations record it» was a claim this file made and did
 * not keep. It used to apply four recorded migrations and then the subject, and
 * two of the objects it measures had been redefined **later the same day** --
 * so every case here was green about a `private.voice_channel_recount` and a
 * `write_voice_call_service_message` that production had already replaced. The
 * record was honest; the fixed subset was not.
 *
 * So there are two bases now, and a case declares which it is for:
 *
 *   `databaseAsRecorded()`     the whole of `CHAIN` -- what production runs.
 *                              Every behavioural case uses it, because a
 *                              behavioural case is a claim about the product.
 *   `databaseBeforeSubject()`  `CHAIN` truncated immediately before `SUBJECT`.
 *                              Only the cases about the subject *file* use it:
 *                              the four self-check mutations, idempotence, the
 *                              rollback, and the deploy-moment case. All of
 *                              them apply `SUBJECT` last, and applying it last
 *                              on a database that has already run
 *                              `20260918280000` would silently reinstate the
 *                              writer that migration replaced -- a widening
 *                              that looks like it worked and did not.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

const root = fileURLToPath(new URL("../../", import.meta.url));
const migrationSql = (name) =>
  readFileSync(path.join(root, ".migration-backup/supabase/migrations", `${name}.sql`), "utf8");
const rollbackSql = (name) =>
  readFileSync(
    path.join(root, ".migration-backup/supabase/migrations", `${name}.rollback.sql`),
    "utf8",
  );

/**
 * Everything below depends on the definition of one of these, so a recorded
 * migration that replaces any of them belongs in `CHAIN`. The nine
 * `20260913150000` created, the three `20260918200000` added, and the trigger.
 */
const OBJECTS_UNDER_TEST = [
  "public.voice_channel_chat",
  "private.voice_channel_recount",
  "public.voice_participant_joined",
  "public.voice_participant_left",
  "public.voice_participants_replace",
  "public.voice_channel_set_active",
  "public.voice_participants_reap",
  "public.voice_webhook_event_seen",
  "public.voice_webhook_events_purge",
  "public.voice_call_transition",
  "public.voice_call_service_line",
  "public.write_voice_call_service_message",
];
const TRIGGER_UNDER_TEST = "trg_voice_call_service_message";

/**
 * The recorded migrations that own those objects, in the order the record
 * applies them, ending where the record ends rather than where this file was
 * written.
 *
 * "every recorded migration that defines one of these objects is in the chain"
 * below asserts exactly that, so the list cannot go stale again in silence --
 * which is the whole of D-252. An entry that owns nothing is here because the
 * record needs it, and the need was measured rather than assumed: dropping it
 * makes the next file fail to apply, with the error quoted beside it.
 *
 * Two recorded files inside this span are absent and neither owns an object
 * under test: `20260918180000` wants the `realtime` schema and `20260918260000`
 * wants `pg_cron`, and a stub of either would be a self-check asserting against
 * the stub. Their absence is not taken on faith. With the chain exactly as
 * written, `md5(pg_get_functiondef())` for all twelve functions and
 * `md5(pg_get_triggerdef())` for the trigger are identical to production, read
 * off `supabase-db` read-only on 2026-09-19; the two the old list got wrong
 * were `private.voice_channel_recount` and
 * `public.write_voice_call_service_message`.
 */
const CHAIN = [
  // owns the voice tables, the webhook RPCs and private.voice_channel_recount
  "20260913150000_voice_channels",
  // needed: voice_channels.category_id, or 20260918160000 will not apply
  "20260914140000_channel_categories",
  // many rooms per chat, and the stuck-flag repair the hand-zeroed case cites
  "20260918160000_voice_rooms_many_and_the_stuck_flag",
  // owns private.voice_channel_recount: the write-only-when-changed rewrite
  "20260918170000_voice_recount_writes_only_when_something_changed",
  // owns voice_call_transition, voice_call_service_line, the writer and the
  // trigger -- the SUBJECT below, and deliberately not the end of the chain
  "20260918200000_a_call_says_so_in_the_conversation",
  // needed: voice_channels.ring_*, or 20260918230000's self-check will not pass
  "20260918220000_a_private_chat_can_ring",
  "20260918230000_a_ring_cannot_be_forged",
  // owns private.voice_channel_recount: the ring-residue arms beside active_since
  "20260918240000_a_call_that_died_does_not_lock_the_pair_out",
  // needed: messages.system_payload, or 20260918280000 will not apply
  "20260918250000_a_call_says_so_in_the_private_chat",
  "20260918270000_a_call_over_an_hour_says_hours",
  // owns write_voice_call_service_message: the private-chat early return
  "20260918280000_a_private_chat_has_no_channel_to_announce",
];

/**
 * The file whose self-check, idempotence and rollback are measured below. It is
 * a member of `CHAIN`, and deliberately not its last member.
 */
const SUBJECT = "20260918200000_a_call_says_so_in_the_conversation";
const BEFORE_SUBJECT = CHAIN.slice(0, CHAIN.indexOf(SUBJECT));

/**
 * Everything the four voice migrations and the new one reference, and nothing
 * else. `messages` carries the real `messages_sender_shape_check` and the real
 * policies, permissive and restrictive as written, because who may read and
 * write such a row is half of what is asserted below.
 */
const STUB = String.raw`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema private;
revoke all on schema private from public;
grant usage on schema public to anon, authenticated, service_role;

-- 20260913150000 publishes two tables into this and its self-check counts them.
create publication supabase_realtime;

-- 20260504_chats_membership_hardening.sql
create type public.chat_member_role as enum ('owner', 'admin', 'member');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  username text unique
);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('private', 'group', 'channel')),
  name text,
  created_by uuid references public.profiles(id) on delete set null,
  is_forum boolean not null default false,
  invite_policy text not null default 'owner_admin_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.chat_member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table public.bans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz
);
create table public.mutes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  chat_id uuid references public.chats(id) on delete cascade,
  expires_at timestamptz
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  name text not null,
  is_general boolean not null default false,
  created_at timestamptz not null default now()
);

-- 20260831100000_bot_platform_foundation.sql gave this its sender shape.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  bot_id uuid,
  content text,
  type text default 'text' check (type in ('text', 'image', 'video', 'audio', 'file', 'sticker', 'system')),
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint messages_sender_shape_check check (
    (type = 'system' and user_id is null and bot_id is null)
    or (coalesce(type, 'text') <> 'system' and not (user_id is not null and bot_id is not null))
  )
);

create function public.is_banned(uid uuid default auth.uid())
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.bans
     where user_id = uid and (expires_at is null or expires_at > now())
  )
$$;
create function public.is_muted(uid uuid, cid uuid default null)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.mutes
     where user_id = uid and (chat_id is null or chat_id = cid)
       and (expires_at is null or expires_at > now())
  )
$$;
create function public.is_chat_member(cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.chat_members where chat_id = cid and user_id = auth.uid())
$$;
create function public.is_chat_admin(cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.chat_members
     where chat_id = cid and user_id = auth.uid() and role in ('owner', 'admin')
  )
$$;
grant execute on function public.is_banned(uuid), public.is_muted(uuid, uuid),
  public.is_chat_member(uuid), public.is_chat_admin(uuid) to anon, authenticated, service_role;

grant select, insert, update, delete on public.chats, public.chat_members, public.topics,
  public.messages to authenticated;
grant select on public.profiles to authenticated;

-- 20260504_chats_membership_hardening.sql, 20260504_roles_admin.sql,
-- 20260506_chat_history_private_hide_permissions.sql: the live set, and the
-- permissive/restrictive split is what the visibility cases rest on.
alter table public.messages enable row level security;
create policy "Chat members can view messages" on public.messages for select to authenticated
  using (public.is_chat_member(chat_id));
create policy "Chat members can send messages" on public.messages for insert to authenticated
  with check ((select auth.uid()) = user_id and bot_id is null and public.is_chat_member(chat_id));
create policy "Users can edit own messages" on public.messages for update
  using (user_id = auth.uid());
create policy "block muted/banned from sending" on public.messages as restrictive for insert
  with check (not public.is_banned(auth.uid()) and not public.is_muted(auth.uid(), chat_id));
create policy "block banned reads" on public.messages as restrictive for select
  using (not public.is_banned(auth.uid()));

alter table public.chats enable row level security;
create policy "members read chats" on public.chats for select to authenticated
  using (public.is_chat_member(id));
alter table public.chat_members enable row level security;
create policy "members read membership" on public.chat_members for select to authenticated
  using (public.is_chat_member(chat_id));
alter table public.topics enable row level security;
create policy "members read topics" on public.topics for select to authenticated
  using (public.is_chat_member(chat_id));
`;

/** A failed statement leaves PGlite in an aborted transaction; close it first. */
async function execOrRollback(db, sql) {
  try {
    return await db.exec(sql);
  } catch (error) {
    await db.exec("rollback").catch(() => {});
    throw error;
  }
}

/** The stub plus the named recorded migrations, applied in the order given. */
async function databaseThrough(names) {
  const db = await new PGlite();
  await db.exec(STUB);
  for (const name of names) await execOrRollback(db, migrationSql(name));
  return db;
}

/** What production runs. Every behavioural case below is measured against it. */
const databaseAsRecorded = () => databaseThrough(CHAIN);

/**
 * The chain truncated immediately before the subject, so that applying the
 * subject -- whole, mutated, or followed by its rollback -- leaves it the last
 * word on the objects it owns. Only the cases about the subject file use this.
 */
const databaseBeforeSubject = () => databaseThrough(BEFORE_SUBJECT);

/** @type {PGlite} */
let db;

before(async () => {
  db = await databaseAsRecorded();
});

after(async () => {
  await db?.close();
});

let serial = 0;

/** A group with two members and one voice room, fresh for each case. */
async function group(roomName = "Общая") {
  serial += 1;
  const suffix = String(serial).padStart(4, "0");
  const anna = `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}00000001`;
  const boris = `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}00000002`;
  const outsider = `cccccccc-cccc-4ccc-8ccc-${suffix}00000003`;
  await db.exec(`
    insert into auth.users (id) values ('${anna}'), ('${boris}'), ('${outsider}');
    insert into public.profiles (id, full_name, username)
      values ('${anna}', 'Анна Ковалёва', 'anna${suffix}'),
             ('${boris}', 'Борис Ильин', 'boris${suffix}'),
             ('${outsider}', 'Кто-то ещё', 'other${suffix}');
  `);
  const chat = (
    await db.query(
      `insert into public.chats (type, name, created_by) values ('group', $1, $2) returning id`,
      [`Команда ${suffix}`, anna],
    )
  ).rows[0].id;
  await db.exec(`
    insert into public.chat_members (chat_id, user_id, role)
      values ('${chat}', '${anna}', 'owner'), ('${chat}', '${boris}', 'member');
  `);
  const channel = (
    await db.query(
      `insert into public.voice_channels (chat_id, name, created_by) values ($1, $2, $3) returning id`,
      [chat, roomName, anna],
    )
  ).rows[0].id;
  return { chat, channel, anna, boris, outsider };
}

/**
 * A private chat between two people, with the one room a call there gets.
 *
 * Built by hand rather than through `public.voice_private_room`, which wants an
 * `auth.uid()` and a `blocked_from_chat` this stub has not got; the row is the
 * shape that function inserts -- «Звонок», two seats -- copied from
 * `20260918220000`. What matters is only that the chat is of type `private` and
 * that it has a `voice_channels` row, because that pair is precisely what did
 * not exist when the trigger was written.
 */
async function privatePair() {
  serial += 1;
  const suffix = String(serial).padStart(4, "0");
  const anna = `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}00000001`;
  const boris = `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}00000002`;
  await db.exec(`
    insert into auth.users (id) values ('${anna}'), ('${boris}');
    insert into public.profiles (id, full_name, username)
      values ('${anna}', 'Анна Ковалёва', 'anna${suffix}'),
             ('${boris}', 'Борис Ильин', 'boris${suffix}');
  `);
  const chat = (
    await db.query(
      `insert into public.chats (type, created_by) values ('private', $1) returning id`,
      [anna],
    )
  ).rows[0].id;
  await db.exec(`
    insert into public.chat_members (chat_id, user_id, role)
      values ('${chat}', '${anna}', 'owner'), ('${chat}', '${boris}', 'member');
  `);
  const channel = (
    await db.query(
      `insert into public.voice_channels (chat_id, name, max_participants, created_by)
         values ($1, 'Звонок', 2, $2) returning id`,
      [chat, anna],
    )
  ).rows[0].id;
  return { chat, channel, anna, boris };
}

/**
 * Ordered by `ctid`, which is insertion order for a table nothing has deleted
 * from, rather than by `created_at`. PGlite's clock is coarse enough that two
 * statements share a transaction timestamp, so `created_at` ties and the
 * fallback to a random `id` shuffled the pair -- measured, twice, before this
 * comment existed. In production the two rows are minutes apart.
 */
const lines = async (chat) =>
  (
    await db.query(
      `select content, type, user_id, bot_id from public.messages
        where chat_id = $1 order by ctid`,
      [chat],
    )
  ).rows;

const contents = async (chat) => (await lines(chat)).map((row) => row.content);

const latch = async (channel) =>
  (await db.query(`select call_announced_at from public.voice_channels where id = $1`, [channel]))
    .rows[0].call_announced_at;

const activeSince = async (channel) =>
  (await db.query(`select active_since from public.voice_channels where id = $1`, [channel]))
    .rows[0].active_since;

/** The webhook path's own RPC, called the way `receiveWebhook` calls it. */
const joined = (channel, user, at) =>
  db.query(`select public.voice_participant_joined($1, $2, $3)`, [channel, user, at]);
const left = (channel, user, at) =>
  db.query(`select public.voice_participant_left($1, $2, $3)`, [channel, user, at]);
const setActive = (channel, at) =>
  db.query(`select public.voice_channel_set_active($1, $2)`, [channel, at]);

/**
 * The same `room_started`, dated against the database's own clock.
 *
 * `private.voice_channel_recount` clears `active_since` on an empty room once
 * the flag is more than two minutes old, so whether a flag survives is a fact
 * about its distance from `now()` and has to be written as one. A fixed
 * timestamp here is a case that passes until the afternoon it was written.
 */
const setActiveAgo = (channel, ago) =>
  db.query(`select public.voice_channel_set_active($1, pg_catalog.now() - $2::interval)`, [
    channel,
    ago,
  ]);

const T = (minute) => `2026-09-18T12:${String(minute).padStart(2, "0")}:00.000Z`;

// ── the gate ─────────────────────────────────────────────────────────────────

test("a call with two people writes one start line and one end line, not one per join", async () => {
  const { chat, channel, anna, boris } = await group("Общая");

  // `room_started` first, because that is the real order: asking for a token
  // creates the room before anybody is counted.
  await setActive(channel, T(0));
  await joined(channel, anna, T(1));
  assert.deepEqual(await contents(chat), ["Начался разговор в канале «Общая»"]);

  // The second arrival is the whole gate. A path that wrote per join would put
  // a second line here.
  await joined(channel, boris, T(2));
  assert.deepEqual(
    await contents(chat),
    ["Начался разговор в канале «Общая»"],
    "a second joiner wrote a line, so the message lands once per join",
  );

  await left(channel, anna, T(3));
  assert.deepEqual(
    await contents(chat),
    ["Начался разговор в канале «Общая»"],
    "somebody leaving a call that is still running ended it",
  );

  await left(channel, boris, T(4));
  assert.deepEqual(await contents(chat), [
    "Начался разговор в канале «Общая»",
    "Разговор в канале «Общая» закончился",
  ]);

  // A `room_finished` after the fact adds nothing: it writes `active_since`
  // alone and never reaches `participant_count`.
  await setActive(channel, null);
  assert.equal((await contents(chat)).length, 2);
});

test("ten people join and leave in every order, and the conversation still shows one pair", async () => {
  const { chat, channel } = await group("Планёрка");
  const people = [];
  for (let index = 0; index < 10; index += 1) {
    const id = `dddddddd-dddd-4ddd-8ddd-${String(serial).padStart(4, "0")}0000000${index}`;
    await db.exec(`insert into auth.users (id) values ('${id}');
      insert into public.profiles (id, full_name) values ('${id}', 'Участник ${index}');`);
    people.push(id);
  }
  for (const [index, id] of people.entries()) await joined(channel, id, T(index));
  // Leaving from the middle outwards, so the last departure is not the first
  // arrival and the count crosses every value twice.
  for (const id of [...people.slice(5), ...people.slice(0, 5).reverse()]) {
    await left(channel, id, T(30));
  }
  assert.deepEqual(await contents(chat), [
    "Начался разговор в канале «Планёрка»",
    "Разговор в канале «Планёрка» закончился",
  ]);
});

// ── the three measured facts ─────────────────────────────────────────────────

test("a press that creates the room and connects nobody says nothing at all", async () => {
  // `docs/operations/voice.md:163-167`: asking for a token creates the room, so
  // `room_started` fires for a press that produced no call, and `active_since`
  // is set for a minute afterwards.
  const { chat, channel } = await group("Общая");
  await setActive(channel, T(0));
  assert.deepEqual(await contents(chat), []);
  assert.equal(await latch(channel), null);

  // And again, three times, which is what a retried join on a slow network
  // looks like from here.
  await setActive(channel, T(1));
  await setActive(channel, T(2));
  await setActive(channel, T(3));
  assert.deepEqual(await contents(chat), []);

  // The recount's own stale-flag clear runs over such a channel and is also
  // silent: it writes `active_since` without moving the count.
  await db.query(`update public.voice_channels set active_since = now() - interval '10 minutes'
                    where id = $1`, [channel]);
  await db.query(`select private.voice_channel_recount($1)`, [channel]);
  assert.equal(
    (await db.query(`select active_since from public.voice_channels where id = $1`, [channel]))
      .rows[0].active_since,
    null,
    "the stale flag was not cleared, so this case is no longer measuring what it says",
  );
  assert.deepEqual(await contents(chat), []);
});

test("the end line lands with no room_finished webhook at all", async () => {
  // The reconciler's own write, which is how a `room_finished` lost to a restart
  // is survived: nothing here sends one, and the end line must not wait for it
  // nor for the `active_since` such a webhook would clear.
  //
  // `active_since` is dated **relative to `now()`**, and that is the whole
  // repair to this case. It used to be set to `T(0)` -- a fixed
  // 2026-09-18T12:00:00Z -- and asserted afterwards to be non-null. That held
  // for the five hours between the file being written and the constant falling
  // two minutes into the past. From 12:02Z onwards
  // `private.voice_channel_recount` saw a flag older than its two-minute grace,
  // cleared it in the same UPDATE that dropped the count to zero, and the guard
  // failed -- for a day and a half, reported twice as pre-existing. Nothing in
  // the product had moved: measured on 2026-09-19, this case passes verbatim
  // with the fixture clock wound back inside the window and fails outside it,
  // and the boundary is the grace window to the second.
  //
  // The participant timestamps below stay on `T()`. A fixed constant is only a
  // time bomb once something compares it with `now()`, and nothing compares
  // `joined_at` with anything here.

  // -- the flag is alive, so the end line is measurably not waiting for it ----
  const live = await group("Общая");
  await setActiveAgo(live.channel, "0 seconds");
  const flagBefore = await activeSince(live.channel);
  assert.notEqual(
    flagBefore,
    null,
    "voice_channel_set_active left no flag, so there is nothing for the end line to be independent of",
  );
  await joined(live.channel, live.anna, T(1));
  await db.query(`select public.voice_participants_replace($1, $2::uuid[], $3)`, [
    live.channel,
    [],
    T(5),
  ]);
  assert.deepEqual(await contents(live.chat), [
    "Начался разговор в канале «Общая»",
    "Разговор в канале «Общая» закончился",
  ]);
  assert.deepEqual(
    await activeSince(live.channel),
    flagBefore,
    "the recount cleared a flag younger than its own two-minute grace, so either that grace " +
      "is gone or this case has aged again -- read voice_channel_recount before the trigger",
  );

  // -- and once the grace has passed, one statement does both ----------------
  // Which is what production does for every call that outlives two minutes: the
  // recount drops the count to zero and clears the stale flag in the same
  // UPDATE, and the end line still has to land. This half is what the case
  // above silently turned into while it was red, so it is named here on purpose
  // rather than arrived at by the calendar.
  const stale = await group("Общая");
  await setActiveAgo(stale.channel, "3 minutes");
  await joined(stale.channel, stale.anna, T(1));
  await db.query(`select public.voice_participants_replace($1, $2::uuid[], $3)`, [
    stale.channel,
    [],
    T(5),
  ]);
  assert.deepEqual(await contents(stale.chat), [
    "Начался разговор в канале «Общая»",
    "Разговор в канале «Общая» закончился",
  ]);
  assert.equal(
    await activeSince(stale.channel),
    null,
    "a flag three minutes past its grace survived an empty recount, so both halves of this " +
      "case are now the same case and the first one proves nothing",
  );
});

test("the reaper ends a call whose every webhook was lost", async () => {
  // Layer 4: the residue sweep. No leave webhook, no reconciler observation,
  // no `room_finished` -- only a row nobody has confirmed lately.
  const { chat, channel, anna } = await group("Общая");
  await joined(channel, anna, T(1));
  const reaped = (
    await db.query(`select public.voice_participants_reap(now() + interval '1 hour') as n`)
  ).rows[0].n;
  assert.equal(reaped, 1, "the reaper removed nothing, so this case proves nothing");
  assert.deepEqual(await contents(chat), [
    "Начался разговор в канале «Общая»",
    "Разговор в канале «Общая» закончился",
  ]);
});

test("a webhook delivered twice, and delivered out of order, writes nothing extra", async () => {
  const { chat, channel, anna, boris } = await group("Общая");

  // The same `participant_joined` twice. `voice_webhook_event_seen` would stop
  // a redelivery carrying the same event id before this point; what is measured
  // here is the case it cannot stop -- the same fact arriving under a new id.
  await joined(channel, anna, T(1));
  await joined(channel, anna, T(1));
  await joined(channel, anna, T(1));
  assert.deepEqual(await contents(chat), ["Начался разговор в канале «Общая»"]);

  // The duplicate-identity ordering of slice 2's gate: a late `left` for a
  // session the new one replaced must lose the `joined_at` comparison, so the
  // count never dips and the conversation never says the call ended.
  await joined(channel, anna, T(4));
  await left(channel, anna, T(1));
  assert.deepEqual(await contents(chat), ["Начался разговор в канале «Общая»"]);

  await joined(channel, boris, T(5));
  await left(channel, boris, T(6));
  await left(channel, boris, T(6));
  await left(channel, anna, T(7));
  await left(channel, anna, T(7));
  assert.deepEqual(await contents(chat), [
    "Начался разговор в канале «Общая»",
    "Разговор в канале «Общая» закончился",
  ]);
});

// ── the latch ────────────────────────────────────────────────────────────────

test("a call already in progress when this is applied does not announce an ending", async () => {
  // The real deploy moment, and it has to be staged as such: the people are in
  // the room **before** the trigger exists, so the conversation was never told
  // a call began. Raising the count after the migration would be a 0 -> N
  // transition like any other and would measure nothing.
  //
  // Base: `databaseBeforeSubject()`. This case is about the moment `SUBJECT`
  // was applied, so the schema it is applied to has to be the one that existed
  // then -- the chain's later entries had not been written.
  const fresh = await databaseBeforeSubject();
  try {
    const chat = (
      await fresh.query(
        `insert into public.chats (type, name) values ('group', 'Команда') returning id`,
      )
    ).rows[0].id;
    const channel = (
      await fresh.query(
        `insert into public.voice_channels (chat_id, name) values ($1, 'Общая') returning id`,
        [chat],
      )
    ).rows[0].id;
    const user = "eeeeeeee-eeee-4eee-8eee-000000000001";
    await fresh.exec(`insert into auth.users (id) values ('${user}');
      insert into public.profiles (id, full_name) values ('${user}', 'Анна Ковалёва');`);
    await fresh.query(`select public.voice_participant_joined($1, $2, $3)`, [channel, user, T(1)]);
    assert.equal(
      (await fresh.query(`select participant_count from public.voice_channels where id = $1`, [
        channel,
      ])).rows[0].participant_count,
      1,
      "nobody was in the room before the migration, so this case measures nothing",
    );

    await execOrRollback(fresh, migrationSql(SUBJECT));

    // The call finishes. The conversation must stay silent rather than announce
    // an ending for a beginning nobody wrote.
    await fresh.query(`select public.voice_participant_left($1, $2, $3)`, [channel, user, T(2)]);
    const after = (
      await fresh.query(`select content from public.messages where chat_id = $1`, [chat])
    ).rows.map((row) => row.content);
    assert.deepEqual(after, [], "a call in progress at deploy time announced an ending");

    // And the next real call announces itself normally.
    //
    // `ctid`, for the reason the `lines()` helper above gives: PGlite's clock
    // ties the two `created_at` values and the fallback to a random `id` then
    // shuffles the pair. This query was the one place in the file still
    // ordering by `created_at, id`, and it flaked -- measured on 2026-09-19 at
    // roughly one run in six, on a database no change of mine touches.
    await fresh.query(`select public.voice_participant_joined($1, $2, $3)`, [channel, user, T(5)]);
    await fresh.query(`select public.voice_participant_left($1, $2, $3)`, [channel, user, T(6)]);
    assert.deepEqual(
      (
        await fresh.query(`select content from public.messages where chat_id = $1 order by ctid`, [
          chat,
        ])
      ).rows.map((row) => row.content),
      ["Начался разговор в канале «Общая»", "Разговор в канале «Общая» закончился"],
    );
  } finally {
    await fresh.close();
  }
});

test("a repair that zeroes a count by hand is silent when no call was announced", async () => {
  // `20260918160000` had to make exactly such a repair. With no announced call
  // the latch keeps it quiet; the case above covers the drop that follows a
  // call the conversation does know about.
  const { chat, channel } = await group("Общая");
  await db.query(
    `update public.voice_channels set participant_count = 3, call_announced_at = null where id = $1`,
    [channel],
  );
  await db.query(`update public.voice_channels set call_announced_at = null where id = $1`, [
    channel,
  ]);
  await db.query(`update public.voice_channels set participant_count = 0 where id = $1`, [channel]);
  assert.equal(
    (await contents(chat)).filter((line) => line.includes("закончился")).length,
    0,
    "a hand-zeroed count with no announced call wrote an end line",
  );
});

test("a latch left set by hand on an empty room costs one line and then heals", async () => {
  // The start arm's `not p_announced` half only differs from nothing at all in
  // this state, and nothing in the product can reach it: the latch is released
  // in the same statement that writes the end line. A hand-written repair can,
  // so the cost is measured rather than assumed -- one «закончился» with no
  // beginning above it, once, after which the channel behaves normally.
  //
  // Without this case, removing that half of the rule turns no test red, which
  // is how it was found.
  const { chat, channel, anna } = await group("Общая");
  await db.query(`update public.voice_channels set call_announced_at = now() where id = $1`, [
    channel,
  ]);

  await joined(channel, anna, T(1));
  assert.deepEqual(
    await contents(chat),
    [],
    "a second start line was written for a call the conversation already believes is running",
  );

  await left(channel, anna, T(2));
  assert.deepEqual(await contents(chat), ["Разговор в канале «Общая» закончился"]);
  assert.equal(await latch(channel), null, "the orphan end line did not release the latch");

  await joined(channel, anna, T(5));
  await left(channel, anna, T(6));
  assert.deepEqual(await contents(chat), [
    "Разговор в канале «Общая» закончился",
    "Начался разговор в канале «Общая»",
    "Разговор в канале «Общая» закончился",
  ]);
});

test("a second call is a second pair of lines", async () => {
  const { chat, channel, anna } = await group("Общая");
  await joined(channel, anna, T(1));
  await left(channel, anna, T(2));
  await joined(channel, anna, T(10));
  await left(channel, anna, T(11));
  assert.deepEqual(await contents(chat), [
    "Начался разговор в канале «Общая»",
    "Разговор в канале «Общая» закончился",
    "Начался разговор в канале «Общая»",
    "Разговор в канале «Общая» закончился",
  ]);
});

// ── the room that is not a channel ───────────────────────────────────────────

test("a private chat's room fills and empties and the conversation stays silent", async () => {
  // `20260918280000`, and the only case in this file that can tell the current
  // writer from the one it replaced. Everything above seeds a group, for which
  // the two are identical -- which is why the stale chain cost nothing visible
  // and could have gone on costing nothing visible indefinitely.
  //
  // The owner found the defect on their first real call: five lines about one
  // cancelled call, four of them from this trigger, naming a «канал» that
  // exists only as `voice_private_room`'s internal name for the row. A private
  // chat has no channel, and slice B already writes the call down from
  // `voice_call_stop` with the outcome, the direction and the length.
  //
  // This is the case that makes `CHAIN` load-bearing rather than decorative.
  // Measured on 2026-09-19: drop `20260918280000` from `CHAIN` and it fails on
  // the first assertion with the two lines the migration exists to forbid,
  // while every other case in the file stays green.
  const { chat, channel, anna, boris } = await privatePair();

  await setActive(channel, T(0));
  await joined(channel, anna, T(1));
  await joined(channel, boris, T(2));
  assert.deepEqual(
    await contents(chat),
    [],
    "a private chat was told a conversation began in a channel it has not got",
  );

  await left(channel, anna, T(3));
  await left(channel, boris, T(4));
  assert.deepEqual(
    await contents(chat),
    [],
    "a private chat was told a conversation in a channel ended",
  );

  // The early return comes before the latch, so the row is left alone rather
  // than half-written: a later change that moved the check below the transition
  // arithmetic would leave this set.
  assert.equal(await latch(channel), null, "the private room latched a call as announced");

  // And the group beside it is unaffected -- the fix is a private-chat early
  // return, not a trigger that has stopped working.
  const heard = await group("Общая");
  await joined(heard.channel, heard.anna, T(1));
  await left(heard.channel, heard.anna, T(2));
  assert.deepEqual(await contents(heard.chat), [
    "Начался разговор в канале «Общая»",
    "Разговор в канале «Общая» закончился",
  ]);
});

// ── the sentence, and a room that outlives its name ──────────────────────────

test("the line names the room, and keeps that name when the room is renamed or deleted", async () => {
  const { chat, channel, anna } = await group("Общая");
  await joined(channel, anna, T(1));
  await left(channel, anna, T(2));

  // Renaming the room afterwards changes nothing: the sentence is a snapshot,
  // so last week's history is not rewritten by an administrator tidying up.
  await db.query(`update public.voice_channels set name = 'Переговорная' where id = $1`, [channel]);
  assert.deepEqual(await contents(chat), [
    "Начался разговор в канале «Общая»",
    "Разговор в канале «Общая» закончился",
  ]);

  // And deleting the room leaves both lines standing. There is no foreign key
  // from the message to the channel, which is the whole reason.
  await db.query(`delete from public.voice_channels where id = $1`, [channel]);
  assert.deepEqual(await contents(chat), [
    "Начался разговор в канале «Общая»",
    "Разговор в канале «Общая» закончился",
  ]);
});

test("a rename during a call is reflected from the moment it happens, not retroactively", async () => {
  // Each line records the name the room had when that line was written. Stated
  // as a test rather than left to be discovered.
  const { chat, channel, anna } = await group("Общая");
  await joined(channel, anna, T(1));
  await db.query(`update public.voice_channels set name = 'Переговорная' where id = $1`, [channel]);
  await left(channel, anna, T(2));
  assert.deepEqual(await contents(chat), [
    "Начался разговор в канале «Общая»",
    "Разговор в канале «Переговорная» закончился",
  ]);
});

test("the sentence names no room id, no status code and no webhook", async () => {
  const { chat, channel, anna } = await group("Общая");
  await joined(channel, anna, T(1));
  await left(channel, anna, T(2));
  for (const line of await contents(chat)) {
    assert.ok(!line.includes(channel), `the line names the room id: ${line}`);
    assert.ok(!line.includes(chat), `the line names the chat id: ${line}`);
    assert.doesNotMatch(
      line,
      /room_started|room_finished|participant_|webhook|livekit|[0-9]{3}/i,
      `the line reads like a log entry: ${line}`,
    );
  }
});

test("both rows are the shape the client draws as a service line", async () => {
  const { chat, channel, anna } = await group("Общая");
  await joined(channel, anna, T(1));
  await left(channel, anna, T(2));
  const rows = await lines(chat);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    // `resolveMessageActor` answers `{ kind: "system" }` only when both are
    // absent, and `MessageList` routes on `type === "system"` before it touches
    // a sender. A row with a sender would be drawn as a bubble.
    assert.equal(row.type, "system");
    assert.equal(row.user_id, null);
    assert.equal(row.bot_id, null);
  }
});

// ── who may read it, and who may write one ───────────────────────────────────

/** One statement as `authenticated`, with a `sub` claim, rolled back. */
async function asUser(userId, sql, params = []) {
  await db.exec("begin");
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await db.exec("set local role authenticated");
    return await db.query(sql, params);
  } finally {
    await db.exec("rollback").catch(() => {});
  }
}

test("everybody in the chat reads the line and nobody outside it does", async () => {
  const { chat, channel, anna, boris, outsider } = await group("Общая");
  await joined(channel, anna, T(1));
  await left(channel, anna, T(2));

  const read = async (userId) =>
    (
      await asUser(userId, `select count(*)::int as n from public.messages where chat_id = $1`, [
        chat,
      ])
    ).rows[0].n;

  // `Chat members can view messages` -- the same predicate as
  // `members read voice channels`, so the line's audience is the room's.
  assert.equal(await read(anna), 2, "the owner cannot read the lines");
  assert.equal(await read(boris), 2, "an ordinary member cannot read the lines");
  assert.equal(await read(outsider), 0, "somebody outside the chat can read the lines");

  // And the restrictive `block banned reads` still applies to them.
  await db.exec(`insert into public.bans (user_id) values ('${boris}')`);
  assert.equal(await read(boris), 0, "a banned member still reads the lines");
  await db.exec(`delete from public.bans where user_id = '${boris}'`);
});

test("no client can write a line like this, whatever it claims to be", async () => {
  const { chat, anna } = await group("Общая");
  await assert.rejects(
    () =>
      asUser(
        anna,
        `insert into public.messages (chat_id, type, content)
           values ($1, 'system', 'Начался разговор в канале «Общая»')`,
        [chat],
      ),
    // Either gate refuses it and both are structural: the INSERT policy wants
    // `auth.uid() = user_id`, and `messages_sender_shape_check` wants
    // `user_id is null`. The two cannot both hold.
    /row-level security|violates check constraint/i,
    "a member could forge a service line",
  );
  assert.deepEqual(await contents(chat), []);
});

test("nobody may call the writer, and nobody may set the latch", async () => {
  const { anna, channel } = await group("Общая");
  await assert.rejects(
    () => asUser(anna, `select public.write_voice_call_service_message()`),
    /permission denied|does not exist|can only be called/i,
    "the writer is reachable as a function",
  );
  await assert.rejects(
    () =>
      asUser(anna, `update public.voice_channels set call_announced_at = now() where id = $1`, [
        channel,
      ]),
    /permission denied/i,
    "a member can latch a call as announced",
  );
});

// ── the chain itself ─────────────────────────────────────────────────────────

/**
 * Comments stripped, whitespace collapsed, lowercased.
 *
 * Without it the scan below finds a `create or replace function` for the writer
 * in the prose of every migration that discusses one, and reports files that
 * change nothing. Both comment forms go: the doc blocks these files open with,
 * and a double dash to end of line. A double dash inside a string literal can
 * only cost the scan a match, never invent one, and the per-object floor below
 * turns a scanner that has stopped matching into a failure rather than a pass.
 */
function sqlOnly(text) {
  let out = "";
  let rest = text;
  for (;;) {
    const open = rest.indexOf("/*");
    if (open < 0) break;
    const close = rest.indexOf("*/", open + 2);
    if (close < 0) {
      rest = rest.slice(0, open);
      break;
    }
    out += rest.slice(0, open) + " ";
    rest = rest.slice(close + 2);
  }
  out += rest;
  return out
    .split("\n")
    .map((line) => {
      const dashes = line.indexOf("--");
      return dashes < 0 ? line : line.slice(0, dashes);
    })
    .join(" ")
    .split(/\s+/)
    .join(" ")
    .toLowerCase();
}

const MIGRATION_DIR = path.join(root, ".migration-backup/supabase/migrations");

/** Applied migrations only: a rollback undoes one and a rehearsal never runs. */
const recordedMigrations = () =>
  readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => !name.endsWith(".rollback.sql") && !name.endsWith(".rehearsal.sql"))
    .map((name) => name.slice(0, -4))
    .sort();

test("every recorded migration that defines one of these objects is in the chain", async () => {
  // The repair for D-252, and the only part of it that keeps working after
  // today. The old list was correct when it was written and wrong eight hours
  // later, because nothing connected it to the record. This does.
  //
  // What it cannot see is named rather than implied: a migration that changes
  // what these objects *do* without redefining them -- a column one of them
  // reads, a constraint on a table one of them writes -- passes this case.
  // That is the shape `20260918280000` itself describes, and the answer to it
  // is a behavioural case, not a scan.
  const owners = new Map();
  const note = (object, file) => {
    if (!owners.has(object)) owners.set(object, []);
    owners.get(object).push(file);
  };
  for (const name of recordedMigrations()) {
    const sql = sqlOnly(migrationSql(name));
    for (const qualified of OBJECTS_UNDER_TEST) {
      const bare = qualified.slice(qualified.indexOf(".") + 1);
      const defines = [qualified, bare].some(
        (spelling) =>
          sql.includes(`create function ${spelling}(`) ||
          sql.includes(`create or replace function ${spelling}(`),
      );
      if (defines) note(qualified, name);
    }
    if (
      sql.includes(`create trigger ${TRIGGER_UNDER_TEST}`) ||
      sql.includes(`create or replace trigger ${TRIGGER_UNDER_TEST}`)
    ) {
      note(TRIGGER_UNDER_TEST, name);
    }
  }

  // A scanner that has stopped matching would otherwise pass this case by
  // finding nothing to complain about.
  for (const object of [...OBJECTS_UNDER_TEST, TRIGGER_UNDER_TEST]) {
    assert.ok(
      (owners.get(object) ?? []).length > 0,
      `no recorded migration appears to define ${object}, so this scan is broken`,
    );
  }

  const strays = [];
  for (const [object, files] of owners) {
    for (const file of files) {
      if (!CHAIN.includes(file)) strays.push(`${file} redefines ${object}`);
    }
  }
  assert.deepEqual(
    strays,
    [],
    "a recorded migration redefines an object this file measures and is not in CHAIN, so " +
      "every case here is asserting something about a definition production has replaced",
  );
});

test("the chain is in the record's own order, and the subject is not its last entry", async () => {
  const recorded = new Set(recordedMigrations());
  for (const name of CHAIN) {
    assert.ok(recorded.has(name), `CHAIN names ${name}, which is not a recorded migration`);
  }
  assert.deepEqual(CHAIN, [...CHAIN].sort(), "CHAIN is not in the order the record applies it");
  assert.ok(CHAIN.includes(SUBJECT), "SUBJECT is not in CHAIN");
  assert.ok(
    BEFORE_SUBJECT.length > 0 && BEFORE_SUBJECT.length < CHAIN.length,
    "BEFORE_SUBJECT is the whole chain or none of it, so one of the two bases is not a base",
  );
  assert.ok(
    CHAIN.indexOf(SUBJECT) < CHAIN.length - 1,
    "SUBJECT is the last entry of CHAIN again, which is the state D-252 described",
  );
});

// ── the file itself ──────────────────────────────────────────────────────────

test("the migration applies again over itself and takes no second effect", async () => {
  // Base: `databaseBeforeSubject()`, and it used to be the shared one. Applying
  // `SUBJECT` a second time to the shared database was harmless while the
  // shared database ended on `SUBJECT`; now that it ends on `20260918280000`
  // the same two lines would have quietly downgraded the writer for every case
  // ordered after this one. Idempotence is a property of the file, so it is
  // measured where the file is the last word.
  const fresh = await databaseBeforeSubject();
  try {
    await execOrRollback(fresh, migrationSql(SUBJECT));
    const chat = (
      await fresh.query(
        `insert into public.chats (type, name) values ('group', 'Команда') returning id`,
      )
    ).rows[0].id;
    const channel = (
      await fresh.query(
        `insert into public.voice_channels (chat_id, name) values ($1, 'Общая') returning id`,
        [chat],
      )
    ).rows[0].id;
    const user = "ffffffff-ffff-4fff-8fff-000000000001";
    await fresh.exec(`insert into auth.users (id) values ('${user}');
      insert into public.profiles (id, full_name) values ('${user}', 'Анна Ковалёва');`);

    await fresh.query(`select public.voice_participant_joined($1, $2, $3)`, [channel, user, T(1)]);
    await execOrRollback(fresh, migrationSql(SUBJECT));
    await fresh.query(`select public.voice_participant_left($1, $2, $3)`, [channel, user, T(2)]);

    assert.deepEqual(
      (
        await fresh.query(`select content from public.messages where chat_id = $1 order by ctid`, [
          chat,
        ])
      ).rows.map((row) => row.content),
      ["Начался разговор в канале «Общая»", "Разговор в канале «Общая» закончился"],
    );
  } finally {
    await fresh.close();
  }
});

/**
 * The self-check is only worth having if it fails, and the mutation has to be
 * made in the **file** rather than in the database: the migration is
 * idempotent, so a `create or replace` applied to a live database is undone by
 * the file's own statements before the check block is ever reached. Measured
 * the hard way -- the first version of this case mutated the function and
 * passed, which is a test that proves nothing.
 *
 * Each substitution is asserted to have applied. A replacement that silently
 * matched nothing would leave the file intact and the case green.
 */
const SELF_CHECK_MUTATIONS = [
  {
    what: "the rule fires per arrival rather than per call",
    from: `    when coalesce(p_before, 0) = 0
     and coalesce(p_after, 0) > 0
     and not coalesce(p_announced, false)
    then 'start'`,
    to: `    when coalesce(p_after, 0) > coalesce(p_before, 0)
    then 'start'`,
    raises: /once per join|slice 3/i,
  },
  {
    what: "the end arm no longer requires an announced call",
    from: `    when coalesce(p_before, 0) > 0
     and coalesce(p_after, 0) = 0
     and coalesce(p_announced, false)
    then 'end'`,
    to: `    when coalesce(p_before, 0) > 0
     and coalesce(p_after, 0) = 0
    then 'end'`,
    raises: /announce an ending nobody saw begin/i,
  },
  {
    what: "the start sentence is reworded",
    from: `    return 'Начался разговор в канале «' || v_name || '»';`,
    to: `    return 'Голосовой канал «' || v_name || '»: room_started';`,
    raises: /the start line is not the approved sentence/i,
  },
  {
    what: "the writer stops latching the call as announced",
    from: `  new.call_announced_at := case when v_transition = 'start' then pg_catalog.now() else null end;`,
    to: `  new.call_announced_at := old.call_announced_at;`,
    raises: /without latching the call as announced/i,
  },
];

for (const mutation of SELF_CHECK_MUTATIONS) {
  test(`the self-check raises when ${mutation.what}`, async () => {
    const source = migrationSql(SUBJECT);
    const occurrences = source.split(mutation.from).length - 1;
    assert.equal(
      occurrences,
      1,
      "the mutation matched nothing in the migration, so this case proves nothing",
    );
    const mutated = source.replace(mutation.from, mutation.to);
    // Base: `databaseBeforeSubject()`, so the mutated file is the last word on
    // the objects it owns. On the full chain, `20260918280000` would replace
    // the writer immediately afterwards and the mutation would be measuring
    // nothing -- which is exactly the trap D-252 named.
    const broken = await databaseBeforeSubject();
    try {
      await assert.rejects(
        () => execOrRollback(broken, mutated),
        mutation.raises,
        "the self-check committed a migration whose rule had been broken",
      );
      // And nothing was committed: the raise has to roll the whole file back.
      const column = (
        await broken.query(
          `select count(*)::int as n from pg_attribute
            where attrelid = 'public.voice_channels'::regclass
              and attname = 'call_announced_at' and not attisdropped`,
        )
      ).rows[0].n;
      assert.equal(column, 0, "the refused migration left its column behind");
    } finally {
      await broken.close();
    }
  });
}

test("the rollback removes the trigger, the functions and the column, and keeps the lines", async () => {
  // Base: `databaseBeforeSubject()`. A rollback of `SUBJECT` is only meaningful
  // over the schema `SUBJECT` was applied to; run over the full chain it would
  // drop objects `20260918280000` had since replaced and leave a shape nothing
  // ever had.
  const fresh = await databaseBeforeSubject();
  try {
    await execOrRollback(fresh, migrationSql(SUBJECT));
    const chat = (
      await fresh.query(
        `insert into public.chats (type, name) values ('group', 'Команда') returning id`,
      )
    ).rows[0].id;
    const channel = (
      await fresh.query(
        `insert into public.voice_channels (chat_id, name) values ($1, 'Общая') returning id`,
        [chat],
      )
    ).rows[0].id;
    await fresh.query(`update public.voice_channels set participant_count = 1 where id = $1`, [
      channel,
    ]);
    await fresh.query(`update public.voice_channels set participant_count = 0 where id = $1`, [
      channel,
    ]);
    const before = (
      await fresh.query(`select count(*)::int as n from public.messages where chat_id = $1`, [chat])
    ).rows[0].n;
    assert.equal(before, 2);

    await execOrRollback(fresh, rollbackSql(SUBJECT));

    const left = (
      await fresh.query(`select count(*)::int as n from public.messages where chat_id = $1`, [chat])
    ).rows[0].n;
    assert.equal(left, 2, "the rollback deleted people's conversation history");
    const column = (
      await fresh.query(
        `select count(*)::int as n from pg_attribute
          where attrelid = 'public.voice_channels'::regclass
            and attname = 'call_announced_at' and not attisdropped`,
      )
    ).rows[0].n;
    assert.equal(column, 0);

    // And the room still works afterwards: a call writes nothing and nothing
    // errors, which is what a rollback has to leave behind.
    await fresh.query(`update public.voice_channels set participant_count = 1 where id = $1`, [
      channel,
    ]);
    const after = (
      await fresh.query(`select count(*)::int as n from public.messages where chat_id = $1`, [chat])
    ).rows[0].n;
    assert.equal(after, 2);

    // The migration applies again on a rolled-back database.
    await execOrRollback(fresh, migrationSql(SUBJECT));
  } finally {
    await fresh.close();
  }
});
