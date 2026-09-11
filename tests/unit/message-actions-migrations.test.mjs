/**
 * The shape of the message-action migrations, their rollbacks and their
 * rehearsals — read as text, because the unit suite has no database.
 *
 * `tests/server/message-actions-db.test.mjs` runs the same files in PGlite over
 * a stub of production's objects. Neither has run them against production's
 * schema: the main session does that on a throwaway copy before applying. What
 * this file pins is what the project's migration rules require of the files
 * themselves, so a later edit cannot quietly turn one into something that
 * commits half of itself, skips its self-check or opens a table.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const MIGRATION_DIR = ".migration-backup/supabase/migrations";
const REHEARSAL_DIR = ".migration-backup/supabase/rehearsal";
const NEW_MIGRATIONS = [
  "20260911140000_chat_read_marks_forward_only",
  "20260911141000_message_read_events",
  "20260911142000_one_reaction_per_person",
  "20260911143000_delete_messages_for_everyone",
  "20260911144000_forward_message_with_media",
];
const PREVIOUS_NEWEST = "20260911130000";

/**
 * Splits SQL into top-level statements, skipping comments and keeping string
 * and dollar-quoted bodies whole. `masked` has every dollar body replaced by its
 * tags, so a keyword inside a function body is not taken for a statement.
 */
export function scanSql(sql) {
  const statements = [];
  let raw = "";
  let masked = "";
  let balanced = true;
  let index = 0;
  const push = () => {
    if (raw.trim()) statements.push({ raw: raw.trim(), masked: masked.replace(/\s+/g, " ").trim().toLowerCase() });
    raw = "";
    masked = "";
  };
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", index);
      index = end === -1 ? sql.length : end;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", index + 2);
      if (end === -1) {
        balanced = false;
        break;
      }
      index = end + 2;
      raw += " ";
      masked += " ";
      continue;
    }
    if (char === "'") {
      const start = index;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (sql[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      raw += sql.slice(start, index);
      masked += "''";
      continue;
    }
    if (char === "$") {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, index + tag.length);
        if (end === -1) {
          balanced = false;
          break;
        }
        raw += sql.slice(index, end + tag.length);
        masked += `${tag}${tag}`;
        index = end + tag.length;
        continue;
      }
    }
    if (char === ";") {
      push();
      index += 1;
      continue;
    }
    raw += char;
    masked += char;
    index += 1;
  }
  push();
  return { statements, balanced };
}

const read = (path) => readFileSync(path, "utf8");

test("the new migrations are named after the newest applied one, once each", () => {
  const all = readdirSync(MIGRATION_DIR).filter((name) => name.endsWith(".sql") && !name.endsWith(".rollback.sql"));
  for (const name of NEW_MIGRATIONS) {
    assert.ok(all.includes(`${name}.sql`), `${name}.sql is missing`);
    assert.match(name, /^20260911\d{6}_[a-z0-9_]+$/);
    assert.ok(name.slice(0, 14) > PREVIOUS_NEWEST, `${name} is not after ${PREVIOUS_NEWEST}`);
  }
  const stamps = NEW_MIGRATIONS.map((name) => name.slice(0, 14));
  assert.equal(new Set(stamps).size, stamps.length, "two migrations share a timestamp");
  assert.deepEqual([...stamps].sort(), stamps, "the list is not in apply order");
});

