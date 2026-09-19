/**
 * A join is announced once, run in a real PostgreSQL.
 *
 * Accepting an invite into a group wrote two system messages: one from the
 * `after insert on public.chat_members` trigger of
 * `20260915140000_a_group_says_who_came_and_went.sql`, and one from
 * `public.group_invite_accept`, which had been writing its own since
 * 2026-05-11 and went on doing so when the trigger arrived under it. Measured
 * read-only on production: three joins since the trigger shipped, three
 * cross-form pairs, no exceptions.
 *
 * `20260919190000_a_join_is_announced_once.sql` narrows the older insert to the
 * two cases the trigger declines — **a channel**, and **a group whose only
 * member is the person who has just joined**. Deleting it outright is the
 * obvious change and is wrong for exactly those two: it swaps a duplicate for
 * silence.
 *
 * ── Why this file exists, and what it is guarding ─────────────────────────
 *
 * The migration's guard, `not (v_chat.type = 'group' and v_members > 1)`, is a
 * hand-written complement of two guards living in **another** function. Nothing
 * in the database ties the two together: if somebody widens the trigger's type
 * check to include channels, or drops its `v_members <= 1` arm, the guard here
 * becomes wrong and neither file changes. A comment saying «keep these in
 * agreement» would not survive that, and the migration's own self-check runs
 * once and is never run again.
 *
 * So this file drives **both mechanisms together** through every combination
 * that can occur, and asserts the number of lines rather than which writer
 * produced it. A drift in either direction then shows up as two lines or as
 * none. That is the only form of this check that keeps working.
 *
 * PGlite is PostgreSQL in process, no Docker. The stub is the minimum schema
 * these two migrations touch, transcribed from the recorded ones; the two
 * migrations under test and `20260509`'s invite table and payload helper are
 * applied **verbatim**, because they are the subject. What this proves is that
 * the SQL parses, that the self-check passes and refuses what it should, that
 * the rollback restores the duplicate, and that the two mechanisms between them
 * write exactly one line for every way of joining. It proves nothing about an
 * object production has and the migrations do not show.
 *
 * The stub carries `trg_add_chat_creator_as_owner` and
 * `trg_enforce_chat_member_delete` from `20260504_chats_membership_hardening`
 * because both are load-bearing here and not background: the first is the whole
 * reason the trigger has a `v_members <= 1` guard at all, and the second is why
 * a memberless group has to be built with a null `created_by` rather than by
 * emptying one.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

const root = fileURLToPath(new URL("../../", import.meta.url));
const DIR = path.join(root, ".migration-backup/supabase/migrations");
const migrationSql = (name) => readFileSync(path.join(DIR, `${name}.sql`), "utf8");
const rollbackSql = (name) => readFileSync(path.join(DIR, `${name}.rollback.sql`), "utf8");

/** The invite table and its payload helper, lifted from the recorded file. */
const INVITES = (() => {
  const source = migrationSql("20260509_group_invites");
  const open = source.indexOf("create table if not exists public.group_invites");
  const close = source.indexOf(
    "revoke all on function public._group_invite_payload(public.group_invites) from public, anon, authenticated;",
  );
  if (open < 0 || close < 0) throw new Error("the invite table or its payload helper moved");
  return source.slice(open, close);
})();

/** The definition the trigger arrived under, and the one being narrowed. */
const ACCEPT_BEFORE = "20260511_invite_accept_read_baseline_and_system_notice";
const MEMBERSHIP_TRIGGER = "20260915140000_a_group_says_who_came_and_went";
const SUBJECT = "20260919190000_a_join_is_announced_once";

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

grant usage on schema public to anon, authenticated, service_role;

