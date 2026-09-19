/**
 * The removal of the call service message, and its restore, run in a real
 * PostgreSQL.
 *
 * This file used to prove «once per call, not once per join» — the gate of
 * slice 3 of `docs/proposals/2026-09-13-voice-channels.md:1141-1150`. That
 * feature was removed from production on 2026-09-19 at the owner's instruction:
 * «по сути и так видно если люди сидят, можно просто оставить отметку на группе
 * о том сколько людей в войсе как уже есть чтобы не мусорить инфой». A group
 * shows who is in a channel on the channel itself, continuously, and two rows
 * appended to a conversation for ever said the same thing worse.
 *
 * So the twenty-odd cases that measured the feature are gone: a suite that is
 * green about sentences the product no longer writes is not coverage, it is a
 * false statement with a tick beside it. **The harness is not gone**, because
 * it is the only place in this repository where a migration can be run, mutated
 * and rolled back against the schema as the record holds it, and that is
 * exactly what the removal needs.
 *
 * What is proved here now:
 *
 *  - a group's room fills and empties and the conversation stays silent;
 *  - the lines the feature already wrote are **still there** afterwards — the
 *    removal takes out a mechanism, and the twenty-five rows it had written
 *    were deleted separately, from a verified export, on the owner's own
 *    instruction;
 *  - **a private chat's call record still works**, which is the thing that
 *    could most easily have been cut by mistake. `voice_call_stop` and
 *    `voice_call_record_line` are a different mechanism with a different
 *    wording, carried in `messages.system_payload`, and the owner asked about
 *    channels in groups;
 *  - both self-checks refuse a half-applied state, each by a mutation that has
 *    to be shown to have matched;
 *  - the rollback restores the feature **exactly** — `pg_get_functiondef` and
 *    `pg_get_triggerdef` compared by md5 against the state before the removal,
 *    which is how a transcription that had dropped the inline comments from
 *    `voice_call_transition` was caught;
 *  - and the writer it restores is `20260918280000`'s, not `20260918200000`'s,
 *    so a private chat is not told about a «канал» again.
 *
 * PGlite is PostgreSQL in process, no Docker. The stub is a copy of the
 * production objects these migrations touch, transcribed from the recorded
 * migrations -- **except** for the voice tables, the RPCs and
 * `private.voice_channel_recount`, which are applied from
 * `.migration-backup/supabase/migrations/` verbatim. What this proves is that
 * the SQL parses, that the self-checks pass and refuse what they should, that
 * the round trip is exact, and that the behaviour holds against the schema as
 * the migrations record it. It proves nothing about an object production has
 * and the migrations do not show; that is what a rehearsal on a schema copy is
 * for, and the removal had one before it was applied.
 *
 * ── Two bases, and why (D-252) ─────────────────────────────────────────────
 *
 * «The schema as the migrations record it» was a claim this file made and did
 * not keep. It used to apply a fixed subset and then the subject, and two of
 * the objects it measures had been redefined **later the same day** -- so every
 * case here was green about a `private.voice_channel_recount` and a
 * `write_voice_call_service_message` that production had already replaced.
 *
 * So there are two bases, and a case declares which it is for:
 *
 *   `databaseAsRecorded()`     the whole of `CHAIN` -- what production runs.
 *                              Every behavioural case uses it, because a
 *                              behavioural case is a claim about the product.
 *   `databaseBeforeSubject()`  `CHAIN` truncated immediately before `SUBJECT`,
 *                              which is the feature still in place. The cases
 *                              about the subject *file* use it: its self-check
 *                              mutations, its idempotence, and the round trip,
 *                              all of which need the thing being removed to
 *                              still be there.
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
 * migration that defines **or drops** any of them belongs in `CHAIN`.
 *
 * The «or drops» is new and it is the whole reason the scan below was widened.
 * The subject of this file creates nothing: a scan that only looked for
 * `create` would have reported the removal as touching nothing and let a
 * second, later removal of one of these objects sit outside `CHAIN` unnoticed
 * -- D-252's failure again, from the other side.
 *
 * The last two are the mechanism this file's subject deliberately does **not**
 * remove, and they are measured for exactly that reason.
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
  "public.voice_call_record_line",
  "public.voice_call_stop",
];
const TRIGGER_UNDER_TEST = "trg_voice_call_service_message";

/**
 * The recorded migrations that own those objects, in the order the record
 * applies them, ending where the record ends rather than where this file was
 * written.
 *
 * "every recorded migration that defines or drops one of these objects is in
 * the chain" below asserts exactly that, so the list cannot go stale again in
 * silence -- which is the whole of D-252. An entry that owns nothing is here
 * because the record needs it, and the need was measured rather than assumed:
 * dropping it makes the next file fail to apply.
 *
 * Two recorded files inside this span are absent and neither owns an object
 * under test: `20260918180000` wants the `realtime` schema and `20260918260000`
 * wants `pg_cron`, and a stub of either would be a self-check asserting against
 * the stub.
 */
