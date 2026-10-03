import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createBotMethodRepository } from "../../artifacts/api-server/src/bot/repository.ts";
import { createMessageHandlers } from "../../artifacts/api-server/src/bot/methods/messages.ts";
import { toBotApiErrorResponse } from "../../artifacts/api-server/src/bot/errors.ts";
import { fullSchemaIds as q } from "./bot-media-authority-full-schema.fixture.mjs";
import { assertInlineDeliveryLinks } from "./bot-media-inline-http.fixture.mjs";

const tokenId = "e5070000-0000-4000-8000-000000000301";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l7sAAAAASUVORK5CYII=";
const pngSha = "1206f9d3b441f79f05d47c2d722c11236e11769101efadde7c24083e3fa18ab5";
const cleanupBoundMs = 20_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const sha = value => createHash("sha256").update(value).digest("hex");
const fingerprint = (method, input) => sha(JSON.stringify([method, input]));
const pipeline = ["bot_media_ingest_reserve_internal", "bot_media_upload_begin_internal",
  "bot_media_upload_finish_internal", "bot_media_ingest_commit_internal"];

function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, release: resolve };
}

function track(pending, promise) {
  pending.add(promise);
  // Attach rejection handlers immediately, including to jobs awaited only in finally.
  promise.then(() => pending.delete(promise), () => pending.delete(promise));
  return promise;
}

async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + " exceeded its bound")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

