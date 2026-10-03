import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageFixture, trusted, quote, session, settled, accounting, closing,
  objectState, outcomeOrWait,
} from "./bot-media-coverage.fixture.mjs";
import {
  begin, finish, object, commitSql,
} from "./bot-media-logical-identity.fixture.mjs";
import { repairEnabled, installAuthorityRepair } from "./bot-media-authority-repair.fixture.mjs";

const baseline = process.env.BOT_MEDIA_COVERAGE_BASELINE === "1";
const failure = (outcome, code, name) => {
  assert.equal(outcome.error?.code, code, "the actual operation must refuse with the specified SQLSTATE");
  assert.ok(outcome.error.message.includes(name));
};

async function fixture(t) {
  const db = await coverageFixture(t), r = db.a.receipt;
  if (repairEnabled) await installAuthorityRepair(db);
  await begin(db, r);
  await object(db, r);
  await finish(db, r);
  t.diagnostic(`local PostgreSQL ${db.version}; ${baseline ? "accepted hooks" : "coverage prototype"}; fictional acknowledged PUT, not provider terminality`);
  return { db, r };
}

async function state(db) {
  return {
    accounting: await accounting(db),
    messages: await db.query("select * from public.messages order by id"),
    results: await db.query("select * from private.bot_message_idempotency order by bot_id,idempotency_key"),
    operations: await db.query("select * from private.bot_operation_idempotency order by bot_id,idempotency_key"),
    storage: await db.query("select * from storage.objects order by id"),
  };
}

