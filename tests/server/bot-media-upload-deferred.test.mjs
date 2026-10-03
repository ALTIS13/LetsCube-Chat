import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { postgres, read, quote, bot, token, chat } from "./bot-inline-media-ingest.fixture.mjs";
import { createBotMethodRepository } from "../../artifacts/api-server/src/bot/repository.ts";
import { createMessageHandlers } from "../../artifacts/api-server/src/bot/methods/messages.ts";
import { toBotApiErrorResponse } from "../../artifacts/api-server/src/bot/errors.ts";

// Captured fictional SQL subset, real handlers/repository/RPCs; Storage is ONLY a fake.
// No physical incarnation, provider terminality, full-schema HTTP or refund proof.
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l7sAAAAASUVORK5CYII=", "base64");
const sha256 = "1206f9d3b441f79f05d47c2d722c11236e11769101efadde7c24083e3fa18ab5";
const fingerprint = "a".repeat(64);
const key = "deferred-real-sql-png-0001";
const path = `${chat}/bots/${bot}/${fingerprint}.png`;
const input = { chat_id: chat, idempotency_key: key,
  photo: { mime_type: "image/png", bytes_base64: bytes.toString("base64") } };
const operationWhere = `bot_id=${quote(bot)} and idempotency_key=${quote(key)}`;
const commitSignature = "public.bot_media_ingest_commit_internal(uuid,uuid,text,text,uuid,jsonb)";
const allowed = new Set(["bot_media_ingest_reserve_internal", "bot_media_upload_begin_internal",
  "bot_media_upload_finish_internal", "bot_media_ingest_commit_internal"]);

function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " exceeded its bound")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function track(pending, promise) {
  pending.add(promise);
  promise.then(() => pending.delete(promise), () => pending.delete(promise));
  return promise;
}