create type public.chat_member_role as enum ('owner', 'admin', 'member');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  username text unique,
  avatar_url text
);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('private', 'group', 'channel')),
  name text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.chat_member_role not null default 'member',
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  last_delivered_at timestamptz,
  primary key (chat_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  bot_id uuid,
  type text not null default 'text',
  content text,
  system_payload jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- 20260831100000's shape check: a system row carries no sender at all. Both
-- writers depend on it being satisfiable, and one of them passes an explicit
-- null user_id while the other omits the column.
alter table public.messages
  add constraint messages_sender_shape_check check (
    (type = 'system' and user_id is null and bot_id is null)
    or (coalesce(type, 'text') <> 'system' and not (user_id is not null and bot_id is not null))
  );

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- 20260504_chats_membership_hardening: the creator's own row, and the refusal
-- to remove the last owner. Both are load-bearing for the cases below.
create or replace function public.add_chat_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.chat_members (chat_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (chat_id, user_id) do nothing;
  end if;
  return new;
end $$;

create trigger trg_add_chat_creator_as_owner
  after insert on public.chats
  for each row execute function public.add_chat_creator_as_owner();

create or replace function public.enforce_chat_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining int;
begin
  if old.role = 'owner'::public.chat_member_role then
    perform pg_advisory_xact_lock(hashtext('chat_owner:' || old.chat_id::text));
    select count(*) into remaining
      from public.chat_members
     where chat_id  = old.chat_id
       and role     = 'owner'::public.chat_member_role
       and user_id <> old.user_id;
    if remaining = 0 then
      raise exception 'Нельзя удалить последнего владельца чата'
        using errcode = 'P0001';
    end if;
  end if;
  return old;
end $$;

create trigger trg_enforce_chat_member_delete
  before delete on public.chat_members
  for each row execute function public.enforce_chat_member_delete();

create or replace function public.is_chat_member(p_chat_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_members
     where chat_id = p_chat_id and user_id = auth.uid()
  )
$$;

-- Named by 20260509's SELECT policy on group_invites, so the invite table will
-- not create without it.
create or replace function public.is_chat_admin(p_chat_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_members
     where chat_id = p_chat_id and user_id = auth.uid()
       and role in ('owner'::public.chat_member_role, 'admin'::public.chat_member_role)
  )
$$;
`;

async function execOrRollback(db, sql) {
  try {
    return await db.exec(sql);
  } catch (error) {
    await db.exec("rollback").catch(() => {});
    throw error;
  }
}

/** The stub, the invite table, the old accept, the trigger — and the subject. */
async function database({ withSubject = true } = {}) {
  const db = await new PGlite();
  await db.exec(STUB);
  await execOrRollback(db, INVITES);
  await execOrRollback(db, migrationSql(ACCEPT_BEFORE));
  await execOrRollback(db, migrationSql(MEMBERSHIP_TRIGGER));
  if (withSubject) await execOrRollback(db, migrationSql(SUBJECT));
  return db;
}

/** @type {PGlite} */
let db;
before(async () => {
  db = await database();
});
after(async () => {
  await db?.close();
});

let serial = 0;

/**
 * Two people and a chat of the given shape, with a pending invite for the
 * second of them.
 *
 * `owned` false builds the chat with a null `created_by`, which is the only way
 * to get a group nobody is in: `enforce_chat_member_delete` refuses to remove
 * the last owner, so one cannot be emptied afterwards.
 */
async function invitation(instance, type, { owned = true } = {}) {
  serial += 1;
  const suffix = String(serial).padStart(4, "0");
  const owner = `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}00000001`;
  const joiner = `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}00000002`;
  await instance.exec(`
    insert into auth.users (id) values ('${owner}'), ('${joiner}');
    insert into public.profiles (id, full_name, username)
      values ('${owner}', 'Зоя Яблокова', 'zoya${suffix}'),
             ('${joiner}', 'Борис Ильин', 'boris${suffix}');
  `);
  const chat = (
    await instance.query(
      `insert into public.chats (type, name, created_by) values ($1, $2, $3) returning id`,
      [type, `Чат ${suffix}`, owned ? owner : null],
    )
  ).rows[0].id;
  // Whatever the creator trigger wrote while the chat was being made is not
  // what any of this is about.
  await instance.query(`delete from public.messages where chat_id = $1`, [chat]);
  const invite = (
    await instance.query(
      `insert into public.group_invites (chat_id, inviter_id, invitee_id)
         values ($1, $2, $3) returning id`,
      [chat, owner, joiner],
    )
  ).rows[0].id;
  return { chat, invite, owner, joiner };
}

/** `group_invite_accept` as the invitee, committed. */
async function accept(instance, invite, joiner) {
  await instance.exec("begin");
  try {
    await instance.query(`select set_config('request.jwt.claim.sub', $1, true)`, [joiner]);
    await instance.query(`select public.group_invite_accept($1)`, [invite]);
    await instance.exec("commit");
  } catch (error) {
    await instance.exec("rollback").catch(() => {});
    throw error;
  }
}

const linesIn = async (instance, chat) =>
  (
    await instance.query(
      `select content, type, user_id, bot_id from public.messages
        where chat_id = $1 order by created_at, id`,
      [chat],
    )
  ).rows;

// ── one join, one line ───────────────────────────────────────────────────────

test("accepting an invite into a group writes one line, and it is the trigger's", async () => {
  const { chat, invite, joiner } = await invitation(db, "group");
  await accept(db, invite, joiner);

  const rows = await linesIn(db, chat);
  assert.equal(rows.length, 1, `expected one line, got ${JSON.stringify(rows.map((r) => r.content))}`);
  assert.equal(rows[0].content, "Борис Ильин присоединился(ась) к группе");
  assert.equal(rows[0].type, "system");
  // `messages_sender_shape_check` requires it, and the client draws a row with
  // a sender as a bubble rather than as a centred pill.
  assert.equal(rows[0].user_id, null);
  assert.equal(rows[0].bot_id, null);
});

test("the duplicate is real: the same acceptance wrote two lines before the subject", async () => {
  // Without this, the case above would pass just as well against a database
  // where the older insert had never existed, and would be proving nothing
  // about the change.
  const fresh = await database({ withSubject: false });
  try {
    const { chat, invite, joiner } = await invitation(fresh, "group");
    await accept(fresh, invite, joiner);
    const contents = (await linesIn(fresh, chat)).map((row) => row.content);
    assert.deepEqual(contents.sort(), [
      "Борис Ильин присоединился к группе",
      "Борис Ильин присоединился(ась) к группе",
    ]);
  } finally {
    await fresh.close();
  }
});

test("a channel keeps its line, because the trigger declines a channel", async () => {
  // `group_invite_accept` admits ('group', 'channel'); the membership trigger
  // returns early unless the type is exactly 'group'. Deleting the older insert
  // rather than narrowing it would make this zero.
  const { chat, invite, joiner } = await invitation(db, "channel");
  await accept(db, invite, joiner);

  const rows = await linesIn(db, chat);
  assert.equal(rows.length, 1, `expected one line, got ${JSON.stringify(rows.map((r) => r.content))}`);
  assert.equal(rows[0].content, "Борис Ильин присоединился к группе");
});

test("a group nobody is in keeps its line, because the trigger declines that too", async () => {
  // The trigger's `v_members <= 1` guard exists to ignore the creator's own row
  // — written by `trg_add_chat_creator_as_owner` while the group is being made
  // — and it cannot tell that from a join that leaves one member. Three groups
  // on production have no members and seven have one, so a pending invite
  // outliving its chat's membership is reachable rather than hypothetical.
  const { chat, invite, joiner } = await invitation(db, "group", { owned: false });
  assert.equal(
    (await db.query(`select count(*)::int as n from public.chat_members where chat_id = $1`, [chat]))
      .rows[0].n,
    0,
    "the fixture was supposed to build a group nobody is in",
  );
  await accept(db, invite, joiner);

  const rows = await linesIn(db, chat);
  assert.equal(rows.length, 1, `expected one line, got ${JSON.stringify(rows.map((r) => r.content))}`);
  assert.equal(rows[0].content, "Борис Ильин присоединился к группе");
});

test("an administrator adding somebody directly still writes exactly one line", async () => {
  // The path that never went through `group_invite_accept` at all: a row
  // inserted straight into `chat_members` under the RLS policy. It was the
  // trigger's alone before this change and must still be.
  const { chat, owner, joiner } = await invitation(db, "group");
  await db.exec("begin");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [owner]);
  await db.query(`insert into public.chat_members (chat_id, user_id, role) values ($1, $2, 'member')`, [
    chat,
    joiner,
  ]);
  await db.exec("commit");

  const rows = await linesIn(db, chat);
  assert.equal(rows.length, 1, `expected one line, got ${JSON.stringify(rows.map((r) => r.content))}`);
  assert.equal(rows[0].content, "Зоя Яблокова добавил(а) в группу: Борис Ильин");
});

test("leaving still writes exactly one line, which this change does not touch", async () => {
  const { chat, invite, joiner } = await invitation(db, "group");
  await accept(db, invite, joiner);
  await db.exec("begin");
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [joiner]);
  await db.query(`delete from public.chat_members where chat_id = $1 and user_id = $2`, [chat, joiner]);
  await db.exec("commit");

  assert.deepEqual(
    (await linesIn(db, chat)).map((row) => row.content),
    ["Борис Ильин присоединился(ась) к группе", "Борис Ильин вышел(а) из группы"],
  );
});

test("accepting twice adds nothing, because the invite is no longer pending", async () => {
  const { chat, invite, joiner } = await invitation(db, "group");
  await accept(db, invite, joiner);
  await assert.rejects(
    () => accept(db, invite, joiner),
    /group_invite_not_pending/,
    "an accepted invite could be accepted again",
  );
  assert.equal((await linesIn(db, chat)).length, 1);
});

// ── the file itself ──────────────────────────────────────────────────────────

test("the subject changes the function and nothing else about it", async () => {
  // `security definer`, the pinned `search_path` and the grant are what make
  // the RPC work at all; a `create or replace` that dropped any of them would
  // deploy and then refuse every acceptance.
  const row = (
    await db.query(
      `select p.prosecdef as secdef,
              array_to_string(p.proconfig, ',') as config,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'group_invite_accept'`,
    )
  ).rows[0];
  assert.equal(row.secdef, true);
  assert.match(row.config, /search_path=/);
  assert.equal(row.authenticated, true);
  assert.equal(row.anon, false);
});

test("the subject applies again over itself and takes no second effect", async () => {
  const fresh = await database();
  try {
    await execOrRollback(fresh, migrationSql(SUBJECT));
    const { chat, invite, joiner } = await invitation(fresh, "group");
    await accept(fresh, invite, joiner);
    assert.equal((await linesIn(fresh, chat)).length, 1);
  } finally {
    await fresh.close();
  }
});

/**
 * The self-check is only worth having if it fails, and the mutation has to be
 * made in the **file**: the migration is idempotent, so a change applied to a
 * live database is undone by the file's own statements before the check block
 * is reached.
 *
 * Each substitution is asserted to have applied. A replacement that silently
 * matched nothing would leave the file intact and the case green.
 */
const MUTATIONS = [
  {
    what: "the guard is dropped, so the duplicate comes back",
    file: "sql",
    from: "  if coalesce(v_joined, false) and not (v_chat.type = 'group' and v_members > 1) then",
    to: "  if coalesce(v_joined, false) then",
    raises: /wrote 2 lines rather than one/i,
  },
  {
    what: "the insert is deleted rather than narrowed, so a channel goes silent",
    file: "sql",
    from: "  if coalesce(v_joined, false) and not (v_chat.type = 'group' and v_members > 1) then",
    to: "  if false then",
    raises: /channel wrote 0 lines rather than one/i,
  },
  {
    what: "the guard forgets the member count, so a group nobody is in goes silent",
    file: "sql",
    from: "  if coalesce(v_joined, false) and not (v_chat.type = 'group' and v_members > 1) then",
    to: "  if coalesce(v_joined, false) and v_chat.type <> 'group' then",
    raises: /no other member wrote 0 lines rather than one/i,
  },
  {
    what: "the wrong writer is kept, so the group's line is the older wording",
    file: "sql",
    from: "  if coalesce(v_joined, false) and not (v_chat.type = 'group' and v_members > 1) then",
    to: "  if coalesce(v_joined, false) and not (v_chat.type = 'group' and v_members > 99) then",
    raises: /wrote 2 lines rather than one/i,
  },
  {
    // Placed where the file's own work is, which is where such an edit would
    // land. The guard is a `count(*)` latched at the top and compared inside
    // the check block, so it sees anything the file does *before* the check and
    // nothing after it — a `delete` wedged between the check and `commit`
    // would go past it. That is a limit of a self-check rather than of this
    // case: a check can only assert about a state it is reached in.
    what: "the file starts deleting the rows the duplication already wrote",
    file: "sql",
    // And the database has to have such a row in it, or the `delete` removes
    // nothing, the count does not move and the case passes while proving
    // nothing. Measured: without this it did exactly that.
    seed: true,
    from: "-- ── the self-check, which raises rather than committing half of this ───────",
    to: `delete from public.messages
 where type = 'system' and content like '%присоединился к группе';

