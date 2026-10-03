import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageFixture, trusted, messageInsert, mediaUrl, uuid, closing,
  mutateInstalled, session, settled, messageCount, objectState,
  outcomeOrWait, pauseCloserAcquisition, namespace, waitForGate,
} from "./bot-media-coverage.fixture.mjs";

const closedOracle = async (db, id, input) => {
  const outcome = await settled(trusted(db, messageInsert(id, input) + ";"));
  assert.equal(outcome.error?.code, "55000", "zero successful new references after close");
  assert.equal(await messageCount(db), 0);
};

for (const [name, signature, edit, input] of [
  ["removed closed-generation guard", "fixture_coverage.check_refs(jsonb)",
    body => body.replace("RAISE EXCEPTION 'fixture_generation_closed' USING ERRCODE = '55000';", "NULL;"),
    db => ({ path: db.a.receipt.path })],
  ["removed final-reference validation", "fixture_coverage.after_write()",
    body => body.replaceAll("PERFORM fixture_coverage.check_refs(refs);", "NULL;"),
    db => ({ url: mediaUrl(db.a.receipt.path) })],
  ["unknown writer treated as absent", "fixture_coverage.check_refs(jsonb)",
    body => body.replace("RAISE EXCEPTION 'fixture_unknown_after_close' USING ERRCODE = '55000';", "NULL;"),
    () => ({ url: "unsupported" })],
]) {
  test("literal refusal oracle kills " + name + " in the actual compiled candidate", async t => {
    const db = await coverageFixture(t), id = uuid(8200);
    await closing(db);
    await closedOracle(db, id, input(db));
    await mutateInstalled(db, signature, edit);
    await assert.rejects(closedOracle(db, id, input(db)), { code: "ERR_ASSERTION" },
      "the same previously passing oracle must go RED under the executable mutant");
    assert.equal(await messageCount(db), 1, "the mutant actually admitted the forbidden fictional row");
  });
}

test("writer barrier key drift is killed by real writer-first contention, not a shared constant assertion", async t => {
  const db = await coverageFixture(t);
  await mutateInstalled(db, "fixture_coverage.before_write()", body => body.replaceAll("270311", "270312"));
  const writer = await session(db);
  await writer.connection.send("begin; " + messageInsert(uuid(8210), { path: db.a.receipt.path }) + ";");
  const outcome = await settled(closing(db));
  await assert.rejects(async () => assert.equal(outcome.error?.code, "55P03", "writer-first must defer close"), { code: "ERR_ASSERTION" });
  await writer.connection.send("commit;");
  assert.deepEqual(await objectState(db), [{ id: 1, closed: true }, { id: 2, closed: false }]);
  assert.equal(await messageCount(db), 1, "wrong-key writer and closer actually committed the forbidden interleaving");
});

test("NOWAIT omission is killed by its actual queued control-row edge with lock timeout disabled", async t => {
  const db = await coverageFixture(t);
  await mutateInstalled(db, "fixture_coverage.close_objects(integer[])", body => body.replace("FOR UPDATE NOWAIT", "FOR UPDATE"));
  const owner = await session(db), closer = await session(db);
  await owner.connection.send("begin; select id from fixture_coverage.objects where id=2 for update;");
  const operation = settled(closer.connection.send("begin; set local lock_timeout='0'; select fixture_coverage.close_objects(array[1,2]); commit;"));
  const observed = await outcomeOrWait(db, operation, closer.pid, owner.pid);
  await owner.connection.send("commit;");
  const outcome = await operation;
  await assert.rejects(async () => assert.equal(observed.waiting, false, "closer must never queue under exclusive coverage"), { code: "ERR_ASSERTION" });
  assert.equal(observed.waiting, true, "pg_stat_activity/pg_blocking_pids prove the mutant's real forbidden wait");
  assert.equal(outcome.error, undefined, "releasing the controlled owner lets the blocking mutant wrongly close");
  assert.deepEqual(await objectState(db), [{ id: 1, closed: true }, { id: 2, closed: true }]);
});

