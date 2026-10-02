import assert from "node:assert/strict";
import test from "node:test";
import { reservation, reserveSql, commitSql, object } from "./bot-inline-media-ingest.fixture.mjs";
import {
  purgeFixture, enqueue, claim, queueRows, quote, uuid, catalog, queueConstraints,
  waitForRelationLock, migration, rollback, claimSignature, finishSignature,
} from "./bot-media-purge-hold.fixture.mjs";

const baseline = Boolean(process.env.BOT_PURGE_HOLD_BASELINE);
const constraint = "message_media_purge_chat_media_unleased";
const controlSql = sql => `set role service_role; ${sql};`;
const claimedIds = rows => rows.map(row => row.id).sort();
const protectedRows = async db => (await queueRows(db)).filter(row => row.bucket === "chat-media");
const finish = (db, id, error = null) => db.exec(controlSql(
  `select public.message_media_purge_finish(${quote(id)},${error === null ? "null" : quote(error)})`));
const denied = (operation, code, name) => assert.rejects(operation, error => {
  assert.equal(error.code, code);
  if (name) assert.ok(error.message.includes(name), "expected named database rejection");
  return true;
}, "expected database rejection " + code + (name ? " from " + name : ""));
const gated = (name, body) => test(name, { skip: baseline ? "migration-only case; explicit baseline run" : false }, body);

async function message(db, n, fields = {}) {
  const values = { id: uuid(2000 + n), chat_id: uuid(3), type: "image", ...fields };
  await db.exec(`insert into public.messages(${Object.keys(values).join(",")}) values (${
    Object.values(values).map(value => value === null ? "null" : quote(typeof value === "object" ? JSON.stringify(value) : value)).join(",")});`);
  return values.id;
}

async function variant(db, n, fields = {}) {
  const values = { id: uuid(4000 + n), source_path: "source-" + n, variant_kind: "image_thumb", variant_path: "variant-" + n, ...fields };
  await db.exec(`insert into public.media_variants(${Object.keys(values).join(",")}) values (${
    Object.values(values).map(value => value === null ? "null" : quote(value)).join(",")});`);
  return values.id;
}

async function replaceClaim(db, edit) {
  const [fn] = await db.query(`select pg_get_functiondef('${claimSignature}'::regprocedure) as ddl`);
  const changed = edit(fn.ddl);
  assert.notEqual(changed, fn.ddl, "mutation must actually change executable function DDL");
  await db.exec(changed);
  return fn.ddl;
}

async function functionCatalogWithoutBody(db) {
  return (await catalog(db)).map(({ body, ...metadata }) => metadata);
}

async function tableCatalog(db) {
  return db.query(`select oid::regclass::text as name,relowner::regrole::text as owner,
    relacl::text,relrowsecurity,relforcerowsecurity from pg_class
    where oid in ('private.message_media_purge'::regclass,'public.media_variants'::regclass,'public.content_reports'::regclass)
    order by 1`);
}

test("claim never returns chat-media, including malformed paths without receipts", async t => {
  const db = await purgeFixture(t);
  t.diagnostic("actual PostgreSQL " + db.version);
  const canonical = reservation().path;
  await enqueue(db, 1, "chat-media", canonical);
  await enqueue(db, 2, "chat-media", canonical.replaceAll("/", "%2F"));
  await enqueue(db, 3, "chat-media", "%malformed/../not-a-bot-object");
  await enqueue(db, 4, "chat-media", "");
  const before = await queueRows(db);
  const returned = await claim(db);
  assert.equal(returned.filter(row => row.bucket === "chat-media").length, 0,
    "claimed protected bucket: chat-media must never reach external DELETE");
  assert.deepEqual(await queueRows(db), before, "no-reference protected queue rows remain untouched");
});

