import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../../", import.meta.url);
const path = "supabase/migrations/20261018031000_native_preview_point_lookup.sql";
const id = n => `ab000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = id(1), sender = id(2), sid = id(3), device = id(4), chat = id(5), message = id(6), note = id(7);
const signature = "public.native_message_notification_preview(uuid,uuid)";
const oldJoin = "join public.messages m on n.payload->>'message_id' = m.id::text";
async function source() {
  try { return await readFile(new URL(path, root), "utf8"); }
  catch (e) { if (e.code !== "ENOENT") throw e; return null; }
}
function extract(text, start, delimiter = "$fn$;") {
  const a = text.indexOf(start), b = text.indexOf(delimiter, a);
  assert.ok(a >= 0 && b > a, "actual SQL fixture boundary");
  return text.slice(a, b + delimiter.length);
}
async function baselineSql() {
  const base = (await readFile(new URL("supabase/migrations/20261007210924_native_message_preview.sql", root), "utf8")).replaceAll("\r", "");
  return extract(base, "create function public.native_message_notification_preview(").replace(
    "    and n.id = p_notification_id and n.kind = 'message' and n.read_at is null",
    "    and n.id = p_notification_id and n.kind = 'message' and n.read_at is null\n    AND private.notification_topic_alert_allowed(n.id)");
}
async function fixture(t, { migrate = true } = {}) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls; create role outsider;
    create schema auth; create schema private;
    create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to authenticated;
    create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz,not_after timestamptz);
    create table public.chats(id uuid primary key);
    create table public.chat_members(chat_id uuid,user_id uuid,joined_at timestamptz,hidden_at timestamptz,cleared_at timestamptz);
    create table public.topics(id uuid primary key,chat_id uuid,is_general boolean,archived boolean);
    create table public.messages(id uuid primary key,chat_id uuid,user_id uuid,bot_id uuid,content text,type text,
      deleted_at timestamptz,created_at timestamptz,topic_id uuid,media_metadata jsonb);
    create table public.profiles(id uuid primary key,full_name text);
    create table public.bots(id uuid primary key,display_name text);
    create table public.message_hidden_for_users(message_id uuid,user_id uuid);
    create table public.user_blocks(blocker_id uuid,blocked_id uuid);
    create function public.is_banned(uuid) returns boolean language sql stable as $$select false$$;
    create table public.notifications(id uuid primary key,user_id uuid,kind text,payload jsonb,read_at timestamptz,
      created_at timestamptz,alert_origin jsonb,alert_suppressed_at timestamptz);
    create table public.user_push_devices(id uuid primary key,user_id uuid,session_id uuid,platform text,provider text,enabled boolean,revoked_at timestamptz);
    create table public.notification_preview_preferences(user_id uuid primary key,preview_level text);
    create table public.chat_notification_preferences(user_id uuid,chat_id uuid,push_enabled boolean,muted_until timestamptz);
    create table public.topic_notification_preferences(user_id uuid,chat_id uuid,scope_key text,mode text);
    create table private.topic_notification_runtime(singleton boolean primary key,enabled boolean);
    create table private.web_message_preview_runtime(singleton boolean primary key,enabled boolean);
    insert into private.topic_notification_runtime values(true,false);
    insert into private.web_message_preview_runtime values(true,true);
    create table public.notifications_native_push_outbox(notification_id uuid,device_id uuid,user_id uuid);
    create table public.album_push_groups(id uuid primary key,user_id uuid,chat_id uuid,sender_kind text,sender_id uuid,album_id text,topic_alert_suppressed_at timestamptz);
    create table public.album_push_members(group_id uuid,notification_id uuid,message_id uuid);
    create table public.notifications_album_push_outbox(group_id uuid,device_id uuid,subscription_id uuid,suppressed_at timestamptz);
    create sequence private.visibility_calls;
    create sequence private.push_calls;
    create table private.fixture_policy(allowed boolean); insert into private.fixture_policy values(true);
    -- Controlled push-policy boundary; visibility/topic/album and the RPC use actual SQL.
    create function public._notification_push_allowed(u uuid,k text,p jsonb) returns boolean
      language plpgsql stable security definer as $$begin
        perform nextval('private.push_calls');
        return k='message' and (select allowed from private.fixture_policy)
          and private.message_topic_alert_allowed(u,(p->>'message_id')::uuid);
      end$$;
    insert into auth.sessions values('${sid}','${user}',now()-interval '2 hours',null);
    insert into public.chats values('${chat}');
    insert into public.chat_members values('${chat}','${user}',now()-interval '3 hours',null,null);
    insert into public.profiles values('${sender}','Fixture Sender');
    insert into public.messages values('${message}','${chat}','${sender}',null,'Current fixture text','text',null,now()-interval '1 minute',null,'{}');
    insert into public.messages select ('cd000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${chat}','${sender}',null,
      'Unrelated fixture','text',null,now()-interval '1 minute',null,'{}' from generate_series(1,4500) i;
    insert into public.notifications values('${note}','${user}','message',jsonb_build_object('message_id','${message}','chat_id','${chat}'),null,now()-interval '1 minute',null,null);
    insert into public.user_push_devices values('${device}','${user}','${sid}','android','fcm',true,null);
    insert into public.notification_preview_preferences values('${user}','message');
    insert into public.notifications_native_push_outbox values('${note}','${device}','${user}');
    do $$declare r record;begin for r in select oid::regclass as name from pg_class where relnamespace='public'::regnamespace and relkind='r' loop
      execute format('alter table %s enable row level security',r.name);end loop;end$$;
  `);
  const visibility = await readFile(new URL("supabase/migrations/20261001180000_member_mentions.sql", root), "utf8");
  await db.exec(extract(visibility, "CREATE FUNCTION private.message_notification_visible_to("));
  await db.exec(`alter function private.message_notification_visible_to(uuid,uuid) rename to fixture_actual_visible;
    create function private.message_notification_visible_to(m uuid,u uuid) returns boolean language plpgsql stable security definer as $$begin
      perform nextval('private.visibility_calls'); return private.fixture_actual_visible(m,u);end$$;`);
  const coordinated = await readFile(new URL("supabase/migrations/20261017104253_coordinated_notification_release.sql", root), "utf8");
  for (const name of ["topic_notification_scope", "message_topic_alert_allowed", "message_alert_origin", "notification_topic_alert_allowed"])
    await db.exec(extract(coordinated, `CREATE FUNCTION private.${name}(`));
  const base = await readFile(new URL("supabase/migrations/20261007210924_native_message_preview.sql", root), "utf8");
  await db.exec(extract(base, "create function public.native_message_preview_recipient("));
  await db.exec(await baselineSql());
  await db.exec(`revoke all on function ${signature} from public,anon,authenticated,service_role;
    grant execute on function ${signature} to authenticated;
    update public.notifications set alert_origin=private.message_alert_origin('${message}');
    analyze public.messages; analyze public.notifications; analyze auth.sessions; analyze public.user_push_devices;`);
  await claims(db);
  const before = await metadata(db);
  if (migrate && await source()) await db.exec(await source());
  return { db, before };
}
async function claims(db, extra = {}) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: "authenticated", is_anonymous: false,
    sub: user, session_id: sid, exp: Math.floor(Date.now() / 1000) + 3600, ...extra })]);
}
async function preview(db, d = device, n = note) {
  await db.exec("set role authenticated");
  try { return (await db.query("select * from public.native_message_notification_preview($1,$2)", [d, n])).rows; }
  finally { await db.exec("reset role"); }
}
async function metadata(db) {
  return (await db.query(`select to_jsonb(p)-'prosrc' as function,
    (select jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) order by c.oid)
      from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')) as tables,
    (select enabled from private.topic_notification_runtime where singleton) as topic,
    (select enabled from private.web_message_preview_runtime where singleton) as web
    from pg_proc p where p.oid='${signature}'::regprocedure`)).rows;
}
async function resetCounters(db) { await db.exec("alter sequence private.visibility_calls restart; alter sequence private.push_calls restart;"); }
async function counters(db) {
  return (await db.query(`select (select case when is_called then last_value else 0 end from private.visibility_calls)::int as visibility,
    (select case when is_called then last_value else 0 end from private.push_calls)::int as push`)).rows[0];
}
async function pointOracle(db) {
  await resetCounters(db);
  const rows = await preview(db), calls = await counters(db);
  assert.equal(rows.length, 1, "positive current owned notification");
  assert.ok(calls.visibility <= 8 && calls.push <= 2, `POINT_LOOKUP_REQUIRED: ${JSON.stringify(calls)}`);
  return rows;
}

