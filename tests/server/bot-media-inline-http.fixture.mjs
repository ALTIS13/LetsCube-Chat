import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createBotMethodRepository } from "../../artifacts/api-server/src/bot/repository.ts";
import { createMessageHandlers } from "../../artifacts/api-server/src/bot/methods/messages.ts";
import { toBotApiErrorResponse } from "../../artifacts/api-server/src/bot/errors.ts";
import { fullSchemaIds as q } from "./bot-media-authority-full-schema.fixture.mjs";

const tokenId = "e5070000-0000-4000-8000-000000000301";
const requestId = "fictional-inline-http";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l7sAAAAASUVORK5CYII=";
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const sha = value => createHash("sha256").update(value).digest("hex");
const fingerprint = (method, input) => sha(JSON.stringify([method, input]));
const inputFor = suffix => ({ chat_id: q.sourceChat, idempotency_key: `fictional-inline-http-${suffix}`,
  photo: { mime_type: "image/png", bytes_base64: png } });
const rpcNames = ["bot_media_ingest_reserve_internal", "bot_media_upload_begin_internal",
  "bot_media_upload_finish_internal", "bot_media_ingest_commit_internal"];
const pipeline = ["bot_media_ingest_reserve_internal", "bot_media_upload_begin_internal",
  "bot_media_upload_finish_internal", "bot_media_ingest_commit_internal"];