async function fixture(t, { failB = false, failALate = false } = {}) {
  assert.ok(process.env.BOT_INGEST_PG_BIN, "supply the configured owned local BOT_INGEST_PG_BIN");
  assert.ok(!process.env.BOT_INGEST_TEST_BASELINE, "this gate requires the real ingest migration");
  const pendingSql = new Set(), pendingCalls = new Set();
  let directory;
  const raw = await postgres({ after(cleanup) {
    t.after(async () => {
      try {
        await bounded(Promise.allSettled([...pendingCalls, ...pendingSql]), 20_000, "pre-teardown settling");
        assert.equal(pendingCalls.size, 0, "all handler calls settled before DB teardown");
        assert.equal(pendingSql.size, 0, "all SQL transports settled before DB teardown");
      } finally { await cleanup(); }
      assert.equal(existsSync(directory), false, "the exact owned temporary PG directory was removed");
      t.diagnostic("owned local PG stopped; exact temporary directory absent; no outstanding calls/SQL");
    });
  } });
  const exec = sql => bounded(track(pendingSql, raw.exec(
    "set statement_timeout='3s'; set lock_timeout='2s';\n" + sql)), 8_000, "owned SQL transport");
  const query = async sql => JSON.parse(await exec(
    "select coalesce(jsonb_agg(q),'[]'::jsonb) from (" + sql + ") q;"));
  const [identity] = await query("select current_user as owner,current_setting('data_directory') as directory");
  directory = identity.directory;
  assert.equal(identity.owner, "fixture_control");
  assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
  assert.match(basename(directory), /^letscube-bot-ingest-/);
  t.diagnostic("local PostgreSQL " + raw.version + "; fictional captured schema, not full production restore");
  await exec(read("supabase/migrations/20261002155123_bot_media_upload_intents.sql"));

  const reached = deferred(), release = deferred();
  const unknown = new Error("fictional old PUT outcome unknown");
  const injected = new assert.AssertionError({ message: "injected B adapter assertion while A is outstanding" });
  const lateInjected = new assert.AssertionError({ message: "unexpected late A assertion after B failed" });
  const control = { failures: [], calls: [], leases: {}, puts: [], downloads: [], stored: null,
    jobs: [], cleanupSettled: false, cleanupMs: null, injected, lateInjected };
  const guard = async body => {
    try { return await body(); }
    catch (error) { if (error !== unknown) control.failures.push(error); throw error; }
  };
  const guardSync = body => {
    try { return body(); }
    catch (error) { control.failures.push(error); throw error; }
  };
  const assertAdapters = () => { if (control.failures.length) throw control.failures[0]; };
  const receipt = async () => {
    const rows = await query("select * from private.bot_media_ingests where " + operationWhere);
    assert.equal(rows.length, 1); return rows[0];
  };
  const attempts = () => query("select * from private.bot_media_upload_attempts where " + operationWhere);
  const counts = async () => (await query(`select
    (select count(*)::int from private.bot_media_ingests) as receipts,
    (select coalesce(sum(byte_size),0)::int from private.bot_media_ingests) as charged_bytes,
    (select count(*)::int from storage.objects) as objects,
    (select count(*)::int from public.messages) as messages,
    (select count(*)::int from private.bot_message_idempotency) as deliveries,
    (select count(*)::int from private.bot_operation_idempotency) as operations,
    (select count(*)::int from private.bot_upload_grants) as grants`))[0];

  const handlers = Object.fromEntries(["A", "B"].map(actor => {
    const repository = createBotMethodRepository({
      rpc: (name, args) => guard(async () => {
        assert.ok(allowed.has(name)); assert.equal(args.p_bot_id, bot);
        assert.equal(args.p_idempotency_key, key);
        if (Object.hasOwn(args, "p_token_id")) assert.equal(args.p_token_id, token);
        if (Object.hasOwn(args, "p_chat_id")) assert.equal(args.p_chat_id, chat);
        const parameters = Object.entries(args).map(([name, value]) => {
          assert.match(name, /^p_[a-z0-9_]+$/);
          return name + " => " + quote(typeof value === "object" ? JSON.stringify(value) : value);
        }).join(",");
        const call = { actor, name, args: structuredClone(args), code: null, data: null, error: null };
        control.calls.push(call);
        try {
          const row = JSON.parse(await exec("set role service_role; select to_jsonb(q) from (select public." +
            name + "(" + parameters + ") as value) q;"));
          call.code = "00000"; call.data = row.value;
        } catch (error) {
          const message = error.message.match(/ERROR:\s+[A-Z0-9]{5}:\s+([^\r\n]*)/)?.[1];
          call.code = error.code; call.error = { code: error.code, message, details: error.detail };
          if (actor !== "A" || name !== "bot_media_ingest_commit_internal" ||
            args.p_lease_id !== control.leases.A || error.code !== "42501" || message !== "bot_ingest_lease_invalid") {
            throw error;
          }
          return { data: null, error: call.error };
        }
        if (name === "bot_media_upload_begin_internal") {
          assert.deepEqual(call.data, { attempt_id: args.p_lease_id, state: "pending" });
          control.leases[actor] = args.p_lease_id;
        }
        return { data: call.data, error: null };
      }),
      storage: { from: bucket => guardSync(() => {
        assert.equal(bucket, "chat-media");
        return {
          upload: (objectPath, body, options) => guard(async () => {
            assert.equal(objectPath, path); assert.deepEqual(body, bytes);
            assert.deepEqual(options, { contentType: "image/png", upsert: false });
            const lease = control.leases[actor];
            const rows = await query("select state,byte_size::int,content_sha256 from private.bot_media_upload_attempts where " +
              operationWhere + " and attempt_id=" + quote(lease));
            assert.deepEqual(rows, [{ state: "pending", byte_size: 68, content_sha256: sha256 }]);
            const put = { actor, lease, outcome: null }; control.puts.push(put);
            if (actor === "A") {
              reached.release();
              const terminal = await bounded(release.promise, 15_000, "old fictional PUT release");
              if (terminal === "unknown") { put.outcome = "unknown"; throw failALate ? lateInjected : unknown; }
              assert.equal(terminal, "409"); assert.ok(control.stored, "B created the fictional object first");
              assert.equal((await counts()).objects, 1);
              put.outcome = 409;
              return { data: null, error: { status: 409, statusCode: "ResourceAlreadyExists" } };
            }
            if (failB) throw injected;
            assert.equal(control.stored, null, "fake overwrite is forbidden");
            await exec("insert into storage.objects(bucket_id,name,metadata) values ('chat-media'," +
              quote(path) + ",' {\"mimetype\":\"image/png\",\"size\":68}'::jsonb);");
            control.stored = { bytes: Buffer.from(body), hash: createHash("sha256").update(body).digest("hex") };
            assert.equal(control.stored.hash, sha256); put.outcome = 200;
            return { data: { path }, error: null };
          }),
          download: (objectPath, options, parameters) => guardSync(() => {
            assert.equal(actor, "A"); assert.equal(objectPath, path); assert.deepEqual(options, {});
            assert.equal(parameters.cache, "no-store"); assert.ok(parameters.signal instanceof AbortSignal);
            const download = { delivered: 0, hash: null, signal: parameters.signal };
            control.downloads.push(download);
            return { asStream: () => guard(async () => {
              assert.ok(control.stored);
              const hash = createHash("sha256");
              return { error: null, data: new ReadableStream({ pull(controller) {
                guardSync(() => {
                  const end = download.delivered === 0 ? 17 : 68;
                  const chunk = control.stored.bytes.subarray(download.delivered, end);
                  download.delivered += chunk.length; hash.update(chunk); controller.enqueue(Uint8Array.from(chunk));
                  if (download.delivered === 68) { download.hash = hash.digest("hex"); controller.close(); }
                });
              } }, { highWaterMark: 0 }) };
            }) };
          }),
          remove: () => guardSync(() => assert.fail("fake remove is forbidden")),
          update: () => guardSync(() => assert.fail("fake overwrite is forbidden")),
        };
      }) },
    });
    return [actor, createMessageHandlers(repository, () => fingerprint,
      () => guard(async () => assert.fail("inline photo must not publish a chat action")))];
  }));
  const invoke = actor => {
    const promise = (async () => {
      let response;
      try {
        const result = await handlers[actor].sendPhoto({ bot: { botId: bot, tokenId: token },
          requestId: "fictional-deferred-" + actor }, structuredClone(input));
        response = { status: 200, body: { ok: true, result } };
      } catch (error) { response = toBotApiErrorResponse(error, "fictional-deferred-" + actor); }
      assertAdapters(); return response;
    })();
    control.jobs.push(promise); return track(pendingCalls, promise);
  };
  return { exec, query, control, invoke, reached, release, receipt, attempts, counts, t };
}