-- ── the self-check, which raises rather than committing half of this ───────`,
    raises: /changed the number of rows in public\.messages/i,
  },
  {
    what: "the rollback does not actually restore the older insert",
    file: "rollback",
    from: "  if coalesce(v_joined, false) then",
    to: "  if coalesce(v_joined, false) and not (v_chat.type = 'group' and 1 > 0) then",
    raises: /wrote 1 lines rather than the two/i,
  },
];

for (const mutation of MUTATIONS) {
  test(`the self-check raises when ${mutation.what}`, async () => {
    const source = mutation.file === "sql" ? migrationSql(SUBJECT) : rollbackSql(SUBJECT);
    assert.equal(
      source.split(mutation.from).length - 1,
      1,
      "the mutation matched nothing, so this case proves nothing",
    );
    const broken = await database({ withSubject: mutation.file === "rollback" });
    try {
      if (mutation.seed) {
        const seeded = await invitation(broken, "group");
        await accept(broken, seeded.invite, seeded.joiner);
        assert.equal(
          (await linesIn(broken, seeded.chat)).length,
          2,
          "the seed was supposed to leave the duplicate this mutation deletes",
        );
      }
      await assert.rejects(
        () => execOrRollback(broken, source.replace(mutation.from, mutation.to)),
        mutation.raises,
        "the self-check committed a state it was written to refuse",
      );
    } finally {
      await broken.close();
    }
  });
}

// ── the round trip ───────────────────────────────────────────────────────────

test("the rollback restores the duplicate, and the subject removes it again", async () => {
  // A rollback of this change puts a defect back, which is what a rollback of
  // this change *is*. Saying so here is the point: if it produced one line it
  // would not have rolled anything back.
  const fresh = await database();
  try {
    const first = await invitation(fresh, "group");
    await accept(fresh, first.invite, first.joiner);
    assert.equal((await linesIn(fresh, first.chat)).length, 1);

    await execOrRollback(fresh, rollbackSql(SUBJECT));
    const second = await invitation(fresh, "group");
    await accept(fresh, second.invite, second.joiner);
    assert.equal(
      (await linesIn(fresh, second.chat)).length,
      2,
      "the rollback did not restore the second writer",
    );

    // And the lines already written are untouched by either direction.
    assert.equal((await linesIn(fresh, first.chat)).length, 1);

    await execOrRollback(fresh, migrationSql(SUBJECT));
    const third = await invitation(fresh, "group");
    await accept(fresh, third.invite, third.joiner);
    assert.equal((await linesIn(fresh, third.chat)).length, 1);
    assert.equal((await linesIn(fresh, second.chat)).length, 2);
  } finally {
    await fresh.close();
  }
});

test("the recorded rollback is the definition the trigger arrived under", async () => {
  // Not a fresh transcription: the rollback carries `20260511`'s function text,
  // so a restore cannot quietly become a rewrite. Compared with whitespace
  // collapsed, because the generator that built the file indents nothing
  // differently but a future editor might.
  const recorded = migrationSql(ACCEPT_BEFORE).split("\n").slice(16, 110).join("\n");
  const inRollback = rollbackSql(SUBJECT);
  const open = inRollback.indexOf("create or replace function public.group_invite_accept(");
  const close = inRollback.indexOf("end $$;", open);
  assert.ok(open > 0 && close > open, "the rollback has no group_invite_accept in it");
  const restored = inRollback.slice(open, close + "end $$;".length);
  const flat = (text) => text.replace(/\s+/g, " ").trim();
  assert.equal(
    flat(restored),
    flat(recorded),
    "the rollback's function has drifted from 20260511's, so it restores something production never ran",
  );
});
