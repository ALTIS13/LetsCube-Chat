/**
 * The removal of the call service message, and its restore, read as text.
 *
 * This file used to pin the *shape* of
 * `20260918200000_a_call_says_so_in_the_conversation.sql` -- its sentences, its
 * trigger, its grants. That feature was removed on 2026-09-19 at the owner's
 * instruction («по сути и так видно если люди сидят»), so those assertions
 * described an object production no longer has, and a green suite saying «the
 * two sentences are the approved ones» read as though the product still said
 * them. They are gone.
 *
 * What is here instead are the three text-level facts about the removal that a
 * database cannot check and that would each be an expensive mistake:
 *
 *  1. **The recorded migration is what was applied.** The removal reached
 *     production before this file was written: what ran was 200000's own
 *     rollback, so `20260919180000_…sql` carries that file's body byte for byte
 *     and only its header is new. A record that has drifted from what the
 *     database ran is worse than no record, which is the whole of
 *     `scripts/migration-inventory.mjs`.
 *
 *  2. **The restore restores what was there, not what 200000 wrote.** 280000
 *     replaced the writer so a private chat would stop being told about a
 *     «канал»; a rollback that replays 200000 would reinstate that defect and
 *     look like it worked. The three function bodies are compared character for
 *     character against the recorded files they come from -- which is not
 *     pedantry: the first draft of the restore dropped the inline comments from
 *     `voice_call_transition` and PGlite's `md5(pg_get_functiondef())` caught it
 *     immediately, because a function body includes its comments.
 *
 *  3. **Neither file deletes anybody's messages.** The rows the feature wrote
 *     were removed separately, under the owner's own instruction and from a
 *     verified export. A migration that quietly carried a `delete` would do it
 *     again on every database it is replayed against.
 *
 * `tests/server/voice-call-service-message-db.test.mjs` runs both files in
 * PGlite and proves the behaviour, the self-checks' teeth and the round trip.
 *
 * **Comments are stripped before every scan**, because this repository's
 * migrations open with long headers that quote the SQL they discuss, and a
 * guard has matched prose in a doc comment more than once in a single session.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const DIR = ".migration-backup/supabase/migrations";

const REMOVAL = "20260919180000_the_rail_already_says_who_is_in_the_channel";
/** The file that was actually applied, and the source of the removal's body. */
const APPLIED = "20260918200000_a_call_says_so_in_the_conversation";
/** The migration whose writer the restore must bring back -- not 200000's. */
const PRIVATE_FIX = "20260918280000_a_private_chat_has_no_channel_to_announce";

const read = (name) => readFileSync(`${DIR}/${name}`, "utf8");

/** Comments stripped. `strip()` is `tests/unit/voice-room-seam.test.mjs`'s. */
const strip = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

const removal = read(`${REMOVAL}.sql`);
const restore = read(`${REMOVAL}.rollback.sql`);
const applied = read(`${APPLIED}.rollback.sql`);
const removalSql = strip(removal);
const restoreSql = strip(restore);

/** Everything from `begin;` on: a migration minus its header. */
const body = (text) => text.slice(text.indexOf("\nbegin;\n") + 1);

/**
 * One `create or replace function` statement, verbatim and including its
 * inline comments, because `pg_get_functiondef` returns the body as written and
 * a restore that reformats one is restoring a different function.
 */
function functionBlock(text, name) {
  const open = text.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(open, -1, `no definition of ${name} to read`);
  const close = text.indexOf("\n$function$;\n", open);
  assert.notEqual(close, -1, `the definition of ${name} has no terminator`);
  return text.slice(open, close + "\n$function$;\n".length);
}

test("the removal beside its rollback, both present", () => {
  assert.ok(existsSync(`${DIR}/${REMOVAL}.sql`), "no removal migration");
  assert.ok(existsSync(`${DIR}/${REMOVAL}.rollback.sql`), "no rollback file");
});

test("the recorded removal is the file that was applied, byte for byte", () => {
  // The removal reached production as 200000's rollback before it was recorded
  // as a migration of its own. Only the header may differ; an edit to the body
  // makes the record describe something the database never ran.
  assert.equal(
    body(removal),
    body(applied),
    "the removal migration's body has diverged from `20260918200000_…rollback.sql`, which is the file production actually ran",
  );
  assert.notEqual(
    removal.slice(0, removal.indexOf("\nbegin;\n")),
    applied.slice(0, applied.indexOf("\nbegin;\n")),
    "the removal carries the rollback's header, so it does not say what it is or when it ran",
  );
  assert.match(
    removal,
    /Applied to production on 2026-09-19/,
    "the header does not record that this had already run when it was written",
  );
});

test("both files are one transaction and bound the lock they wait for", () => {
  for (const [label, text] of [
    ["the removal", removalSql],
    ["the restore", restoreSql],
  ]) {
    assert.match(text, /^\s*begin;/m, `${label} does not open a transaction`);
    assert.match(text, /\bcommit;/, `${label} does not commit`);
    assert.doesNotMatch(text, /\brollback;/, `${label} rolls itself back`);
    assert.match(
      text,
      /set local lock_timeout = '5s';/,
      `${label} would queue the product behind a blocked lock`,
    );
  }
});

