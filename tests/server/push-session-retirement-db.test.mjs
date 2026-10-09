import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const root = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8").replaceAll("\r\n", "\n");
const proposal = "supabase/migration-proposals/push_session_retirement.sql";
const source = () => existsSync(new URL(proposal, root)) ? read(proposal) : "";
const rollback = () => read("supabase/migration-proposals/push_session_retirement.rollback.sql");
const base = read(".migration-backup/supabase/migrations/20260921114126_android_push_session_binding.sql");
const devices = read(".migration-backup/supabase/migrations/20260711_native_push_fcm_delivery.sql");
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = uuid(1), B = uuid(2), S = uuid(3), T = uuid(4), U = uuid(5);

export async function fixture(sql = source()) {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  try {
    await db.exec(`create role fixture_control superuser login; set session authorization fixture_control;
      alter role postgres rename to fixture_admin; create role postgres nosuperuser bypassrls;
      create role authenticated nosuperuser nobypassrls; create role anon nosuperuser nobypassrls;
      create role service_role nosuperuser bypassrls; create role supabase_auth_admin nosuperuser;
      create schema auth authorization supabase_auth_admin; create schema private authorization postgres;
      create schema extensions authorization postgres; create extension pgcrypto with schema extensions;
      grant create on schema public to postgres;
      grant usage on schema public,auth,extensions to postgres,authenticated;
      revoke all on schema private from public,anon,authenticated,service_role;
      create table auth.users(id uuid primary key); alter table auth.users owner to supabase_auth_admin;
      create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
      alter table auth.sessions owner to supabase_auth_admin; alter table auth.sessions enable row level security;
      grant select,references,trigger on auth.sessions to postgres; grant references on auth.users to postgres;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
      insert into auth.users values('${A}'),('${B}'); insert into auth.sessions values('${S}','${A}',null),('${T}','${A}',null),('${U}','${B}',null);
      set role postgres;
      ${devices.slice(devices.indexOf("create table if not exists public.user_push_devices"), devices.indexOf("update public.user_push_devices"))}
      alter table public.user_push_devices add column session_id uuid references auth.sessions(id) on delete set null,add column voice_call_protocol smallint;
      create unique index user_push_devices_provider_token_hash_uidx on public.user_push_devices(provider,token_hash);
      alter table public.user_push_devices enable row level security;
      revoke all on public.user_push_devices from public,anon,authenticated,service_role;`);
    for (const name of ["impl", "legacy", "new"]) {
      const ddl = base.match(new RegExp(`v_${name}_ddl text := \\$ddl\\$([\\s\\S]*?)\\$ddl\\$;`));
      assert.ok(ddl, "installed registration SQL control"); await db.exec(ddl[1]);
    }
    await db.exec(`revoke all on function private.register_push_device_bound(text,text,text,text,text,text,text,smallint,boolean) from public,anon,authenticated,service_role;
      revoke all on function public.register_push_device(text,text,text,text,text,text,text),public.register_push_device(text,text,text,text,text,text,text,smallint) from public,anon,authenticated,service_role;
      grant execute on function public.register_push_device(text,text,text,text,text,text,text),public.register_push_device(text,text,text,text,text,text,text,smallint) to authenticated;`);
    if (sql.trim()) await db.exec(sql);
    return db;
  } catch (error) { delete error.query; await db.close(); throw error; }
}

async function register(db, value, user = A, sid = S, legacy = false) {
  await db.exec("begin; set local role authenticated;");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user, ...(sid === null ? {} : { session_id: sid }) })]);
    await db.query(`select * from public.register_push_device('android','fcm',$1::text,null,null,null,null${legacy ? "" : ",1::smallint"})`, [value]);
    await db.exec("commit;");
  } catch (error) { delete error.query; await db.exec("rollback;"); throw error; }
}
const rows = async db => (await db.query("select token,session_id,enabled,revoked_at::text from public.user_push_devices order by token")).rows;
async function deleteSession(db, sid = S) {
  await db.exec("begin; set local role supabase_auth_admin;");
  try { await db.query("delete from auth.sessions where id=$1", [sid]); await db.exec("commit;"); }
  catch (error) { delete error.query; await db.exec("rollback;"); throw error; }
}
async function using(run, sql = source()) { const db = await fixture(sql); try { await run(db); } finally { await db.close(); } }

test("shipped control: deleting a session leaves ordinary push active", () => using(async db => {
  await register(db, "fictional-old-token-0001"); await deleteSession(db);
  assert.equal((await rows(db))[0].enabled, true); assert.equal((await rows(db))[0].session_id, null);
}, ""));

