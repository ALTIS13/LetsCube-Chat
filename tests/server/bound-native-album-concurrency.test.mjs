import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deliveryFixture, sendFixtureMessage, claimFixtureTarget } from "./topic-notification-delivery.fixture.mjs";
import { id, user, chat, quote } from "./topic-notification-overrides.fixture.mjs";

const proposal = new URL("../../docs/proposals/2026-10-17-bound-native-album-delivery.sql", import.meta.url);
const nativeHash = "v1:0918c37f7151f42f6571fb37e7b3ee787c9b9003267e346fae506e3f4cfec1bb";
const webHash = "v1:31a3586636684d806e71ae039a72c602302f7be949c8a4de4b491d7e4cd16f29";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const last = text => JSON.parse(text.trim().split("\n").at(-1));
function observe(promise) {
  const op = { settled: false };
  op.result = promise.then(value => { op.settled = true; return { value }; }, error => { op.settled = true; return { error }; });
  return op;
}
async function result(op) { const r = await op.result; if (r.error) throw r.error; return r.value; }
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("owned PG step timeout")), 15000); })]); }
  finally { clearTimeout(timer); }
}
async function setup(t, channel, mutation) {
  assert.equal(process.env.LETSCUBE_TOPIC_DELIVERY_PG17, "1", "explicit native PG17 required; never skip/fallback");
  assert.ok(process.env.LETSCUBE_TOPIC_PG17_DRIVER, "exact isolated driver required");
  const db = await deliveryFixture({ candidate: true, native: true, t });
  const sessions = [], pending = []; let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    const a = await Promise.allSettled(sessions.map(s => bounded(Promise.resolve().then(() => s.close()))));
    const b = await Promise.allSettled([bounded(Promise.resolve().then(() => db.close()))]);
    const c = await Promise.allSettled(pending.map(op => bounded(op.result)));
    assert.ok([...a, ...b, ...c].every(r => r.status === "fulfilled"), "all exact owned connections must close/settle");
  };
  t.after(close);
  try {
    // Only fixture column supplementation: all producers/policy bodies remain actual.
    await db.exec(`alter table public.user_push_devices add column token text,add column app_version text;
      update public.user_push_devices set token='fictional:\u00e9\u{1f9ca}',app_version='0.1.21';
      update public.push_subscriptions set endpoint='https://provider.invalid/\u00e9/\u{1f9ca}?x=1#f',p256dh='a\u{1f9ca}:bc',auth='auth:\u00e9';
      alter table public.user_push_devices enable row level security;
      alter table public.notifications_native_push_outbox enable row level security;`);
    await db.exec(await readFile(proposal, "utf8"));
    const album = channel !== "native", web = channel === "album-web";
    const signature = album ? "public.album_push_recheck_bound(uuid,uuid,uuid,text)" : "public.native_push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)";
    if (mutation) {
      const ddl = (await db.query(`select pg_get_functiondef('${signature}'::regprocedure) as source`)).rows[0].source;
      const needle = mutation === "share" ? web ? "FOR SHARE OF s" : "FOR SHARE OF d"
        : mutation === "early-settle" ? album ? "IF v_web THEN" : "SELECT d.* INTO v_device FROM public.user_push_devices d"
          : album ? "PERFORM private.topic_alert_lock(v_user,v_chat);" : "PERFORM private.topic_alert_lock(v_user,(v_origin->>'chat_id')::uuid);";
      assert.equal(ddl.split(needle).length - 1, 1, "one compiled lock omission anchor");
      const replacement = mutation === "early-settle"
        ? `PERFORM private.topic_alert_reconcile_${album ? "group(v_group)" : "notification(v_note)"};\n  ${needle}`
        : mutation === "share" ? "" : "NULL;";
      await db.exec(ddl.replace(needle, replacement));
    }
    await sendFixtureMessage(db, 160, album ? { albumIndex: 0 } : {});
    if (album) await sendFixtureMessage(db, 161, { albumIndex: 1 });
    const targetId = id(web ? 50 : 52);
    const table = album ? "public.notifications_album_push_outbox" : "public.notifications_native_push_outbox";
    const claim = await claimFixtureTarget(db, table, `${web ? "subscription_id" : "device_id"}='${targetId}'`);
    assert.ok(claim.id, "actual producer required");
    for (let i = 0; i < 2; i++) sessions.push(db.session());
    const [a, b] = sessions;
    const pidA = Number(await a.send("select pg_backend_pid();")), pidB = Number(await b.send("select pg_backend_pid();"));
    assert.ok(pidA > 0 && pidB > 0); assert.notEqual(pidA, pidB);
    const rpc = album ? "public.album_push_recheck_bound" : "public.native_push_outbox_delivery_recheck_bound";
    const args = `'${claim.id}','${claim.token}','${targetId}','${web ? webHash : nativeHash}'`;
    const call = album ? `select jsonb_build_object('status',status) from ${rpc}(${args});`
      : `select jsonb_build_object('status',${rpc}(${args}));`;
    const change = `update public.${web ? "push_subscriptions" : "user_push_devices"} set ${web ? "auth" : "token"}='B' where id='${targetId}'; select jsonb_build_object('changed',true);`;
    const start = (s, sql) => { const op = observe(s.send(sql)); pending.push(op); return op; };
    return { db, a, b, pidA, pidB, claim, table, call, change, start, close, targetId,
      targetTable: web ? "public.push_subscriptions" : "public.user_push_devices",
      changedStatus: album ? "target_changed" : "device_changed" };
  } catch (error) { await close(); throw error; }
}
async function wait(f, pid, blocker, op, event, message) {
  for (let i = 0; i < 35; i++) {
    const r = (await f.db.query(`select wait_event,pg_blocking_pids(pid) as blockers from pg_stat_activity where pid=${pid}`)).rows[0];
    if (r?.wait_event === event && r.blockers.includes(blocker)) return;
    if (op.settled) { await result(op); break; }
    await pause(35);
  }
  assert.fail(message);
}
async function released(f) {
  const r = (await f.db.query(`select claim_token,claimed_until,sent_at,attempt_count,last_error${f.table.includes("album") ? ",suppressed_at,suppression_reason" : ""}
    from ${f.table} where id='${f.claim.id}'`)).rows[0];
  assert.deepEqual(r, { claim_token: null, claimed_until: null, sent_at: null, attempt_count: 0, last_error: null,
    ...(f.table.includes("album") ? { suppressed_at: null, suppression_reason: null } : {}) });
}
async function matchingHoldsWriter(f) {
  assert.deepEqual(last(await f.a.send(`begin; ${f.call}`)), { status: "deliver" });
  const writer = f.start(f.b, `begin; ${f.change}`);
  await wait(f, f.pidB, f.pidA, writer, "transactionid", "literal descriptor writer must wait until checked transaction commits");
  await f.a.send("commit;"); assert.deepEqual(last(await result(writer)), { changed: true }); await f.b.send("commit;");
  assert.deepEqual(last(await f.a.send(f.call)), { status: f.changedStatus }); await released(f);
}
async function barrierFirst(f) {
  await f.a.send(`begin; select private.topic_notification_lock('${user}','${chat}');`);
  const reader = f.start(f.b, `begin; ${f.call}`);
  await wait(f, f.pidB, f.pidA, reader, "advisory", "actual bound reader must reach account/source barrier");
  const writer = f.start(f.a, f.change);
  for (let i = 0; i < 35; i++) {
    if (writer.settled) break;
    const r = (await f.db.query(`select wait_event,pg_blocking_pids(pid) as blockers from pg_stat_activity where pid=${f.pidA}`)).rows[0];
    if (r?.wait_event === "transactionid" && r.blockers.includes(f.pidB)) {
      assert.fail("literal source barrier must precede any descriptor/outbox locks");
    }
    await pause(35);
  }
  assert.deepEqual(last(await bounded(result(writer))), { changed: true }); await f.a.send("commit;");
  assert.deepEqual(last(await bounded(result(reader))), { status: f.changedStatus }); await f.b.send("commit;"); await released(f);
}