// Same transport contract as inline-http: request(method,path,body,role) returns
// {status,data,error}; query(sql) returns rows; exec(sql) is an idle privileged
// session; digest() covers application/catalog state; check(name,body) runs body.
// The coordinator installs fullSchemaSeed, fictional token 0301, HTTP probe,
// combined coverage/preflight SQL and bounded transports in a fresh owned copy.
// No DDL, catalog mutant, host/runtime/key selection, teardown or provider I/O.
// Storage is ONLY fictional metadata and local bytes. Logical generation is NOT
// physical generation; pending/unknown remain HOLD, with no cleanup/quota release.
export async function runBotMediaDeferredHttpAcceptance({ request, query, exec, digest, check }) {
  for (const dep of [request, query, exec, digest, check]) assert.equal(typeof dep, "function");
  const pendingIo = new Set(), pendingAdapters = new Set(), pendingJobs = new Set(), pendingBodies = new Set();
  const controls = [], done = [], objects = new Map();
  const bytes = Buffer.from(png, "base64");
  assert.equal(bytes.length, 68); assert.equal(sha(bytes), pngSha);
  assert.equal(bytes.readUInt32BE(16), 1); assert.equal(bytes.readUInt32BE(20), 1);
  const specs = ["stale-409", "old-unknown", "cleanup-b", "cleanup-late-a"].map(suffix => {
    const input = { chat_id: q.sourceChat, idempotency_key: "fictional-deferred-http-" + suffix,
      photo: { mime_type: "image/png", bytes_base64: png } };
    const hash = fingerprint("sendPhoto", input);
    return { input, hash, path: `${q.sourceChat}/bots/${q.bot}/${hash}.png` };
  });
  assert.equal(new Set(specs.map(spec => spec.path)).size, 4);
  const io = fn => (...args) => track(pendingIo, Promise.resolve().then(() => fn(...args)));
  const sqlQuery = io(query), sqlExec = io(exec), http = io(request), stateDigest = io(digest);
  const where = spec => `bot_id=${quote(q.bot)} and idempotency_key=${quote(spec.input.idempotency_key)}`;
  const objectWhere = spec => `bucket_id='chat-media' and name=${quote(spec.path)}`;
  const idleExec = sql => sqlExec(`do $fixture_deferred_http$ begin
    if exists (select 1 from pg_catalog.pg_stat_activity where pid=pg_backend_pid()
      and xact_start is distinct from query_start) then
      raise exception 'fictional_deferred_http_exec_not_idle';
    end if;
    ${sql}
  end; $fixture_deferred_http$;`);
  const receipt = async spec => {
    const rows = await sqlQuery(`select to_jsonb(i) as value from private.bot_media_ingests i where ${where(spec)}`);
    assert.equal(rows.length, 1, "one exact fictional charged receipt"); return rows[0].value;
  };
  const attempts = async spec => (await sqlQuery(`select to_jsonb(a) as value
    from private.bot_media_upload_attempts a where ${where(spec)} order by attempt_id`)).map(row => row.value);
  const counts = async () => (await sqlQuery(`select
    (select count(*)::int from private.bot_media_ingests) as receipts,
    (select coalesce(sum(byte_size),0)::bigint::text from private.bot_media_ingests) as charged_bytes,
    (select count(*)::int from private.bot_media_ingests where bot_id='${q.bot}') as bot_receipts,
    (select coalesce(sum(byte_size),0)::bigint::text from private.bot_media_ingests where bot_id='${q.bot}') as bot_charged_bytes,
    (select count(*)::int from private.bot_media_upload_attempts) as attempts,
    (select count(*)::int from private.bot_media_object_identities) as identities,
    (select count(*)::int from private.bot_media_path_claims) as path_claims,
    (select count(*)::int from private.bot_media_attempt_bindings) as attempt_bindings,
    (select count(*)::int from private.bot_media_grant_bindings) as grant_bindings,
    (select count(*)::int from storage.objects) as objects,
    (select count(*)::int from public.messages) as messages,
    (select count(*)::int from private.bot_upload_grants) as grants,
    (select count(*)::int from private.bot_operation_idempotency) as operations,
    (select count(*)::int from private.bot_message_idempotency) as deliveries,
    (select count(*)::int from private.bot_message_media_observations) as observations`))[0];
  const assertDelta = async (before, expected) => {
    const after = await counts();
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    for (const name of Object.keys(before)) {
      assert.equal(BigInt(after[name]) - BigInt(before[name]), BigInt(expected[name] ?? 0),
        "literal before-to-after " + name + " delta, never an empty copied-schema assumption");
    }
  };
  const chargeDelta = { receipts: 1, charged_bytes: 68, bot_receipts: 1, bot_charged_bytes: 68,
    identities: 1, path_claims: 1 };
  const commitDelta = { ...chargeDelta, attempts: 2, attempt_bindings: 2, grant_bindings: 1,
    objects: 1, messages: 1, grants: 1, operations: 1, deliveries: 1, observations: 1 };
  const effects = async (spec, expected) => {
    const [row] = await sqlQuery(`select
      (select count(*)::int from public.messages where media_bucket='chat-media' and media_path=${quote(spec.path)}) as messages,
      (select count(*)::int from private.bot_upload_grants where bot_id='${q.bot}' and bucket_id='chat-media'
        and object_path=${quote(spec.path)}) as grants,
      (select count(*)::int from private.bot_operation_idempotency where ${where(spec)}) as operations,
      (select count(*)::int from private.bot_message_idempotency where ${where(spec)}) as deliveries,
      (select count(*)::int from private.bot_message_media_observations o join public.messages m on m.id=o.message_id
        where m.media_bucket='chat-media' and m.media_path=${quote(spec.path)}) as observations`);
    assert.deepEqual(row, { messages: expected, grants: expected, operations: expected,
      deliveries: expected, observations: expected });
  };
  const assertReceiptIdentity = (row, spec) => {
    for (const [field, value] of Object.entries({ bot_id: q.bot, owner_token_id: tokenId,
      chat_id: q.sourceChat, method: "sendPhoto", idempotency_key: spec.input.idempotency_key,
      request_fingerprint: spec.hash, object_path: spec.path, content_type: "image/png",
      byte_size: 68, content_sha256: pngSha })) assert.equal(row[field], value, "exact receipt " + field);
    assert.match(row.lease_id, uuid); assert.ok(Number.isFinite(Date.parse(row.created_at)));
    assert.equal(row.commit_xid, null);
  };
  const assertReserved = (row, spec) => {
    assertReceiptIdentity(row, spec); assert.equal(row.state, "reserved");
    assert.equal(row.result, null); assert.equal(row.completed_at, null);
  };
  const identity = async (spec, initial) => {
    const rows = await sqlQuery(`select to_jsonb(i) as value
      from private.bot_media_object_identities i where ${where(spec)}`);
    assert.equal(rows.length, 1);
    const row = rows[0].value; assert.match(row.generation_id, uuid);
    assert.deepEqual(row, { generation_id: row.generation_id, bucket_id: "chat-media", object_path: spec.path,
      claim_kind: "ingest", bot_id: q.bot, idempotency_key: spec.input.idempotency_key,
      chat_id: q.sourceChat, method: "sendPhoto", request_fingerprint: spec.hash,
      content_type: "image/png", byte_size: 68, content_sha256: pngSha, receipt_created_at: initial.created_at });
    assert.deepEqual(await sqlQuery(`select bucket_id,object_path,claim_kind from private.bot_media_path_claims
      where bucket_id='chat-media' and object_path=${quote(spec.path)}`),
    [{ bucket_id: "chat-media", object_path: spec.path, claim_kind: "ingest" }]);
    return row;
  };
  const assertAttempts = async (f, expected) => {
    const rows = await attempts(f.spec); assert.equal(rows.length, expected.length);
    for (const [actor, state] of expected) {
      const lease = f.control.leases[actor], row = rows.find(value => value.attempt_id === lease);
      assert.ok(row, "retain the exact bot/key/lease attempt");
      for (const [field, value] of Object.entries({ bot_id: q.bot, idempotency_key: f.spec.input.idempotency_key,
        attempt_id: lease, owner_token_id: tokenId, chat_id: q.sourceChat, request_fingerprint: f.spec.hash,
        object_path: f.spec.path, content_type: "image/png", byte_size: 68, content_sha256: pngSha, state })) {
        assert.equal(row[field], value, "literal attempt " + field);
      }
      assert.ok(Number.isFinite(Date.parse(row.started_at)));
      if (state === "pending") assert.equal(row.observed_at, null);
      else assert.ok(Number.isFinite(Date.parse(row.observed_at)));
      assert.deepEqual({ ...row, state: "pending", observed_at: null }, f.control.pendingAttempts[actor],
        "finish preserves the entire original attempt, including started_at and exact identity");
    }
    const bound = await sqlQuery(`select b.attempt_id,b.generation_id from private.bot_media_attempt_bindings b
      join private.bot_media_upload_attempts a on a.attempt_id=b.attempt_id
      where a.bot_id='${q.bot}' and a.idempotency_key=${quote(f.spec.input.idempotency_key)} order by b.attempt_id`);
    assert.deepEqual(bound, rows.map(row => ({ attempt_id: row.attempt_id,
      generation_id: f.control.initialIdentity.generation_id })), "both leases bind the same logical identity");
    return rows;
  };
  const metadata = async spec => {
    assert.deepEqual(await sqlQuery(`select bucket_id,name,metadata from storage.objects where ${objectWhere(spec)}`),
      [{ bucket_id: "chat-media", name: spec.path, metadata: { mimetype: "image/png", size: 68 } }]);
    const object = objects.get(spec.path); assert.ok(object); assert.deepEqual(object.bytes, bytes);
    assert.equal(object.hash, pngSha);
  };
  const assertCommitted = async (f, result) => {
    const { spec, control } = f;
    const rows = await sqlQuery(`select id,chat_id,bot_id,user_id,type,content,media_bucket,media_path,media_metadata,created_at
      from public.messages where media_bucket='chat-media' and media_path=${quote(spec.path)}`);
    assert.match(result.message_id, uuid); assert.ok(Number.isFinite(Date.parse(result.created_at)));
    assert.deepEqual(result, { message_id: result.message_id, chat_id: q.sourceChat,
      bot_id: q.bot, type: "image", created_at: result.created_at });
    assert.deepEqual(rows, [{ id: result.message_id, chat_id: q.sourceChat, bot_id: q.bot, user_id: null,
      type: "image", content: null, media_bucket: "chat-media", media_path: spec.path,
      media_metadata: { mime_type: "image/png", size: 68, size_bytes: 68, kind: "image" }, created_at: result.created_at }]);
    const row = await receipt(spec); assertReceiptIdentity(row, spec); assert.equal(row.state, "complete");
    assert.equal(row.lease_id, control.leases.B); assert.equal(row.created_at, control.initialReceipt.created_at);
    assert.ok(Number.isFinite(Date.parse(row.completed_at))); assert.deepEqual(row.result, result);
    assert.deepEqual(await identity(spec, control.initialReceipt), control.initialIdentity);
    await assertInlineDeliveryLinks({ query: sqlQuery }, spec, result);
    assert.deepEqual(await sqlQuery(`select bot_id,idempotency_key,method,request_fingerprint,result
      from private.bot_operation_idempotency where ${where(spec)}`),
    [{ bot_id: q.bot, idempotency_key: spec.input.idempotency_key, method: "sendPhoto", request_fingerprint: spec.hash, result }]);
    const grants = await sqlQuery(`select id,bot_id,chat_id,bucket_id,object_path,content_type,byte_size,
      consumed_message_id,consumed_at,created_at from private.bot_upload_grants
      where bot_id='${q.bot}' and bucket_id='chat-media' and object_path=${quote(spec.path)}`);
    assert.equal(grants.length, 1); const grant = grants[0]; assert.match(grant.id, uuid);
    assert.ok(Number.isFinite(Date.parse(grant.consumed_at))); assert.ok(Number.isFinite(Date.parse(grant.created_at)));
    assert.deepEqual(grant, { id: grant.id, bot_id: q.bot, chat_id: q.sourceChat, bucket_id: "chat-media",
      object_path: spec.path, content_type: "image/png", byte_size: 68, consumed_message_id: result.message_id,
      consumed_at: grant.consumed_at, created_at: grant.created_at });
    assert.deepEqual(await sqlQuery(`select grant_id,generation_id,issued_at from private.bot_media_grant_bindings
      where generation_id=${quote(control.initialIdentity.generation_id)}`),
    [{ grant_id: grant.id, generation_id: control.initialIdentity.generation_id, issued_at: grant.created_at }]);
    await effects(spec, 1); await metadata(spec); await assertDelta(control.before, commitDelta);
    return row;
  };

  const open = (spec, { failB = false, failALate = false } = {}) => {
    const reached = deferred(), release = deferred();
    const unknown = new TypeError("Fictional deferred old PUT outcome unknown");
    const injected = new assert.AssertionError({ message: "injected B assertion while fictional A is outstanding" });
    const lateInjected = new assert.AssertionError({ message: "independent late fictional A assertion" });
    const control = { calls: [], puts: [], downloads: [], failures: [], leases: {}, pendingAttempts: {}, jobs: [],
      initialReceipt: null, initialIdentity: null, initialAttempt: null, before: null,
      oldSettled: false, cleanup: null, injected, lateInjected, release };
    controls.push(control);
    const guard = body => track(pendingAdapters, (async () => {
      try { return await body(); }
      catch (error) { if (error !== unknown) control.failures.push(error); throw error; }
    })());
    const guardSync = body => {
      try { return body(); }
      catch (error) { control.failures.push(error); throw error; }
    };
    const handlers = Object.fromEntries(["A", "B"].map(actor => {
      const repository = createBotMethodRepository({
        rpc: (name, args) => guard(async () => {
          assert.ok(pipeline.includes(name), "only real inline reserve/begin/finish/commit RPCs");
          assert.equal(args.p_bot_id, q.bot); assert.equal(args.p_idempotency_key, spec.input.idempotency_key);
          const base = { p_bot_id: q.bot, p_idempotency_key: spec.input.idempotency_key };
          if (name === "bot_media_upload_finish_internal") {
            assert.equal(args.p_attempt_id, control.leases[actor]);
            assert.ok(["acknowledged", "unknown"].includes(args.p_outcome));
            assert.deepEqual(args, { ...base, p_attempt_id: control.leases[actor], p_outcome: args.p_outcome });
          } else if (name === "bot_media_ingest_commit_internal") {
            assert.deepEqual(args, { ...base, p_token_id: tokenId, p_request_fingerprint: spec.hash,
              p_lease_id: control.leases[actor], p_payload: { media_bucket: "chat-media", media_path: spec.path,
                media_metadata: { mime_type: "image/png", size: 68, size_bytes: 68, kind: "image" } } });
          } else {
            assert.match(args.p_lease_id, uuid);
            if (name === "bot_media_upload_begin_internal") assert.equal(args.p_lease_id, control.leases[actor]);
            assert.deepEqual(args, { ...base, p_token_id: tokenId, p_chat_id: q.sourceChat,
              ...(name === "bot_media_ingest_reserve_internal" ? { p_method: "sendPhoto" } : {}),
              p_request_fingerprint: spec.hash, p_lease_id: args.p_lease_id, p_object_path: spec.path,
              p_content_type: "image/png", p_byte_size: 68, p_content_sha256: pngSha });
          }
          const call = { actor, name, args: structuredClone(args) }; control.calls.push(call);
          if (name === "bot_media_ingest_commit_internal" && actor === "A") call.beforeDigest = await stateDigest();
          const response = await http("POST", "/rpc/" + name, args, "service_role");
          call.status = response.status; call.data = response.data; call.error = response.error;
          // A transport/setup assertion is never synthesized into a permission refusal.
          if (response.status !== 200) {
            assert.equal(actor, "A"); assert.equal(name, "bot_media_ingest_commit_internal");
            assert.equal(args.p_lease_id, control.leases.A); assert.equal(response.status, 403);
            assert.equal(response.error?.code, "42501"); assert.equal(response.error?.message, "bot_ingest_lease_invalid");
            assert.equal(response.data, null);
            return { data: response.data, error: response.error };
          }
          assert.ok(!response.error);
          if (name === "bot_media_ingest_reserve_internal") {
            assert.equal(typeof response.data?.duplicate, "boolean");
            if (!response.data.duplicate) {
              assert.deepEqual(response.data, { duplicate: false, result: null, lease_id: args.p_lease_id });
              assert.equal(control.leases[actor], undefined, "only one actual reservation per caller");
              control.leases[actor] = args.p_lease_id;
            } else assert.deepEqual(response.data, { duplicate: true, result: control.currentResult, lease_id: null });
          }
          if (name === "bot_media_upload_begin_internal") {
            assert.deepEqual(response.data, { attempt_id: control.leases[actor], state: "pending" });
          }
          if (name === "bot_media_upload_finish_internal") {
            assert.deepEqual(response.data, { attempt_id: control.leases[actor], state: args.p_outcome });
          }
          if (name === "bot_media_ingest_commit_internal") {
            assert.equal(actor, "B"); assert.equal(response.data?.duplicate, false);
          }
          return { data: response.data, error: response.error };
        }),
        storage: { from: bucket => guardSync(() => {
          assert.equal(bucket, "chat-media");
          return {
            upload: (path, body, options) => guard(async () => {
              assert.equal(path, spec.path); assert.ok(Buffer.isBuffer(body)); assert.deepEqual(body, bytes);
              assert.equal(sha(body), pngSha); assert.deepEqual(options, { contentType: "image/png", upsert: false });
              const lease = control.leases[actor], current = await receipt(spec); assertReserved(current, spec);
              assert.equal(current.lease_id, lease);
              const rows = await sqlQuery(`select to_jsonb(a) as value from private.bot_media_upload_attempts a
                where ${where(spec)} and attempt_id=${quote(lease)}`);
              assert.equal(rows.length, 1); const pending = rows[0].value;
              assert.deepEqual({ state: pending.state, observed_at: pending.observed_at,
                byte_size: pending.byte_size, content_sha256: pending.content_sha256 },
              { state: "pending", observed_at: null, byte_size: 68, content_sha256: pngSha },
                "real begin committed pending before any fake PUT");
              control.pendingAttempts[actor] = pending;
              const put = { actor, lease, path, hash: pngSha, outcome: null }; control.puts.push(put);
              if (actor === "A") {
                reached.release();
                // Only the scenario may release A; a slow B/check must not invent
                // provider terminality. Finally owns the separate 20s cleanup bound.
                const terminal = await release.promise;
                if (terminal === "unknown") { put.outcome = "unknown"; throw failALate ? lateInjected : unknown; }
                assert.equal(terminal, "409"); await metadata(spec); put.outcome = 409;
                return { data: null, error: { statusCode: "409", message: "Fictional object already exists" } };
              }
              control.takeoverReceipt = current;
              assert.deepEqual({ ...current, lease_id: control.initialReceipt.lease_id,
                lease_expires_at: control.initialReceipt.lease_expires_at }, control.initialReceipt,
              "B takes only the exact expired lease, preserving the entire initial accounting receipt");
              assert.equal(control.oldSettled, false); assert.equal(control.puts[0].outcome, null);
              if (failB) { put.outcome = "unknown"; throw injected; }
              assert.equal(objects.has(path), false, "fake overwrite is forbidden");
              const [absent] = await sqlQuery(`select count(*)::int as n from storage.objects where ${objectWhere(spec)}`);
              assert.equal(absent.n, 0, "never overwrite or adopt copied objects");
              await idleExec(`insert into storage.objects(bucket_id,name,metadata)
                values ('chat-media',${quote(path)},'{"mimetype":"image/png","size":68}'::jsonb);`);
              objects.set(path, { bytes: Buffer.from(body), hash: pngSha }); put.outcome = 200;
              return { data: { path }, error: null };
            }),
            download: (path, options, parameters) => guardSync(() => {
              assert.equal(actor, "A"); assert.equal(path, spec.path); assert.deepEqual(options, {});
              assert.equal(parameters.cache, "no-store"); assert.ok(parameters.signal instanceof AbortSignal);
              assert.equal(parameters.signal.aborted, false);
              const download = { delivered: 0, chunks: 0, hash: null, signal: parameters.signal };
              control.downloads.push(download);
              return { asStream: () => guard(async () => {
                await metadata(spec); const stored = objects.get(path), hash = createHash("sha256");
                return { error: null, data: new ReadableStream({ pull(controller) {
                  guardSync(() => {
                    const end = download.chunks === 0 ? 17 : 68;
                    const chunk = stored.bytes.subarray(download.delivered, end);
                    download.delivered += chunk.length; download.chunks++; hash.update(chunk);
                    controller.enqueue(Uint8Array.from(chunk));
                    if (download.delivered === 68) { download.hash = hash.digest("hex"); controller.close(); }
                  });
                } }, { highWaterMark: 0 }) };
              }) };
            }),
            update: () => guardSync(() => assert.fail("fake overwrite is forbidden")),
            remove: () => guardSync(() => assert.fail("fake remove is forbidden")),
          };
        }) },
      });
      return [actor, createMessageHandlers(repository, fingerprint,
        () => guard(async () => assert.fail("inline photo must not publish a chat action")))];
    }));
    const invoke = actor => {
      const promise = (async () => {
        let response;
        const requestId = "fictional-deferred-http-" + actor;
        try {
          const result = await handlers[actor].sendPhoto({ bot: { botId: q.bot, tokenId }, requestId }, structuredClone(spec.input));
          response = { status: 200, body: { ok: true, result } };
        } catch (error) { response = toBotApiErrorResponse(error, requestId); }
        // Outside the public mapper: swallowed adapter failures still reject the job.
        if (control.failures.length) throw control.failures[0];
        return response;
      })();
      if (actor === "A") promise.then(() => { control.oldSettled = true; }, () => { control.oldSettled = true; });
      control.jobs.push(promise); return track(pendingJobs, promise);
    };
    return { spec, control, reached, release, invoke };
  };

  const settle = async (jobs, label, includeBodies = false) => {
    const start = performance.now(), deadline = start + cleanupBoundMs;
    await bounded(Promise.allSettled([...jobs, ...(includeBodies ? [...pendingBodies] : [])]),
      deadline - performance.now(), label + " jobs/bodies");
    while (pendingIo.size || pendingAdapters.size) {
      const remaining = deadline - performance.now(); assert.ok(remaining > 0, "literal 20s cleanup deadline");
      await bounded(Promise.allSettled([...pendingIo, ...pendingAdapters]), remaining, label + " transports/adapters");
    }
    assert.equal(pendingJobs.size, 0); assert.equal(pendingIo.size, 0); assert.equal(pendingAdapters.size, 0);
    if (includeBodies) assert.equal(pendingBodies.size, 0);
    const milliseconds = Math.ceil(performance.now() - start);
    assert.ok(milliseconds < 20_000, "release/settling is bounded on failure, before operator teardown");
    return { settled: true, milliseconds, boundMs: 20_000, outstandingJobs: 0, outstandingAdapters: 0, outstandingIo: 0 };
  };
  const run = async (name, body) => {
    let invocations = 0, bodyPromise, checkFailure, bodyFailure;
    try {
      await check(name, () => {
        invocations++;
        if (invocations !== 1) return track(pendingBodies, Promise.reject(new assert.AssertionError({
          message: "check must run a body exactly once" })));
        bodyPromise = track(pendingBodies, Promise.resolve().then(body)); return bodyPromise;
      });
    } catch (error) { checkFailure = { error }; }
    // A callback which returns early or catches the rejection cannot bypass the body.
    if (bodyPromise) { try { await bodyPromise; } catch (error) { bodyFailure = { error }; } }
    if (bodyFailure) throw bodyFailure.error;
    if (checkFailure) throw checkFailure.error;
    assert.equal(invocations, 1, "check cannot skip, swallow or repeat its body");
    assert.ok(bodyPromise); done.push(name);
  };
  const envelope = (response, status, code, message) => assert.deepEqual(response, { status,
    body: { ok: false, error: { code, message, request_id: "fictional-deferred-http-A" } } },
  "literal public status/error with no invented retry hint");
  const sameReserve = (first, repeat) => {
    assert.notEqual(first.p_lease_id, repeat.p_lease_id);
    assert.deepEqual({ ...repeat, p_lease_id: first.p_lease_id }, first);
  };
  const scenario = async (f, terminal) => {
    const { control, spec } = f;
    try {
      control.before = await counts();
      const oldCall = f.invoke("A");
      await bounded(Promise.race([f.reached.promise, oldCall.then(() => {
        assert.fail("A settled before reaching deferred fictional PUT");
      })]), 10_000, "real A begin/deferred PUT barrier");
      control.initialReceipt = await receipt(spec); assertReserved(control.initialReceipt, spec);
      assert.equal(control.initialReceipt.lease_id, control.leases.A);
      control.initialIdentity = await identity(spec, control.initialReceipt);
      [control.initialAttempt] = await assertAttempts(f, [["A", "pending"]]);
      await effects(spec, 0); await assertDelta(control.before, { ...chargeDelta, attempts: 1, attempt_bindings: 1 });
      assert.equal(control.oldSettled, false); assert.equal(control.puts[0].outcome, null);
      await idleExec(`update private.bot_media_ingests set lease_expires_at=clock_timestamp()-interval '1 second'
        where ${where(spec)} and owner_token_id='${tokenId}' and state='reserved'
          and object_path=${quote(spec.path)} and lease_id=${quote(control.leases.A)};
        if not found then raise exception 'fictional_deferred_http_expiry_missing'; end if;`);
      const current = await bounded(f.invoke("B"), 20_000, "real B takeover/commit");
      assert.equal(current.status, 200); assert.equal(current.body.ok, true);
      assert.notEqual(control.leases.B, control.leases.A); control.currentResult = current.body.result;
      const complete = await assertCommitted(f, current.body.result);
      const overlap = await assertAttempts(f, [["A", "pending"], ["B", "acknowledged"]]);
      assert.deepEqual(overlap.find(row => row.attempt_id === control.leases.A), control.initialAttempt);
      assert.equal(control.oldSettled, false, "B committed while A is still outstanding");
      assert.equal(control.puts[0].outcome, null);
      f.release.release(terminal);
      const old = await bounded(oldCall, 20_000, "old fictional A final observation/commit");
      const after = await assertAttempts(f, [["A", terminal === "409" ? "acknowledged" : "unknown"], ["B", "acknowledged"]]);
      assert.deepEqual(after.find(row => row.attempt_id === control.leases.B),
        overlap.find(row => row.attempt_id === control.leases.B), "A never mutates B's exact attempt");
      const oldAttempt = after.find(row => row.attempt_id === control.leases.A);
      assert.deepEqual({ ...oldAttempt, state: "pending", observed_at: null }, control.initialAttempt,
        "A preserves its original identity and started_at, changing only the observation");
      assert.deepEqual(await receipt(spec), complete, "late A cannot erase B's receipt or initial charge time");
      await assertCommitted(f, current.body.result);
      const callsA = control.calls.filter(call => call.actor === "A"), callsB = control.calls.filter(call => call.actor === "B");
      assert.deepEqual(callsB.map(call => call.name), pipeline); assert.deepEqual(callsB.map(call => call.status), [200, 200, 200, 200]);
      assert.equal(callsB[2].args.p_outcome, "acknowledged");
      assert.deepEqual(callsB[3].data, { duplicate: false, result: current.body.result });
      sameReserve(callsA[0].args, callsB[0].args);
      if (terminal === "409") {
        assert.deepEqual(callsA.map(call => call.name), pipeline);
        assert.deepEqual(callsA.map(call => call.status), [200, 200, 200, 403]);
        assert.equal(callsA[2].args.p_outcome, "acknowledged");
        assert.equal(callsA[3].error.code, "42501"); assert.equal(callsA[3].error.message, "bot_ingest_lease_invalid");
        assert.equal(callsA[3].args.p_lease_id, control.leases.A);
        assert.equal(await stateDigest(), callsA[3].beforeDigest, "stale actual commit has no effects");
        envelope(old, 403, "forbidden", "Forbidden");
        assert.equal(control.downloads.length, 1);
        const download = control.downloads[0]; assert.equal(download.delivered, 68); assert.equal(download.chunks, 2);
        assert.equal(download.hash, pngSha); assert.equal(download.signal.aborted, true);
      } else {
        assert.deepEqual(callsA.map(call => call.name), pipeline.slice(0, 3));
        assert.deepEqual(callsA.map(call => call.status), [200, 200, 200]);
        assert.equal(callsA[2].args.p_outcome, "unknown");
        envelope(old, 500, "internal_error", "Internal server error"); assert.equal(control.downloads.length, 0);
      }
      const beforeRetry = await stateDigest(), beforeAttempts = await attempts(spec), putCount = control.puts.length;
      assert.deepEqual(await bounded(f.invoke("B"), 20_000, "cached public repeat"), current);
      const cached = control.calls.filter(call => call.actor === "B").slice(4);
      assert.equal(cached.length, 1); assert.equal(cached[0].name, pipeline[0]); assert.equal(cached[0].status, 200);
      assert.deepEqual(cached[0].data, { duplicate: true, result: current.body.result, lease_id: null });
      sameReserve(callsB[0].args, cached[0].args);
      assert.equal(control.puts.length, putCount); assert.deepEqual(await attempts(spec), beforeAttempts);
      assert.deepEqual(await receipt(spec), complete); assert.equal(await stateDigest(), beforeRetry);
      assert.deepEqual(control.puts.map(put => [put.actor, put.lease, put.outcome]),
        [["A", control.leases.A, terminal === "409" ? 409 : "unknown"], ["B", control.leases.B, 200]]);
      await assertCommitted(f, current.body.result); assert.deepEqual(control.failures, []);
    } finally {
      f.release.release("unknown"); control.cleanup = await settle(control.jobs, "deferred scenario cleanup");
    }
  };
  const assertOnlyInjectedFailure = f => assert.deepEqual(f.control.failures, [f.control.injected],
    "only the deliberate B assertion is permitted after all jobs/adapters/SQL settle");
  const faultControl = async (spec, failALate) => {
    const f = open(spec, { failB: true, failALate }), { control } = f;
    await assert.rejects(scenario(f, "409"), error => error === control.injected);
    assert.equal(control.cleanup.settled, true); assert.ok(control.cleanup.milliseconds < 20_000);
    assert.deepEqual(await Promise.allSettled(control.jobs), [
      { status: "rejected", reason: control.injected }, { status: "rejected", reason: control.injected },
    ], "both jobs reject outside public mapping, including A released by finally");
    if (failALate) {
      assert.deepEqual(control.failures, [control.injected, control.lateInjected], "independent late A failure retained");
      assert.throws(() => assertOnlyInjectedFailure(f), error => error instanceof assert.AssertionError &&
        error.code === "ERR_ASSERTION" && error.actual === control.failures &&
        error.expected.length === 1 && error.expected[0] === control.injected,
      "the one-expected-error oracle must go RED for the independent late A assertion");
    } else assertOnlyInjectedFailure(f);
    assert.notEqual(control.leases.A, control.leases.B);
    await assertAttempts(f, [["A", "unknown"], ["B", "unknown"]]);
    const held = await receipt(spec); assertReserved(held, spec); assert.equal(held.lease_id, control.leases.B);
    assert.equal(held.created_at, control.initialReceipt.created_at);
    assert.deepEqual(held, control.takeoverReceipt, "both unknown observations leave the entire charged B reservation intact");
    assert.deepEqual(await identity(spec, control.initialReceipt), control.initialIdentity);
    await effects(spec, 0);
    assert.deepEqual(await sqlQuery(`select name from storage.objects where ${objectWhere(spec)}`), []);
    assert.equal(objects.has(spec.path), false); assert.equal(control.downloads.length, 0);
    await assertDelta(control.before, { ...chargeDelta, attempts: 2, attempt_bindings: 2 });
    for (const actor of ["A", "B"]) {
      const calls = control.calls.filter(call => call.actor === actor);
      assert.deepEqual(calls.map(call => call.name), pipeline.slice(0, 3));
      assert.deepEqual(calls.map(call => call.status), [200, 200, 200]);
      assert.equal(calls[2].args.p_outcome, "unknown");
    }
    sameReserve(control.calls.find(call => call.actor === "A").args, control.calls.find(call => call.actor === "B").args);
    assert.deepEqual(control.puts.map(put => [put.actor, put.lease, put.outcome]),
      [["A", control.leases.A, "unknown"], ["B", control.leases.B, "unknown"]]);
  };

  let baseline, finalCleanup;
  try {
    const state = await http("POST", "/rpc/fixture_http_state", {});
    assert.equal(state.status, 200); assert.ok(!state.error);
    assert.deepEqual(state.data, { role: "authenticated", actor: q.actor, isolation: "read committed", readonly: "on" });
    assert.deepEqual(await sqlQuery(`select id,bot_id,revoked_at from private.bot_tokens where id='${tokenId}' or bot_id='${q.bot}'`),
      [{ id: tokenId, bot_id: q.bot, revoked_at: null }], "operator must seed only the exact fictional token, never a copied token");
    assert.deepEqual(await sqlQuery(`select bot_id,chat_id from public.chat_bot_members
      where bot_id='${q.bot}' and chat_id='${q.sourceChat}' and removed_at is null`), [{ bot_id: q.bot, chat_id: q.sourceChat }]);
    for (const spec of specs) {
      const [prestate] = await sqlQuery(`select
        (select count(*)::int from private.bot_media_ingests where ${where(spec)}) as receipts,
        (select count(*)::int from private.bot_media_upload_attempts where ${where(spec)}) as attempts,
        (select count(*)::int from private.bot_media_object_identities where ${where(spec)}) as identities,
        (select count(*)::int from private.bot_media_path_claims where bucket_id='chat-media' and object_path=${quote(spec.path)}) as claims,
        (select count(*)::int from storage.objects where ${objectWhere(spec)}) as objects`);
      assert.deepEqual(prestate, { receipts: 0, attempts: 0, identities: 0, claims: 0, objects: 0 }); await effects(spec, 0);
    }
    baseline = await counts();
    await run("HTTP B commits while old A remains outstanding; verified fictional 409 yields actual stale 42501/403", async () => {
      await scenario(open(specs[0]), "409");
    });
    await run("HTTP late A unknown returns 500 with no old commit, preserving B and the charged HOLD attempt", async () => {
      await scenario(open(specs[1]), "unknown");
    });
    await run("HTTP B adapter assertion releases A in finally and both rejected jobs/SQL settle within literal 20s", async () => {
      await faultControl(specs[2], false);
    });
    await run("HTTP independent late A assertion makes the exact one-expected-error cleanup oracle RED", async () => {
      await faultControl(specs[3], true);
    });
    await assertDelta(baseline, { receipts: 4, charged_bytes: 272, bot_receipts: 4, bot_charged_bytes: 272,
      identities: 4, path_claims: 4, attempts: 8, attempt_bindings: 8, grant_bindings: 2,
      objects: 2, messages: 2, grants: 2, operations: 2, deliveries: 2, observations: 2 });
  } finally {
    for (const control of controls) control.release.release("unknown");
    // Bodies/jobs/adapters/SQL share ONE 20s deadline, not sequential allowances.
    finalCleanup = await settle(controls.flatMap(control => control.jobs), "pre-operator-teardown cleanup", true);
  }
  const fictionalPutAttempts = controls.reduce((n, control) => n + control.puts.length, 0);
  const controlledDownloads = controls.reduce((n, control) => n + control.downloads.length, 0);
  assert.equal(done.length, 4); assert.equal(fictionalPutAttempts, 8); assert.equal(controlledDownloads, 1);
  assert.equal(objects.size, 2);
  assert.deepEqual(controls.map(control => control.failures), [[], [], [controls[2].injected],
    [controls[3].injected, controls[3].lateInjected]], "no unexpected late adapter/transport error may be masked");
  return { done, checks: 4, actualInlineHandlerRepository: true, actualPostgrestRpcs: true,
    storageEdge: "controlled-fictional-metadata-and-local-bytes", fictionalPutAttempts, controlledDownloads,
    counts: { newReceipts: 4, chargedBytes: 272, attempts: 8, logicalIdentities: 4, objects: 2,
      messages: 2, grants: 2, deliveries: 2, operations: 2, registeredObservations: 2, cachedRetries: 2 },
    cleanup: { ...finalCleanup, scenarios: controls.map(control => control.cleanup),
      bothRejectedJobsVerified: true, exactInjectedErrorCollectionsVerified: true, lateAssertionOracleRed: true },
    realProviderUploadPerformed: false, providerTerminalityProven: false, physicalGenerationProven: false,
    cleanupOrRefundPerformed: false, automaticRetry: false, sqlCatalogMutated: false,
    gatewayRouterOrAuthProven: false, productionOrMainOrNativePublicationAuthorized: false };
}