test("point lookup: actual RPC evaluates privacy only for the exact message, not 4500 unrelated rows", async t => {
  const { db } = await fixture(t);
  const rows = await pointOracle(db);
  assert.equal(rows[0].message_id, message); assert.equal(rows[0].body, "Current fixture text");
  t.diagnostic(`executed point lookup privacy calls: ${JSON.stringify(await counters(db))}`);
});

test("point lookup counter rejects the executed old text-cast join", async t => {
  const { db } = await fixture(t);
  await pointOracle(db);
  await db.exec((await baselineSql()).replace("create function", "create or replace function"));
  await assert.rejects(pointOracle(db), /POINT_LOOKUP_REQUIRED/);
});

test("actual migration preserves function identity ACL security RLS and both global flags", async t => {
  const { db, before } = await fixture(t);
  assert.deepEqual(await metadata(db), before);
  for (const role of ["anon", "service_role", "outsider"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query("select * from public.native_message_notification_preview($1,$2)", [device, note]), /permission denied/);
    await db.exec("reset role");
  }
});

test("executed migration changes exactly one join in the independently reconstructed live body", async t => {
  const { db } = await fixture(t, { migrate: false });
  const body = async () => (await db.query(`select prosrc from pg_proc where oid='${signature}'::regprocedure`)).rows[0].prosrc;
  const before = await body();
  assert.equal((await db.query(`select md5(prosrc) as hash from pg_proc where oid='${signature}'::regprocedure`)).rows[0].hash,
    "b5661f9e78a29ed856f91c702bd118e4");
  const pointJoin = `join public.messages m on m.id = CASE
      WHEN n.payload->>'message_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (n.payload->>'message_id')::uuid
      ELSE NULL::uuid END`;
  assert.equal(before.split(oldJoin).length, 2);
  await db.exec(await source());
  assert.equal(await body(), before.replace(oldJoin, () => pointJoin));
  assert.equal((await db.query(`select md5(prosrc) as hash from pg_proc where oid='${signature}'::regprocedure`)).rows[0].hash,
    "52e6ea87dedfafe9fbe99f5cc14ee6c6");
});

