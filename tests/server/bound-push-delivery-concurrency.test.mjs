import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deliveryFixture, sendFixtureMessage, claimFixtureTarget } from "./topic-notification-delivery.fixture.mjs";
import { id, user, quote } from "./topic-notification-overrides.fixture.mjs";

// Native PG17 only. Fixed fictional descriptor/literal shared with the DB probe;
// no hash computed by the implementation under test supplies this oracle.
const proposal = new URL("../../docs/proposals/2026-10-16-bound-push-delivery.sql", import.meta.url);
const signature = "public.push_outbox_delivery_recheck_bound(uuid,uuid,uuid,text)";
const endpoint = "https://provider.invalid/\u00e9/\u{1f9ca}?x=1#f";
const key = "a\u{1f9ca}:bc", auth = "auth:\u00e9";
const fingerprintA = "v1:31a3586636684d806e71ae039a72c602302f7be949c8a4de4b491d7e4cd16f29";
const writerWait = "descriptor writer must wait on transactionid while bound transaction holds matching snapshot";
const readerWait = "bound reader must wait on transactionid for the uncommitted descriptor writer";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`bounded native PG step timed out: ${label}`)), 15000);
    })]);
  } finally { clearTimeout(timer); }
}
function observe(promise) {
  const operation = { settled: false };
  operation.result = promise.then(value => {
    operation.settled = true; return { value };
  }, error => {
    operation.settled = true; return { error };
  });
  return operation;
}
async function result(operation) {
  const outcome = await bounded(operation.result, "pending session result");
  if (Object.hasOwn(outcome, "error")) throw outcome.error;
  return outcome.value;
}
const last = text => JSON.parse(text.trim().split("\n").at(-1));
const boundCall = claim => `select jsonb_build_object('status',public.push_outbox_delivery_recheck_bound(
  '${claim.id}','${claim.token}','${id(50)}','${fingerprintA}'));`;
const descriptorB = `update public.push_subscriptions set endpoint=${quote(endpoint + "-B")},
  p256dh=${quote(key + "-B")},auth=${quote(auth + "-B")} where id='${id(50)}';`;

async function setup(t, { omitShare = false } = {}) {
  assert.equal(process.env.LETSCUBE_TOPIC_DELIVERY_PG17, "1", "explicit LETSCUBE_TOPIC_DELIVERY_PG17=1 is required; no fallback");
  assert.ok(process.env.LETSCUBE_TOPIC_PG17_DRIVER, "explicit isolated PG17 driver is required; no fallback");
  const db = await deliveryFixture({ baseline: true, native: true, t });
  const sessions = [], pending = [];
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    // Closing the exact owned connections rolls back open transactions and
    // releases blockers even when the schedule or omission oracle rejects.
    const closures = await Promise.allSettled(sessions.map(session => bounded(Promise.resolve().then(() => session.close()), "owned session closure")));
    const database = await Promise.allSettled([bounded(Promise.resolve().then(() => db.close()), "owned fixture closure")]);
    const settlements = await Promise.allSettled(pending.map(operation => bounded(operation.result, "closed session settlement")));
    assert.ok(closures.every(outcome => outcome.status === "fulfilled"), "all owned native sessions must close");
    assert.equal(database[0].status, "fulfilled", "owned native fixture must close");
    assert.ok(settlements.every(outcome => outcome.status === "fulfilled"), "closed native operations must settle");
  }
  t.after(close);
  try {
    await db.exec(`alter table public.push_subscriptions add column endpoint text,add column p256dh text,add column auth text;
      update public.push_subscriptions set endpoint=${quote(endpoint)},p256dh=${quote(key)},auth=${quote(auth)};
      alter table public.push_subscriptions enable row level security;
      alter table public.notifications_push_outbox enable row level security;`);
    await db.exec(await readFile(proposal, "utf8"));
    if (omitShare) {
      const source = (await db.query(`select pg_get_functiondef('${signature}'::regprocedure) as source`)).rows[0].source;
      assert.equal(source.split("FOR SHARE OF s").length - 1, 1, "one actual compiled subscription-lock omission anchor");
      await db.exec(source.replace("FOR SHARE OF s", ""));
    }
    await sendFixtureMessage(db, 160);
    const claim = await claimFixtureTarget(db, "public.notifications_push_outbox", `subscription_id='${id(50)}'`);
    assert.ok(claim.id, "real captured producer must create the claimed target");
    for (let i = 0; i < 2; i++) {
      const session = db.session(); sessions.push(session);
      assert.equal(typeof session.send, "function", "native session.send API is required");
      assert.equal(typeof session.close, "function", "native session.close API is required for exact cleanup");
    }
    const [a, b] = sessions;
    const pidA = Number(await bounded(a.send("select pg_backend_pid();"), "session A pid"));
    const pidB = Number(await bounded(b.send("select pg_backend_pid();"), "session B pid"));
    assert.ok(Number.isSafeInteger(pidA) && pidA > 0 && Number.isSafeInteger(pidB) && pidB > 0);
    assert.notEqual(pidA, pidB, "the schedule must use two real PostgreSQL backends");
    const start = (session, sql) => {
      const operation = observe(session.send(sql)); pending.push(operation); return operation;
    };
    return { db, a, b, pidA, pidB, claim, start, close };
  } catch (error) { await close(); throw error; }
}

