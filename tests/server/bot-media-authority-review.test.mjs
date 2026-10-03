import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageFixture, installForward, session, trusted, messageInsert, quote, uuid,
  asActor, actor, accounting, settled, outcomeOrWait, mutateInstalled,
} from "./bot-media-coverage.fixture.mjs";
import { installAuthorityRepair } from "./bot-media-authority-repair.fixture.mjs";

const source = uuid(8800), reply = uuid(8801), destination = uuid(11);
const key = "authority-cache-command", signature = "public.forward_message(uuid,uuid,uuid,timestamptz,uuid)";

async function fixture(t, forward = false) {
  const db = await coverageFixture(t);
  if (forward) {
    await installForward(db);
    await trusted(db, `insert into public.chat_members(chat_id,user_id) values ('${destination}','${actor}');`);
  }
  await trusted(db, messageInsert(source, { path: db.a.receipt.path }) + ";");
  await installAuthorityRepair(db, { forward });
  return db;
}

const command = (db, extra = {}) => `select public.bot_message_command_internal('${db.a.receipt.bot}',
  '${db.a.receipt.chat}','sendDocument',${quote(JSON.stringify({ file_id: source, ...extra }))}::jsonb,
  '${key}',${quote("f".repeat(64))})::text;`;
const forward = `select (public.forward_message('${source}','${destination}','${uuid(8802)}',null,null)).id;`;

for (const entrypoint of ["direct", "gateway"]) {
test(`${entrypoint} cached send refuses a changed target instead of returning a revoked chat's result`, async t => {
  const db = await fixture(t, true);
  const signature = entrypoint === "gateway" ? "bot_message_command_internal" : "bot_send_message_internal";
  const fingerprint = entrypoint === "gateway" ? "," + quote("f".repeat(64)) : "";
  const call = chat => `select public.${signature}('${db.a.receipt.bot}',
    '${chat}','sendDocument',${quote(JSON.stringify({ file_id: source }))}::jsonb,'${key}'${fingerprint})::text;`;
  const response = JSON.parse(await db.exec("set role service_role; " + call(db.a.receipt.chat)));
  const first = response.result ?? response;
  const before = await accounting(db);
  await trusted(db, `update public.chat_bot_members set removed_at=clock_timestamp()
    where bot_id='${db.a.receipt.bot}' and chat_id='${db.a.receipt.chat}';`);
  assert.equal((await db.query(`select (public.bot_membership_authorize_internal('${db.a.receipt.bot}',
    '${destination}','send_message')->>'allowed')::boolean as allowed`))[0].allowed, true);
  await assert.rejects(db.exec("set role service_role; " + call(destination)),
    error => error.code === "23505" && error.message.includes("bot_idempotency_conflict"));
  assert.deepEqual(await db.query(`select id,chat_id from public.messages where id<>'${source}'`),
    [{ id: first.message_id, chat_id: db.a.receipt.chat }]);
  assert.deepEqual(await accounting(db), before);
});
}

test("authority helpers retain private definer ACLs and refuse unsupported snapshots", async t => {
  const db = await fixture(t, true);
  const rows = await db.query(`select p.proname,pg_get_userbyid(p.proowner) as owner,
    p.prosecdef,p.provolatile,p.proconfig,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_role
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='fixture_authority' order by p.proname`);
  assert.deepEqual(rows.map(row => row.proname), ["bot_target_current", "file_id_current", "file_payload_current", "forward_current", "hidden_entry_guard"]);
  for (const { proname, ...row } of rows) assert.deepEqual(row, {
    owner: "postgres", prosecdef: true, provolatile: "v", proconfig: ['search_path=""'],
    anon: false, authenticated: false, service_role: false,
  }, proname);
  for (const isolation of ["repeatable read", "serializable", "read uncommitted"]) {
    await assert.rejects(db.exec(`set role postgres; begin isolation level ${isolation};
      select fixture_authority.file_id_current('${db.a.receipt.bot}','${db.a.receipt.chat}','${source}'); commit;`),
      error => error.code === "0A000");
    await assert.rejects(db.exec(`set role postgres; begin isolation level ${isolation};
      select fixture_authority.forward_current('${actor}','${source}','${destination}',null); commit;`),
      error => error.code === "0A000");
  }
  assert.deepEqual(await db.query(`select id from public.messages where id<>'${source}'`), []);
});