const CHAIN = [
  // owns the voice tables, the webhook RPCs and private.voice_channel_recount
  "20260913150000_voice_channels",
  // needed: voice_channels.category_id, or 20260918160000 will not apply
  "20260914140000_channel_categories",
  // many rooms per chat, and the stuck-flag repair
  "20260918160000_voice_rooms_many_and_the_stuck_flag",
  // owns private.voice_channel_recount: the write-only-when-changed rewrite
  "20260918170000_voice_recount_writes_only_when_something_changed",
  // owns voice_call_transition, voice_call_service_line, the writer and the
  // trigger -- the feature the SUBJECT below removes
  "20260918200000_a_call_says_so_in_the_conversation",
  // needed: voice_channels.ring_*, or 20260918230000's self-check will not pass;
  // owns voice_call_stop
  "20260918220000_a_private_chat_can_ring",
  "20260918230000_a_ring_cannot_be_forged",
  // owns private.voice_channel_recount: the ring-residue arms beside active_since
  "20260918240000_a_call_that_died_does_not_lock_the_pair_out",
  // needed: messages.system_payload; owns voice_call_record_line and rewrites
  // voice_call_stop
  "20260918250000_a_call_says_so_in_the_private_chat",
  // owns voice_call_record_line: the hours arm
  "20260918270000_a_call_over_an_hour_says_hours",
  // owns write_voice_call_service_message: the private-chat early return
  "20260918280000_a_private_chat_has_no_channel_to_announce",
  // the SUBJECT: drops the trigger, the three functions and the column
  "20260919180000_the_rail_already_says_who_is_in_the_channel",
];

/**
 * The file whose self-check, idempotence and round trip are measured below.
 *
 * Unlike every earlier subject of this file it **is** the last entry of
 * `CHAIN`, and that is not the state D-252 described: D-252 was a chain that
 * stopped before the record did, so the cases measured definitions production
 * had replaced. Here the record itself stops at the removal, and the case below
 * asserts that rather than asserting a position.
 */
const SUBJECT = "20260919180000_the_rail_already_says_who_is_in_the_channel";
const BEFORE_SUBJECT = CHAIN.slice(0, CHAIN.indexOf(SUBJECT));

/**
 * Everything the voice migrations reference, and nothing else. `messages`
 * carries the real `messages_sender_shape_check` and the real policies,
 * permissive and restrictive as written, because who may read and write such a
 * row is half of what is asserted below.
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

/**
 * The webhook path's own RPCs, called the way `receiveWebhook` calls them.
 *
 * `latch`, `activeSince`, `setActive` and `setActiveAgo` stood here too, and
 * went with the cases that used them: `call_announced_at` no longer exists to
 * read, and the `active_since` grace window is
 * `tests/server/voice-participant-reconciler.test.mjs`'s subject rather than
 * this file's. A helper kept for a case that no longer exists is a helper
 * somebody will reintroduce the case for.
 */
const joined = (channel, user, at) =>
  db.query(`select public.voice_participant_joined($1, $2, $3)`, [channel, user, at]);
const left = (channel, user, at) =>
  db.query(`select public.voice_participant_left($1, $2, $3)`, [channel, user, at]);

const T = (minute) => `2026-09-18T12:${String(minute).padStart(2, "0")}:00.000Z`;

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

// ── the conversation is silent ───────────────────────────────────────────────