async function retirement(db) {
  await register(db, "fictional-token-00001"); await register(db, "fictional-token-00002");
  await register(db, "fictional-token-00003", A, T); await register(db, "fictional-token-00004", B, U);
  await register(db, "fictional-token-00005", A, null, true);
  await deleteSession(db); const actual = await rows(db);
  for (const row of actual.slice(0, 2)) { assert.equal(row.enabled, false); assert.ok(row.revoked_at); assert.equal(row.session_id, null); }
  for (const row of actual.slice(2)) { assert.equal(row.enabled, true); assert.equal(row.revoked_at, null); }
  assert.equal((await db.query("select count(*)::int n from auth.sessions where id=$1", [S])).rows[0].n, 0);
}
test("Auth-role logout retires all rotated endpoints, preserving successor and unbound endpoints", () => using(retirement));

test("late legacy registration with a deleted session cannot revive the device", () => using(async db => {
  await register(db, "fictional-token-00001"); await deleteSession(db);
  await assert.rejects(register(db, "fictional-token-00001", A, S, true), /invalid_push_session/);
  const actual = await rows(db); assert.equal(actual.length, 1); assert.equal(actual[0].enabled, false);
}));

test("rebound same-user and foreign-user successor survives deletion of the old session", () => using(async db => {
  await register(db, "fictional-token-00001"); await register(db, "fictional-token-00001", A, T);
  await register(db, "fictional-token-00002"); await register(db, "fictional-token-00002", B, U);
  await deleteSession(db); assert.deepEqual((await rows(db)).map(r => [r.session_id,r.enabled,r.revoked_at]), [[T,true,null],[U,true,null]]);
}));

test("session deletion rollback restores device, and rollback migration restores prior contract", () => using(async db => {
  await register(db, "fictional-token-00001"); const before = await rows(db);
  await db.exec(`begin; set local role supabase_auth_admin; delete from auth.sessions where id='${S}'; rollback;`);
  assert.deepEqual(await rows(db), before);
  await db.exec(rollback()); await deleteSession(db); assert.equal((await rows(db))[0].enabled, true);
}));

test("private retirement has no client or Auth-role direct execution grant", () => using(async db => {
  const result = await db.query(`select r.rolname,has_function_privilege(r.oid,'private.retire_push_devices_on_session_delete()','EXECUTE') allowed
    from pg_roles r where r.rolname in ('anon','authenticated','service_role','supabase_auth_admin') order by r.rolname`);
  assert.deepEqual(result.rows, ["anon","authenticated","service_role","supabase_auth_admin"].map(rolname => ({ rolname,allowed:false })));
  await register(db, "fictional-token-00001"); await deleteSession(db);
  assert.equal((await rows(db))[0].enabled,false, "trigger execution succeeds without granting its definer to the Auth role");
}));

for (const [name,change] of [
  ["body", "create or replace function private.retire_push_devices_on_session_delete() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin return old; end$$"],
  ["ACL", "grant execute on function private.retire_push_devices_on_session_delete() to authenticated"],
  ["security", "alter function private.retire_push_devices_on_session_delete() security invoker"],
  ["search path", "alter function private.retire_push_devices_on_session_delete() set search_path=public"],
]) {
  test(`rollback refuses retirement ${name} drift without removing the hook`, () => using(async db => {
    await db.exec(change);
    await assert.rejects(db.exec(rollback()), /push_retirement_rollback_drift/);
    await db.exec("rollback;");
    const actual = await db.query("select count(*)::int n from pg_trigger where tgrelid='auth.sessions'::regclass and tgname='retire_push_devices_before_session_delete'");
    assert.equal(actual.rows[0].n, 1);
  }));
}

for (const [name,from,to] of [
  ["AFTER trigger", "before delete on auth.sessions", "after delete on auth.sessions"],
  ["invoker function", "language plpgsql security definer", "language plpgsql security invoker"],
  ["skip deletion", "return old;", "return null;"],
  ["missing session predicate", "where session_id=old.id and user_id=old.user_id", "where user_id=old.user_id"],
  ["missing revoked-session guard", "if (p_require_session or nullif(auth.jwt()->>''session_id'', '''') is not null) and v_session is null then", "if p_require_session and v_session is null then"],
]) {
  test(`mutation killed: ${name}`, async () => {
    const text=source(); assert.equal(text.split(from).length,2,"unique mutation target");
    await assert.rejects(async () => using(async db => {
      await retirement(db);
      await assert.rejects(register(db,"fictional-token-00001",A,S,true),/invalid_push_session/);
    },text.replace(from,to)), error => error.code === "ERR_ASSERTION" || /push_retirement_(self_check|registration_drift)/.test(error.message));
  });
}