test("both files raise rather than report success on a half-applied state", () => {
  // A `do` block that only ever notices is worse than none: it reads like a
  // check and commits anything. `tests/server/…-db.test.mjs` mutates both files
  // and shows each raise being reached.
  for (const [label, text] of [
    ["the removal", removalSql],
    ["the restore", restoreSql],
  ]) {
    const raises = text.match(/raise exception/g) ?? [];
    assert.ok(raises.length >= 3, `${label} has only ${raises.length} raising assertions`);
  }
});

test("the role is enforced rather than described", () => {
  // `public.voice_channels` is owned by `supabase_admin` rather than by
  // `postgres` -- read off production, not guessed -- and three migrations in a
  // row once failed on «must be owner of …» for guessing it.
  for (const [label, text] of [
    ["the removal", removalSql],
    ["the restore", restoreSql],
  ]) {
    assert.match(text, /pg_has_role\(\s*current_user/, `${label} does not check its role`);
    assert.match(text, /run it as supabase_admin/, `${label} does not name the role it needs`);
  }
});

test("neither file deletes anybody's messages, and the removal writes out the one that would", () => {
  for (const [label, text] of [
    ["the removal", removalSql],
    ["the restore", restoreSql],
  ]) {
    assert.doesNotMatch(
      text,
      /delete\s+from\s+public\.messages/i,
      `${label} deletes people's conversation history`,
    );
  }
  // Stripped above, because the reasoned-out `delete` lives in a comment on
  // purpose; unstripped it must still be written down, so that whoever has to
  // run it is not composing the predicate themselves.
  assert.match(
    removal,
    /delete from public\.messages/,
    "the removal no longer writes out what to run if the rows must go too",
  );
  assert.match(
    removal,
    /system_payload is null/,
    "the written-out delete does not exclude a private chat's call record, which is the only thing telling the two apart",
  );
});

test("the restore brings back 20260918280000's writer, not 20260918200000's", () => {
  // The single thing this rollback can get wrong in a way that looks like
  // success. 200000's writer announced a call in any chat with a room; 280000
  // made it return early for a private chat after the owner read five lines
  // about a call they had cancelled.
  const restored = functionBlock(restore, "write_voice_call_service_message");
  assert.equal(
    restored,
    functionBlock(read(`${PRIVATE_FIX}.sql`), "write_voice_call_service_message"),
    "the restored writer is not the one 20260918280000 left, so a private chat would be told about a «канал» again",
  );
  assert.notEqual(
    restored,
    functionBlock(read(`${APPLIED}.sql`), "write_voice_call_service_message"),
    "the restored writer is 20260918200000's, which is the defect 20260918280000 repaired",
  );
  // And the self-check looks for it on the catalogue's own copy of the source,
  // rather than trusting the file it has just run.
  assert.match(
    restoreSql,
    /pg_get_functiondef[\s\S]{0,600}write_voice_call_service_message/,
    "the restore's self-check does not read the writer back off the catalogue",
  );
});

test("the restore's pure functions are the recorded ones, comments included", () => {
  // `pg_get_functiondef` returns a body as written, so a reformatted or
  // de-commented copy is a different function. The first draft of the restore
  // dropped the inline comments from `voice_call_transition` and the round-trip
  // md5 in the server suite went red on exactly that.
  const source = read(`${APPLIED}.sql`);
  for (const name of ["voice_call_transition", "voice_call_service_line"]) {
    assert.equal(
      functionBlock(restore, name),
      functionBlock(source, name),
      `the restored ${name} is not character for character the one 20260918200000 defined`,
    );
  }
});

test("the restore puts back the grants the column actually had, not the ones 200000 left", () => {
  // 200000 revoked UPDATE and granted nothing; 20260918230000 later rewrote a
  // table-wide INSERT grant into a column list that named `call_announced_at`.
  // The live state at the moment of removal was «INSERT yes, UPDATE no», and a
  // rollback that quietly improves that is a rollback whose result nobody can
  // predict.
  assert.match(
    restoreSql,
    /revoke update \(call_announced_at\) on public\.voice_channels from authenticated;/,
    "a member could latch a call as announced after a restore",
  );
  assert.match(
    restoreSql,
    /grant insert \(call_announced_at\) on public\.voice_channels to authenticated;/,
    "the restore does not put back the INSERT grant 20260918230000's column list carries",
  );
});

test("the removal weakens no policy and disables no row level security", () => {
  for (const [label, text] of [
    ["the removal", removalSql],
    ["the restore", restoreSql],
  ]) {
    assert.doesNotMatch(text, /disable row level security/i, `${label} turns row level security off`);
    assert.doesNotMatch(text, /create policy/i, `${label} creates a policy`);
    assert.doesNotMatch(text, /drop policy/i, `${label} drops a policy`);
  }
  const grants = (removalSql.match(/^\s*grant\b/gim) ?? []).filter((line) => !line.includes("revoke"));
  assert.deepEqual(grants, [], "the removal grants something");
});

test("the removal leaves the private chat's call record alone", () => {
  // A different mechanism entirely -- `voice_call_stop` writes the outcome, the
  // direction and the length into `messages.system_payload` -- and the owner
  // asked about channels in groups. The server suite drives one after the
  // removal and finds it still writing; this only pins that the file names
  // neither of its functions.
  for (const name of ["voice_call_stop", "voice_call_record_line"]) {
    assert.doesNotMatch(
      removalSql,
      new RegExp(`drop\\s+function[^;]*${name}`, "i"),
      `the removal drops public.${name}, which belongs to the private-chat call record`,
    );
  }
});