test("hold includes existing and future ingest receipts without changing charges or protected queue rows", async t => {
  const db = await purgeFixture(t);
  const r = reservation({ key: "purge-hold-receipt" });
  await db.service(reserveSql(r));
  await object(db, r);
  await db.service(commitSql(r));
  await db.exec("update public.messages set deleted_at=clock_timestamp();");
  await enqueue(db, 10, "chat-media", r.path);
  const future = reservation({ key: "purge-hold-future", fingerprint: "c".repeat(64), lease: uuid(502) });
  future.path = `${future.chat}/bots/${future.bot}/${future.fingerprint}.pdf`;
  await enqueue(db, 11, "chat-media", future.path);
  const before = await protectedRows(db);
  await db.service(reserveSql(future));
  const receipts = await db.query("select * from private.bot_media_ingests order by idempotency_key");
  assert.equal((await claim(db)).filter(row => row.bucket === "chat-media").length, 0);
  assert.deepEqual(await protectedRows(db), before);
  assert.deepEqual(await db.query("select * from private.bot_media_ingests order by idempotency_key"), receipts);
});

test("old protected rows cannot starve a newer ordinary row at literal LIMIT 1", async t => {
  const db = await purgeFixture(t);
  await enqueue(db, 20, "chat-media", "oldest", { created_at: "2000-01-01T00:00:00Z", last_error: "fixture-retained-error" });
  await enqueue(db, 21, "chat-media", "next", { created_at: "2000-01-02T00:00:00Z" });
  const ordinary = await enqueue(db, 22, "media", "ordinary", { created_at: "2000-01-03T00:00:00Z" });
  const before = await protectedRows(db);
  assert.deepEqual(claimedIds(await claim(db, 1)), [ordinary]);
  assert.deepEqual(await protectedRows(db), before);
  assert.deepEqual(await claim(db, 1), []);
});

test("D-103 limit defaults/clamps stay 50, 1 and 200 and exclude the bucket before limiting", async t => {
  const db = await purgeFixture(t);
  await db.exec(`insert into private.message_media_purge(id,message_id,bucket,path,created_at)
    select ('10000000-0000-4000-8000-'||lpad((6000+n)::text,12,'0'))::uuid,
      ('10000000-0000-4000-8000-'||lpad((7000+n)::text,12,'0'))::uuid,
      case when n<=25 then 'chat-media' else 'media' end,'limit-'||n,
      '2000-01-01'::timestamptz+n*interval '1 second' from generate_series(1,325) n;`);
  const initialProtected = await protectedRows(db);
  for (const [limit, expected] of [[null, 50], [0, 1], [-5, 1], [1, 1], [201, 200], [999, 200]]) {
    await db.exec("update private.message_media_purge set claimed_until=null,attempts=0 where bucket='media';");
    const rows = await claim(db, limit);
    assert.equal(rows.length, expected);
    assert.equal(rows.filter(row => row.bucket === "chat-media").length, 0);
    assert.deepEqual(await protectedRows(db), initialProtected);
  }
  await db.exec("update private.message_media_purge set claimed_until=null,attempts=0 where bucket='media';");
  const rows = JSON.parse(await db.exec(controlSql(
    "select coalesce(jsonb_agg(q),'[]'::jsonb) from public.message_media_purge_claim() q")));
  assert.equal(rows.length, 50);
});