test("a group's room fills and empties and the conversation says nothing", async () => {
  // Driven through the webhook path's own RPCs rather than by writing
  // `participant_count` by hand, because the trigger that used to fire hung off
  // exactly that column and a fixture that moves it a different way would be
  // measuring its own shortcut.
  const { chat, channel, anna, boris } = await group("Общая");
  await joined(channel, anna, T(1));
  await joined(channel, boris, T(2));
  await left(channel, boris, T(3));
  await left(channel, anna, T(4));

  assert.deepEqual(await contents(chat), [], "a whole call still wrote into the conversation");

  // And the silence is the removal's, not the fixture's: the latch the writer
  // used is gone from the table entirely.
  const column = (
    await db.query(
      `select count(*)::int as n from pg_attribute
        where attrelid = 'public.voice_channels'::regclass
          and attname = 'call_announced_at' and not attisdropped`,
    )
  ).rows[0].n;
  assert.equal(column, 0, "call_announced_at is still on voice_channels");
});

test("a second call, a rename and a reaped room are all equally silent", async () => {
  // The three paths that each used to write a line by a different route: a
  // fresh crossing of zero, the reconciler's wholesale replace, and the reaper.
  const { chat, channel, anna, boris } = await group("Общая");
  await joined(channel, anna, T(1));
  await left(channel, anna, T(2));
  await joined(channel, anna, T(3));
  await db.query(`update public.voice_channels set name = 'Переговорная' where id = $1`, [channel]);
  await db.query(`select public.voice_participants_replace($1, $2::uuid[], $3)`, [
    channel,
    [boris],
    T(4),
  ]);
  await db.query(`select public.voice_participants_replace($1, $2::uuid[], $3)`, [channel, [], T(5)]);
  assert.deepEqual(await contents(chat), []);
});

test("the lines the feature already wrote are still in the conversation", async () => {
  // Base: `databaseBeforeSubject()`, because the rows can only be written by
  // the feature this file's subject removes. The removal takes out a mechanism;
  // the twenty-five rows it had written on production were deleted afterwards,
  // separately, from a verified export and on the owner's own instruction. A
  // migration that deleted them itself would do it again on every database it
  // was replayed against.
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
    await fresh.query(`update public.voice_channels set participant_count = 1 where id = $1`, [
      channel,
    ]);
    await fresh.query(`update public.voice_channels set participant_count = 0 where id = $1`, [
      channel,
    ]);
    const written = (
      await fresh.query(`select content from public.messages where chat_id = $1 order by ctid`, [
        chat,
      ])
    ).rows.map((row) => row.content);
    assert.deepEqual(written, [
      "Начался разговор в канале «Общая»",
      "Разговор в канале «Общая» закончился",
    ]);

    await execOrRollback(fresh, migrationSql(SUBJECT));

    assert.deepEqual(
      (
        await fresh.query(`select content from public.messages where chat_id = $1 order by ctid`, [
          chat,
        ])
      ).rows.map((row) => row.content),
      written,
      "the removal deleted people's conversation history",
    );
  } finally {
    await fresh.close();
  }
});

// ── the mechanism that deliberately stays ────────────────────────────────────

/** One statement as `authenticated`, with a `sub` claim. */
async function asUser(userId, sql, params = [], { keep = false } = {}) {
  await db.exec("begin");
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await db.exec("set local role authenticated");
    const result = await db.query(sql, params);
    if (keep) await db.exec("commit");
    return result;
  } finally {
    if (!keep) await db.exec("rollback").catch(() => {});
  }
}

