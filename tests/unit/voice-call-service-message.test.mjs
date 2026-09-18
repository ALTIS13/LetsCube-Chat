/**
 * The shape of the call-service-message migration and its rollback, read as
 * text, because the unit suite has no database.
 *
 * `tests/server/voice-call-service-message-db.test.mjs` runs the same file in
 * PGlite and proves the behaviour, the self-check's teeth and the rollback.
 * What this file pins is what this project's migration rules require of the
 * file itself, so a later edit cannot quietly turn it into something that
 * commits half of itself, guesses its owner, takes a lock it does not need or
 * says a status code out loud.
 *
 * **Comments are stripped before every scan.** Guards in this repository have
 * matched prose in a doc comment five times in one session, and this file's
 * header talks at length about the very words the assertions look for -- it
 * names `room_started`, `room_finished` and `participant_count` in almost every
 * paragraph. Without `strip()` the «the copy names no status code» case would
 * pass on the commentary while the SQL said anything at all.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const DIR = ".migration-backup/supabase/migrations";
const NAME = "20260918200000_a_call_says_so_in_the_conversation";

/** Comments stripped. `strip()` is `tests/unit/voice-room-seam.test.mjs`'s. */
const strip = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

const migration = readFileSync(`${DIR}/${NAME}.sql`, "utf8");
const rollback = readFileSync(`${DIR}/${NAME}.rollback.sql`, "utf8");
const sql = strip(migration);
const rollbackSql = strip(rollback);

test("the migration has a rollback beside it", () => {
  assert.ok(existsSync(`${DIR}/${NAME}.rollback.sql`), "no rollback file");
});

test("both files are one transaction and bound the lock they wait for", () => {
  for (const [label, body] of [
    ["the migration", sql],
    ["the rollback", rollbackSql],
  ]) {
    assert.match(body, /^\s*begin;/m, `${label} does not open a transaction`);
    assert.match(body, /\bcommit;/, `${label} does not commit`);
    assert.doesNotMatch(body, /\brollback;/, `${label} rolls itself back`);
    assert.match(
      body,
      /set local lock_timeout = '5s';/,
      `${label} would queue the product behind a blocked lock`,
    );
  }
});

test("both files raise rather than report success on a half-applied state", () => {
  // A `do` block that only ever notices is worse than none: it reads like a
  // check and commits anything.
  for (const [label, body] of [
    ["the migration", sql],
    ["the rollback", rollbackSql],
  ]) {
    const raises = body.match(/raise exception/g) ?? [];
    assert.ok(raises.length >= 3, `${label} has only ${raises.length} raising assertions`);
  }
});

