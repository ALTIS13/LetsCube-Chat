import assert from "node:assert/strict";
import { fullSchemaIds as q, forwardCall, sendCall } from "./bot-media-authority-full-schema.fixture.mjs";

export async function waitForEpoch(query, writer, blocker) {
  for (let i = 0; i < 40; i++) {
    const [edge] = await query(`select ${blocker}=any(pg_blocking_pids(${writer})) as blocker,
      exists(select 1 from pg_locks where pid=${writer} and relation='public.chat_bot_members'::regclass
        and mode='RowShareLock' and granted) as epoch,
      exists(select 1 from pg_locks where pid=${writer} and locktype='transactionid' and not granted
        and transactionid=(select backend_xid from pg_stat_activity where pid=${blocker})) as xid`);
    if (edge.blocker && edge.epoch && edge.xid) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail("actual accepted epoch row/transaction wait, not a timing assumption");
}

// Literal retention oracle: a different transaction may not commit a sanction
// after successful authorization while the forwarded message is uncommitted.
export async function sanctionRetentionCase({ session, query, check, kind }) {
  const writer = session("writer-" + kind), mutator = session("mutator-" + kind);
  try {
    const [{ pid: writerPid }] = await writer.query("select pg_backend_pid() as pid");
    const [{ pid: mutatorPid }] = await mutator.query("select pg_backend_pid() as pid");
    await writer.exec(`begin; set local statement_timeout='10s'; set local role authenticated;
      set request.jwt.claim.sub='${q.actor}';`);
    const [copy] = await writer.query(forwardCall());
    assert.equal(copy.to_jsonb.chat_id, q.targetChat, "known successful forward before revocation");
    const mutation = kind === "ban"
      ? `insert into public.bans(user_id,reason) values ('${q.actor}','fictional retention')`
      : `insert into public.mutes(user_id,chat_id,reason) values ('${q.actor}',${kind === "global-mute" ? "null" : "'" + q.targetChat + "'"},'fictional retention')`;
    let completed = false;
    const operation = mutator.exec(`begin; set local statement_timeout='10s';
      do $proof$ begin begin ${mutation};
        raise exception 'retention_missing'; exception when lock_not_available then null; end;
      end $proof$; rollback;`).then(() => ({ pass: true }), error => ({ pass: false, code: error.code }));
    operation.then(() => { completed = true; });
    let waiting = false;
    for (let i = 0; i < 100 && !completed; i++) {
      const [edge] = await query(`select ${writerPid}=any(pg_blocking_pids(${mutatorPid})) as waiting`);
      if (edge.waiting) { waiting = true; await writer.exec("rollback;"); break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (!completed) await writer.exec("rollback;");
    const result = await operation;
    await check(kind + " insertion after forward guard is try-only refused", async () => {
      assert.equal(waiting, false, "no inverse wait behind the retained source/target prefix");
      assert.equal(result.pass, true, "requires actual 55P03, not a committed late sanction");
    });
    const [state] = await query(`select
      (select count(*)::int from public.bans where user_id='${q.actor}') as bans,
      (select count(*)::int from public.mutes where user_id='${q.actor}') as mutes`);
    assert.deepEqual(state, { bans: 0, mutes: 0 });
  } finally {
    await writer.close(); await mutator.close();
  }
}

export async function foreignKeyCompatibilityCase({ session, query, check }) {
  const sanction = session("fk-sanction"), member = session("fk-member");
  let operation;
  try {
    const [{ pid: holder }] = await sanction.query("select pg_backend_pid() as pid");
    const [{ pid: inserting }] = await member.query("select pg_backend_pid() as pid");
    await sanction.exec(`begin; set local statement_timeout='5s';
      insert into public.bans(user_id,reason) values ('${q.outsider}','fictional FK compatibility');`);
    let completed = false;
    operation = member.exec(`begin; set local statement_timeout='5s';
      insert into public.chat_members(chat_id,user_id) values ('${q.targetChat}','${q.outsider}');`)
      .then(() => ({ code: "00000" }), error => ({ code: error.code }));
    operation.then(() => { completed = true; });
    let waiting = false;
    for (let i = 0; i < 100 && !completed; i++) {
      const [edge] = await query(`select ${holder}=any(pg_blocking_pids(${inserting})) as waiting`);
      if (edge.waiting) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (waiting || !completed) await sanction.exec("rollback;");
    const outcome = await operation;
    await check("sentinel does not introduce a foreign-key waiting edge", async () => {
      assert.equal(waiting, false, "actual FK KEY SHARE must coexist with sentinel mutation");
      assert.equal(outcome.code, "00000");
      const result = await sanction.exec(`insert into public.mutes(user_id,chat_id,reason)
        values ('${q.outsider}','${q.targetChat}','fictional FK compatibility');`)
        .then(() => ({ code: "00000" }), error => ({ code: error.code }));
      assert.equal(result.code, "00000", "reverse chat FK also coexists with member sentinel");
    });
  } finally {
    await sanction.close(); if (operation) await operation; await member.close();
  }
}

export async function unsupportedIsolationCase({ session, check, isolation, route }) {
  const writer = session("isolation-" + isolation.replaceAll(" ", "-"));
  try {
    const sql = route === "bot" ? sendCall("authority-isolation-" + isolation.replaceAll(" ", "-"))
      : route === "forward" ? forwardCall() : `insert into public.messages(chat_id,user_id,type,media_bucket,media_path,forwarded_from_id)
        values ('${q.targetChat}','${q.actor}','file','chat-media','${q.actor}/fictional-authority.pdf','${q.source}')`;
    const result = await writer.exec(`begin isolation level ${isolation}; set local statement_timeout='10s';
      set local role ${route === "bot" ? "service_role" : "authenticated"};
      set request.jwt.claim.sub='${route === "bot" ? "" : q.actor}';
      select count(*) from public.messages;
      ${sql}; commit;`).then(() => ({ pass: true }), error => ({ code: error.code }));
    await check(route + " exact " + isolation + " refuses unsupported snapshot", async () => {
      assert.equal(result.code, "0A000");
    });
  } finally { await writer.close(); }
}

export async function retainedTargetCase({ session, query, check, kind }) {
  const writer = session("target-writer-" + kind), mutator = session("target-mutator-" + kind);
  const privateChat = "e5070000-0000-4000-8000-000000000032";
  try {
    await writer.exec(`begin; set local statement_timeout='10s'; set local role authenticated;
      set request.jwt.claim.sub='${q.actor}';`);
    const [copy] = await writer.query(kind === "private-block"
      ? `select to_jsonb(public.forward_message('${q.source}','${privateChat}',null,null,null))` : forwardCall());
    assert.equal(copy.to_jsonb.forwarded_from_id, q.source);
    const statement = kind === "private-block"
      ? `set local role authenticated; set request.jwt.claim.sub='${q.outsider}';
         insert into public.user_blocks(blocker_id,blocked_id) values ('${q.outsider}','${q.actor}')`
      : kind === "membership"
        ? `insert into public.chat_members(chat_id,user_id) values ('${q.targetChat}','${q.outsider}')`
        : `insert into public.bans(user_id,reason) values ('${q.outsider}','fictional unrelated')`;
    const result = await mutator.exec(`begin; set local statement_timeout='2s'; ${statement}; rollback;`)
      .then(() => ({ code: "00000" }), error => ({ code: error.code }));
    await check(kind + " retained target mutation", async () => {
      assert.equal(result.code, kind === "unrelated-actor" ? "00000" : "55P03");
      assert.equal((await query(`select count(*)::int as n from public.user_blocks
        where blocker_id='${q.outsider}' and blocked_id='${q.actor}'`))[0].n, 0);
    });
  } finally { await writer.close(); await mutator.close(); }
}

export async function waitedBotCase({ session, query, check, kind }) {
  const epoch = session("epoch-" + kind), writer = session("send-" + kind), mutator = session("source-" + kind);
  let operation;
  try {
    const [{ pid: blocker }] = await epoch.query("select pg_backend_pid() as pid");
    const [{ pid: sending }] = await writer.query("select pg_backend_pid() as pid");
    await epoch.exec("begin; set local statement_timeout='15s';");
    if (kind === "real-privacy-prefix") {
      await epoch.exec(`set local role authenticated; set request.jwt.claim.sub='${q.actor}';
        select public.chat_bot_set_privacy('${q.sourceChat}','${q.bot}',false);`);
    } else {
      await epoch.exec(`update public.chat_bot_members set privacy_mode=privacy_mode
        where bot_id='${q.bot}' and chat_id='${q.sourceChat}';`);
    }
    const payload = kind === "archived-topic" ? { file_id: q.source, topic_id: q.topic } : { file_id: q.source };
    operation = writer.exec(`begin; set local statement_timeout='15s'; set local role service_role;
      ${sendCall("authority-wait-" + kind, payload)}; commit;`)
      .then(value => ({ value }), error => ({ error }));
    await waitForEpoch(query, sending, blocker);
    if (kind === "source-reply") await mutator.exec(`begin; update public.messages set reply_to_id=null
      where id='${q.source}'; commit;`);
    if (kind === "archived-topic") await mutator.exec(`begin; update public.topics set archived=true
      where id='${q.topic}'; commit;`);
    await epoch.exec("commit;");
    const outcome = await operation;
    await check(kind + " revoked during actual epoch wait is refused", async () => {
      assert.equal(outcome.error?.code, kind === "archived-topic" ? "42501" : "P0002");
      assert.equal((await query(`select count(*)::int as n from private.bot_message_idempotency
        where bot_id='${q.bot}' and idempotency_key='authority-wait-${kind}'`))[0].n, 0);
    });
  } finally {
    await epoch.close(); await mutator.close(); if (operation) await operation; await writer.close();
  }
}