// Read-only reusable oracle; spec is {input:{chat_id,idempotency_key},path}.
// Literal semantics from 20261002222251_bot_message_media_references.sql and
// 20261002232331_bot_message_media_observations.sql, never a resolver RPC call.
export async function assertInlineDeliveryLinks({ query }, spec, result) {
  assert.equal(spec.input.chat_id, q.sourceChat);
  assert.equal(result.chat_id, q.sourceChat); assert.equal(result.bot_id, q.bot); assert.equal(result.type, "image");
  assert.match(result.message_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(spec.path, new RegExp(`^${q.sourceChat}/bots/${q.bot}/[0-9a-f]{64}\\.png$`));
  const key = spec.input.idempotency_key;
  const deliveries = await query(`select bot_id,idempotency_key,method,message_id
    from private.bot_message_idempotency where bot_id='${q.bot}' and idempotency_key=${quote(key)}`);
  assert.deepEqual(deliveries, [{ bot_id: q.bot, idempotency_key: key, method: "sendPhoto",
    message_id: result.message_id }], "exact inline delivery ledger points to the returned message");

  const identities = await query(`select generation_id,bot_id,idempotency_key,chat_id,method,bucket_id,object_path
    from private.bot_media_object_identities where bot_id='${q.bot}' and idempotency_key=${quote(key)}`);
  assert.equal(identities.length, 1, "one independent logical identity for the exact admission");
  const generation = identities[0].generation_id;
  assert.match(generation, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(identities, [{ generation_id: generation, bot_id: q.bot, idempotency_key: key,
    chat_id: q.sourceChat, method: "sendPhoto", bucket_id: "chat-media", object_path: spec.path }],
  "logical generation belongs to the exact inline object, not the observation under test");

  // Filter only by returned message: wrong paths/kinds/generations must remain
  // visible to the assertion instead of being excluded by the query predicate.
  const observations = await query(`select message_id,source_kind,bucket_id,object_path,
    reference_state,generation_id,hold_reason from private.bot_message_media_observations
    where message_id=${quote(result.message_id)} order by source_kind`);
  assert.deepEqual(observations, [{ message_id: result.message_id, source_kind: "canonical",
    bucket_id: "chat-media", object_path: spec.path, reference_state: "registered",
    generation_id: generation, hold_reason: null }], "literal canonical observation links this message to its own logical object");
}

// Contract matches gatewayHttp: request(method, path, body, role) returns
// {status,data,error}; query(sql) returns rows; exec(sql) is an idle privileged
// session. blocker has independent exec/query; digest covers application rows,
// functions and triggers; check(name, body) must run body and propagate failure.
// The coordinator supplies a fresh owned full PG17 copy, fullSchemaSeed, combined
// coverage/preflight SQL and fixture_http_state. No DDL, host, key or runtime is
// selected here. Storage is ONLY a controlled fake: SQL metadata + local bytes,
// not a provider PUT, physical generation, terminality or reclamation proof.
export async function runBotMediaInlineHttpAcceptance({ request, query, exec, blocker, digest, check }) {
  for (const dep of [request, query, exec, digest, check, blocker?.exec, blocker?.query]) {
    assert.equal(typeof dep, "function", "coordinator supplies every transport/session dependency");
  }
  const done = [], objects = new Map(), adapters = [];
  const bytes = Buffer.from(png, "base64");
  assert.equal(bytes.length, 68, "literal fictional PNG charge");
  assert.equal(bytes.readUInt32BE(16), 1); assert.equal(bytes.readUInt32BE(20), 1);
  const specifications = ["busy", "lost", "unknown"].map(suffix => {
    const input = inputFor(suffix), hash = fingerprint("sendPhoto", input);
    return { input, hash, path: `${q.sourceChat}/bots/${q.bot}/${hash}.png` };
  });
  const [busySpec, lostSpec, unknownSpec] = specifications;
  const where = spec => `bot_id=${quote(q.bot)} and idempotency_key=${quote(spec.input.idempotency_key)}`;

  // Refuse an exec already inside a transaction: HTTP must see committed metadata
  // and must never wait on our own SQL session's receipt/object locks.
  const idleExec = sql => exec(`do $fixture_inline_http$ begin
    if exists (select 1 from pg_catalog.pg_stat_activity where pid=pg_backend_pid()
      and xact_start is distinct from query_start) then
      raise exception 'fictional_inline_http_exec_not_idle';
    end if;
    ${sql}
  end; $fixture_inline_http$;`);
  const run = async (name, body) => {
    let passed = false;
    await check(name, async () => { await body(); passed = true; });
    assert.ok(passed, "check cannot swallow an assertion or omit its body"); done.push(name);
  };
  const receipt = async spec => {
    const found = await query(`select to_jsonb(i) as value from private.bot_media_ingests i where ${where(spec)}`);
    assert.equal(found.length, 1, "exact fictional charged receipt"); return found[0].value;
  };
  const attempts = async spec => (await query(`select to_jsonb(a) as value
    from private.bot_media_upload_attempts a where ${where(spec)} order by started_at,attempt_id`)).map(row => row.value);
  const accounting = async () => (await query(`select count(*)::int as global_count,
    coalesce(sum(byte_size),0)::bigint::text as global_bytes,
    count(*) filter (where bot_id='${q.bot}')::int as bot_count,
    coalesce(sum(byte_size) filter (where bot_id='${q.bot}'),0)::bigint::text as bot_bytes
    from private.bot_media_ingests`))[0];
  const charged = async (before, count) => {
    const after = await accounting();
    assert.equal(after.global_count, before.global_count + count);
    assert.equal(after.bot_count, before.bot_count + count);
    assert.equal(BigInt(after.global_bytes), BigInt(before.global_bytes) + BigInt(68 * count));
    assert.equal(BigInt(after.bot_bytes), BigInt(before.bot_bytes) + BigInt(68 * count));
  };
  const effects = async (spec, expected) => {
    const [row] = await query(`select
      (select count(*)::int from public.messages where media_bucket='chat-media'
        and media_path=${quote(spec.path)}) as messages,
      (select count(*)::int from private.bot_operation_idempotency where ${where(spec)}) as operations,
      (select count(*)::int from private.bot_message_idempotency where ${where(spec)}) as deliveries,
      (select count(*)::int from private.bot_upload_grants where bot_id='${q.bot}'
        and bucket_id='chat-media' and object_path=${quote(spec.path)}) as grants,
      (select count(*)::int from private.bot_message_media_observations o join public.messages m on m.id=o.message_id
        where m.media_bucket='chat-media' and m.media_path=${quote(spec.path)}) as observations`);
    assert.deepEqual(row, { messages: expected, operations: expected, deliveries: expected,
      grants: expected, observations: expected }, "literal delivery/grant/observation effects for exact path/key");
  };
  const assertIdentity = (row, spec) => {
    for (const [column, expected] of Object.entries({ bot_id: q.bot, owner_token_id: tokenId,
      chat_id: q.sourceChat, method: "sendPhoto", idempotency_key: spec.input.idempotency_key,
      request_fingerprint: spec.hash, object_path: spec.path, content_type: "image/png", content_sha256: sha(bytes) })) {
      assert.equal(row[column], expected, "immutable fictional " + column);
    }
    assert.equal(Number(row.byte_size), 68);
  };
  const assertReserved = (row, spec) => {
    assertIdentity(row, spec); assert.equal(row.state, "reserved");
    assert.equal(row.result, null); assert.equal(row.completed_at, null); assert.equal(row.commit_xid, null);
  };
  const assertAttempts = async (spec, states, leases) => {
    const found = await attempts(spec); assert.equal(found.length, states.length);
    for (let i = 0; i < found.length; i++) {
      const row = found[i];
      for (const [column, expected] of Object.entries({ bot_id: q.bot, owner_token_id: tokenId,
        chat_id: q.sourceChat, idempotency_key: spec.input.idempotency_key, request_fingerprint: spec.hash,
        object_path: spec.path, content_type: "image/png", content_sha256: sha(bytes),
        attempt_id: leases[i], state: states[i] })) assert.equal(row[column], expected, "actual upload intent identity");
      assert.equal(Number(row.byte_size), 68);
      assert.ok(Number.isFinite(Date.parse(row.started_at)));
      assert.ok(Number.isFinite(Date.parse(row.observed_at)), "real finish persisted its observation");
    }
    return found;
  };
  const metadata = async spec => {
    const found = await query(`select name,metadata from storage.objects
      where bucket_id='chat-media' and name=${quote(spec.path)}`);
    assert.deepEqual(found, [{ name: spec.path, metadata: { mimetype: "image/png", size: 68 } }]);
    const stored = objects.get(spec.path); assert.ok(stored);
    assert.equal(stored.bytes.length, 68); assert.equal(stored.hash, sha(bytes));
    assert.ok(stored.bytes.equals(bytes), "locally recorded fictional bytes, not provider evidence");
  };
  const assertCommitted = async (spec, result) => {
    assert.equal(result.chat_id, q.sourceChat); assert.equal(result.bot_id, q.bot); assert.equal(result.type, "image");
    const found = await query(`select id,chat_id,bot_id,user_id,type,media_bucket,media_path,media_metadata
      from public.messages where media_bucket='chat-media' and media_path=${quote(spec.path)}`);
    assert.equal(found.length, 1); assert.equal(found[0].id, result.message_id);
    assert.deepEqual({ ...found[0], id: undefined }, { id: undefined, chat_id: q.sourceChat, bot_id: q.bot,
      user_id: null, type: "image", media_bucket: "chat-media", media_path: spec.path,
      media_metadata: { mime_type: "image/png", size: 68, size_bytes: 68, kind: "image" } });
    const row = await receipt(spec); assertIdentity(row, spec); assert.equal(row.state, "complete");
    assert.equal(row.commit_xid, null); assert.ok(Number.isFinite(Date.parse(row.completed_at)));
    assert.deepEqual(row.result, result); await assertInlineDeliveryLinks({ query }, spec, result);
    await effects(spec, 1); await metadata(spec);
    const ledgers = await query(`select method,request_fingerprint,result from private.bot_operation_idempotency
      where ${where(spec)}`);
    assert.deepEqual(ledgers, [{ method: "sendPhoto", request_fingerprint: spec.hash, result }]);
    return row;
  };
  const open = (spec, { loseCommitResponse = false, unknownUpload = false } = {}) => {
    const control = { calls: [], puts: [], downloads: [], failures: [], lossInjected: false };
    adapters.push(control);
    const responseLost = new TypeError("Fictional inline HTTP response lost after real commit");
    const storageUnknown = new TypeError("Fictional Storage outcome unknown");
    const guard = async body => {
      try { return await body(); }
      catch (error) {
        if (error !== responseLost && error !== storageUnknown) control.failures.push(error);
        throw error;
      }
    };
    const repository = createBotMethodRepository({
      rpc: (name, args) => guard(async () => {
        assert.ok(rpcNames.includes(name), "only the real inline RPC pipeline is permitted");
        assert.equal(args.p_bot_id, q.bot); assert.equal(args.p_idempotency_key, spec.input.idempotency_key);
        if ("p_chat_id" in args) assert.equal(args.p_chat_id, q.sourceChat);
        if ("p_token_id" in args) assert.equal(args.p_token_id, tokenId);
        if ("p_request_fingerprint" in args) assert.equal(args.p_request_fingerprint, spec.hash);
        if ("p_object_path" in args) assert.equal(args.p_object_path, spec.path);
        const call = { name, args: structuredClone(args) }; control.calls.push(call);
        if (name === "bot_media_ingest_commit_internal") call.beforeDigest = await digest();
        const result = await request("POST", "/rpc/" + name, args, "service_role");
        assert.equal(typeof result.status, "number");
        assert.ok(result.status >= 400 ? result.error && typeof result.error.code === "string" : !result.error,
          "transport must return the real SQL error, not a synthesized permission denial");
        call.status = result.status; call.error = result.error; call.data = result.data;
        if (loseCommitResponse && name === "bot_media_ingest_commit_internal" && !control.lossInjected) {
          assert.equal(result.status, 200); assert.equal(result.data.duplicate, false);
          control.lossInjected = true; throw responseLost;
        }
        return { data: result.data, error: result.error };
      }),
      storage: { from(bucket) {
        // from() is synchronous and is also caught by repository.ts.
        try { assert.equal(bucket, "chat-media"); }
        catch (error) { control.failures.push(error); throw error; }
        return {
          upload: (path, body, options) => guard(async () => {
            assert.equal(path, spec.path); assert.deepEqual(options, { contentType: "image/png", upsert: false });
            assert.ok(Buffer.isBuffer(body)); assert.equal(body.length, 68); assert.ok(body.equals(bytes));
            const call = { path, hash: sha(body), outcome: null }; control.puts.push(call);
            const current = await receipt(spec); assertReserved(current, spec);
            const pending = await attempts(spec), attempt = pending.at(-1);
            assert.equal(attempt.state, "pending"); assert.equal(attempt.attempt_id, current.lease_id);
            assert.equal(attempt.observed_at, null); assert.equal(attempt.content_sha256, call.hash);
            if (objects.has(path)) {
              await metadata(spec); call.outcome = 409;
              return { data: null, error: { statusCode: "409", message: "Fictional object already exists" } };
            }
            const [absent] = await query(`select count(*)::int as n from storage.objects
              where bucket_id='chat-media' and name=${quote(path)}`);
            assert.equal(absent.n, 0, "never adopt or overwrite an object copied into the database");
            await idleExec(`insert into storage.objects(bucket_id,name,metadata)
              values ('chat-media',${quote(path)},'{"mimetype":"image/png","size":68}'::jsonb);`);
            objects.set(path, { bytes: Buffer.from(body), hash: call.hash });
            if (unknownUpload) { call.outcome = "unknown"; throw storageUnknown; }
            call.outcome = 200; return { data: { path }, error: null };
          }),
          download(path, options, fetchOptions) {
            return { asStream: () => guard(async () => {
              assert.equal(path, spec.path); assert.deepEqual(options, {});
              assert.equal(fetchOptions.cache, "no-store"); assert.ok(fetchOptions.signal instanceof AbortSignal);
              assert.equal(fetchOptions.signal.aborted, false);
              const stored = objects.get(path); assert.ok(stored); await metadata(spec);
              const call = { path, delivered: 0, chunks: 0, hash: null }; control.downloads.push(call);
              const hash = createHash("sha256");
              // No prefetch: counters describe the actual repository's read loop,
              // not bytes eagerly enqueued by the fake before anybody reads them.
              return { error: null, data: new ReadableStream({ pull(controller) {
                const chunk = stored.bytes.subarray(call.delivered, call.chunks === 0 ? 17 : 68);
                controller.enqueue(Uint8Array.from(chunk));
                call.delivered += chunk.length; call.chunks++; hash.update(chunk);
                if (call.delivered === 68) { call.hash = hash.digest("hex"); controller.close(); }
              } }, { highWaterMark: 0 }) };
            }) };
          },
        };
      } },
    });
    const handlers = createMessageHandlers(repository, fingerprint, async () => {
      const error = new Error("fictional inline send must not publish a chat action");
      control.failures.push(error); throw error;
    });
    const assertAdapters = () => {
      if (control.failures.length) throw control.failures[0];
    };
    const invoke = async () => {
      let result, error;
      try { result = await handlers.sendPhoto({ bot: { botId: q.bot, tokenId }, requestId }, structuredClone(spec.input)); }
      catch (caught) { error = caught; }
      assertAdapters();
      return error ? toBotApiErrorResponse(error, requestId) : { status: 200, body: { ok: true, result } };
    };
    return { control, invoke, assertAdapters };
  };
  const envelope = (response, status, code, message, retryAfter) => assert.deepEqual(response,
    { status, body: { ok: false, error: { code, message, request_id: "fictional-inline-http",
      ...(retryAfter === undefined ? {} : { retry_after: retryAfter }) } } }, "literal sanitized Gateway mapper contract");
  const leaseBusy = (response, call) => {
    assert.equal(call.status, 500); assert.equal(call.error.code, "55000");
    assert.equal(call.error.message, "bot_media_ingest_busy"); assert.match(call.error.details, /^[0-9]{1,3}$/);
    const hint = Number(call.error.details); assert.ok(hint >= 1 && hint <= 120);
    envelope(response, 429, "rate_limited", "Too many requests", hint);
  };
  const sameReserve = (first, again) => {
    assert.notEqual(first.p_lease_id, again.p_lease_id, "public repeat obtains a new attempt UUID, not a new identity");
    assert.deepEqual({ ...again, p_lease_id: first.p_lease_id }, first,
      "unchanged public request binds the same actor/chat/key/path/bytes/fingerprint");
  };
  const acquireCoverage = async () => {
    await blocker.exec("begin; select pg_advisory_xact_lock(270311,1);");
    const [lock] = await blocker.query(`select count(*)::int as n from pg_catalog.pg_locks
      where pid=pg_backend_pid() and locktype='advisory' and classid=270311 and objid=1 and objsubid=2
        and mode='ExclusiveLock' and granted`);
    assert.equal(lock.n, 1, "real independent coverage advisory blocker");
  };

  const state = await request("POST", "/rpc/fixture_http_state", {});
  assert.equal(state.status, 200);
  assert.deepEqual(state.data, { role: "authenticated", actor: q.actor, isolation: "read committed", readonly: "on" });
  const [member] = await query(`select count(*)::int as n from public.chat_bot_members
    where bot_id='${q.bot}' and chat_id='${q.sourceChat}' and removed_at is null`);
  assert.equal(member.n, 1, "fictional full-schema sourceChat membership must already exist");
  for (const spec of specifications) {
    const [prestate] = await query(`select
      (select count(*)::int from private.bot_media_ingests where ${where(spec)}) as receipts,
      (select count(*)::int from private.bot_media_upload_attempts where ${where(spec)}) as attempts,
      (select count(*)::int from storage.objects where bucket_id='chat-media' and name=${quote(spec.path)}) as objects`);
    assert.deepEqual(prestate, { receipts: 0, attempts: 0, objects: 0 }); await effects(spec, 0);
  }
  const [tokens] = await query(`select count(*)::int as n from private.bot_tokens where bot_id='${q.bot}' or id='${tokenId}'`);
  assert.equal(tokens.n, 0, "never edit/adopt a copied token; fullSchemaSeed has none");
  // Exact columns/constraints from the tracked foundation migration
  // .migration-backup/supabase/migrations/20260831100000_bot_platform_foundation.sql.
  // No raw token is created, authenticated, returned or included in evidence.
  await idleExec(`insert into private.bot_tokens(id,bot_id,token_prefix,token_hash)
    values ('${tokenId}','${q.bot}','fictional_inline_http',repeat('0',64));`);
  const initialAccounting = await accounting();
  const busy = open(busySpec);
  let initialReceipt, initialAttempt, busyResult;

  await run("inline PNG admitted then actual coverage 55P03 maps to 503/2 without delivery effects", async () => {
    try {
      await acquireCoverage();
      const response = await busy.invoke();
      envelope(response, 503, "service_unavailable", "Service unavailable", 2);
      assert.deepEqual(busy.control.calls.map(call => call.name), pipeline);
      assert.deepEqual(busy.control.calls.map(call => call.status), [200, 200, 200, 500]);
      const commit = busy.control.calls[3];
      assert.equal(commit.error.code, "55P03"); assert.equal(commit.error.message, "fixture_coverage_busy");
      assert.equal(await digest(), commit.beforeDigest, "commit rolled back every message/trigger/grant/ledger effect");
      assert.deepEqual(busy.control.puts.map(call => call.outcome), [200]); assert.equal(busy.control.downloads.length, 0);
      initialReceipt = await receipt(busySpec); assertReserved(initialReceipt, busySpec);
      assert.equal(initialReceipt.lease_id, busy.control.calls[0].args.p_lease_id);
      [initialAttempt] = await assertAttempts(busySpec, ["acknowledged"], [initialReceipt.lease_id]);
      await charged(initialAccounting, 1); await effects(busySpec, 0); await metadata(busySpec);
    } finally { await blocker.exec("rollback;"); }
  });
  await run("immediate unchanged inline public retry hits real 55000/429 active lease with no extra PUT", async () => {
    const before = await digest();
    const response = await busy.invoke(); leaseBusy(response, busy.control.calls.at(-1));
    assert.equal(busy.control.calls.length, 5);
    assert.equal(busy.control.calls.at(-1).name, "bot_media_ingest_reserve_internal");
    sameReserve(busy.control.calls[0].args, busy.control.calls[4].args);
    assert.equal(busy.control.puts.length, 1); assert.equal(busy.control.downloads.length, 0);
    assert.deepEqual(await receipt(busySpec), initialReceipt);
    assert.deepEqual(await attempts(busySpec), [initialAttempt]);
    assert.equal(await digest(), before); await charged(initialAccounting, 1); await effects(busySpec, 0);
  });
  await run("explicit fictional lease expiry retries the same 409 object via controlled download/hash and commits once", async () => {
    await idleExec(`update private.bot_media_ingests set lease_expires_at=clock_timestamp()-interval '1 second'
      where ${where(busySpec)} and object_path=${quote(busySpec.path)} and state='reserved'
        and lease_id=${quote(initialReceipt.lease_id)};
      if not found then raise exception 'fictional_inline_http_expiry_missing'; end if;`);
    const response = await busy.invoke(); assert.equal(response.status, 200); assert.equal(response.body.ok, true);
    busyResult = response.body.result;
    assert.deepEqual(busy.control.calls.slice(5).map(call => call.name), pipeline);
    assert.deepEqual(busy.control.calls.slice(5).map(call => call.status), [200, 200, 200, 200]);
    sameReserve(busy.control.calls[0].args, busy.control.calls[5].args);
    assert.deepEqual(busy.control.puts.map(call => call.outcome), [200, 409]);
    assert.equal(busy.control.downloads.length, 1); assert.equal(busy.control.downloads[0].delivered, 68);
    assert.equal(busy.control.downloads[0].chunks, 2);
    assert.equal(busy.control.downloads[0].hash, sha(bytes));
    const complete = await assertCommitted(busySpec, busyResult);
    assert.equal(complete.created_at, initialReceipt.created_at, "initial accounting time survives lease rotation/commit");
    assert.equal(complete.byte_size, initialReceipt.byte_size); assert.equal(complete.lease_id, busy.control.calls[5].args.p_lease_id);
    assert.deepEqual(busy.control.calls[8].args.p_payload, busy.control.calls[3].args.p_payload);
    const found = await assertAttempts(busySpec, ["acknowledged", "acknowledged"], [initialReceipt.lease_id, complete.lease_id]);
    assert.deepEqual(found[0], initialAttempt, "initial intent observation preserved, never overwritten");
    await charged(initialAccounting, 1);
  });
  await run("cached inline success has no extra PUT and current revoked membership refuses the same receipt", async () => {
    const before = await digest(), complete = await receipt(busySpec);
    assert.deepEqual(await busy.invoke(), { status: 200, body: { ok: true, result: busyResult } });
    assert.equal(busy.control.calls.length, 10); assert.equal(busy.control.calls.at(-1).data.duplicate, true);
    assert.equal(await digest(), before);
    try {
      await idleExec(`update public.chat_bot_members set removed_at=clock_timestamp()
        where bot_id='${q.bot}' and chat_id='${q.sourceChat}' and removed_at is null;
        if not found then raise exception 'fictional_inline_http_membership_missing'; end if;`);
      const deniedBefore = await digest();
      envelope(await busy.invoke(), 403, "forbidden", "Forbidden");
      const call = busy.control.calls.at(-1); assert.equal(call.name, "bot_media_ingest_reserve_internal");
      assert.equal(call.status, 403); assert.equal(call.error.code, "42501"); assert.equal(call.error.message, "bot_chat_forbidden");
      assert.equal(busy.control.calls.length, 11); assert.equal(await digest(), deniedBefore);
      assert.deepEqual(await receipt(busySpec), complete);
    } finally {
      await idleExec(`update public.chat_bot_members set removed_at=null where bot_id='${q.bot}' and chat_id='${q.sourceChat}';`);
    }
    assert.equal(busy.control.puts.length, 2); assert.equal(busy.control.downloads.length, 1);
    const [restored] = await query(`select count(*)::int as n from public.chat_bot_members
      where bot_id='${q.bot}' and chat_id='${q.sourceChat}' and removed_at is null`);
    assert.equal(restored.n, 1);
    // Revoke/restore legitimately enqueues fictional membership updates. The
    // denied request above, not those controlled authority changes, is inert.
    await effects(busySpec, 1); await charged(initialAccounting, 1);
  });
  await run("response lost after actual inline commit repeats from the real receipt without another PUT", async () => {
    const lost = open(lostSpec, { loseCommitResponse: true });
    envelope(await lost.invoke(), 500, "internal_error", "Internal server error");
    assert.equal(lost.control.lossInjected, true); assert.deepEqual(lost.control.calls.map(call => call.name), pipeline);
    assert.deepEqual(lost.control.calls.map(call => call.status), [200, 200, 200, 200]);
    const result = lost.control.calls[3].data.result, complete = await assertCommitted(lostSpec, result);
    const before = await digest();
    assert.deepEqual(await lost.invoke(), { status: 200, body: { ok: true, result } });
    assert.equal(lost.control.calls.length, 5); assert.equal(lost.control.calls[4].name, "bot_media_ingest_reserve_internal");
    assert.equal(lost.control.calls[4].data.duplicate, true); assert.equal(lost.control.calls[4].data.lease_id, null);
    sameReserve(lost.control.calls[0].args, lost.control.calls[4].args);
    assert.deepEqual(await receipt(lostSpec), complete); assert.equal(await digest(), before);
    assert.deepEqual(lost.control.puts.map(call => call.outcome), [200]); assert.equal(lost.control.downloads.length, 0);
    await assertAttempts(lostSpec, ["acknowledged"], [complete.lease_id]); await charged(initialAccounting, 2);
  });
  await run("unknown controlled Storage outcome remains charged and held without immediate retry PUT or message", async () => {
    const unknown = open(unknownSpec, { unknownUpload: true });
    envelope(await unknown.invoke(), 500, "internal_error", "Internal server error");
    assert.deepEqual(unknown.control.calls.map(call => call.name), ["bot_media_ingest_reserve_internal",
      "bot_media_upload_begin_internal", "bot_media_upload_finish_internal"]);
    assert.deepEqual(unknown.control.calls.map(call => call.status), [200, 200, 200]);
    assert.equal(unknown.control.calls[2].args.p_outcome, "unknown");
    const held = await receipt(unknownSpec); assertReserved(held, unknownSpec);
    const intent = await assertAttempts(unknownSpec, ["unknown"], [held.lease_id]);
    await effects(unknownSpec, 0); await metadata(unknownSpec); await charged(initialAccounting, 3);
    const before = await digest();
    leaseBusy(await unknown.invoke(), unknown.control.calls.at(-1));
    assert.equal(unknown.control.calls.length, 4); assert.equal(unknown.control.calls[3].name, "bot_media_ingest_reserve_internal");
    sameReserve(unknown.control.calls[0].args, unknown.control.calls[3].args);
    assert.deepEqual(unknown.control.puts.map(call => call.outcome), ["unknown"]); assert.equal(unknown.control.downloads.length, 0);
    assert.deepEqual(await receipt(unknownSpec), held); assert.deepEqual(await attempts(unknownSpec), intent);
    assert.equal(await digest(), before); await effects(unknownSpec, 0); await charged(initialAccounting, 3);
  });
  for (const control of adapters) if (control.failures.length) throw control.failures[0];
  const fictionalPutAttempts = adapters.reduce((sum, control) => sum + control.puts.length, 0);
  const controlledDownloads = adapters.reduce((sum, control) => sum + control.downloads.length, 0);
  assert.equal(done.length, 6); assert.equal(fictionalPutAttempts, 4); assert.equal(controlledDownloads, 1);
  return { done, actualInlineHandlerRepository: true, actualPostgrestRpcs: true,
    storageEdge: "controlled-fictional-metadata-and-local-bytes", fictionalPutAttempts,
    controlledDownloads, realProviderUploadPerformed: false, providerTerminalityProven: false,
    physicalGenerationProven: false, automaticRetry: false, cleanupOrRefundPerformed: false,
    gatewayRouterOrAuthProven: false };
}
