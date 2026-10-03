import assert from "node:assert/strict";
import test from "node:test";
import {
  fenceFixture, session, namespace, gate, waitForFence, assertHeld, settled, accounting, state,
  pausedNestedInsert, pausedUpsert,
} from "./bot-message-fence-interleavings.fixture.mjs";

const open = [{ id: 1, closed: false }, { id: 2, closed: false }];
const closed = [{ id: 1, closed: true }, { id: 2, closed: true }];

test("writer-first positive control retains committed references and denies waiting sorted closer", async t => {
  const db = await fenceFixture(t);
  t.diagnostic("actual PostgreSQL " + db.version + "; independent real sessions, test-only candidate, no production admission");
  const before = await accounting(db), writer = await session(db), closer = await session(db);
  await writer.connection.send("insert into fixture_fence.messages(id,object_id) values (10,2),(11,1);");
  await assertHeld(db, writer.pid, 1, "ShareLock"); await assertHeld(db, writer.pid, 2, "ShareLock");
  const closing = settled(closer.connection.send("select fixture_fence.close_objects(array[2,1]); commit;"));
  await waitForFence(db, closer.pid, writer.pid, 1, "ExclusiveLock");
  await writer.connection.send("commit;");
  const outcome = await closing;
  assert.equal(outcome.error?.code, "55000");
  assert.match(outcome.error.message, /fixture_reference_present/);
  assert.deepEqual(await state(db), { objects: open, messages: [{ id: 10, object_id: 2 }, { id: 11, object_id: 1 }] });
  assert.deepEqual(await accounting(db), before);
});

test("closer-first positive control rechecks after wait and denies new writer with full rollback", async t => {
  const db = await fenceFixture(t), before = await accounting(db);
  const closer = await session(db), writer = await session(db);
  await closer.connection.send("select fixture_fence.close_objects(array[2,1]);");
  await assertHeld(db, closer.pid, 1, "ExclusiveLock"); await assertHeld(db, closer.pid, 2, "ExclusiveLock");
  const writing = settled(writer.connection.send("insert into fixture_fence.messages(id,object_id) values (10,2),(11,1); commit;"));
  await waitForFence(db, writer.pid, closer.pid, 1, "ShareLock");
  await closer.connection.send("commit;");
  const outcome = await writing;
  assert.equal(outcome.error?.code, "55000");
  assert.match(outcome.error.message, /fixture_writer_closed/);
  assert.deepEqual(await state(db), { objects: closed, messages: [] });
  assert.deepEqual(await accounting(db), before);
});

// The safety mode deliberately goes RED on the observed counterexample; default
// mode retains the literal 40P01 oracle. Neither mode implements a production fix.
function requireCounterexample(outcome) {
  if (process.env.BOT_MESSAGE_FENCE_EXPECT_SAFE === "1") {
    assert.equal(outcome.error?.code ?? null, null, "negative acceptance: sorted per-statement fences must not deadlock");
  }
  assert.equal(outcome.error?.code, "40P01", "the actual writer must be the PostgreSQL deadlock victim, not a timeout");
}

test("reverse object order across separate sorted statements deadlocks with exclusive waiting closer", async t => {
  const db = await fenceFixture(t), before = await accounting(db);
  const writer = await session(db, { deadlockTimeout: "300ms" }), closer = await session(db);
  await writer.connection.send("insert into fixture_fence.messages(id,object_id) values (10,2);");
  await assertHeld(db, writer.pid, 2, "ShareLock");
  const closing = settled(closer.connection.send("select fixture_fence.close_objects(array[2,1]); commit;"));
  await waitForFence(db, closer.pid, writer.pid, 2, "ExclusiveLock");
  await assertHeld(db, closer.pid, 1, "ExclusiveLock");
  const writing = settled(writer.connection.send("insert into fixture_fence.messages(id,object_id) values (11,1); commit;"));
  await waitForFence(db, writer.pid, closer.pid, 1, "ShareLock");
  const outcome = await writing;
  const closeOutcome = await closing;
  assert.equal(closeOutcome.error, undefined);
  assert.deepEqual(await state(db), { objects: closed, messages: [] });
  assert.deepEqual(await accounting(db), before);
  requireCounterexample(outcome);
});

test("nested INSERT sorted statement handlers deadlock after inner B fence before outer A fence", async t => {
  const db = await fenceFixture(t), before = await accounting(db);
  await pausedNestedInsert(db);
  const barrier = await session(db), writer = await session(db, { deadlockTimeout: "300ms" }), closer = await session(db);
  await barrier.connection.send(`select pg_advisory_xact_lock(${namespace},${gate});`);
  const writing = settled(writer.connection.send("insert into fixture_fence.messages(id,object_id) values (901,1); commit;"));
  await waitForFence(db, writer.pid, barrier.pid, gate, "ExclusiveLock");
  await assertHeld(db, writer.pid, 2, "ShareLock");
  const closing = settled(closer.connection.send("select fixture_fence.close_objects(array[2,1]); commit;"));
  await waitForFence(db, closer.pid, writer.pid, 2, "ExclusiveLock");
  await assertHeld(db, closer.pid, 1, "ExclusiveLock");
  await barrier.connection.send("commit;");
  await waitForFence(db, writer.pid, closer.pid, 1, "ShareLock");
  const outcome = await writing, closeOutcome = await closing;
  assert.equal(closeOutcome.error, undefined);
  assert.deepEqual(await state(db), { objects: closed, messages: [] });
  assert.deepEqual(await accounting(db), before);
  requireCounterexample(outcome);
});

test("ON CONFLICT update and insert sorted transition handlers deadlock across their disjoint object sets", async t => {
  const db = await fenceFixture(t), before = await accounting(db);
  await pausedUpsert(db);
  const barrier = await session(db), writer = await session(db, { deadlockTimeout: "300ms" }), closer = await session(db);
  await barrier.connection.send(`select pg_advisory_xact_lock(${namespace},${gate});`);
  const writing = settled(writer.connection.send(`set local fixture_fence.pause_upsert='on';
    insert into fixture_fence.messages(id,object_id) values (701,2),(702,1)
      on conflict(id) do update set object_id=excluded.object_id; commit;`));
  await waitForFence(db, writer.pid, barrier.pid, gate, "ExclusiveLock");
  await assertHeld(db, writer.pid, 2, "ShareLock");
  const closing = settled(closer.connection.send("select fixture_fence.close_objects(array[2,1]); commit;"));
  await waitForFence(db, closer.pid, writer.pid, 2, "ExclusiveLock");
  await assertHeld(db, closer.pid, 1, "ExclusiveLock");
  await barrier.connection.send("commit;");
  await waitForFence(db, writer.pid, closer.pid, 1, "ShareLock");
  const outcome = await writing, closeOutcome = await closing;
  assert.equal(closeOutcome.error, undefined);
  assert.deepEqual(await state(db), { objects: closed, messages: [{ id: 701, object_id: null }] });
  assert.deepEqual(await accounting(db), before);
  requireCounterexample(outcome);
});