test("successful cached forward retains source membership until its transaction ends", async t => {
  const db = await fixture(t, true), id = await db.exec(asActor + forward);
  const writer = await session(db, asActor);
  try {
    assert.equal(await writer.connection.send("begin; " + forward), id);
    await assert.rejects(db.exec(`set role postgres; set lock_timeout='150ms';
      delete from public.chat_members where chat_id='${uuid(3)}' and user_id='${actor}';`),
      error => error.code === "55P03");
    await writer.connection.send("commit;");
    await trusted(db, `delete from public.chat_members where chat_id='${uuid(3)}' and user_id='${actor}';`);
    await assert.rejects(db.exec(asActor + forward), error => error.code === "P0002");
    assert.deepEqual(await db.query(`select id from public.messages where chat_id='${destination}'`), [{ id }]);
  } finally {
    await writer.connection.close();
  }
});

async function wait(db, waiter, blocker, advisory = false) {
  for (let i = 0; i < 150; i++) {
    const [edge] = await db.query(`select ${blocker}=any(pg_blocking_pids(${waiter})) as blocker,
      exists(select 1 from pg_locks where pid=${waiter} and not granted
        and locktype='${advisory ? "advisory" : "transactionid"}') as lock`);
    if (edge.blocker && edge.lock) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("the named real blocking edge must be reached");
}

async function afterEpoch(db, call, mutation, target, human = false) {
  const blocker = await session(db, "set role postgres;"), writer = await session(db, human ? asActor : "set role service_role;");
  let operation;
  try {
    await blocker.connection.send(`begin; update public.chat_bot_members set privacy_mode=privacy_mode
      where bot_id='${db.a.receipt.bot}' and chat_id='${target}';`);
    operation = settled(writer.connection.send("begin; " + call + " commit;"));
    await wait(db, writer.pid, blocker.pid);
    await blocker.connection.send(mutation);
    await blocker.connection.send("commit;");
    return await operation;
  } finally {
    await blocker.connection.close();
    if (operation) await operation;
    await writer.connection.close();
  }
}

for (const entrypoint of ["gateway", "direct send"]) {
test(`${entrypoint} cached result rechecks target access after its real advisory wait`, async t => {
  const db = await fixture(t);
  const call = entrypoint === "gateway" ? command(db) : `select public.bot_send_message_internal('${db.a.receipt.bot}',
    '${db.a.receipt.chat}','sendDocument',${quote(JSON.stringify({ file_id: source }))}::jsonb,'${key}')::text;`;
  await db.exec("set role service_role; " + call);
  const before = await accounting(db), blocker = await session(db, "set role postgres;"), writer = await session(db, "set role service_role;");
  let operation;
  try {
    await blocker.connection.send(`begin; select pg_advisory_xact_lock(hashtextextended('${db.a.receipt.bot}:${key}',0));`);
    operation = settled(writer.connection.send("begin; " + call + " commit;"));
    await wait(db, writer.pid, blocker.pid, true);
    await trusted(db, `update public.chat_bot_members set removed_at=clock_timestamp()
      where bot_id='${db.a.receipt.bot}' and chat_id='${db.a.receipt.chat}';`);
    await blocker.connection.send("commit;");
    assert.equal((await operation).error?.code, "42501", "cached success must not cross target removal");
    assert.equal((await db.query("select count(*)::int as n from public.messages"))[0].n, 2);
    assert.deepEqual(await accounting(db), before);
  } finally {
    await blocker.connection.close();
    if (operation) await operation;
    await writer.connection.close();
  }
});
}

test("valid cached file-id result does not require re-admitting its old source", async t => {
  const db = await fixture(t), first = JSON.parse(await db.exec("set role service_role; " + command(db)));
  await trusted(db, `update public.messages set deleted_at=clock_timestamp() where id='${source}';`);
  const duplicate = JSON.parse(await db.exec("set role service_role; " + command(db)));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.result.message_id, first.result.message_id);
});