test("guarded UUID lookup preserves rejection of malformed missing uppercase and noncanonical payload IDs", async t => {
  const { db } = await fixture(t);
  assert.equal((await preview(db)).length, 1);
  for (const value of [null, "", "not-a-uuid", message.toUpperCase(), message.replaceAll("-", ""), `{${message}}`, ` ${message}`, 123, {}, id(99)]) {
    await db.query("update public.notifications set payload=jsonb_build_object('chat_id',$1::text,'message_id',$2::jsonb)", [chat, JSON.stringify(value)]);
    assert.deepEqual(await preview(db), [], `reject ${JSON.stringify(value)}`);
  }
  await db.query("update public.notifications set payload=jsonb_build_object('chat_id',$1::text)", [chat]);
  assert.deepEqual(await preview(db), []);
});

test("executed RPC retains unread session recipient visibility topic consent push and descriptor gates", async t => {
  const { db } = await fixture(t);
  for (const [name, change] of [
    ["read", "update public.notifications set read_at=now()"],
    ["wrong notification owner", `update public.notifications set user_id='${id(99)}'`],
    ["old notification", "update public.notifications set created_at=now()-interval '3 hours'"],
    ["future notification", "update public.notifications set created_at=now()+interval '1 minute'"],
    ["chat mismatch", `update public.notifications set payload=jsonb_set(payload,'{chat_id}','\"${id(99)}\"')`],
    ["uppercase chat remains rejected", `update public.notifications set payload=jsonb_set(payload,'{chat_id}','\"${chat.toUpperCase()}\"')`],
    ["deleted message", "update public.messages set deleted_at=now()"],
    ["hidden", `insert into public.message_hidden_for_users values('${message}','${user}')`],
    ["blocked", `insert into public.user_blocks values('${user}','${sender}')`],
    ["topic disabled", `insert into public.topic_notification_preferences values('${user}','${chat}','general','disabled')`],
    ["suppressed", "update public.notifications set alert_suppressed_at=now()"],
    ["origin mismatch", "update public.notifications set alert_origin='{}'"],
    ["none consent", "update public.notification_preview_preferences set preview_level='none'"],
    ["push denied", "update private.fixture_policy set allowed=false"],
    ["revoked session", "delete from auth.sessions"],
    ["expired session", "update auth.sessions set not_after=now()-interval '1 second'"],
    ["foreign descriptor session", `update public.user_push_devices set session_id='${id(99)}'`],
    ["disabled descriptor", "update public.user_push_devices set enabled=false"],
    ["revoked descriptor", "update public.user_push_devices set revoked_at=now()"],
    ["missing delivery", "delete from public.notifications_native_push_outbox"],
  ]) await t.test(name, async () => {
    await db.exec("begin");
    try { assert.equal((await preview(db)).length, 1); await db.exec(change); assert.deepEqual(await preview(db), []); }
    finally { await db.exec("rollback"); }
  });
  for (const extra of [{ is_anonymous: true }, { exp: 1 }, { session_id: id(99) }, { sub: id(99) }]) {
    await claims(db, extra); assert.deepEqual(await preview(db), []);
  }
});