test("the role is enforced rather than described", () => {
  // Three migrations in a row guessed an owner from the schema and two of them
  // failed on «must be owner of …». This one asks.
  assert.match(
    sql,
    /pg_has_role\(\s*current_user/,
    "the migration does not check that the running role can own what it alters",
  );
  assert.match(
    sql,
    /run it as supabase_admin/,
    "the migration does not name the role it needs when it refuses",
  );
  assert.match(rollbackSql, /pg_has_role\(\s*current_user/, "the rollback does not check its role");
});

test("the writer's owner is derived from public.messages rather than named", () => {
  // Its whole ability to write past the INSERT policy is that it owns the
  // table. A hard-coded `owner to postgres` would be a second place for that to
  // be wrong.
  assert.match(
    sql,
    /pg_get_userbyid\(relowner\)[\s\S]{0,200}'public\.messages'::regclass/,
    "the owner is not read off public.messages",
  );
  assert.match(sql, /alter function %s owner to %I/, "the functions are not re-owned");
  assert.doesNotMatch(
    sql,
    /alter function [\w.()," ]+ owner to postgres/,
    "an owner is hard-coded, so it can drift from the table it writes to",
  );
});

test("both DDL statements are guarded, so a second application takes no lock", () => {
  // `add column if not exists` would do for the column, but the no-rewrite
  // proof has to read the filenode before the statement, so the guard is
  // explicit and the same block carries both.
  assert.match(
    sql,
    /attname = 'call_announced_at'[\s\S]{0,400}alter table public\.voice_channels add column call_announced_at/,
    "the column is added without first checking whether it is there",
  );
  // The filenode is compared, not merely read. A guard on the presence of the
  // words passes for `if false then` -- measured.
  assert.match(
    sql,
    /if v_filenode_after <> v_filenode_before then[\s\S]{0,300}raise exception/,
    "the migration reads the filenode without acting on a change, so its catalog-only claim is unproven",
  );
  assert.equal(
    (sql.match(/pg_relation_filenode\('public\.voice_channels'::regclass\)/g) ?? []).length,
    2,
    "the filenode is not read on both sides of the ALTER",
  );
  assert.match(
    sql,
    /drop trigger if exists trg_voice_call_service_message on public\.voice_channels;/,
    "the trigger is created without dropping a previous one",
  );
});

test("the trigger is narrow: one column, one crossing of zero, and before the write", () => {
  assert.match(
    sql,
    /before update of participant_count on public\.voice_channels/,
    "the trigger no longer watches one column before the write, so the latch needs a second UPDATE",
  );
  assert.match(
    sql,
    /\(coalesce\(old\.participant_count, 0\) = 0\) is distinct from \(coalesce\(new\.participant_count, 0\) = 0\)/,
    "the WHEN clause no longer admits only a crossing of zero",
  );
});

test("the rule is a pure function of its arguments, so it can be asserted without an SFU", () => {
  assert.match(
    sql,
    /create or replace function public\.voice_call_transition\([\s\S]{0,400}immutable/,
    "voice_call_transition is no longer immutable, so it can read the world",
  );
  assert.match(
    sql,
    /create or replace function public\.voice_call_service_line\([\s\S]{0,400}immutable/,
    "voice_call_service_line is no longer immutable",
  );
  // The gate of slice 3, as the self-check states it.
  assert.match(
    sql,
    /once per join rather than once per call/,
    "the self-check no longer asserts that a second joiner writes nothing",
  );
});

test("every function pins an empty search_path and none is reachable by a client", () => {
  const functions = [
    "voice_call_transition",
    "voice_call_service_line",
    "write_voice_call_service_message",
  ];
  for (const name of functions) {
    const body = sql.slice(sql.indexOf(`create or replace function public.${name}(`));
    assert.match(
      body.slice(0, 600),
      /set search_path to ''/,
      `${name} does not pin an empty search_path`,
    );
  }
  assert.match(
    sql,
    /revoke all on function public\.write_voice_call_service_message\(\)\s*\n?\s*from public, anon, authenticated;/,
    "the writer is reachable as a function",
  );
  assert.match(
    sql,
    /revoke update \(call_announced_at\) on public\.voice_channels from authenticated;/,
    "a member can latch a call as announced",
  );
});

test("the migration weakens no policy and disables no row level security", () => {
  assert.doesNotMatch(sql, /disable row level security/i, "row level security is turned off");
  assert.doesNotMatch(sql, /create policy/i, "a policy is created, so the audience is not the chat's");
  assert.doesNotMatch(sql, /drop policy/i, "a policy is dropped");
  // The only grant-shaped statement is a revoke.
  const grants = (sql.match(/^\s*grant\b/gim) ?? []).filter((line) => !line.includes("revoke"));
  assert.deepEqual(grants, [], "the migration grants something");
});

test("the two sentences are the approved ones, and neither reads like a log entry", () => {
  assert.match(
    sql,
    /return 'Начался разговор в канале «' \|\| v_name \|\| '»';/,
    "the start sentence changed",
  );
  assert.match(
    sql,
    /return 'Разговор в канале «' \|\| v_name \|\| '» закончился';/,
    "the end sentence changed",
  );

  // Every string literal the file can put in front of a person, checked for the
  // vocabulary of a log. Scoped to the two copy functions so that the rest of
  // the file -- whose exception messages are for whoever applies it -- is left
  // alone.
  const copy = sql.slice(
    sql.indexOf("create or replace function public.voice_call_service_line("),
    sql.indexOf("comment on function public.voice_call_service_line("),
  );
  const literals = [...copy.matchAll(/'([^']*)'/g)].map((match) => match[1]).filter(Boolean);
  assert.ok(literals.length >= 4, "the copy function has no sentences in it any more");
  for (const line of literals) {
    if (line === "start" || line === "end") continue;
    assert.doesNotMatch(
      line,
      /room_started|room_finished|participant|webhook|livekit|sfu|[0-9]/i,
      `a sentence names a status code, a room id or a webhook: ${line}`,
    );
  }
});

test("the copy names the room, and stores the name rather than referring to it", () => {
  // A message is permanent and a room is not. `new.name` is a snapshot; a join
  // to voice_channels at read time would rewrite history on a rename and say
  // nothing once the room was deleted.
  assert.match(
    sql,
    /public\.voice_call_service_line\(v_transition, new\.name\)/,
    "the sentence no longer takes the room's name from the row being written",
  );
  assert.doesNotMatch(
    sql,
    /references public\.voice_channels/,
    "something now points at the channel, so the line cannot outlive the room",
  );
});

test("the rollback removes the four objects and keeps the lines already written", () => {
  for (const fragment of [
    "drop trigger if exists trg_voice_call_service_message on public.voice_channels;",
    "drop function if exists public.write_voice_call_service_message();",
    "drop function if exists public.voice_call_service_line(text, text);",
    "drop function if exists public.voice_call_transition(integer, integer, boolean);",
    "alter table public.voice_channels drop column if exists call_announced_at;",
  ]) {
    assert.ok(rollbackSql.includes(fragment), `the rollback does not ${fragment}`);
  }
  // Stripped, because the reasoned-out `delete` lives in a comment on purpose
  // and a scan of the raw text would read it as a statement.
  assert.doesNotMatch(
    rollbackSql,
    /delete from public\.messages/,
    "the rollback deletes people's conversation history",
  );
  assert.match(
    rollback,
    /delete from public\.messages/,
    "the rollback no longer writes out what to run if the rows must go too",
  );
});