async function waitForRow(db, waiter, blocker, relation) {
  for (let i = 0; i < 150; i++) {
    const [edge] = await db.query(`select
      (select wait_event_type='Lock' from pg_stat_activity where pid=${waiter}) as waiting,
      ${blocker}=any(pg_blocking_pids(${waiter})) as blocker,
      exists(select 1 from pg_locks l where l.pid=${waiter} and l.locktype='transactionid'
        and not l.granted and l.transactionid=(select backend_xid from pg_stat_activity where pid=${blocker})) as xid,
      exists(select 1 from pg_locks l where l.pid=${waiter} and l.relation=${quote(relation)}::regclass
        and l.granted) as relation_lock`);
    if (edge.waiting && edge.blocker && edge.xid && edge.relation_lock) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("actual row wait with expected transaction blocker was not observed: " + relation);
}

const authorities = [
  { name: "token", relation: "private.bot_tokens", predicate: r => `id='${r.token}'`,
    set: "revoked_at=clock_timestamp()", error: "bot_media_ingest_token_revoked" },
  { name: "membership", relation: "public.chat_bot_members", predicate: r => `bot_id='${r.bot}' and chat_id='${r.chat}'`,
    set: "removed_at=clock_timestamp()", error: "bot_chat_forbidden" },
];

for (const authority of authorities) {
  test(`ingest ${authority.name} revocation before actual SHARE acquisition refuses freshly and rolls back`, async t => {
    const { db, r } = await fixture(t), before = await state(db),
      blocker = await session(db, "set role postgres;"), writer = await session(db, "set role service_role;");
    await blocker.connection.send(`begin; update ${authority.relation} set ${authority.set}
      where ${authority.predicate(r)};`);
    const operation = settled(writer.connection.send("begin; " + commitSql(r) + "; commit;"));
    await waitForRow(db, writer.pid, blocker.pid, authority.relation);
    await blocker.connection.send("commit;");
    failure(await operation, "42501", authority.error);
    assert.deepEqual(await state(db), before, "no grant consumption, message/result/completion; earlier reservation and PUT outcome survive");
  });
}

test("ingest retained token/member SHARE prevents revocation committing unnoticed during an existing Storage wait", async t => {
  const { db, r } = await fixture(t), before = await state(db),
    storage = await session(db, "set role postgres;"), writer = await session(db, "set role service_role;");
  await storage.connection.send(`begin; update storage.objects set metadata=metadata
    where bucket_id='chat-media' and name=${quote(r.path)};`);
  const operation = settled(writer.connection.send("begin; " + commitSql(r) + "; commit;"));
  await waitForRow(db, writer.pid, storage.pid, "storage.objects");
  const revokers = [];
  for (const authority of authorities) {
    const revoker = await session(db, "set role postgres;");
    const mutation = settled(revoker.connection.send(`begin; update ${authority.relation}
      set ${authority.set} where ${authority.predicate(r)}; commit;`));
    assert.deepEqual(await outcomeOrWait(db, mutation, revoker.pid, writer.pid), { waiting: true },
      authority.name + " mutator must be genuinely blocked by the ingest transaction");
    await waitForRow(db, revoker.pid, writer.pid, authority.relation);
    revokers.push(mutation);
  }
  await storage.connection.send("commit;");
  const outcome = await operation;
  assert.equal(outcome.error, undefined);
  const result = JSON.parse(outcome.value);
  assert.equal(result.duplicate, false);
  assert.ok(result.result.message_id);
  for (const mutation of revokers) assert.equal((await mutation).error, undefined);
  const after = await state(db);
  assert.equal(after.messages.length, 1);
  assert.equal(after.results.length, 1);
  assert.equal(after.operations.length, 1);
  const receipt = after.accounting.rows.receipts.find(row => row.idempotency_key === r.key);
  const oldReceipt = before.accounting.rows.receipts.find(row => row.idempotency_key === r.key);
  assert.equal(receipt.state, "complete");
  assert.equal(receipt.commit_xid, null);
  assert.equal(receipt.byte_size, oldReceipt.byte_size);
  assert.equal(receipt.created_at, oldReceipt.created_at);
  assert.deepEqual(after.accounting.rows.attempts, before.accounting.rows.attempts);
  assert.deepEqual(after.accounting.bindings.attempts, before.accounting.bindings.attempts);
  assert.deepEqual(after.storage, before.storage);
});

test("ingest server wall-clock expiry after the actual Storage wait rolls back grant/identity/result work", async t => {
  const { db, r } = await fixture(t), storage = await session(db, "set role postgres;"),
    writer = await session(db, "set role service_role;");
  await trusted(db, `update private.bot_media_ingests set lease_expires_at=clock_timestamp()+interval '2 seconds'
    where bot_id='${r.bot}' and idempotency_key=${quote(r.key)};`);
  const before = await state(db);
  await storage.connection.send(`begin; update storage.objects set metadata=metadata
    where bucket_id='chat-media' and name=${quote(r.path)};`);
  const operation = settled(writer.connection.send("begin; " + commitSql(r) + "; commit;"));
  await waitForRow(db, writer.pid, storage.pid, "storage.objects");
  let expired = false;
  for (let i = 0; i < 250; i++) {
    expired = (await db.query(`select clock_timestamp() >= lease_expires_at as expired
      from private.bot_media_ingests where bot_id='${r.bot}' and idempotency_key=${quote(r.key)}`))[0].expired;
    if (expired) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(expired, true, "server time actually passed the stored lease deadline while the named wait is held");
  await storage.connection.send("commit;");
  failure(await operation, "55000", "bot_media_ingest_lease_expired");
  assert.deepEqual(await state(db), before);
});

test("fictional closer never takes the ingest row prefix; later closed admission rolls back only current commit work", async t => {
  assert.equal(baseline, false, "this C6 test requires the coverage candidate, not the deliberately unguarded closer baseline");
  const { db, r } = await fixture(t), before = await state(db),
    storage = await session(db, "set role postgres;"), writer = await session(db, "set role service_role;");
  await storage.connection.send(`begin; update storage.objects set metadata=metadata
    where bucket_id='chat-media' and name=${quote(r.path)};`);
  const operation = settled(writer.connection.send("begin; " + commitSql(r) + "; commit;"));
  await waitForRow(db, writer.pid, storage.pid, "storage.objects");
  const closer = await session(db, "set role postgres;");
  const close = settled(closer.connection.send("begin; select fixture_coverage.close_objects(array[1]); commit;"));
  assert.deepEqual(await outcomeOrWait(db, close, closer.pid, writer.pid), { waiting: false },
    "closer must not add an inverse wait on the writer's quota/operation/receipt/token/member prefix");
  assert.equal((await close).error, undefined);
  assert.deepEqual(await objectState(db), [{ id: 1, closed: true }, { id: 2, closed: false }]);
  await storage.connection.send("commit;");
  failure(await operation, "55000", "fixture_generation_closed");
  assert.deepEqual(await state(db), before, "fixture close is not eligibility: pending receipt and acknowledged PUT stay held");
});