test("other buckets retain canonical, explicit/derived preview and shared variant target holds with exact equality", async t => {
  const db = await purgeFixture(t);
  await message(db, 30, { media_bucket: "media", media_path: "live.jpg", media_metadata: { preview: { path: "explicit.webp" } } });
  await message(db, 31);
  await message(db, 32, { deleted_at: "2000-01-01" });
  await variant(db, 30, { message_id: uuid(2031), variant_bucket: "media", variant_path: "shared.webp" });
  await variant(db, 31, { message_id: uuid(2032), variant_bucket: "media", variant_path: "shared.webp" });
  await variant(db, 32, { profile_id: uuid(32), variant_bucket: "media", variant_path: "avatar.webp" });
  for (const [n, path] of [[30, "live.jpg"], [31, "explicit.webp"], [32, "live.preview.webp"],
    [33, "live.preview.jpg"], [34, "shared.webp"], [35, "avatar.webp"]]) await enqueue(db, n, "media", path);
  const eligible = [
    await enqueue(db, 36, "other-bucket", "live.jpg"),
    await enqueue(db, 37, "media", "live.jpg.extra"),
    await enqueue(db, 38, "media", "LIVE.jpg"),
    await enqueue(db, 39, "media", "source-only"),
  ];
  await variant(db, 33, { source_path: "source-only", variant_path: "unrelated-target" });
  assert.deepEqual(claimedIds(await claim(db)), eligible.sort());
  const heldIds = [30, 31, 32, 33, 34, 35].map(n => uuid(1000 + n));
  const allRows = await queueRows(db);
  const kept = allRows.filter(row => heldIds.includes(row.id) && row.status === "kept");
  assert.equal(kept.length, 6, "canonical, both derived previews, explicit preview and shared/avatar targets remain held");
  assert.ok(kept.every(row => row.attempts === 0 && row.claimed_until === null && row.finished_at !== null));
  assert.equal(allRows.find(row => row.message_id === uuid(2032) && row.path === "shared.webp").status, "kept",
    "the removed variant target is still held by the live message's shared variant");
});

test("moved deleted-message variants and open moderation reports keep the original D-103 behavior", async t => {
  const db = await purgeFixture(t);
  for (const n of [40, 41, 42]) await message(db, n, { deleted_at: "2000-01-01" });
  await variant(db, 40, { message_id: uuid(2040), variant_path: "deleted-target" });
  await variant(db, 41, { message_id: uuid(2041), variant_path: "reported-new" });
  await variant(db, 42, { message_id: uuid(2042), variant_path: "reported-reviewing" });
  await db.exec(`insert into public.content_reports(reporter_id,target_user_id,kind,message_id,reason,status)
    values ('${uuid(50)}','${uuid(51)}','message','${uuid(2041)}','other','new'),
      ('${uuid(50)}','${uuid(51)}','message','${uuid(2042)}','other','reviewing');`);
  const rows = await claim(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, "deleted-target");
  assert.deepEqual((await db.query("select variant_path from public.media_variants order by variant_path"))
    .map(row => row.variant_path), ["reported-new", "reported-reviewing"]);
  await db.exec("update public.content_reports set status='dismissed';");
  assert.deepEqual((await claim(db)).map(row => row.path).sort(), ["reported-new", "reported-reviewing"]);
  assert.equal((await db.query("select count(*)::int as n from public.media_variants"))[0].n, 0);
});

test("protected live references can still be marked kept and moved protected targets are never leased", async t => {
  const db = await purgeFixture(t);
  await message(db, 45, { media_bucket: "chat-media", media_path: "held-original" });
  await message(db, 46, { deleted_at: "2000-01-01" });
  await enqueue(db, 45, "chat-media", "held-original");
  await variant(db, 45, { message_id: uuid(2046), variant_bucket: "chat-media", variant_path: "moved-protected" });
  assert.deepEqual(await claim(db), []);
  const rows = await protectedRows(db);
  assert.equal(rows.find(row => row.path === "held-original").status, "kept");
  const moved = rows.find(row => row.path === "moved-protected");
  assert.equal(moved.status, "pending");
  assert.equal(moved.attempts, 0);
  assert.equal(moved.claimed_until, null);
});

test("two actual sessions preserve SKIP LOCKED and a future ordinary lease", async t => {
  const db = await purgeFixture(t);
  const first = await enqueue(db, 50, "media", "locked", { created_at: "2000-01-01" });
  const second = await enqueue(db, 51, "media", "free", { created_at: "2000-01-02" });
  const future = await enqueue(db, 52, "media", "future");
  await db.exec(`update private.message_media_purge set claimed_until=clock_timestamp()+interval '1 hour' where id='${future}';`);
  const a = db.session(), b = db.session();
  await a.send(`begin; select id from private.message_media_purge where id='${first}' for update;`);
  const returned = JSON.parse(await b.send(controlSql(
    "select coalesce(jsonb_agg(q),'[]'::jsonb) from public.message_media_purge_claim(1) q")));
  assert.deepEqual(claimedIds(returned), [second]);
  await a.send("commit;");
  assert.deepEqual(claimedIds(await claim(db, 1)), [first]);
  assert.deepEqual(await claim(db), []);
  const futureRow = (await queueRows(db)).find(row => row.id === future);
  assert.equal(futureRow.attempts, 0);
});