for (const [kind, mutation, code] of [
  ["file kind", `update public.messages set type='image' where id='${source}';`, "22023"],
  ["forward system type", `update public.messages set type='system' where id='${source}';`, "22023"],
]) {
  test(`fresh ${kind} is checked after the actual epoch wait`, async t => {
    const human = kind.startsWith("forward"), db = await fixture(t, human);
    const outcome = await afterEpoch(db, human ? forward : command(db), mutation, human ? destination : db.a.receipt.chat, human);
    assert.equal(outcome.error?.code, code, "literal current kind/type refusal");
    assert.deepEqual(await db.query(`select id from public.messages where id<>'${source}'`), []);
  });
}

test("payload reply visibility is checked independently of a still-readable file-id", async t => {
  const db = await fixture(t);
  await trusted(db, `update public.messages set user_id=null,bot_id='${db.a.receipt.bot}' where id='${source}';
    ${messageInsert(reply)};`);
  const outcome = await afterEpoch(db, command(db, { reply_to_id: reply }),
    `update public.chat_bot_members set privacy_mode='restricted' where bot_id='${db.a.receipt.bot}' and chat_id='${db.a.receipt.chat}';`, db.a.receipt.chat);
  assert.equal(outcome.error?.code, "42501", "the payload reply, not the source's own reply, must be rechecked");
  assert.match(outcome.error.message, /bot_reply_forbidden/);
  assert.deepEqual(await db.query(`select id from public.messages where id not in ('${source}','${reply}')`), []);
});

test("missing bot membership cannot be rejoined between acquisition and revalidation", async t => {
  const db = await fixture(t), helper = "fixture_authority.bot_target_current(uuid,uuid)";
  await trusted(db, `delete from public.chat_bot_members where bot_id='${db.a.receipt.bot}' and chat_id='${db.a.receipt.chat}';`);
  await mutateInstalled(db, helper, body => {
    const marker = "  if coalesce((public.bot_membership_authorize_internal";
    assert.equal(body.split(marker).length, 2);
    return body.replace(marker, "  perform pg_catalog.pg_advisory_xact_lock(270312,96);\n" + marker);
  });
  const blocker = await session(db, "set role postgres;"), writer = await session(db, "set role postgres;");
  let operation;
  try {
    await blocker.connection.send("begin; select pg_advisory_xact_lock(270312,96);");
    operation = settled(writer.connection.send(`begin; select fixture_authority.file_id_current('${db.a.receipt.bot}','${db.a.receipt.chat}','${source}'); commit;`));
    const progress = await outcomeOrWait(db, operation, writer.pid, blocker.pid);
    if (progress.waiting) {
      await trusted(db, `insert into public.chat_bot_members(bot_id,chat_id,privacy_mode,full_visibility_approved_by)
        values ('${db.a.receipt.bot}','${db.a.receipt.chat}','full','${actor}');`);
    }
    await blocker.connection.send("commit;");
    assert.equal((await operation).error?.code, "42501", "no freshly inserted, unretained membership may authorize the request");
  } finally {
    await blocker.connection.close();
    if (operation) await operation;
    await writer.connection.close();
  }
});

test("missing forward membership cannot be rejoined between acquisition and revalidation", async t => {
  const db = await fixture(t, true), helper = "fixture_authority.forward_current(uuid,uuid,uuid,uuid)";
  await trusted(db, `delete from public.chat_members where chat_id='${uuid(3)}' and user_id='${actor}';`);
  await mutateInstalled(db, helper, body => {
    const marker = "  if public.is_banned(p_user) then";
    assert.equal(body.split(marker).length, 2);
    return body.replace(marker, "  perform pg_catalog.pg_advisory_xact_lock(270312,96);\n" + marker);
  });
  const blocker = await session(db, "set role postgres;"), writer = await session(db, "set role postgres;");
  let operation;
  try {
    await blocker.connection.send("begin; select pg_advisory_xact_lock(270312,96);");
    operation = settled(writer.connection.send(`begin; select fixture_authority.forward_current('${actor}','${source}','${destination}',null); commit;`));
    const progress = await outcomeOrWait(db, operation, writer.pid, blocker.pid);
    if (progress.waiting) await trusted(db, `insert into public.chat_members(chat_id,user_id) values ('${uuid(3)}','${actor}');`);
    await blocker.connection.send("commit;");
    assert.equal((await operation).error?.code, "P0002", "new unretained source membership must not authorize a forward");
  } finally {
    await blocker.connection.close();
    if (operation) await operation;
    await writer.connection.close();
  }
});

