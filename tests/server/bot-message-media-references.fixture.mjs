import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  identityFixture, next, reserve, identityFor, quote, snapshot, allBindings,
} from "./bot-media-logical-identity.fixture.mjs";

export { next, reserve, identityFor, quote, snapshot, allBindings };
export const baseline = process.env.BOT_MESSAGE_MEDIA_REFERENCES_BASELINE === "1";
export const resolverSignature = "private.bot_message_media_references(text,text,text,jsonb)";
export const urlSignature = "private.bot_media_url_pointer(text)";
const root = new URL("../../", import.meta.url);

function migrationPath() {
  if (process.env.BOT_MESSAGE_MEDIA_REFERENCES_MIGRATION) {
    return resolve(process.env.BOT_MESSAGE_MEDIA_REFERENCES_MIGRATION);
  }
  const names = readdirSync(new URL("supabase/migrations/", root))
    .filter(name => name.endsWith("_bot_message_media_references.sql"));
  assert.equal(names.length, 1, "exactly one message reference resolver candidate must exist");
  return new URL("supabase/migrations/" + names[0], root);
}
let candidate;
export const resolverSource = () => candidate ??= readFileSync(migrationPath(), "utf8").replaceAll("\r\n", "\n");
export const resolverRollback = () => {
  const path = migrationPath();
  return readFileSync(path instanceof URL ? new URL(path.href.replace(/\.sql$/, ".rollback.sql")) :
    path.replace(/\.sql$/, ".rollback.sql"), "utf8").replaceAll("\r\n", "\n");
};

export async function referenceFixture(t, { applyResolver = !baseline, sql } = {}) {
  assert.ok(!process.env.BOT_MEDIA_IDENTITY_BASELINE, "the accepted logical identity base is required");
  const db = await identityFixture(t, { applyIdentity: true });
  // The accepted focused base omits this legacy message column, not its semantics.
  await db.exec("alter table public.messages add column media_url text;");
  if (applyResolver) await db.exec(sql ?? resolverSource());
  return db;
}

export const scalar = value => value === null ? "null" : quote(value);
export const metadataSql = value => value === undefined ? "null::jsonb" : quote(JSON.stringify(value)) + "::jsonb";
export const referenceSql = ({ bucket = null, path = null, url = null, metadata } = {}) =>
  `select * from private.bot_message_media_references(${scalar(bucket)},${scalar(path)},${scalar(url)},${metadataSql(metadata)})`;
export const references = (db, input) => db.query(referenceSql(input) + " order by source_kind");
export const urlPointer = (db, url) => db.query(`select * from private.bot_media_url_pointer(${scalar(url)})`);
export const mediaUrl = (path, bucket = "chat-media", endpoint = "object/public") =>
  "https://core.letscube.ru/storage/v1/" + endpoint + "/" + bucket + "/" + path;

export async function known(db, n = 1) {
  const receipt = next(300 + n);
  await reserve(db, receipt);
  return { receipt, identity: await identityFor(db, receipt) };
}

export function observation(source, bucket, path, generation = null, state = "unresolved", reason = "unregistered_object") {
  return { source_kind: source, bucket_id: bucket, object_path: path,
    generation_id: generation, reference_state: state, hold_reason: reason };
}

// Mutants change the actual compiled candidate body, not a mirror implementation.
export async function mutateInstalled(db, signature, edit) {
  const [functionRow] = await db.query(`select pg_get_functiondef(${quote(signature)}::regprocedure) as ddl`);
  const ddl = functionRow.ddl;
  const delimiter = ddl.match(/AS (\$[A-Za-z_]*\$)/)?.[1];
  assert.ok(delimiter, "the candidate must have a complete dollar-quoted function body");
  const open = ddl.indexOf(delimiter), close = ddl.indexOf(delimiter, open + delimiter.length);
  assert.ok(close > open, "the selected function body must terminate");
  const before = ddl.slice(open + delimiter.length, close), after = edit(before);
  assert.notEqual(after, before, "the executable candidate body must actually change");
  await db.exec("set role postgres; " + ddl.slice(0, open + delimiter.length) + after + ddl.slice(close));
  return async () => db.exec("set role postgres; " + ddl);
}

export async function authorityCatalog(db) {
  return {
    tables: await db.query(`select c.oid,n.nspname,c.relname,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private','storage') and c.relkind in ('r','p') order by c.oid`),
    policies: await db.query("select * from pg_policies where schemaname in ('public','private','storage') order by schemaname,tablename,policyname"),
    triggers: await db.query(`select t.oid,t.tgrelid,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private','storage') order by t.oid`),
  };
}
