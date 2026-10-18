import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = new URL("../../supabase/migrations/20261018021000_web_push_worker_protocol.sql", import.meta.url);
const mirror = new URL("../../.migration-backup/supabase/migrations/20261018021000_web_push_worker_protocol.sql", import.meta.url);
const id = n => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function source() {
  try { return await readFile(migration, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; return null; }
}
const identity = db => db.query(`select c.oid::text,c.relowner::regrole::text,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
  (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p where p.polrelid=c.oid) as policies,
  (select jsonb_agg(to_jsonb(i) order by i.indexrelid) from pg_index i where i.indrelid=c.oid and i.indisprimary) as pk,
  (select jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid,a.attnotnull,a.attidentity,a.attgenerated,a.attacl::text)
    order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.attname<>'web_push_protocol') as columns
  from pg_class c where c.oid='public.push_subscriptions'::regclass`);
async function fixture(t, { baseline = false, topic = false, web = false, sql } = {}) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='postgres') then create role postgres bypassrls; end if;
      create role authenticated;create role anon;create role service_role bypassrls;
    end $$;
    create schema private authorization postgres;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select current_setting('request.fixture_user')::uuid$$;
    grant usage on schema public,auth to authenticated;
    create table public.push_subscriptions(id uuid primary key,user_id uuid not null,endpoint text not null,
      p256dh text not null,auth text not null,is_active boolean not null default true,seen integer not null default 0);
    alter table public.push_subscriptions owner to postgres;
    alter table public.push_subscriptions enable row level security;
    grant select,insert,update,delete on public.push_subscriptions to authenticated;
    create policy own_subscription on public.push_subscriptions to authenticated
      using(user_id=auth.uid()) with check(user_id=auth.uid());
    create table private.topic_notification_runtime(singleton boolean primary key check(singleton),enabled boolean not null);
    create table private.web_message_preview_runtime(singleton boolean primary key check(singleton),enabled boolean not null);
    alter table private.topic_notification_runtime owner to postgres;
    alter table private.web_message_preview_runtime owner to postgres;
    insert into private.topic_notification_runtime values(true,${topic});
    insert into private.web_message_preview_runtime values(true,${web});
    insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth) values
      ('${id(10)}','${id(1)}','https://fixture.invalid/push','fixture-key','fixture-auth');
    select set_config('request.fixture_user','${id(1)}',false);`);
  const before = (await identity(db)).rows;
  const rows = (await db.query("select to_jsonb(s) as value from public.push_subscriptions s order by id")).rows;
  if (!baseline) { const ddl = sql ?? await source(); if (ddl) await db.exec(ddl); }
  return { db, before, rows };
}
async function protocol(db) {
  return (await db.query("select web_push_protocol from public.push_subscriptions where id=$1", [id(10)])).rows[0].web_push_protocol;
}
async function ack(db) { await db.query("update public.push_subscriptions set web_push_protocol=1 where id=$1", [id(10)]); }

test("protocol default: actual migration adds a smallint default-zero column and old rows stay zero", async t => {
  const { db, rows } = await fixture(t);
  const meta = (await db.query("select a.atttypid::regtype::text as type,a.attnotnull from pg_attribute a where a.attrelid='public.push_subscriptions'::regclass and a.attname='web_push_protocol'")).rows;
  assert.deepEqual(meta, [{ type: "smallint", attnotnull: true }], "PROTOCOL_COLUMN_REQUIRED");
  assert.equal(await protocol(db), 0);
  assert.deepEqual((await db.query("select to_jsonb(s)-'web_push_protocol' as value from public.push_subscriptions s order by id")).rows, rows);
  await db.query("insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth) values($1,$2,'fixture','key','auth')", [id(11), id(1)]);
  await db.query("insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth,web_push_protocol) values($1,$2,'fixture','key','auth',1)", [id(12), id(1)]);
  assert.deepEqual((await db.query("select web_push_protocol from public.push_subscriptions order by id")).rows.map(r => r.web_push_protocol), [0, 0, 0]);
});

test("protocol ACK: existing own-row ACL permits capability-only 1 and 0 without descriptor changes", async t => {
  const { db, before } = await fixture(t);
  await db.exec("set role authenticated");
  try {
    await ack(db); assert.equal(await protocol(db), 1);
    await db.query("update public.push_subscriptions set seen=seen+1,user_id=user_id,endpoint=endpoint,p256dh=p256dh,auth=auth,is_active=is_active where id=$1", [id(10)]);
    assert.equal(await protocol(db), 1);
    await db.query("update public.push_subscriptions set web_push_protocol=0 where id=$1", [id(10)]);
    assert.equal(await protocol(db), 0);
  } finally { await db.exec("reset role"); }
  assert.deepEqual((await identity(db)).rows, before);
});

test("protocol invalid: CHECK and NOT NULL reject invalid capability-only writes atomically", async t => {
  const { db } = await fixture(t); await ack(db);
  for (const value of [-1, 2, null]) {
    await assert.rejects(db.query("update public.push_subscriptions set web_push_protocol=$1 where id=$2", [value, id(10)]), e => e.code === (value === null ? "23502" : "23514"));
    assert.equal(await protocol(db), 1);
  }
});

for (const [column, value] of [["user_id", id(2)], ["endpoint", "https://fixture.invalid/replaced"], ["p256dh", "replaced-key"], ["auth", "replaced-auth"], ["is_active", false]]) {
  test(`protocol reset: changing ${column} overrides a simultaneous ACK`, async t => {
    const { db } = await fixture(t); await ack(db);
    await db.query(`update public.push_subscriptions set ${column}=$1,web_push_protocol=1 where id=$2`, [value, id(10)]);
    assert.equal(await protocol(db), 0);
  });
}

test("protocol reset: deactivate/reactivate and descriptor ABA cannot restore an old ACK", async t => {
  const { db } = await fixture(t); await ack(db);
  await db.exec("update public.push_subscriptions set is_active=false; update public.push_subscriptions set is_active=true;");
  assert.equal(await protocol(db), 0);
  await ack(db);
  await db.exec("update public.push_subscriptions set auth='replacement'; update public.push_subscriptions set auth='fixture-auth';");
  assert.equal(await protocol(db), 0);
});

test("protocol preserves public identity ACL RLS policies and both runtime flags in all four states", async t => {
  for (const topic of [false, true]) for (const web of [false, true]) {
    const { db, before } = await fixture(t, { topic, web });
    assert.deepEqual((await identity(db)).rows, before);
    assert.deepEqual((await db.query("select (select enabled from private.topic_notification_runtime where singleton) as topic,(select enabled from private.web_message_preview_runtime where singleton) as web")).rows, [{ topic, web }]);
  }
});

test("protocol schema reload is emitted once only by committed actual migration", async t => {
  const { db } = await fixture(t, { baseline: true }), notices = [];
  const stop = await db.listen("pgrst", payload => notices.push(payload));
  try {
    await db.exec(await source());
    assert.deepEqual(notices, ["reload schema"]);
    await assert.rejects(db.exec(await source()), /web_push_worker_protocol_prestate_drift/);
    await db.exec("rollback");
    assert.deepEqual(notices, ["reload schema"]);
  } finally { await stop(); }
});

test("protocol mirror is byte-identical to the executed migration", async () => {
  assert.deepEqual(await readFile(migration), await readFile(mirror));
});

test("protocol rollback header removes only the new trigger function and column and reloads schema", async t => {
  const { db, before, rows } = await fixture(t); await ack(db);
  const text = await source(), start = text.indexOf("-- BEGIN;"), end = text.indexOf("-- COMMIT;", start);
  assert.ok(start > 0 && end > start);
  const rollback = text.slice(start, end + "-- COMMIT;".length).split("\n").map(line => {
    assert.ok(line.startsWith("-- ")); return line.slice(3);
  }).join("\n");
  await db.exec(rollback);
  assert.deepEqual((await identity(db)).rows, before);
  assert.deepEqual((await db.query("select to_jsonb(s) as value from public.push_subscriptions s order by id")).rows, rows);
  assert.equal((await db.query("select to_regprocedure('private.web_push_worker_protocol_reset()') is null as absent")).rows[0].absent, true);
  assert.equal((await db.query("select count(*)::int as n from pg_attribute where attrelid='public.push_subscriptions'::regclass and attname='web_push_protocol' and not attisdropped")).rows[0].n, 0);
});

function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, "unique loaded SQL mutation");
  return text.replace(from, to);
}

test("protocol raising postcheck refuses default constraint and trigger omissions atomically", async t => {
  const original = await source();
  const mutations = [
    ["default", text => replaceOnce(text, "smallint NOT NULL DEFAULT 0,", "smallint NOT NULL DEFAULT 1,")],
    ["constraint", text => replaceOnce(text,
      ",\n  ADD CONSTRAINT push_subscriptions_web_push_protocol_check CHECK(web_push_protocol IN (0,1));", ";")],
    ["trigger", text => replaceOnce(text, "DO $selfcheck$", "ALTER TABLE public.push_subscriptions DISABLE TRIGGER web_push_worker_protocol_reset;\nDO $selfcheck$")],
  ];
  for (const [name, mutate] of mutations) await t.test(name, async t => {
    const { db, before } = await fixture(t, { baseline: true }), notices = [];
    const stop = await db.listen("pgrst", payload => notices.push(payload));
    try {
      await assert.rejects(db.exec(mutate(original)), /web_push_worker_protocol_selfcheck_failed/);
      await db.exec("rollback");
      assert.deepEqual((await identity(db)).rows, before);
      assert.equal((await db.query("select count(*)::int as n from pg_attribute where attrelid='public.push_subscriptions'::regclass and attname='web_push_protocol' and not attisdropped")).rows[0].n, 0);
      assert.equal((await db.query("select to_regprocedure('private.web_push_worker_protocol_reset()') is null as absent")).rows[0].absent, true);
      assert.deepEqual(notices, []);
    } finally { await stop(); }
  });
});

test("protocol reset omissions fail the ordinary literal-zero assertions", async t => {
  const original = await source();
  for (const insert of [true, false]) await t.test(insert ? "insert" : "descriptor", async t => {
    const sql = insert
      ? replaceOnce(original, "IF TG_OP='INSERT' THEN\n    NEW.web_push_protocol:=0;", "IF TG_OP='INSERT' THEN\n    NULL;")
      : replaceOnce(original, "    NEW.web_push_protocol:=0;\n  END IF;\n  RETURN NEW;", "    NULL;\n  END IF;\n  RETURN NEW;");
    const { db } = await fixture(t, { sql });
    if (insert) await db.query("insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth,web_push_protocol) values($1,$2,'fixture','key','auth',1)", [id(11), id(1)]);
    else { await ack(db); await db.exec("update public.push_subscriptions set auth='replacement'"); }
    const value = insert ? (await db.query("select web_push_protocol from public.push_subscriptions where id=$1", [id(11)])).rows[0].web_push_protocol : await protocol(db);
    assert.throws(() => assert.equal(value, 0), error => error.code === "ERR_ASSERTION");
    assert.equal(value, 1);
  });
});