test("lease expiry remains strict less-than transaction time and reclaims increment attempts once", async t => {
  const db = await purgeFixture(t);
  const equal = await enqueue(db, 60, "media", "equal");
  const expired = await enqueue(db, 61, "media", "expired", { attempts: 2 });
  const session = db.session();
  await session.send(`begin; update private.message_media_purge set claimed_until=transaction_timestamp() where id='${equal}';
    update private.message_media_purge set claimed_until=transaction_timestamp()-interval '1 microsecond' where id='${expired}';`);
  const rows = JSON.parse(await session.send(controlSql(
    "select coalesce(jsonb_agg(q),'[]'::jsonb) from public.message_media_purge_claim(50) q")));
  assert.deepEqual(claimedIds(rows), [expired]);
  const delta = JSON.parse(await session.send(`reset role; select to_jsonb(q) from (
    select attempts,claimed_until-transaction_timestamp()=interval '5 minutes' as five_minutes
    from private.message_media_purge where id='${expired}') q;`));
  assert.deepEqual(delta, { attempts: 3, five_minutes: true });
  await session.send("commit;");
});

test("ordinary finish still marks success done and retains bounded error/backoff/eight-attempt failure", async t => {
  const db = await purgeFixture(t);
  const success = await enqueue(db, 70, "media", "success");
  const failure = await enqueue(db, 71, "media", "failure");
  const exhausted = await enqueue(db, 72, "media", "exhausted", { attempts: 7 });
  await claim(db);
  await finish(db, success);
  await finish(db, failure, "x".repeat(250));
  await finish(db, exhausted, "fixture-remove-failed");
  const rows = await queueRows(db);
  const done = rows.find(row => row.id === success);
  assert.equal(done.status, "done"); assert.equal(done.claimed_until, null);
  assert.notEqual(done.finished_at, null); assert.equal(done.last_error, null);
  const retry = rows.find(row => row.id === failure);
  assert.equal(retry.status, "pending"); assert.equal(retry.last_error.length, 200);
  assert.equal(retry.attempts, 1); assert.equal(retry.finished_at, null);
  const failed = rows.find(row => row.id === exhausted);
  assert.equal(failed.status, "failed"); assert.equal(failed.attempts, 8);
  assert.notEqual(failed.finished_at, null); assert.equal(failed.last_error, "fixture-remove-failed");
  await finish(db, uuid(9999));
});

gated("migration preserves function identity/ACL/settings, tables and queue data; only service can claim/finish", async t => {
  const db = await purgeFixture(t, { applyHold: false });
  await enqueue(db, 80, "chat-media", "pending-retained");
  const functions = await functionCatalogWithoutBody(db), tables = await tableCatalog(db), rows = await queueRows(db);
  const originalFinish = (await catalog(db)).find(row => row.name === "message_media_purge_finish");
  assert.ok(originalFinish);
  await db.exec(migration());
  assert.deepEqual(await functionCatalogWithoutBody(db), functions);
  assert.deepEqual(await tableCatalog(db), tables);
  assert.deepEqual(await queueRows(db), rows);
  assert.deepEqual((await catalog(db)).find(row => row.name === "message_media_purge_finish"), originalFinish);
  assert.ok((await queueConstraints(db)).some(row => row.conname === constraint && row.convalidated));
  for (const role of ["anon", "authenticated"]) {
    await denied(db.exec(`set role ${role}; select * from public.message_media_purge_claim(1);`), "42501");
    await denied(db.exec(`set role ${role}; select public.message_media_purge_finish('${uuid(1080)}',null);`), "42501");
  }
  await db.exec("grant usage on schema private to anon,authenticated,service_role;");
  for (const role of ["anon", "authenticated", "service_role"]) {
    await denied(db.exec(`set role ${role}; select * from private.message_media_purge;`), "42501");
    await denied(db.exec(`set role ${role}; update private.message_media_purge set claimed_until=now();`), "42501");
  }
  assert.deepEqual(await claim(db), []);
});