test("pre-acquisition cached scans are killed by a writer commit inside the actual closer acquisition window", async t => {
  const db = await coverageFixture(t);
  await pauseCloserAcquisition(db, { cacheScans: true });
  const barrier = await session(db), closer = await session(db);
  await barrier.connection.send(`begin; select pg_advisory_xact_lock(${namespace},98);`);
  const operation = settled(closer.connection.send("begin; select fixture_coverage.close_objects(array[1]); commit;"));
  await waitForGate(db, closer.pid, barrier.pid, 98);
  await trusted(db, messageInsert(uuid(8250), { path: db.a.receipt.path }) + ";");
  await barrier.connection.send("commit;");
  const outcome = await operation;
  await assert.rejects(async () => assert.equal(outcome.error?.code, "55000", "post-acquisition scan must refuse committed reference"), { code: "ERR_ASSERTION" });
  assert.equal(outcome.error, undefined, "mutant actually closes from cached empty results, not another error");
  assert.equal(await messageCount(db), 1);
  assert.deepEqual(await objectState(db), [{ id: 1, closed: true }, { id: 2, closed: false }]);
});

test("fixed-snapshot guard omission is killed by an old REPEATABLE READ snapshot and concurrent committed close", async t => {
  const db = await coverageFixture(t);
  await mutateInstalled(db, "fixture_coverage.before_write()", body => body.replace(
    /IF pg_catalog\.current_setting\('transaction_isolation'\) <> 'read committed' THEN[\s\S]*?END IF;/, ""));
  const writer = await session(db);
  await writer.connection.send("begin isolation level repeatable read; select closed from fixture_coverage.objects where id=1;");
  await closing(db);
  const outcome = await settled(writer.connection.send(messageInsert(uuid(8220), { path: db.a.receipt.path }) + "; commit;"));
  await assert.rejects(async () => assert.equal(outcome.error?.code, "0A000", "fixed snapshot must be refused"), { code: "ERR_ASSERTION" });
  assert.equal(outcome.error, undefined, "the mutant really commits through its stale snapshot, not another refusal");
  assert.equal(await messageCount(db), 1);
  assert.deepEqual(await objectState(db), [{ id: 1, closed: true }, { id: 2, closed: false }]);
});

test("unknown closer hold omission is killed by a committed unsupported reference", async t => {
  const db = await coverageFixture(t);
  await trusted(db, messageInsert(uuid(8230), { url: "unsupported" }) + ";");
  await assert.rejects(closing(db), { code: "55000" });
  await mutateInstalled(db, "fixture_coverage.close_objects(integer[])", body => body.replace(
    "RAISE EXCEPTION 'fixture_unknown_coverage' USING ERRCODE = '55000';", "NULL;"));
  const outcome = await settled(closing(db));
  await assert.rejects(async () => assert.equal(outcome.error?.code, "55000", "unknown holds all close"), { code: "ERR_ASSERTION" });
  assert.equal(outcome.error, undefined);
  assert.deepEqual(await objectState(db), [{ id: 1, closed: true }, { id: 2, closed: false }]);
});

test("closer isolation omission is killed by a reference committed after its old snapshot", async t => {
  const db = await coverageFixture(t);
  await mutateInstalled(db, "fixture_coverage.close_objects(integer[])", body => body.replace(
    /IF pg_catalog\.current_setting\('transaction_isolation'\) <> 'read committed' THEN[\s\S]*?END IF;/, ""));
  const closer = await session(db);
  await closer.connection.send("begin isolation level repeatable read; select id from public.messages;");
  await trusted(db, messageInsert(uuid(8240), { path: db.a.receipt.path }) + ";");
  const outcome = await settled(closer.connection.send("select fixture_coverage.close_objects(array[1]); commit;"));
  await assert.rejects(async () => assert.equal(outcome.error?.code, "0A000", "old-snapshot closer must be refused"), { code: "ERR_ASSERTION" });
  assert.equal(outcome.error, undefined);
  assert.equal(await messageCount(db), 1);
  assert.deepEqual(await objectState(db), [{ id: 1, closed: true }, { id: 2, closed: false }]);
});