async function targetDelete(f) {
  const fk = (await f.db.query(`select count(*)::int as n from pg_constraint
    where conrelid='${f.table}'::regclass and confrelid='${f.targetTable}'::regclass and contype='f' and confdeltype='c'`)).rows[0].n;
  assert.equal(fk, 1, "actual target DELETE CASCADE FK required, not a lock-only mock");
  await f.db.exec(`set role postgres; update public.notifications n set alert_suppressed_at=clock_timestamp()
    where n.id in (select notification_id from public.notifications_native_push_outbox where id='${f.claim.id}'
      union select am.notification_id from public.notifications_album_push_outbox o join public.album_push_members am on am.group_id=o.group_id where o.id='${f.claim.id}'); reset role;`);
  await f.a.send(`begin; select id from ${f.targetTable} where id='${f.targetId}' for update;`);
  const reader = f.start(f.b, `begin; ${f.call}`);
  await wait(f, f.pidB, f.pidA, reader, "transactionid", "literal bound reader must reach held descriptor");
  const deletion = f.start(f.a, `delete from ${f.targetTable} where id='${f.targetId}'; select jsonb_build_object('deleted',true);`);
  for (let i = 0; i < 35; i++) {
    if (deletion.settled) break;
    const r = (await f.db.query(`select wait_event,pg_blocking_pids(pid) as blockers from pg_stat_activity where pid=${f.pidA}`)).rows[0];
    if (r?.wait_event === "transactionid" && r.blockers.includes(f.pidB)) {
      assert.fail("literal descriptor DELETE CASCADE must not wait on pretarget SETTLE outbox ownership");
    }
    await pause(20);
  }
  assert.deepEqual(last(await bounded(result(deletion))), { deleted: true }); await f.a.send("commit;");
  assert.deepEqual(last(await bounded(result(reader))), { status: "claim_lost" }); await f.b.send("commit;");
  assert.equal((await f.db.query(`select count(*)::int as n from ${f.table} where id='${f.claim.id}'`)).rows[0].n, 0);
}