test("a private chat's call record still says what happened", async () => {
  // The thing most easily cut by mistake. `voice_call_stop` and
  // `voice_call_record_line` are a different mechanism from the one removed --
  // a record with an outcome, a direction and a length, carried in
  // `messages.system_payload` -- and the owner asked about channels in groups,
  // not about the call log in a private conversation.
  //
  // Driven through `voice_call_stop` as the product calls it, rather than by
  // asserting the two functions exist: a declaration is not a surface, and what
  // matters is that a call in a private chat still leaves its record on a
  // database the removal has been applied to.
  const { chat, channel, anna } = await privatePair();
  await db.query(
    `update public.voice_channels set ring_started_at = now(), ring_caller = $2 where id = $1`,
    [channel, anna],
  );

  const state = (
    await asUser(anna, `select public.voice_call_stop($1, 'cancelled') as state`, [channel], {
      keep: true,
    })
  ).rows[0].state;
  assert.equal(state, "ringing");

  const rows = await lines(chat);
  assert.equal(rows.length, 1, "the call left no record, or left more than one");
  assert.equal(rows[0].type, "system");
  assert.equal(rows[0].content, "Отменённый звонок");
  const payload = (
    await db.query(`select system_payload from public.messages where chat_id = $1`, [chat])
  ).rows[0].system_payload;
  assert.equal(payload.kind, "call");
  assert.equal(payload.outcome, "cancelled");
  assert.equal(payload.caller, anna);

  // And nothing announced a «канал» beside it, which is what
  // `20260918280000` was written for and what the removal must not undo from
  // the other direction.
  assert.equal(
    rows.filter((row) => (row.content ?? "").includes("канале")).length,
    0,
    "a private chat was told about a channel",
  );
});

test("nothing left in the database names an object the removal dropped", async () => {
  // The catalogue's own answer, and the same question that was put to
  // production read-only before and after the removal. A function whose body
  // still called `voice_call_transition` would parse, deploy and then fail at
  // run time on the first call, which is the failure shape this repository has
  // met before.
  const stale = (
    await db.query(
      `select n.nspname || '.' || p.proname as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prokind = 'f' and n.nspname in ('public', 'private')
          and (pg_get_functiondef(p.oid) like '%voice_call_transition%'
            or pg_get_functiondef(p.oid) like '%voice_call_service_line%'
            or pg_get_functiondef(p.oid) like '%write_voice_call_service_message%'
            or pg_get_functiondef(p.oid) like '%call_announced_at%')
        order by 1`,
    )
  ).rows.map((row) => row.name);
  assert.deepEqual(stale, [], "a function still names something the removal dropped");
});

// ── the chain itself ─────────────────────────────────────────────────────────

/** Which recorded migrations define or drop one of the objects measured here. */
function ownersOf(names) {
  const owners = new Map();
  const note = (object, file) => {
    if (!owners.has(object)) owners.set(object, []);
    owners.get(object).push(file);
  };
  for (const name of names) {
    const sql = sqlOnly(migrationSql(name));
    for (const qualified of OBJECTS_UNDER_TEST) {
      const bare = qualified.slice(qualified.indexOf(".") + 1);
      const touches = [qualified, bare].some(
        (spelling) =>
          sql.includes(`create function ${spelling}(`) ||
          sql.includes(`create or replace function ${spelling}(`) ||
          sql.includes(`drop function ${spelling}(`) ||
          sql.includes(`drop function if exists ${spelling}(`),
      );
      if (touches) note(qualified, name);
    }
    if (
      sql.includes(`create trigger ${TRIGGER_UNDER_TEST}`) ||
      sql.includes(`create or replace trigger ${TRIGGER_UNDER_TEST}`) ||
      sql.includes(`drop trigger ${TRIGGER_UNDER_TEST}`) ||
      sql.includes(`drop trigger if exists ${TRIGGER_UNDER_TEST}`)
    ) {
      note(TRIGGER_UNDER_TEST, name);
    }
  }
  return owners;
}

test("every recorded migration that defines or drops one of these objects is in the chain", async () => {
  // The repair for D-252, widened. The old scan looked only for `create`, so
  // the subject of this file -- which creates nothing at all -- would have been
  // invisible to it, and a second removal of one of these objects could have
  // sat outside CHAIN with every case here still green.
  const owners = ownersOf(recordedMigrations());

  // A scanner that has stopped matching would otherwise pass this case by
  // finding nothing to complain about.
  for (const object of [...OBJECTS_UNDER_TEST, TRIGGER_UNDER_TEST]) {
    assert.ok(
      (owners.get(object) ?? []).length > 0,
      `no recorded migration appears to define or drop ${object}, so this scan is broken`,
    );
  }
  // And it can see a drop specifically, not only a create: the subject must
  // appear as an owner of the four objects it removes.
  for (const object of [
    "public.voice_call_transition",
    "public.voice_call_service_line",
    "public.write_voice_call_service_message",
    TRIGGER_UNDER_TEST,
  ]) {
    assert.ok(
      (owners.get(object) ?? []).includes(SUBJECT),
      `the scan does not see ${SUBJECT} dropping ${object}, so its «or drops» half is not working`,
    );
  }

  const strays = [];
  for (const [object, files] of owners) {
    for (const file of files) {
      if (!CHAIN.includes(file)) strays.push(`${file} touches ${object}`);
    }
  }
  assert.deepEqual(
    strays,
    [],
    "a recorded migration defines or drops an object this file measures and is not in CHAIN, so " +
      "every case here is asserting something about a state production has moved past",
  );
});

