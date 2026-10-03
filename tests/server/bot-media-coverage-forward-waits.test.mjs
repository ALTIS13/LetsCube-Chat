import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  coverageFixture, session, settled, accounting, installForward, trusted,
  authenticated, asActor, actor, uuid, quote, messageInsert, mediaUrl, observations,
} from "./bot-media-coverage.fixture.mjs";

const sourceChat = uuid(3), destination = uuid(11), sourceId = uuid(8100);
const forwardSignature = "public.forward_message(uuid,uuid,uuid,timestamptz,uuid)";
const strict = process.env.BOT_MEDIA_AUTH_REQUIRE_FRESH === "1";
const mode = process.env.BOT_MEDIA_COVERAGE_BASELINE === "1" ? "baseline" : "prototype";
const root = new URL("../../", import.meta.url);
const captured = [
  [forwardSignature, "public.forward_message", ".migration-backup/supabase/migrations/20260911144000_forward_message_with_media.sql",
    "535058cdf0cc4a973bf3356082a52d8e2e6fce4f7b58cd988c6cb1138459eec2"],
  ["private.lock_bot_message_epoch()", "private.lock_bot_message_epoch", "supabase/migrations/20260926144000_bot_privacy_delivery_epoch.sql",
    "6e22377078025c81b8058d5dbb1ff40ae1c798babd76b13c51ac68df38bcf814"],
  ["private.guard_bot_message_created_at()", "private.guard_bot_message_created_at", "supabase/migrations/20260926144000_bot_privacy_delivery_epoch.sql",
    "aa536a0706a3b907dc6b840315df52b3fab819d0812ced9f70a27698b939bd3e"],
];
const sha = text => createHash("sha256").update(text).digest("hex");

function sourceBody(path, name) {
  const sql = readFileSync(new URL(path, root), "utf8").replaceAll("\r\n", "\n");
  const at = sql.indexOf("function " + name + "(");
  assert.ok(at >= 0, "the captured function must exist in the named accepted source");
  const selected = sql.slice(at), delimiter = selected.match(/\bas\s+(\$[A-Za-z_]*\$)/i)?.[1];
  assert.ok(delimiter, "the captured body must be dollar quoted");
  const start = selected.indexOf(delimiter), end = selected.indexOf(delimiter, start + delimiter.length);
  assert.ok(end > start, "the captured body must terminate");
  return selected.slice(start + delimiter.length, end);
}

async function catalog(db) {
  return {
    functions: await db.query(`select p.oid,p.oid::regprocedure::text as signature,p.prosrc,
      pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service_role
      from pg_proc p where p.oid in (${captured.map(([signature]) => quote(signature) + "::regprocedure").join(",")})
      order by p.oid`),
    triggers: await db.query(`select t.oid,t.tgname,t.tgfoid::regprocedure::text as function,t.tgtype,t.tgenabled,
      array(select a.attname::text from pg_attribute a where a.attrelid=t.tgrelid
        and a.attnum=any(t.tgattr) order by a.attnum) as columns
      from pg_trigger t where t.tgrelid='public.messages'::regclass
      and t.tgname in ('trg_a_lock_bot_message_epoch','trg_guard_bot_message_created_at') order by t.tgname`),
  };
}

async function fixture(t) {
  const db = await coverageFixture(t);
  await installForward(db);
  const before = await catalog(db);
  assert.equal(before.functions.length, 3);
  for (const [signature, name, path, hash] of captured) {
    const [installed] = await db.query(`select prosrc from pg_proc where oid=${quote(signature)}::regprocedure`);
    assert.equal(sha(sourceBody(path, name)), hash, "literal accepted source-body hash: " + name);
    assert.equal(sha(installed.prosrc), hash, "actual compiled source-body hash: " + name);
  }
  for (const fn of before.functions) {
    assert.equal(fn.owner, "postgres");
    assert.equal(fn.prosecdef, true);
    assert.equal(fn.provolatile, "v");
    assert.deepEqual(fn.proconfig, ['search_path=""']);
    assert.equal(fn.authenticated, fn.signature.startsWith("forward_message("));
    assert.equal(fn.anon, false);
    assert.equal(fn.service_role, false);
  }
  assert.deepEqual(before.triggers.map(({ oid, ...row }) => row), [
    { tgname: "trg_a_lock_bot_message_epoch", function: "private.lock_bot_message_epoch()", tgtype: 7, tgenabled: "O", columns: [] },
    { tgname: "trg_guard_bot_message_created_at", function: "private.guard_bot_message_created_at()", tgtype: 23, tgenabled: "O", columns: ["created_at"] },
  ]);
  await trusted(db, `insert into public.chat_members(chat_id,user_id) values ('${destination}','${actor}');
    ${messageInsert(sourceId, { path: db.a.receipt.path, url: mediaUrl(db.a.receipt.path) })};
    insert into public.media_variants(message_id,chat_id,owner_id,source_bucket,source_path,
      variant_kind,variant_bucket,variant_path,mime_type,width,height,size_bytes,status) values
      ('${sourceId}','${sourceChat}','${uuid(7002)}','chat-media',${quote(db.a.receipt.path)},
        'image_preview','media','fixture/ready.webp','image/webp',41,23,17,'ready'),
      ('${sourceId}','${sourceChat}','${uuid(7002)}','chat-media',${quote(db.a.receipt.path)},
        'image_thumb','media','fixture/failed.webp','image/webp',null,null,null,'failed'),
      ('${sourceId}','${destination}','${uuid(7002)}','chat-media',${quote(db.a.receipt.path)},
        'video_poster','media','fixture/wrong-chat.webp','image/webp',null,null,null,'ready');`);
  assert.deepEqual((await observations(db, sourceId)).map(row => row.reference_state), ["registered", "registered"]);
  t.diagnostic(`${mode}; PostgreSQL ${db.version}; captured forward + epoch bodies/catalog verified`);
  return { db, before, unchanged: async () => assert.deepEqual(await catalog(db), before, "RPC and epoch hooks remain unchanged") };
}