gated("prior-body, execute ACL, owner and search_path drift refuse installation atomically", async t => {
  const db = await purgeFixture(t, { applyHold: false });
  const [original] = await db.query(`select pg_get_functiondef('${claimSignature}'::regprocedure) as ddl`);
  const mutations = [
    [original.ddl.replace("AS $function$", "AS $function$\n-- fixture old-body drift\n"), original.ddl],
    [`grant execute on function ${claimSignature} to authenticated;`, `revoke execute on function ${claimSignature} from authenticated;`],
    [`alter function ${claimSignature} owner to supabase_admin;`, `alter function ${claimSignature} owner to postgres;`],
    [`alter function ${claimSignature} set search_path=public;`, `alter function ${claimSignature} set search_path='';`],
  ];
  for (const [change, restore] of mutations) {
    await db.exec(change);
    const before = await catalog(db), constraints = await queueConstraints(db), rows = await queueRows(db);
    await denied(db.exec(migration()), "P0001");
    assert.deepEqual(await catalog(db), before);
    assert.deepEqual(await queueConstraints(db), constraints);
    assert.deepEqual(await queueRows(db), rows);
    await db.exec(restore);
  }
  await db.exec(migration());
});

gated("unsettled attempts, all leased statuses and unfinished terminal history refuse without erasing history", async t => {
  const db = await purgeFixture(t, { applyHold: false });
  const cases = [
    { status: "pending", attempts: 1 }, { status: "failed", attempts: 1 },
    ...["pending", "failed", "done", "kept"].flatMap(status => [
      { status, claimed_until: "2000-01-01", finished_at: "2000-01-01" },
      { status, claimed_until: "2100-01-01", finished_at: "2000-01-01" },
    ]),
    { status: "done", attempts: 0, finished_at: null },
    { status: "kept", attempts: 1, finished_at: null },
  ];
  for (let n = 0; n < cases.length; n++) {
    const id = await enqueue(db, 100 + n, "chat-media", "fixture-unsettled", cases[n]);
    const before = await queueRows(db), functions = await catalog(db), constraints = await queueConstraints(db);
    await denied(db.exec(migration()), "P0001");
    assert.deepEqual(await queueRows(db), before);
    assert.deepEqual(await catalog(db), functions);
    assert.deepEqual(await queueConstraints(db), constraints);
    await db.exec(`delete from private.message_media_purge where id='${id}';`);
  }
});

gated("finished done/kept protected history with NULL lease is admitted and preserved unchanged", async t => {
  const db = await purgeFixture(t, { applyHold: false });
  await enqueue(db, 120, "chat-media", "retained-done", { status: "done", attempts: 1, finished_at: "2000-01-01" });
  await enqueue(db, 121, "chat-media", "retained-kept", { status: "kept", attempts: 5, finished_at: "2000-01-01", last_error: "retained" });
  await enqueue(db, 122, "chat-media", "pending-unattempted");
  await enqueue(db, 123, "chat-media", "failed-unattempted", { status: "failed", attempts: 0 });
  await enqueue(db, 124, "media", "ordinary-attempted", { attempts: 2, claimed_until: "2000-01-01" });
  const rows = await queueRows(db);
  await db.exec(migration());
  assert.deepEqual(await queueRows(db), rows);
  assert.equal((await claim(db)).length, 1);
  assert.deepEqual(await protectedRows(db), rows.filter(row => row.bucket === "chat-media"));
});