test("hiding with no membership refuses without creating a dangling hidden entry", async t => {
  const db = await fixture(t, true);
  await trusted(db, `delete from public.chat_members where chat_id='${uuid(3)}' and user_id='${actor}';`);
  await assert.rejects(trusted(db, `insert into public.message_hidden_for_users(message_id,user_id)
    values ('${source}','${actor}');`), error => error.code === "42501");
  assert.deepEqual(await db.query("select * from public.message_hidden_for_users"), []);
});

for (const operationKind of ["insert", "update actor"]) {
test(`hiding ${operationKind} guard refuses immediately rather than relying on lock_timeout`, async t => {
  const db = await fixture(t, true), writer = await session(db, asActor), mutator = await session(db, "set role postgres; set lock_timeout='0';");
  const outsider = uuid(8803);
  if (operationKind === "update actor") await trusted(db, `insert into public.chat_members(chat_id,user_id)
    values ('${uuid(3)}','${outsider}'); insert into public.message_hidden_for_users(message_id,user_id)
    values ('${source}','${outsider}');`);
  const mutation = operationKind === "insert"
    ? `insert into public.message_hidden_for_users(message_id,user_id) values ('${source}','${actor}');`
    : `update public.message_hidden_for_users set user_id='${actor}' where message_id='${source}' and user_id='${outsider}';`;
  let operation;
  try {
    await writer.connection.send("begin; " + forward);
    operation = settled(mutator.connection.send(`begin; ${mutation} commit;`));
    const progress = await outcomeOrWait(db, operation, mutator.pid, writer.pid);
    assert.equal(progress.waiting, false, "guard must not create a real waiting edge to the retained reader");
    assert.equal((await operation).error?.code, "55P03");
    assert.deepEqual(await db.query(`select user_id from public.message_hidden_for_users where user_id='${actor}'`), []);
  } finally {
    await writer.connection.close();
    if (operation) await operation;
    await mutator.connection.close();
  }
});
}

test("forward unique-conflict retry rechecks access before returning another transaction's copy", async t => {
  const db = await fixture(t, true);
  await mutateInstalled(db, signature, body => {
    const marker = "      if not found then\n        raise;\n      end if;\n";
    assert.equal(body.split(marker).length, 2);
    return body.replace(marker, marker + "      perform pg_catalog.pg_advisory_xact_lock(270312,95);\n");
  });
  const holder = await session(db, asActor), waiter = await session(db, asActor), blocker = await session(db, "set role postgres;");
  let operation;
  try {
    const id = await holder.connection.send("begin; " + forward);
    await blocker.connection.send("begin; select pg_advisory_xact_lock(270312,95);");
    operation = settled(waiter.connection.send("begin; " + forward + " commit;"));
    await wait(db, waiter.pid, holder.pid);
    await holder.connection.send("commit;");
    await wait(db, waiter.pid, blocker.pid, true);
    await trusted(db, `insert into public.message_hidden_for_users(message_id,user_id) values ('${source}','${actor}');`);
    await blocker.connection.send("commit;");
    assert.equal((await operation).error?.code, "P0002", "unique-conflict return must not bypass current visibility");
    assert.deepEqual(await db.query(`select id from public.messages where chat_id='${destination}'`), [{ id }]);
  } finally {
    await holder.connection.close();
    await blocker.connection.close();
    if (operation) await operation;
    await waiter.connection.close();
  }
});