for (const channel of ["native", "album-web", "album-native"]) {
  test(`${channel} pending descriptor writer commits B before bound reader checks A`, { timeout: 60000 }, async t => {
    const f = await setup(t, channel);
    try {
      await f.a.send(`begin; ${f.change}`); const reader = f.start(f.b, `begin; ${f.call}`);
      await wait(f, f.pidB, f.pidA, reader, "transactionid", "literal bound reader must wait for descriptor writer");
      await f.a.send("commit;"); assert.deepEqual(last(await result(reader)), { status: f.changedStatus });
      await f.b.send("commit;"); await released(f);
    } finally { await f.close(); }
  });
  test(`${channel} matching descriptor transaction holds concurrent writer`, { timeout: 60000 }, async t => {
    const f = await setup(t, channel); try { await matchingHoldsWriter(f); } finally { await f.close(); }
  });
  test(`${channel} old in-flight reader cannot release a newer exact claim`, { timeout: 60000 }, async t => {
    const f = await setup(t, channel);
    try {
      await f.a.send(`begin; ${f.change}`); const reader = f.start(f.b, `begin; ${f.call}`);
      await wait(f, f.pidB, f.pidA, reader, "transactionid", "literal bound reader must wait for descriptor writer");
      await f.db.exec(`update ${f.table} set claim_token='${id(99)}',claimed_until=clock_timestamp()+interval '5 minutes' where id='${f.claim.id}';`);
      const before = (await f.db.query(`select claim_token,claimed_until,sent_at,attempt_count,last_error from ${f.table} where id='${f.claim.id}'`)).rows[0];
      await f.a.send("commit;"); assert.deepEqual(last(await result(reader)), { status: "claim_lost" }); await f.b.send("commit;");
      assert.deepEqual((await f.db.query(`select claim_token,claimed_until,sent_at,attempt_count,last_error from ${f.table} where id='${f.claim.id}'`)).rows[0], before);
    } finally { await f.close(); }
  });
  test(`${channel} compiled descriptor SHARE omission breaks writer-waits oracle`, { timeout: 60000 }, async t => {
    const f = await setup(t, channel, "share");
    try { await assert.rejects(() => matchingHoldsWriter(f), error => {
      assert.equal(error.code, "ERR_ASSERTION", "not a SQL/setup failure");
      assert.equal(error.message.split("\n")[0], "literal descriptor writer must wait until checked transaction commits"); return true;
    }); } finally { await f.close(); }
  });
  test(`${channel} account/source barrier is before descriptor/outbox locks`, { timeout: 60000 }, async t => {
    const f = await setup(t, channel); try { await barrierFirst(f); } finally { await f.close(); }
  });
  test(`${channel} compiled early-barrier omission exposes descriptor inversion`, { timeout: 60000 }, async t => {
    const f = await setup(t, channel, "barrier");
    try { await assert.rejects(() => barrierFirst(f), error => {
      assert.equal(error.code, "ERR_ASSERTION", "not a SQL/setup failure");
      assert.equal(error.message.split("\n")[0], "literal source barrier must precede any descriptor/outbox locks"); return true;
    }); } finally { await f.close(); }
  });
  test(`${channel} descriptor DELETE CASCADE is not inverted by a pretarget SETTLE`, { timeout: 60000 }, async t => {
    const f = await setup(t, channel); try { await targetDelete(f); } finally { await f.close(); }
  });
  test(`${channel} compiled early reconciliation breaks literal FK DELETE oracle`, { timeout: 60000 }, async t => {
    const f = await setup(t, channel, "early-settle");
    try { await assert.rejects(() => targetDelete(f), error => {
      assert.equal(error.code, "ERR_ASSERTION", "not a setup/deadlock/SQL failure");
      assert.equal(error.message.split("\n")[0], "literal descriptor DELETE CASCADE must not wait on pretarget SETTLE outbox ownership"); return true;
    }); } finally { await f.close(); }
  });
}