test("old compiled claim clone raises named CHECK 23514 without changing attempts or leases", async t => {
  const db = await purgeFixture(t);
  await enqueue(db, 130, "chat-media", "stale-body-protected");
  await enqueue(db, 131, "media", "ordinary-in-same-old-transaction");
  const before = await queueRows(db);
  await denied(db.exec(controlSql("select * from public.fixture_stale_claim(50)")), "23514", constraint);
  assert.deepEqual(await queueRows(db), before, "the whole old claim rolls back, including ordinary rows");
});

gated("old invocation waiting on variants before migration cannot return a protected object after resume", async t => {
  const db = await purgeFixture(t, { applyHold: false });
  await enqueue(db, 140, "chat-media", "in-flight-old-body");
  const before = await queueRows(db), lock = db.session(), old = db.session();
  await lock.send("begin; lock table public.media_variants in access exclusive mode;");
  const pid = Number(await old.send("select pg_backend_pid();"));
  const failed = denied(old.send(controlSql("select * from public.message_media_purge_claim(50)")), "23514", constraint);
  await waitForRelationLock(db, pid, "public.media_variants");
  await db.exec(migration());
  await lock.send("commit;");
  await failed;
  assert.deepEqual(await queueRows(db), before);
  assert.deepEqual(await claim(db), []);
});

gated("unsettled prestate is rechecked after the actual ACCESS EXCLUSIVE queue-lock wait", async t => {
  const db = await purgeFixture(t, { applyHold: false });
  const id = await enqueue(db, 150, "chat-media", "changed-during-lock-wait");
  const writer = db.session(), installer = db.session();
  await writer.send("begin; lock table private.message_media_purge in row exclusive mode;");
  const pid = Number(await installer.send("select pg_backend_pid();"));
  const refusal = denied(installer.send(migration()), "P0001");
  await waitForRelationLock(db, pid, "private.message_media_purge");
  await writer.send(`update private.message_media_purge set attempts=1 where id='${id}'; commit;`);
  await refusal;
  const [row] = await queueRows(db);
  assert.equal(row.attempts, 1); assert.equal(row.claimed_until, null);
  assert.equal((await catalog(db)).find(row => row.name === "message_media_purge_claim").body, "6c8c495fff5655465d4f788389bdd1ae");
  assert.ok(!(await queueConstraints(db)).some(row => row.conname === constraint));
});

gated("CHECK rejects protected leases even for terminal rows and permits other buckets", async t => {
  const db = await purgeFixture(t);
  for (const [n, status] of [[160, "pending"], [161, "done"], [162, "kept"], [163, "failed"]]) {
    const id = await enqueue(db, n, "chat-media", "check-" + status, { status, finished_at: "2000-01-01" });
    await denied(db.exec(`update private.message_media_purge set claimed_until=now() where id='${id}';`), "23514", constraint);
  }
  await denied(enqueue(db, 164, "chat-media", "leased-insert", { claimed_until: "2000-01-01" }), "23514", constraint);
  const ordinary = await enqueue(db, 165, "other-bucket", "ordinary-lease");
  await db.exec(`update private.message_media_purge set claimed_until=now() where id='${ordinary}';`);
  await denied(db.exec(`update private.message_media_purge set bucket='chat-media' where id='${ordinary}';`), "23514", constraint);
  await db.exec("grant usage on schema private to service_role; grant select,update(claimed_until) on private.message_media_purge to service_role;");
  await denied(db.exec(controlSql(`update private.message_media_purge set claimed_until=now() where id='${uuid(1161)}'`)), "23514", constraint);
  await db.exec(controlSql(`update private.message_media_purge set claimed_until=now() where id='${ordinary}'`));
  assert.ok((await protectedRows(db)).every(row => row.claimed_until === null));
});

gated("rollback removes the backstop and restores the original function but does not recover queue/data", async t => {
  const db = await purgeFixture(t, { applyHold: false });
  const original = await catalog(db), constraints = await queueConstraints(db), tables = await tableCatalog(db);
  await db.exec(migration());
  await enqueue(db, 170, "chat-media", "rollback-retained");
  const before = await queueRows(db);
  await db.exec(rollback());
  assert.deepEqual(await catalog(db), original);
  assert.deepEqual(await queueConstraints(db), constraints);
  assert.deepEqual(await tableCatalog(db), tables);
  assert.deepEqual(await queueRows(db), before, "rollback is not data recovery and performs no claim");
  assert.equal((await claim(db)).filter(row => row.bucket === "chat-media").length, 1,
    "restored old body is deliberately unsafe for future protected claims; rollback needs explicit operator control");
});