test("the chain is in the record's own order, and ends where the record ends", async () => {
  const recorded = recordedMigrations();
  for (const name of CHAIN) {
    assert.ok(recorded.includes(name), `CHAIN names ${name}, which is not a recorded migration`);
  }
  assert.deepEqual(CHAIN, [...CHAIN].sort(), "CHAIN is not in the order the record applies it");
  assert.ok(CHAIN.includes(SUBJECT), "SUBJECT is not in CHAIN");
  assert.ok(
    BEFORE_SUBJECT.length > 0 && BEFORE_SUBJECT.length < CHAIN.length,
    "BEFORE_SUBJECT is the whole chain or none of it, so one of the two bases is not a base",
  );

  // The invariant D-252 actually named, stated directly instead of through the
  // proxy «SUBJECT is not the last entry». The subject here *is* last, and that
  // is only safe while nothing recorded after it touches one of these objects.
  const later = recorded.filter((name) => name > CHAIN[CHAIN.length - 1]);
  const afterwards = [...ownersOf(later).values()].flat();
  assert.deepEqual(
    [...new Set(afterwards)],
    [],
    "a migration recorded after the end of CHAIN touches an object this file measures, so CHAIN stops before the record does -- which is D-252",
  );
});

// ── the file itself ──────────────────────────────────────────────────────────

