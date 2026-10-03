import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageFixture, trusted, messageInsert, quote, uuid, session, settled,
  accounting, observations,
} from "./bot-media-coverage.fixture.mjs";

const requireFresh = process.env.BOT_MEDIA_AUTH_REQUIRE_FRESH === "1";
const baseline = process.env.BOT_MEDIA_COVERAGE_BASELINE === "1";
const sendSignature = "public.bot_send_message_internal(uuid,uuid,text,jsonb,text)";
const sendHash = "7786e30e6ad6e9184fc88cf46dba8868d3bafbc7821dc088103c2c2ca3b022c8";
const hasError = (code, name) => error => error.code === code && error.message.includes(name);

async function fixture(t) {
  const db = await coverageFixture(t);
  const [body] = await db.query(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') as hash,
    prosecdef,provolatile,pg_get_userbyid(proowner) as owner,proconfig from pg_proc
    where oid=${quote(sendSignature)}::regprocedure`);
  assert.deepEqual(body, { hash: sendHash, prosecdef: true, provolatile: "v",
    owner: "postgres", proconfig: ['search_path=""'] });
  t.diagnostic(`local PostgreSQL ${db.version}; ${baseline ? "accepted message hooks" : "coverage prototype"}; fictional rows, not full-schema/live acceptance`);
  return db;
}

function call(db, source, key, entrypoint = "send") {
  const name = entrypoint === "command" ? "bot_message_command_internal" : "bot_send_message_internal";
  const fingerprint = entrypoint === "command" ? "," + quote("c".repeat(64)) : "";
  return `select public.${name}('${db.a.receipt.bot}',
    '${db.a.receipt.chat}','sendDocument',${quote(JSON.stringify({ file_id: source }))}::jsonb,
    ${quote(key)}${fingerprint})::text;`;
}

const sentMessage = value => value.result ?? value;

const visibility = async (db, source) => (await db.query(`select
  private.bot_can_receive_message('${db.a.receipt.bot}','${source}') as readable,
  (public.bot_membership_authorize_internal('${db.a.receipt.bot}','${db.a.receipt.chat}',
    'send_message')->>'allowed')::boolean as allowed`))[0];

async function state(db) {
  return {
    messages: await db.query("select * from public.messages order by id"),
    results: await db.query("select * from private.bot_message_idempotency order by bot_id,idempotency_key"),
    operations: await db.query("select * from private.bot_operation_idempotency order by bot_id,idempotency_key"),
    grants: await db.query("select * from private.bot_upload_grants order by id"),
    accounting: await accounting(db),
    storage: await db.query("select * from storage.objects order by id"),
  };
}

async function waitForMembership(db, waiter, blocker) {
  for (let i = 0; i < 150; i++) {
    const [edge] = await db.query(`select
      (select wait_event_type='Lock' from pg_stat_activity where pid=${waiter}) as waiting,
      ${blocker}=any(pg_blocking_pids(${waiter})) as blocker,
      exists(select 1 from pg_locks l where l.pid=${waiter}
        and l.locktype='transactionid' and not l.granted and l.transactionid=(
          select backend_xid from pg_stat_activity where pid=${blocker})) as transaction_wait,
      exists(select 1 from pg_locks l where l.pid=${waiter}
        and l.relation='public.chat_bot_members'::regclass
        and l.mode='RowShareLock' and l.granted) as membership_share`);
    if (edge.waiting && edge.blocker && edge.transaction_wait && edge.membership_share) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("actual epoch membership SHARE/transaction wait was not observed");
}

const changes = [
  { name: "full to restricted", set: "privacy_mode='restricted'", code: "P0002", error: "bot_file_not_found", allowed: true },
  { name: "removed member", set: "removed_at=clock_timestamp()", code: "42501", error: "bot_chat_forbidden", allowed: false },
  { name: "new join epoch", set: "joined_at=clock_timestamp()", code: "P0002", error: "bot_file_not_found", allowed: true },
];

for (const entrypoint of ["send", "command"]) {
for (const [index, change] of changes.entries()) {
  test(`${entrypoint} file_id existing epoch wait: ${change.name} is an explicit retained authority gap`, async t => {
    const db = await fixture(t), source = uuid(8500 + index), key = `file-id-${entrypoint}-epoch-wait-${index}`;
    await trusted(db, messageInsert(source, { path: db.a.receipt.path }) + ";");
    assert.deepEqual(await visibility(db, source), { readable: true, allowed: true });
    const before = await state(db), blocker = await session(db, "set role postgres;"),
      writer = await session(db, "set role service_role;");
    await blocker.connection.send(`begin; update public.chat_bot_members set ${change.set}
      where bot_id='${db.a.receipt.bot}' and chat_id='${db.a.receipt.chat}';`);
    // MVCC controls show the source is readable before the updater commits.
    assert.deepEqual(await visibility(db, source), { readable: true, allowed: true });
    const operation = settled(writer.connection.send("begin; " + call(db, source, key, entrypoint) + " commit;"));
    await waitForMembership(db, writer.pid, blocker.pid);
    assert.equal((await db.query("select count(*)::int as n from private.bot_message_idempotency"))[0].n, 0);
    await blocker.connection.send("commit;");
    const outcome = await operation;
    assert.deepEqual(await visibility(db, source), { readable: false, allowed: change.allowed });
    const after = await state(db);
    if (entrypoint === "send" || outcome.error) assert.deepEqual(after.operations, before.operations);
    assert.deepEqual(after.grants, before.grants);
    assert.deepEqual(after.accounting, before.accounting, "earlier reservations and charge/bindings remain unchanged");
    assert.deepEqual(after.storage, before.storage);
    if (requireFresh) {
      assert.equal(outcome.error?.code, change.code, "strict acceptance must reject authority revoked during the actual wait");
      assert.ok(outcome.error.message.includes(change.error));
      assert.deepEqual(after.messages, before.messages);
      assert.deepEqual(after.results, before.results);
      return;
    }
    assert.equal(outcome.error, undefined, "characterize the current committed gap, do not silently assume it is fixed");
    const response = JSON.parse(outcome.value), result = sentMessage(response);
    assert.equal(response.duplicate, false);
    const copied = after.messages.find(row => row.id === result.message_id);
    assert.ok(copied, "unsafe copy actually committed, not just a stale return value");
    assert.equal(copied.bot_id, db.a.receipt.bot);
    assert.equal(copied.media_path, db.a.receipt.path);
    assert.equal(after.messages.length, before.messages.length + 1);
    assert.deepEqual(after.results.map(row => ({ bot: row.bot_id, key: row.idempotency_key,
      method: row.method, id: row.message_id })), [{ bot: db.a.receipt.bot, key,
      method: "sendDocument", id: result.message_id }]);
    if (entrypoint === "command") assert.deepEqual(after.operations.map(row => ({ key: row.idempotency_key,
      method: row.method, fingerprint: row.request_fingerprint, id: row.result.message_id })),
      [{ key, method: "sendDocument", fingerprint: "c".repeat(64), id: result.message_id }],
      "the actual gateway command committed its operation result too");
    assert.deepEqual(await observations(db, result.message_id), [{ source_kind: "canonical",
      bucket_id: "chat-media", object_path: db.a.receipt.path, generation_id: db.a.identity.generation_id,
      reference_state: "registered", hold_reason: null }]);
    // A fresh request sees the denial. The missing part is revalidation after
    // the existing wait, not a generally broken privacy or membership check.
    await assert.rejects(db.exec("set role service_role; " + call(db, source, key + "-fresh", entrypoint)),
      hasError(change.code, change.error));
    assert.deepEqual(await state(db), after);
    t.diagnostic("retained authority gap reproduced; strict BOT_MEDIA_AUTH_REQUIRE_FRESH=1 must remain RED until separately repaired");
  });
}

test(`${entrypoint} file_id no-wait readable source succeeds, revoked controls deny without new side effects`, async t => {
  const db = await fixture(t), source = uuid(8510);
  await trusted(db, messageInsert(source, { path: db.a.receipt.path }) + ";");
  const before = await state(db);
  const response = JSON.parse(await db.exec("set role service_role; " + call(db, source, "file-id-no-wait-open", entrypoint)));
  assert.equal(response.duplicate, false);
  assert.equal((await state(db)).messages.length, before.messages.length + 1);
  for (const change of changes) {
    await trusted(db, `update public.chat_bot_members set removed_at=null,privacy_mode='full',
      joined_at=clock_timestamp()-interval '1 hour'
      where bot_id='${db.a.receipt.bot}' and chat_id='${db.a.receipt.chat}';
      update public.chat_bot_members set ${change.set}
      where bot_id='${db.a.receipt.bot}' and chat_id='${db.a.receipt.chat}';`);
    const revoked = await state(db);
    await assert.rejects(db.exec("set role service_role; " + call(db, source, "file-id-control-" + change.code, entrypoint)),
      hasError(change.code, change.error));
    assert.deepEqual(await state(db), revoked);
  }
});
}