test("album alternative still requires exact own unsuppressed native album delivery", async t => {
  const { db } = await fixture(t);
  await db.exec(`delete from public.notifications_native_push_outbox;
    insert into public.album_push_groups values('${id(20)}','${user}','${chat}','user','${sender}','fixture-album',null);
    insert into public.album_push_members values('${id(20)}','${note}','${message}');
    insert into public.notifications_album_push_outbox values('${id(20)}','${device}',null,null);`);
  assert.equal((await preview(db)).length, 1);
  for (const change of ["update public.notifications_album_push_outbox set suppressed_at=now()",
    `update public.notifications_album_push_outbox set device_id='${id(99)}'`,
    `update public.album_push_members set message_id='${id(99)}'`,
    `update public.album_push_groups set sender_id='${id(99)}'`]) {
    await db.exec("begin");
    try { await db.exec(change); assert.deepEqual(await preview(db), []); } finally { await db.exec("rollback"); }
  }
});

test("migration mirror and exact rollback restore the old executed body and metadata", async t => {
  const sql = await source(); assert.ok(sql, "MIGRATION_REQUIRED");
  assert.deepEqual(await readFile(new URL(path, root)), await readFile(new URL(`.migration-backup/${path}`, root)));
  const { db, before } = await fixture(t);
  const rollback = extract(sql, "-- BEGIN;", "-- COMMIT;").split("\n").map(line => {
    if (line === "--") return "";
    assert.ok(line.startsWith("-- ")); return line.slice(3);
  }).join("\n");
  await db.exec(rollback);
  assert.equal((await db.query(`select md5(prosrc) as hash from pg_proc where oid='${signature}'::regprocedure`)).rows[0].hash, "b5661f9e78a29ed856f91c702bd118e4");
  assert.deepEqual(await metadata(db), before);
  assert.equal((await preview(db)).length, 1);
  await db.exec(rollback);
  assert.deepEqual(await metadata(db), before);
});

test("raising prestate checks refuse body ACL RLS and role drift without changing the function", async t => {
  for (const [name, change] of [
    ["body", `do $$begin execute replace(pg_get_functiondef('${signature}'::regprocedure),'n.read_at is null','true');end$$;`],
    ["ACL", `grant execute on function ${signature} to anon`],
    ["RLS", "alter table public.messages disable row level security"],
    ["role", "alter role authenticated bypassrls"],
  ]) await t.test(name, async t => {
    const { db } = await fixture(t, { migrate: false });
    await db.exec(change);
    const before = await metadata(db);
    const hash = (await db.query(`select md5(prosrc) as hash from pg_proc where oid='${signature}'::regprocedure`)).rows;
    await assert.rejects(db.exec(await source()), /native_preview_point_prestate_drift/);
    await db.exec("rollback");
    assert.deepEqual(await metadata(db), before);
    assert.deepEqual((await db.query(`select md5(prosrc) as hash from pg_proc where oid='${signature}'::regprocedure`)).rows, hash);
  });
});

test("raising postcheck rejects patch ACL and RLS omissions atomically", async t => {
  const sql = await source();
  for (const [name, from, to] of [
    ["patch omitted", "  EXECUTE replace(ddl,old_join,new_join);", "  NULL;"],
    ["ACL changed", "  EXECUTE metadata_sql INTO after_metadata;",
      `  REVOKE EXECUTE ON FUNCTION ${signature} FROM authenticated;\n  EXECUTE metadata_sql INTO after_metadata;`],
    ["RLS disabled", "  EXECUTE metadata_sql INTO after_metadata;",
      "  ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;\n  EXECUTE metadata_sql INTO after_metadata;"],
  ]) await t.test(name, async t => {
    const { db, before } = await fixture(t, { migrate: false });
    assert.equal(sql.split(from).length, 2);
    await assert.rejects(db.exec(sql.replace(from, () => to)), /native_preview_point_selfcheck_failed/);
    await db.exec("rollback");
    assert.deepEqual(await metadata(db), before);
    assert.equal((await db.query(`select md5(prosrc) as hash from pg_proc where oid='${signature}'::regprocedure`)).rows[0].hash,
      "b5661f9e78a29ed856f91c702bd118e4");
  });
});