test("the removal applies again over itself and takes no second effect", async () => {
  // Base: `databaseBeforeSubject()`, so the subject is the last word on the
  // objects it owns. Every statement in it is guarded, so the second run does
  // no DDL and the self-check still has to pass.
  const fresh = await databaseBeforeSubject();
  try {
    await execOrRollback(fresh, migrationSql(SUBJECT));
    await execOrRollback(fresh, migrationSql(SUBJECT));

    const survivors = (
      await fresh.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in
            ('voice_call_transition', 'voice_call_service_line', 'write_voice_call_service_message')`,
      )
    ).rows;
    assert.deepEqual(survivors, []);

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
    assert.equal(
      (await fresh.query(`select count(*)::int as n from public.messages where chat_id = $1`, [chat]))
        .rows[0].n,
      0,
    );
  } finally {
    await fresh.close();
  }
});

/**
 * The self-check is only worth having if it fails, and the mutation has to be
 * made in the **file** rather than in the database: every statement is guarded,
 * so a change applied to a live database is undone by the file's own statements
 * before the check block is ever reached.
 *
 * Each substitution is asserted to have applied. A replacement that silently
 * matched nothing would leave the file intact and the case green.
 *
 * All three mutations here are the same real mistake in different clothes: a
 * `drop … if exists` whose name or signature is wrong drops nothing, says
 * nothing and returns success.
 */
const REMOVAL_MUTATIONS = [
  {
    what: "a function is dropped at the wrong arity, so nothing is dropped",
    from: "drop function if exists public.voice_call_transition(integer, integer, boolean);",
    to: "drop function if exists public.voice_call_transition(integer, integer);",
    raises: /a service-message function survived/i,
  },
  {
    what: "a function is dropped under the wrong name",
    from: "drop function if exists public.voice_call_service_line(text, text);",
    to: "drop function if exists public.voice_call_service_lines(text, text);",
    raises: /a service-message function survived/i,
  },
  {
    what: "the column is dropped under the wrong name",
    from: "alter table public.voice_channels drop column if exists call_announced_at;",
    to: "alter table public.voice_channels drop column if exists call_announced;",
    raises: /call_announced_at survived/i,
  },
];

for (const mutation of REMOVAL_MUTATIONS) {
  test(`the removal's self-check raises when ${mutation.what}`, async () => {
    const source = migrationSql(SUBJECT);
    assert.equal(
      source.split(mutation.from).length - 1,
      1,
      "the mutation matched nothing in the migration, so this case proves nothing",
    );
    const broken = await databaseBeforeSubject();
    try {
      await assert.rejects(
        () => execOrRollback(broken, source.replace(mutation.from, mutation.to)),
        mutation.raises,
        "the self-check committed a removal that had left half of the feature behind",
      );
      // And nothing was committed: the raise has to roll the whole file back,
      // so the trigger and the column are still there.
      assert.equal(
        (
          await broken.query(
            `select count(*)::int as n from pg_trigger where not tgisinternal
              and tgrelid = 'public.voice_channels'::regclass
              and tgname = 'trg_voice_call_service_message'`,
          )
        ).rows[0].n,
        1,
        "the refused removal dropped the trigger anyway",
      );
    } finally {
      await broken.close();
    }
  });
}

test("the trigger cannot be left behind at all: PostgreSQL refuses before the self-check", async () => {
  // The self-check's first arm looks for a surviving trigger, and no plausible
  // mutation reaches it -- which is worth writing down rather than leaving as a
  // green assertion nobody can break. Dropping the writer while its trigger
  // still references it is refused by the database's own dependency tracking,
  // one statement earlier and with a better error. The arm is a belt for a
  // trigger recreated by something outside this file, not for this file.
  const source = migrationSql(SUBJECT);
  const line = "drop trigger if exists trg_voice_call_service_message on public.voice_channels;\n";
  assert.equal(source.split(line).length - 1, 1, "the mutation matched nothing");
  const broken = await databaseBeforeSubject();
  try {
    await assert.rejects(
      () => execOrRollback(broken, source.replace(line, "")),
      /depends on|cannot drop/i,
      "the writer was dropped while its trigger still pointed at it",
    );
    assert.equal(
      (
        await broken.query(
          `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'write_voice_call_service_message'`,
        )
      ).rows[0].n,
      1,
      "nothing should have been dropped",
    );
  } finally {
    await broken.close();
  }
});

// ── the round trip ───────────────────────────────────────────────────────────

/** The definitions, hashed, so «restored» means «the same» and not «similar». */
async function shapeOf(instance) {
  const functions = (
    await instance.query(
      `select p.proname, md5(pg_get_functiondef(p.oid)) as definition
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in
          ('voice_call_transition', 'voice_call_service_line', 'write_voice_call_service_message')
        order by 1`,
    )
  ).rows;
  const triggers = (
    await instance.query(
      `select t.tgname, md5(pg_get_triggerdef(t.oid)) as definition
         from pg_trigger t where not t.tgisinternal
           and t.tgrelid = 'public.voice_channels'::regclass order by 1`,
    )
  ).rows;
  const column = (
    await instance.query(
      `select a.atttypid::regtype::text as type, a.attnotnull as notnull
         from pg_attribute a where a.attrelid = 'public.voice_channels'::regclass
           and a.attname = 'call_announced_at' and not a.attisdropped`,
    )
  ).rows;
  const grants = (
    await instance.query(
      `select privilege_type from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'voice_channels'
          and column_name = 'call_announced_at' and grantee = 'authenticated'
        order by 1`,
    )
  ).rows.map((row) => row.privilege_type);
  return { functions, triggers, column, grants };
}

test("the rollback restores the feature exactly, definitions and grants included", async () => {
  // Comparing `md5(pg_get_functiondef())` rather than reading the restored SQL,
  // because a function body includes its comments and a restore transcribed by
  // hand will not. That is not hypothetical: the first draft of this rollback
  // tidied the inline comments out of `voice_call_transition` and this case is
  // what found it, in the one place a text scan would have said yes.
  const fresh = await databaseBeforeSubject();
  try {
    const before = await shapeOf(fresh);
    assert.equal(before.functions.length, 3, "the feature is not in place to begin with");
    assert.equal(before.triggers.length, 1);
    assert.equal(before.column.length, 1);

    await execOrRollback(fresh, migrationSql(SUBJECT));
    assert.deepEqual(await shapeOf(fresh), {
      functions: [],
      triggers: [],
      column: [],
      grants: [],
    });

    await execOrRollback(fresh, rollbackSql(SUBJECT));
    assert.deepEqual(
      await shapeOf(fresh),
      before,
      "what came back is not what was there: a restore that is only similar is a restore nobody can predict",
    );

    // Behaviour, not only shape. A group is told once per call again…
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
    for (const count of [1, 3, 2, 0]) {
      await fresh.query(`update public.voice_channels set participant_count = $2 where id = $1`, [
        channel,
        count,
      ]);
    }
    assert.deepEqual(
      (
        await fresh.query(`select content from public.messages where chat_id = $1 order by ctid`, [
          chat,
        ])
      ).rows.map((row) => row.content),
      ["Начался разговор в канале «Общая»", "Разговор в канале «Общая» закончился"],
    );

    // …and a private chat still is not, which is `20260918280000`'s repair
    // surviving the round trip. Replaying `20260918200000` here instead would
    // pass every structural assertion above and fail this one.
    const privateChat = (
      await fresh.query(`insert into public.chats (type) values ('private') returning id`)
    ).rows[0].id;
    const privateRoom = (
      await fresh.query(
        `insert into public.voice_channels (chat_id, name, max_participants)
           values ($1, 'Звонок', 2) returning id`,
        [privateChat],
      )
    ).rows[0].id;
    for (const count of [2, 0]) {
      await fresh.query(`update public.voice_channels set participant_count = $2 where id = $1`, [
        privateRoom,
        count,
      ]);
    }
    assert.equal(
      (
        await fresh.query(`select count(*)::int as n from public.messages where chat_id = $1`, [
          privateChat,
        ])
      ).rows[0].n,
      0,
      "a private chat was told about a «канал», so 20260918200000's writer came back instead of 20260918280000's",
    );

    // And the round trip closes: the removal applies again on a restored
    // database, and the rollback again on top of that.
    await execOrRollback(fresh, rollbackSql(SUBJECT));
    await execOrRollback(fresh, migrationSql(SUBJECT));
    assert.deepEqual((await shapeOf(fresh)).functions, []);
  } finally {
    await fresh.close();
  }
});

/**
 * The restore's self-check, mutated. The first of these is the whole reason
 * this rollback is not «run `20260918200000` again»: it is the mistake that
 * would look like success.
 */
const RESTORE_MUTATIONS = [
  {
    what: "20260918200000's writer is restored instead of 20260918280000's",
    from: `  select c.type into v_type from public.chats as c where c.id = new.chat_id;
  if v_type = 'private' then
    return new;
  end if;
`,
    to: "",
    raises: /private chat|«канал»/i,
  },
  {
    what: "the start sentence is reworded",
    from: `    return 'Начался разговор в канале «' || v_name || '»';`,
    to: `    return 'Голосовой канал «' || v_name || '»: room_started';`,
    raises: /the start line is not the approved sentence/i,
  },
  {
    what: "the trigger is created under another name, so nothing fires",
    from: `create trigger trg_voice_call_service_message
  before update of participant_count on public.voice_channels`,
    to: `create trigger trg_voice_call_service_message_unused
  before update of participant_count on public.voice_channels`,
    raises: /expected one service-message trigger/i,
  },
  {
    what: "the end arm stops requiring an announced call",
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
    what: "the writer stops latching the call as announced",
    from: `  new.call_announced_at := case when v_transition = 'start' then pg_catalog.now() else null end;`,
    to: `  new.call_announced_at := old.call_announced_at;`,
    raises: /without latching the call as announced/i,
  },
];

for (const mutation of RESTORE_MUTATIONS) {
  test(`the rollback's self-check raises when ${mutation.what}`, async () => {
    const source = rollbackSql(SUBJECT);
    assert.equal(
      source.split(mutation.from).length - 1,
      1,
      "the mutation matched nothing in the rollback, so this case proves nothing",
    );
    const broken = await databaseThrough([...CHAIN]);
    try {
      await assert.rejects(
        () => execOrRollback(broken, source.replace(mutation.from, mutation.to)),
        mutation.raises,
        "the self-check committed a restore that had brought back the wrong thing",
      );
      // Nothing committed: the database is still the one the removal left.
      assert.deepEqual(await shapeOf(broken), {
        functions: [],
        triggers: [],
        column: [],
        grants: [],
      });
    } finally {
      await broken.close();
    }
  });
}