const call = key => `select (public.forward_message('${sourceId}','${destination}','${key}',null,null)).id;`;
const copies = db => db.query(`select id,chat_id,user_id,forwarded_from_id,client_message_id,
  media_bucket,media_path,media_url from public.messages where chat_id='${destination}' order by id`);

async function assertCopy(db, id, key) {
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(await copies(db), [{ id, chat_id: destination, user_id: actor,
    forwarded_from_id: sourceId, client_message_id: key, media_bucket: "chat-media",
    media_path: db.a.receipt.path, media_url: mediaUrl(db.a.receipt.path) }]);
  assert.deepEqual(await db.query(`select chat_id,owner_id,profile_id,source_bucket,source_path,
    variant_kind,variant_bucket,variant_path,mime_type,width,height,size_bytes,status
    from public.media_variants where message_id='${id}' order by variant_kind`), [{
    chat_id: destination, owner_id: actor, profile_id: null, source_bucket: "chat-media", source_path: db.a.receipt.path,
    variant_kind: "image_preview", variant_bucket: "media", variant_path: "fixture/ready.webp",
    mime_type: "image/webp", width: 41, height: 23, size_bytes: 17, status: "ready",
  }]);
  assert.deepEqual((await observations(db, id)).map(row => ({ kind: row.source_kind, generation: row.generation_id, state: row.reference_state })), [
    { kind: "canonical", generation: db.a.identity.generation_id, state: "registered" },
    { kind: "legacy_url", generation: db.a.identity.generation_id, state: "registered" },
  ]);
}

const revocations = [
  { name: "source hidden", code: "P0002", reason: "message_not_found",
    sql: `insert into public.message_hidden_for_users(message_id,user_id) values ('${sourceId}','${actor}')` },
  { name: "source cleared", code: "P0002", reason: "message_not_found",
    sql: `update public.chat_members set cleared_at=clock_timestamp()+interval '1 hour' where chat_id='${sourceChat}' and user_id='${actor}'` },
  { name: "source membership removed", code: "P0002", reason: "message_not_found",
    sql: `delete from public.chat_members where chat_id='${sourceChat}' and user_id='${actor}'` },
  { name: "destination membership removed", code: "42501", reason: "not_chat_member",
    sql: `delete from public.chat_members where chat_id='${destination}' and user_id='${actor}'` },
];
const denied = rule => error => error.code === rule.code && error.message.includes(rule.reason);

