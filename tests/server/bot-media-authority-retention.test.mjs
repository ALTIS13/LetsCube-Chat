import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageFixture, installForward, session, trusted, messageInsert, quote, uuid,
  asActor, actor, outsider, accounting,
} from "./bot-media-coverage.fixture.mjs";

const repaired = process.env.BOT_MEDIA_AUTHORITY_REPAIR === "1";
const source = uuid(8600), destination = uuid(11);
const deniedBusy = error => error.code === "55P03";

async function fixture(t, forward = false) {
  const db = await coverageFixture(t);
  if (forward) {
    await installForward(db);
    await trusted(db, `insert into public.chat_members(chat_id,user_id) values
      ('${destination}','${actor}'),('${uuid(3)}','${outsider}');`);
  }
  await trusted(db, messageInsert(source, { path: db.a.receipt.path }) + ";");
  if (repaired) {
    const { installAuthorityRepair } = await import("./bot-media-authority-repair.fixture.mjs");
    await installAuthorityRepair(db, { forward });
  }
  t.diagnostic(`local PostgreSQL ${db.version}; ${repaired ? "authority candidate" : "accepted bodies"}; fictional retention cases`);
  return db;
}

const send = db => `select public.bot_message_command_internal('${db.a.receipt.bot}',
  '${db.a.receipt.chat}','sendDocument',${quote(JSON.stringify({ file_id: source }))}::jsonb,
  'retained-file-id-command',${quote("d".repeat(64))})::text;`;
const forward = `select (public.forward_message('${source}','${destination}','${uuid(8601)}',null,null)).id;`;

async function refusedMutation(db, sql) {
  await assert.rejects(trusted(db, "set lock_timeout='150ms'; " + sql), deniedBusy,
    "current authority must remain protected until the writer transaction ends");
}

for (const [name, mutation] of [
  ["source content", () => `update public.messages set content='changed' where id='${source}';`],
  ["receiver state", db => `update public.bots set state='disabled' where id='${db.a.receipt.bot}';`],
  ["chat type", db => `update public.chats set type='private' where id='${db.a.receipt.chat}';`],
]) {
  test(`file-id retains ${name} authority through transaction completion`, async t => {
    const db = await fixture(t), writer = await session(db, "set role service_role;");
    const before = await accounting(db);
    const response = JSON.parse(await writer.connection.send("begin; " + send(db)));
    assert.equal(response.duplicate, false);
    await refusedMutation(db, mutation(db));
    assert.deepEqual(await accounting(db), before);
    await writer.connection.send("commit;");
    const duplicate = JSON.parse(await db.exec("set role service_role; " + send(db)));
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.result.message_id, response.result.message_id);
    assert.deepEqual(await accounting(db), before);
  });
}

for (const [name, mutation] of [
  ["source membership", `delete from public.chat_members where chat_id='${uuid(3)}' and user_id='${actor}';`],
  ["destination membership", `delete from public.chat_members where chat_id='${destination}' and user_id='${actor}';`],
  ["new hidden entry", `insert into public.message_hidden_for_users(message_id,user_id) values ('${source}','${actor}');`],
]) {
  test(`forward retains ${name} authority through transaction completion`, async t => {
    const db = await fixture(t, true), writer = await session(db, asActor), before = await accounting(db);
    const id = await writer.connection.send("begin; " + forward);
    assert.match(id, /^[0-9a-f-]{36}$/);
    await refusedMutation(db, mutation);
    assert.deepEqual(await accounting(db), before);
    await writer.connection.send("commit;");
    assert.equal(await writer.connection.send(forward), id);
    assert.deepEqual(await db.query(`select id from public.messages where chat_id='${destination}'`), [{ id }]);
    assert.deepEqual(await accounting(db), before);
  });
}

test("forward does not prevent another member hiding the same source", async t => {
  const db = await fixture(t, true), writer = await session(db, asActor);
  const id = await writer.connection.send("begin; " + forward);
  await trusted(db, `set lock_timeout='150ms'; insert into public.message_hidden_for_users(message_id,user_id)
    values ('${source}','${outsider}');`);
  assert.deepEqual(await db.query(`select user_id from public.message_hidden_for_users where message_id='${source}'`),
    [{ user_id: outsider }]);
  await writer.connection.send("commit;");
  assert.equal(await writer.connection.send(forward), id);
});