async function waitForTransaction(db, pid, blocker, operation, message) {
  for (let i = 0; i < 30; i++) {
    const row = (await db.query(`select wait_event_type,wait_event,pg_blocking_pids(pid) as blockers
      from pg_stat_activity where pid=${pid}`)).rows[0];
    if (row?.wait_event_type === "Lock" && row.wait_event === "transactionid" && row.blockers.includes(blocker)) return;
    if (operation.settled) {
      // A driver/SQL rejection is not a killed lock mutant.
      const outcome = await operation.result;
      if (Object.hasOwn(outcome, "error")) throw outcome.error;
      break;
    }
    await delay(40);
  }
  assert.fail(message);
}
async function assertReleased(f) {
  const state = (await f.db.query(`select claim_token,claimed_until,suppressed_at,sent_at,attempt_count,last_error
    from public.notifications_push_outbox where id='${f.claim.id}'`)).rows[0];
  assert.deepEqual(state, { claim_token: null, claimed_until: null, suppressed_at: null,
    sent_at: null, attempt_count: 0, last_error: null });
  const descriptor = (await f.db.query(`select user_id,endpoint,p256dh,auth from public.push_subscriptions where id='${id(50)}'`)).rows[0];
  assert.deepEqual(descriptor, { user_id: user, endpoint: endpoint + "-B", p256dh: key + "-B", auth: auth + "-B" });
}

test("native bound recheck waits for A descriptor commit then releases only the cached-A lease", { timeout: 60000 }, async t => {
  const f = await setup(t);
  try {
    await bounded(f.a.send(`begin; ${descriptorB}`), "A changes descriptor before recheck");
    const pending = f.start(f.b, `begin; ${boundCall(f.claim)}`);
    await waitForTransaction(f.db, f.pidB, f.pidA, pending, readerWait);
    await bounded(f.a.send("commit;"), "A commits descriptor B");
    assert.deepEqual(last(await result(pending)), { status: "subscription_changed" });
    await bounded(f.b.send("commit;"), "B commits exact lease release");
    await assertReleased(f);
  } finally { await f.close(); }
});

async function readerHoldsWriter(f) {
  assert.deepEqual(last(await bounded(f.a.send(`begin; ${boundCall(f.claim)}`), "A obtains matching descriptor lock")), { status: "deliver" });
  const pending = f.start(f.b, `begin; ${descriptorB} select jsonb_build_object('updated',true);`);
  await waitForTransaction(f.db, f.pidB, f.pidA, pending, writerWait);
  await bounded(f.a.send("commit;"), "A releases checked descriptor");
  assert.deepEqual(last(await result(pending)), { updated: true });
  await bounded(f.b.send("commit;"), "B commits changed descriptor");
  const answer = (await f.db.query(`select public.push_outbox_delivery_recheck_bound(
    '${f.claim.id}','${f.claim.token}','${id(50)}','${fingerprintA}') as status`)).rows[0];
  assert.equal(answer.status, "subscription_changed", "retry of cached fingerprint A must refuse descriptor B");
  await assertReleased(f);
}
test("native matching bound transaction holds descriptor writer until commit; retry A is denied", { timeout: 60000 }, async t => {
  const f = await setup(t);
  try { await readerHoldsWriter(f); } finally { await f.close(); }
});

test("compiled FOR SHARE omission breaks the literal writer-waits oracle, not setup", { timeout: 60000 }, async t => {
  const f = await setup(t, { omitShare: true });
  try {
    await assert.rejects(() => readerHoldsWriter(f), error => {
      assert.equal(error.code, "ERR_ASSERTION", "driver/SQL/setup failures cannot kill the lock mutant");
      assert.equal(error.message.split("\n")[0], writerWait); return true;
    });
  } finally { await f.close(); }
});