async function epochWait(db, waiter, blocker) {
  for (let i = 0; i < 100; i++) {
    const [state] = await db.query(`select
      ${blocker}=any(pg_blocking_pids(${waiter})) as expected_blocker,
      exists(select 1 from pg_stat_activity where pid=${waiter} and wait_event_type='Lock') as lock_wait,
      exists(select 1 from pg_locks where pid=${waiter} and relation='public.chat_bot_members'::regclass
        and mode='RowShareLock' and granted) as epoch_relation,
      exists(select 1 from pg_locks where pid=${blocker} and relation='public.chat_bot_members'::regclass
        and mode='RowExclusiveLock' and granted) as update_relation,
      exists(select 1 from pg_locks w join pg_locks h on w.transactionid=h.transactionid
        where w.pid=${waiter} and h.pid=${blocker} and w.locktype='transactionid'
        and h.locktype='transactionid' and not w.granted and h.granted
        and w.mode='ShareLock' and h.mode='ExclusiveLock') as update_xid_wait,
      not exists(select 1 from pg_locks where pid=${waiter} and locktype='advisory' and not granted) as no_advisory_wait`);
    if (Object.values(state).every(value => value === true)) return state;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("forward must wait on the real destination epoch UPDATE transaction, not a test advisory pause");
}

async function blockedForward(db, key, whileWaiting) {
  const blocker = await session(db, "set role postgres;"), waiter = await session(db, asActor);
  let operation;
  try {
    assert.equal(await blocker.connection.send(`begin;
      with changed as (update public.chat_bot_members set privacy_mode=privacy_mode
        where chat_id='${destination}' and bot_id='${uuid(1)}' and removed_at is null returning 1)
      select count(*) from changed;`), "1", "one real destination membership UPDATE is left open");
    operation = settled(waiter.connection.send("begin; " + call(key) + " commit;"));
    const proof = await epochWait(db, waiter.pid, blocker.pid);
    await whileWaiting();
    assert.deepEqual(await epochWait(db, waiter.pid, blocker.pid), proof, "revocation committed while the RPC is still waiting");
    await blocker.connection.send("commit;");
    return await operation;
  } finally {
    await blocker.connection.close();
    if (operation) await operation;
    await waiter.connection.close();
  }
}

test("C9 valid captured forward, retry, ready variant scope and stored attribution", async t => {
  const { db, unchanged } = await fixture(t), key = uuid(8200), before = await accounting(db);
  const connection = await session(db, asActor);
  const id = await connection.connection.send(call(key));
  await assertCopy(db, id, key);
  assert.equal(await connection.connection.send(call(key)), id, "retry returns the same copy, no duplicate variant");
  await assertCopy(db, id, key);
  assert.deepEqual(await accounting(db), before);
  await unchanged();
});

for (const [index, rule] of revocations.entries()) {
  test(`C9 no-wait revoked authority refused: ${rule.name}`, async t => {
    const { db, unchanged } = await fixture(t), key = uuid(8210 + index);
    await trusted(db, rule.sql);
    const before = await accounting(db);
    await assert.rejects(authenticated(db, call(key)), denied(rule));
    assert.deepEqual(await copies(db), [], "no output copy on an already revoked request");
    assert.deepEqual(await accounting(db), before);
    await unchanged();
  });

  test(`C9 existing-wait authorization gap: ${rule.name}`, async t => {
    const { db, unchanged } = await fixture(t), key = uuid(8220 + index), before = await accounting(db);
    const outcome = await blockedForward(db, key, async () => {
      await trusted(db, rule.sql);
      await assert.rejects(authenticated(db, call(uuid(8230 + index))), denied(rule),
        "a fresh RPC sees the committed revocation while the old RPC is blocked");
      assert.deepEqual(await copies(db), []);
    });
    assert.deepEqual(await accounting(db), before);
    await unchanged();
    if (strict) {
      assert.ok(outcome.error && denied(rule)(outcome.error),
        "Missing expected fresh authorization refusal after the destination epoch wait");
      assert.deepEqual(await copies(db), [], "strict oracle: zero committed unauthorized copies");
    } else {
      assert.equal(outcome.error, undefined, "characterization expects the existing unsafe success, not either outcome");
      await assertCopy(db, outcome.value, key);
      await assert.rejects(authenticated(db, call(key)), denied(rule), "a retry must rerun current authority even when the cached copy exists");
      t.diagnostic("literal unsafe outcome: one committed copy after revocation; coverage is not an authorization fix");
    }
  });
}

for (const [index, kind] of ["pointer changed", "deleted and scrubbed", "source row removed"].entries()) {
  test(`C9 existing-wait canonical path guard: ${kind}`, async t => {
    const { db, unchanged } = await fixture(t), before = await accounting(db);
    const outcome = await blockedForward(db, uuid(8240 + index), async () => {
      if (index === 0) {
        await trusted(db, `update public.messages set media_path=${quote(db.b.receipt.path)},
          media_url=${quote(mediaUrl(db.b.receipt.path))} where id='${sourceId}'`);
        assert.equal((await db.query(`select media_path from public.messages where id='${sourceId}'`))[0].media_path, db.b.receipt.path);
      } else if (index === 1) {
        await trusted(db, `update public.messages set deleted_at=clock_timestamp() where id='${sourceId}'`);
        assert.deepEqual(await db.query(`select media_path,media_url,deleted_at is not null as deleted from public.messages where id='${sourceId}'`),
          [{ media_path: null, media_url: null, deleted: true }]);
      } else {
        await trusted(db, `delete from public.messages where id='${sourceId}'`);
        assert.deepEqual(await db.query(`select id from public.messages where id='${sourceId}'`), []);
      }
    });
    assert.ok(outcome.error, "the cached foreign canonical pointer is refused after the epoch wait");
    assert.equal(outcome.error.code, "42501");
    assert.match(outcome.error.message, /message_media_path_not_owned/);
    assert.deepEqual(await copies(db), []);
    assert.deepEqual(await accounting(db), before);
    await unchanged();
  });
}