async function assertAttempts(f, expected) {
  const rows = await f.attempts(); assert.equal(rows.length, expected.length);
  for (const [actor, state] of expected) {
    const row = rows.find(row => row.attempt_id === f.control.leases[actor]);
    assert.ok(row, "the exact caller attempt is retained");
    for (const [field, value] of Object.entries({ bot_id: bot, idempotency_key: key,
      owner_token_id: token, chat_id: chat, request_fingerprint: fingerprint, object_path: path,
      content_type: "image/png", byte_size: 68, content_sha256: sha256, state })) assert.equal(row[field], value);
    assert.ok(row.started_at); assert.equal(row.observed_at === null, state === "pending");
  }
  return rows;
}

async function assertDelivery(f, result) {
  assert.match(result.message_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const messages = await f.query("select id,chat_id,bot_id,user_id,type,content,media_bucket,media_path,media_metadata,created_at from public.messages");
  assert.deepEqual(messages, [{ id: result.message_id, chat_id: chat, bot_id: bot, user_id: null,
    type: "image", content: null, media_bucket: "chat-media", media_path: path,
    media_metadata: { mime_type: "image/png", size: 68, size_bytes: 68, kind: "image" }, created_at: result.created_at }]);
  assert.deepEqual(result, { message_id: result.message_id, chat_id: chat, bot_id: bot,
    type: "image", created_at: messages[0].created_at });
  assert.deepEqual(await f.query("select bot_id,idempotency_key,method,message_id from private.bot_message_idempotency"),
    [{ bot_id: bot, idempotency_key: key, method: "sendPhoto", message_id: result.message_id }]);
  assert.deepEqual(await f.query("select bot_id,idempotency_key,method,request_fingerprint,result from private.bot_operation_idempotency"),
    [{ bot_id: bot, idempotency_key: key, method: "sendPhoto", request_fingerprint: fingerprint, result }]);
  assert.deepEqual(await f.query("select bucket_id,name,metadata from storage.objects"),
    [{ bucket_id: "chat-media", name: path, metadata: { mimetype: "image/png", size: 68 } }]);
  assert.deepEqual(await f.counts(), { receipts: 1, charged_bytes: 68, objects: 1, messages: 1,
    deliveries: 1, operations: 1, grants: 1 });
}

function assertStaleRefusal(proof) {
  assert.equal(proof.commit.code, "42501", "stale caller must receive actual SQLSTATE 42501");
  assert.equal(proof.commit.error.message, "bot_ingest_lease_invalid");
  assert.deepEqual(proof.old, { status: 403, body: { ok: false, error: {
    code: "forbidden", message: "Forbidden", request_id: "fictional-deferred-A" } } });
}

async function scenario(f, terminal) {
  let oldCall;
  try {
    oldCall = f.invoke("A");
    await bounded(Promise.race([f.reached.promise, oldCall.then(() => {
      assert.fail("old caller settled before reaching the deferred PUT");
    })]), 10_000, "old PUT reached barrier");
    const initial = await f.receipt();
    assert.equal(initial.state, "reserved"); assert.equal(initial.result, null);
    assert.equal(initial.lease_id, f.control.leases.A); assert.equal(initial.byte_size, 68);
    assert.equal(initial.object_path, path); assert.equal(initial.content_sha256, sha256);
    assert.deepEqual(await f.counts(), { receipts: 1, charged_bytes: 68, objects: 0,
      messages: 0, deliveries: 0, operations: 0, grants: 0 });
    await assertAttempts(f, [["A", "pending"]]);
    const expired = JSON.parse(await f.exec(`with expired as (
      update private.bot_media_ingests set lease_expires_at=clock_timestamp()-interval '1 second'
      where ${operationWhere} and lease_id=${quote(initial.lease_id)} and state='reserved'
      and object_path=${quote(path)} returning lease_id
    ) select coalesce(jsonb_agg(expired),'[]'::jsonb) from expired;`));
    assert.deepEqual(expired, [{ lease_id: initial.lease_id }]);
    const current = await f.invoke("B"); assert.equal(current.status, 200);
    const result = current.body.result, complete = await f.receipt();
    const committed = f.control.calls.find(call => call.actor === "B" && call.name === "bot_media_ingest_commit_internal");
    assert.equal(committed.code, "00000"); assert.equal(committed.data.duplicate, false);
    assert.deepEqual(committed.data.result, result);
    assert.notEqual(f.control.leases.B, initial.lease_id);
    assert.equal(complete.lease_id, f.control.leases.B); assert.equal(complete.state, "complete");
    assert.equal(complete.created_at, initial.created_at); assert.equal(complete.byte_size, 68);
    assert.deepEqual(complete.result, result); assert.equal(complete.commit_xid, null);
    await assertDelivery(f, result);
    const overlapping = await assertAttempts(f, [["A", "pending"], ["B", "acknowledged"]]);
    f.release.release(terminal);
    const old = await oldCall;
    const after = await assertAttempts(f, [["A", terminal === "409" ? "acknowledged" : "unknown"], ["B", "acknowledged"]]);
    assert.deepEqual(after.find(row => row.attempt_id === f.control.leases.B),
      overlapping.find(row => row.attempt_id === f.control.leases.B), "A cannot rewrite B's attempt");
    assert.equal(after.find(row => row.attempt_id === initial.lease_id).started_at,
      overlapping.find(row => row.attempt_id === initial.lease_id).started_at);
    assert.deepEqual(await f.receipt(), complete, "late A cannot change B's receipt or original accounting");
    await assertDelivery(f, result);
    const beforeRetry = await f.attempts();
    assert.deepEqual(await f.invoke("B"), current);
    assert.deepEqual(await f.attempts(), beforeRetry); assert.deepEqual(await f.receipt(), complete);
    await assertDelivery(f, result);
    assert.deepEqual(f.control.puts.map(put => [put.actor, put.outcome]), [["A", terminal === "409" ? 409 : "unknown"], ["B", 200]]);
    const commits = f.control.calls.filter(call => call.actor === "A" && call.name === "bot_media_ingest_commit_internal");
    if (terminal === "409") {
      assert.equal(commits.length, 1); assert.equal(commits[0].args.p_lease_id, initial.lease_id);
      assert.equal(f.control.downloads.length, 1);
      assert.equal(f.control.downloads[0].delivered, 68); assert.equal(f.control.downloads[0].hash, sha256);
      assert.equal(f.control.downloads[0].signal.aborted, true);
    } else {
      assert.deepEqual(old, { status: 500, body: { ok: false, error: {
        code: "internal_error", message: "Internal server error", request_id: "fictional-deferred-A" } } });
      assert.equal(commits.length, 0); assert.equal(f.control.downloads.length, 0);
    }
    assert.equal(f.control.failures.length, 0);
    return { old, commit: commits[0], current };
  } finally {
    const start = performance.now();
    f.release.release("unknown");
    await bounded(Promise.allSettled(f.control.jobs), 20_000, "deferred cleanup settling");
    f.control.cleanupSettled = true; f.control.cleanupMs = performance.now() - start;
    assert.ok(f.control.cleanupMs < 20_000, "deferred release and settling stays bounded on failure too");
    f.t.diagnostic("deferred release/settling completed in " + Math.ceil(f.control.cleanupMs) + " ms before DB teardown");
  }
}

async function definitions(f) {
  const rows = await f.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
    pg_get_functiondef(p.oid) as definition,pg_get_userbyid(p.proowner) as owner,
    p.proacl::text as acl,p.proconfig,p.prosecdef,p.provolatile
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f' order by n.nspname,p.proname,arguments`);
  return { rows, digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
}

test("deferred old PUT verifies 409 bytes but real stale lease commit refuses 42501/403", { timeout: 90_000 }, async t => {
  const f = await fixture(t); assertStaleRefusal(await scenario(f, "409"));
});

test("deferred old PUT rejects unknown without erasing B's completed receipt or the held attempt", { timeout: 90_000 }, async t => {
  await scenario(await fixture(t), "unknown");
});

test("compiled stale-lease SQL mutant goes RED on the literal refusal oracle and restores exact definitions/digest", { timeout: 90_000 }, async t => {
  const f = await fixture(t), before = await definitions(f);
  const [original] = await f.query("select pg_get_functiondef(" + quote(commitSignature) + "::regprocedure) as definition");
  const guard = "  IF v_row.owner_token_id <> p_token_id OR v_row.lease_id <> p_lease_id THEN\n" +
    "    RAISE EXCEPTION 'bot_ingest_lease_invalid' USING ERRCODE='42501';\n  END IF;\n";
  assert.equal(original.definition.split(guard).length, 2, "mutate exactly one compiled stale-lease guard");
  let proof;
  await assert.rejects(async () => {
    try {
      await f.exec(original.definition.replace(guard, ""));
      assert.notEqual((await definitions(f)).digest, before.digest);
      proof = await scenario(f, "409");
      assertStaleRefusal(proof);
    } finally {
      await f.exec(original.definition);
      assert.deepEqual(await definitions(f), before, "exact function definitions/owners/ACL/config digest restored after oracle failure");
    }
  }, error => error instanceof assert.AssertionError && error.actual === "00000" && error.expected === "42501" &&
    error.message.includes("stale caller must receive actual SQLSTATE 42501"));
  assert.equal(proof.commit.code, "00000"); assert.equal(proof.old.status, 200);
  assert.equal(proof.commit.data.duplicate, true);
  assert.deepEqual(proof.old, proof.current); assert.equal(f.control.cleanupSettled, true);
  t.diagnostic("actual compiled mutant returned SQLSTATE 00000 / status 200; 42501 oracle RED; exact catalog digest restored in finally");
});

test("unexpected adapter assertion is not a Bot refusal and releases/settles outstanding A before teardown", { timeout: 90_000 }, async t => {
  const f = await fixture(t, { failB: true });
  await assert.rejects(scenario(f, "409"), error => error === f.control.injected);
  assert.equal(f.control.cleanupSettled, true); assert.ok(f.control.cleanupMs < 20_000);
  assertOnlyInjectedFailure(f);
  assert.deepEqual(await Promise.allSettled(f.control.jobs), [
    { status: "rejected", reason: f.control.injected },
    { status: "rejected", reason: f.control.injected },
  ], "both completed calls reject only the deliberate B assertion");
  await assertAttempts(f, [["A", "unknown"], ["B", "unknown"]]);
  const row = await f.receipt(); assert.equal(row.state, "reserved"); assert.equal(row.result, null);
  assert.equal(row.byte_size, 68); assert.equal(row.lease_id, f.control.leases.B);
  assert.deepEqual(await f.counts(), { receipts: 1, charged_bytes: 68, objects: 0,
    messages: 0, deliveries: 0, operations: 0, grants: 0 });
});

function assertOnlyInjectedFailure(f) {
  assert.deepEqual(f.control.failures, [f.control.injected],
    "only the deliberate B assertion is permitted after settling");
}

test("late adapter failure cannot be hidden behind the first expected assertion", { timeout: 90_000 }, async t => {
  const f = await fixture(t, { failB: true, failALate: true });
  await assert.rejects(scenario(f, "409"), error => error === f.control.injected);
  assert.equal(f.control.cleanupSettled, true);
  assert.deepEqual(f.control.failures, [f.control.injected, f.control.lateInjected]);
  assert.throws(() => assertOnlyInjectedFailure(f), { code: "ERR_ASSERTION" });
});
