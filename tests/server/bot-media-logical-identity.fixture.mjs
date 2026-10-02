import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  postgres, read, root, reservation, reserveSql, commitSql, object, quote, uuid,
} from "./bot-inline-media-ingest.fixture.mjs";

export { quote, uuid, reserveSql, commitSql, object };
export const baseline = process.env.BOT_MEDIA_IDENTITY_BASELINE === "1";
export const uploadMigration = "supabase/migrations/20261002155123_bot_media_upload_intents.sql";
export const ingestMigration = "supabase/migrations/20261002020000_bot_inline_media_ingest.sql";

function identityPath() {
  if (process.env.BOT_MEDIA_IDENTITY_MIGRATION) {
    return resolve(process.env.BOT_MEDIA_IDENTITY_MIGRATION);
  }
  const names = readdirSync(new URL("supabase/migrations/", root))
    .filter(name => name.endsWith("_bot_media_logical_identity.sql"));
  assert.equal(names.length, 1, "exactly one identity migration must exist; RED uses BOT_MEDIA_IDENTITY_BASELINE=1");
  return new URL("supabase/migrations/" + names[0], root);
}
// A test process uses one candidate snapshot; changed SQL needs a fresh run.
let candidateSql;
export const identitySource = () => candidateSql ??= readFileSync(identityPath(), "utf8").replaceAll("\r\n", "\n");
export const identityRollback = () => {
  const path = identityPath();
  return readFileSync(path instanceof URL ? new URL(path.href.replace(/\.sql$/, ".rollback.sql")) :
    path.replace(/\.sql$/, ".rollback.sql"), "utf8").replaceAll("\r\n", "\n");
};

export async function identityFixture(t, { applyIdentity = !baseline, sql } = {}) {
  assert.ok(!process.env.BOT_INGEST_TEST_BASELINE && !process.env.BOT_UPLOAD_TEST_BASELINE,
    "identity fixtures require the accepted receipt and upload-attempt base");
  const db = await postgres(t, read(ingestMigration));
  await db.exec(read(uploadMigration));
  if (applyIdentity) await db.exec(sql ?? identitySource());
  return db;
}

export function next(n, overrides = {}) {
  const r = reservation({ key: "logical-identity-" + n, fingerprint: n.toString(16).padStart(64, "0"),
    lease: uuid(100 + n), ...overrides });
  r.path = `${r.chat}/bots/${r.bot}/${r.fingerprint}.pdf`;
  return r;
}

const value = input => input === null ? "null" : quote(input);
export const beginSql = r => "select public.bot_media_upload_begin_internal(" +
  [r.bot, r.token, r.chat, r.key, r.fingerprint, r.lease, r.path, r.mime, r.size, r.digest].map(value).join(",") + ") as value";
export const finishSql = (r, outcome = "acknowledged") => "select public.bot_media_upload_finish_internal(" +
  [r.bot, r.key, r.lease, outcome].map(value).join(",") + ") as value";
export const reserve = async (db, r) => (await db.service(reserveSql(r))).value;
export const begin = async (db, r) => (await db.service(beginSql(r))).value;
export const finish = async (db, r, outcome) => (await db.service(finishSql(r, outcome))).value;
export const commit = async (db, r) => (await db.service(commitSql(r))).value;
export const receipt = async (db, r) => (await db.query(`select * from private.bot_media_ingests
  where bot_id=${quote(r.bot)} and idempotency_key=${quote(r.key)}`))[0];
export const attempts = db => db.query("select * from private.bot_media_upload_attempts order by attempt_id");
export const grants = db => db.query("select * from private.bot_upload_grants order by id");
export const identities = db => db.query("select * from private.bot_media_object_identities order by generation_id");
export const attemptBindings = db => db.query("select * from private.bot_media_attempt_bindings order by attempt_id");
export const grantBindings = db => db.query("select * from private.bot_media_grant_bindings order by grant_id");
export const trusted = (db, sql) => db.exec("set role postgres; " + sql);
export const authorizeSql = r => "select * from public.bot_upload_authorize_internal(" +
  [r.bot, r.chat, "chat-media", r.path, r.mime, r.size, 120].map(value).join(",") + ")";
export const authorize = async (db, r) => (await db.service(authorizeSql(r)));
export async function rotate(db, r, lease, token = r.token) {
  await trusted(db, `update private.bot_media_ingests set lease_expires_at=clock_timestamp()-interval '1 second'
    where bot_id=${quote(r.bot)} and idempotency_key=${quote(r.key)};`);
  const fresh = { ...r, lease, token };
  await reserve(db, fresh);
  return fresh;
}

export async function waitForLock(db, pid, relation) {
  for (let i = 0; i < 100; i++) {
    const [state] = await db.query(`select exists(select 1 from pg_locks where pid=${Number(pid)}
      and not granted${relation ? " and relation=" + quote(relation) + "::regclass" : ""}) as waiting`);
    if (state.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("fixture session did not reach the actual lock barrier");
}

export const identityTables = ["bot_media_object_identities", "bot_media_attempt_bindings", "bot_media_grant_bindings",
  "bot_media_path_claims", "bot_media_grant_claims"];
export const snapshot = async db => ({
  receipts: await db.query("select * from private.bot_media_ingests order by bot_id,idempotency_key"),
  attempts: await attempts(db), grants: await grants(db),
});
export const allBindings = async db => ({
  identities: await identities(db), attempts: await attemptBindings(db), grants: await grantBindings(db),
  claims: await db.query("select * from private.bot_media_path_claims order by bucket_id,object_path"),
  grantClaims: await db.query("select * from private.bot_media_grant_claims order by grant_id"),
});
export async function identityFor(db, r) {
  const rows = (await identities(db)).filter(row => row.bot_id === r.bot && row.idempotency_key === r.key);
  assert.equal(rows.length, 1, "one logical identity per admitted operation");
  return rows[0];
}
export function assertSnapshot(identity, r, storedReceipt) {
  assert.match(identity.generation_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  for (const [field, expected] of Object.entries({ bot_id: r.bot, idempotency_key: r.key,
    chat_id: r.chat, method: r.method, request_fingerprint: r.fingerprint, content_type: r.mime,
    byte_size: r.size, content_sha256: r.digest, bucket_id: "chat-media", object_path: r.path,
    receipt_created_at: storedReceipt.created_at })) assert.equal(identity[field], expected, "immutable snapshot " + field);
}

export function mutateFunction(sql, name, edit) {
  const start = sql.indexOf("CREATE FUNCTION private." + name + "()");
  assert.notEqual(start, -1, "mutant must select an actual private function");
  const open = sql.indexOf("$function$", start), close = sql.indexOf("$function$", open + 10);
  assert.ok(open > start && close > open, "mutant must select a complete executable body");
  const before = sql.slice(open + 10, close), after = edit(before);
  assert.notEqual(after, before, "mutant must change executable SQL");
  return sql.slice(0, open + 10) + after + sql.slice(close);
}

export async function refused(operation, name) {
  await assert.rejects(operation, error => {
    assert.ok(["55000", "23505", "23514", "42501", "P0001"].includes(error.code), "expected identity/snapshot refusal SQLSTATE");
    if (name) assert.ok(error.message.includes(name), "expected named identity refusal");
    return true;
  }, "trusted snapshot mutation must be refused");
}
