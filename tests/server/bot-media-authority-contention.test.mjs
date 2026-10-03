import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageFixture, installForward, session, trusted, messageInsert, quote, uuid,
  asActor, actor, accounting, settled, outcomeOrWait,
} from "./bot-media-coverage.fixture.mjs";
import { repairEnabled, installAuthorityRepair } from "./bot-media-authority-repair.fixture.mjs";

const source = uuid(8700), destination = uuid(11);

async function epochWait(db, waiter, blocker) {
  for (let i = 0; i < 150; i++) {
    const [state] = await db.query(`select ${blocker}=any(pg_blocking_pids(${waiter})) as blocker,
      exists(select 1 from pg_locks where pid=${waiter} and relation='public.chat_bot_members'::regclass
        and mode='RowShareLock' and granted) as epoch,
      exists(select 1 from pg_locks where pid=${waiter} and locktype='transactionid' and not granted
        and transactionid=(select backend_xid from pg_stat_activity where pid=${blocker})) as xid`);
    if (state.blocker && state.epoch && state.xid) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("actual existing epoch row/transaction wait must be reached first");
}

for (const kind of ["file-id command", "forward RPC"]) {
  test(`${kind} refuses busy source without an inverse late wait or committed output`, async t => {
    const db = await coverageFixture(t), isForward = kind === "forward RPC";
    if (isForward) {
      await installForward(db);
      await trusted(db, `insert into public.chat_members(chat_id,user_id) values ('${destination}','${actor}');`);
    }
    await trusted(db, messageInsert(source, { path: db.a.receipt.path }) + ";");
    if (repairEnabled) await installAuthorityRepair(db, { forward: isForward });
    const before = await accounting(db), epoch = await session(db, "set role postgres;"),
      sourceWriter = await session(db, "set role postgres;"),
      writer = await session(db, isForward ? asActor : "set role service_role;");
    const target = isForward ? destination : db.a.receipt.chat;
    const call = isForward ? `select (public.forward_message('${source}','${destination}','${uuid(8701)}',null,null)).id;`
      : `select public.bot_message_command_internal('${db.a.receipt.bot}','${target}','sendDocument',
        ${quote(JSON.stringify({ file_id: source }))}::jsonb,'busy-source-command',${quote("e".repeat(64))})::text;`;
    let operation;
    try {
      await epoch.connection.send(`begin; update public.chat_bot_members set privacy_mode=privacy_mode
        where bot_id='${db.a.receipt.bot}' and chat_id='${target}';`);
      await sourceWriter.connection.send(`begin; update public.messages set content='uncommitted source edit' where id='${source}';`);
      operation = settled(writer.connection.send("begin; " + call + " commit;"));
      await epochWait(db, writer.pid, epoch.pid);
      await epoch.connection.send("commit;");
      const progress = await outcomeOrWait(db, operation, writer.pid, sourceWriter.pid);
      assert.equal(progress.waiting, false, "late source acquisition must be try-only, never wait while retaining the epoch prefix");
      const outcome = await operation;
      assert.equal(outcome.error?.code, "55P03", "literal atomic busy refusal, not a successful stale copy");
      assert.deepEqual(await db.query(`select id from public.messages where id<>'${source}'`), []);
      assert.deepEqual(await db.query("select bot_id from private.bot_message_idempotency"), []);
      assert.deepEqual(await db.query("select bot_id from private.bot_operation_idempotency"), []);
      assert.deepEqual(await accounting(db), before);
      await sourceWriter.connection.send("rollback;");
      const retry = await db.exec((isForward ? asActor : "set role service_role;") + call);
      assert.ok(retry, "same identity succeeds after contention ends, without earlier current effects");
      assert.equal((await db.query("select count(*)::int as n from public.messages"))[0].n, 2);
      assert.deepEqual(await accounting(db), before);
    } finally {
      await sourceWriter.connection.close();
      await epoch.connection.close();
      if (operation) await operation;
      await writer.connection.close();
    }
  });
}