for (const name of NEW_MIGRATIONS) {
  test(`${name} is one transaction that ends in a self-check`, () => {
    const sql = read(`${MIGRATION_DIR}/${name}.sql`);
    const { statements, balanced } = scanSql(sql);
    assert.ok(balanced, "an unterminated comment or dollar quote");
    const kinds = statements.map((statement) => statement.masked);
    assert.equal(kinds[0], "begin", "the first statement is not BEGIN");
    assert.equal(kinds.at(-1), "commit", "the last statement is not COMMIT");
    const inner = kinds.slice(1, -1);
    assert.ok(!inner.some((kind) => /^(begin|commit|rollback|end)\b/.test(kind)), "a second transaction boundary inside");
    const selfCheck = statements.at(-2);
    assert.match(selfCheck.masked, /^do \$\$\$\$$/, "the statement before COMMIT is not a DO block");
    assert.match(selfCheck.raw, /raise exception/i, "the self-check never raises");
    assert.ok(!/create index concurrently/i.test(sql), "CREATE INDEX CONCURRENTLY inside a transaction");
    for (const forbidden of [/disable row level security/, /^drop table/, /^truncate/, /^delete from public\./, /^update public\./]) {
      assert.ok(!inner.some((kind) => forbidden.test(kind)), `a top-level statement matches ${forbidden}`);
    }
  });

  test(`${name} protects what it creates`, () => {
    const sql = read(`${MIGRATION_DIR}/${name}.sql`);
    const { statements } = scanSql(sql);
    const kinds = statements.map((statement) => statement.masked);
    for (const kind of kinds) {
      const table = /^create table if not exists ([a-z_]+\.[a-z_]+)/.exec(kind)?.[1];
      if (!table) continue;
      assert.ok(kinds.includes(`alter table ${table} enable row level security`), `${table} is created without RLS`);
      assert.ok(
        kinds.some((other) => other.startsWith(`revoke all on table ${table} from public, anon, authenticated`)),
        `${table} keeps the default grants`,
      );
    }
    for (const statement of statements) {
      const header = /^create or replace function ([a-z_]+\.[a-z_]+)\(/.exec(statement.masked);
      if (!header) continue;
      const fn = header[1];
      assert.match(statement.masked, /set search_path = ''/, `${fn} has no fixed search_path`);
      assert.ok(
        kinds.some((kind) => kind.startsWith(`revoke all on function ${fn}(`) && /from public, anon/.test(kind)),
        `${fn} is not revoked from public and anon`,
      );
      const grants = kinds.filter((kind) => kind.startsWith(`grant execute on function ${fn}(`));
      if (fn.startsWith("private.")) {
        assert.equal(grants.length, 0, `${fn} is granted to someone`);
      } else {
        assert.ok(grants.length > 0, `${fn} is granted to no one`);
        for (const grant of grants) assert.ok(!/\banon\b/.test(grant), `${fn} is granted to anon`);
      }
    }
  });

  test(`${name} has a rollback that is its own transaction`, () => {
    const path = `${MIGRATION_DIR}/${name}.rollback.sql`;
    assert.ok(existsSync(path), "the rollback file is missing");
    const { statements, balanced } = scanSql(read(path));
    assert.ok(balanced);
    assert.equal(statements[0].masked, "begin");
    assert.equal(statements.at(-1).masked, "commit");
    assert.match(statements.at(-2).raw, /raise exception/i, "the rollback does not check itself");
  });

  test(`${name} has a rehearsal that rolls back and tries strangers`, () => {
    const path = `${REHEARSAL_DIR}/${name}.test.sql`;
    assert.ok(existsSync(path), "the rehearsal file is missing");
    const sql = read(path);
    const { statements, balanced } = scanSql(sql);
    assert.ok(balanced);
    assert.equal(statements[0].masked, "begin");
    assert.equal(statements.at(-1).masked, "rollback", "the rehearsal does not end in ROLLBACK");
    assert.ok(!statements.slice(1, -1).some((statement) => /^(begin|commit|rollback)\b/.test(statement.masked)));
    assert.match(statements.at(-2).raw, new RegExp(`select 'rehearsal passed: ${name}' as result`));
    assert.match(sql, /set local role authenticated/);
    assert.match(sql, /request\.jwt\.claims/);
    assert.match(sql, /auth\.uid\(\)/, "the rehearsal does not check how auth.uid() reads the claims");
    assert.match(sql, /v_stranger/, "the rehearsal never acts as someone outside the chat");
    assert.match(sql, /set local role anon|not a member|chat they are not in/, "no non-member or anon expectation");
    assert.ok((sql.match(/raise exception/g) ?? []).length >= 8, "too few expectations to mean anything");
    assert.ok(!/\bcommit\b\s*;/i.test(sql.replace(/--.*$/gm, "")), "the rehearsal commits");
  });
}

test("the scanner itself: a keyword inside a body is not a statement, and an open quote is caught", () => {
  const { statements } = scanSql("begin;\ndo $$ begin commit; end $$;\ncommit;");
  assert.deepEqual(statements.map((statement) => statement.masked), ["begin", "do $$$$", "commit"]);
  assert.equal(scanSql("begin; do $$ unterminated").balanced, false);
  assert.equal(scanSql("select 'it''s'; -- c\n/* block */ select 1;").statements.length, 2);
});