gated("literal removal/wrong-bucket mutants are exposed by protected admission assertion", async t => {
  const db = await purgeFixture(t);
  await enqueue(db, 180, "chat-media", "protected-first", { created_at: "2000-01-01" });
  const ordinary = await enqueue(db, 181, "media", "ordinary-next", { created_at: "2000-01-02" });
  assert.deepEqual(claimedIds(await claim(db, 1)), [ordinary]);
  await db.exec("update private.message_media_purge set claimed_until=null,attempts=0 where bucket='media';");
  const guard = /\s+and\s+queued\.bucket\s*<>\s*'chat-media'/i;
  for (const edit of [ddl => ddl.replace(guard, ""), ddl => ddl.replace(guard, "\n       and queued.bucket <> 'fixture-wrong-bucket'")]) {
    const original = await replaceClaim(db, edit);
    await denied((async () => {
      assert.deepEqual(claimedIds(await claim(db, 1)), [ordinary]);
    })(), "23514", constraint);
    assert.ok((await queueConstraints(db)).some(row => row.conname === constraint));
    assert.ok((await queueRows(db)).every(row => row.attempts === 0 && row.claimed_until === null));
    await db.exec(original);
  }
});

gated("guard placed after LIMIT is exposed by ordinary starvation while CHECK remains installed", async t => {
  const db = await purgeFixture(t);
  await enqueue(db, 190, "chat-media", "protected-first", { created_at: "2000-01-01" });
  const ordinary = await enqueue(db, 191, "media", "ordinary-next", { created_at: "2000-01-02" });
  assert.deepEqual(claimedIds(await claim(db, 1)), [ordinary]);
  await db.exec("update private.message_media_purge set claimed_until=null,attempts=0 where bucket='media';");
  await replaceClaim(db, ddl => ddl.replace(/\s+and\s+queued\.bucket\s*<>\s*'chat-media'/i, "")
    .replace("where queued.id = picked.id", "where queued.id = picked.id and queued.bucket <> 'chat-media'"));
  const rows = await claim(db, 1);
  assert.deepEqual(rows, []);
  assert.throws(() => assert.equal(rows.length, 1), { name: "AssertionError" });
  assert.equal((await queueRows(db)).find(row => row.id === ordinary).attempts, 0);
});

gated("omitted CHECK mutant is exposed by the exact stale-body rejection assertion", async t => {
  const db = await purgeFixture(t, { applyHold: false });
  await enqueue(db, 200, "chat-media", "stale-body-mutant");
  const originalRows = await queueRows(db), originalCatalog = await catalog(db);
  const sql = migration();
  const omitted = sql.replace(/ALTER TABLE private\.message_media_purge ADD CONSTRAINT message_media_purge_chat_media_unleased\s+CHECK \(bucket <> 'chat-media' OR claimed_until IS NULL\);/,
    "-- fixture mutation: omitted constraint installation");
  assert.notEqual(omitted, sql, "source omission mutant must change the actual migration");
  await denied(db.exec(omitted), "P0001", "bot_media_purge_hold_incomplete");
  assert.deepEqual(await queueRows(db), originalRows);
  assert.deepEqual(await catalog(db), originalCatalog);
  assert.ok(!(await queueConstraints(db)).some(row => row.conname === constraint));
  await db.exec(sql);
  await db.exec(`alter table private.message_media_purge drop constraint ${constraint};`);
  await assert.rejects(denied(db.exec(controlSql("select * from public.fixture_stale_claim(50)")), "23514", constraint),
    { name: "AssertionError" });
  const [row] = await queueRows(db);
  assert.equal(row.attempts, 1); assert.notEqual(row.claimed_until, null);
});
