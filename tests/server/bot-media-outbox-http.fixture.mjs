import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { createOutboxRunner } from "../../artifacts/kub/src/lib/outbox/outboxRunner.ts";
import { classifySendFailure } from "../../artifacts/kub/src/lib/outbox/outboxRules.ts";
import { memoryOutboxStorage } from "../../artifacts/kub/src/lib/outbox/outboxStorage.ts";

// No transport, credentials or host selection here. The operator supplies a
// disposable committed fullSchemaSeed, accepted authority + coverage hooks,
// PostgREST 14.12 (RC/commit), and a bounded authenticated-actor request adapter.
// POST /messages must use Prefer: return=representation, never resolution=merge.
// exec/query use an idle privileged connection. blocker is a separate connection.
// The operator preinstalls fixture_http_state/fixture_http_unsupported and owns
// commit/disposal; this suite cannot be wrapped in one uncommitted seed transaction.
const actor = "e5070000-0000-4000-8000-000000000001";
const target = "e5070000-0000-4000-8000-000000000005";
const now = Date.parse("2026-10-03T00:00:00.000Z");
const columns = "id,user_id,chat_id,client_message_id,client_sent_at,topic_id,type,content,reply_to_id,forwarded_from_id,media_bucket,media_path,media_url,media_metadata";
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";

function entry(suffix, media = false) {
  return {
    clientMessageId: `e5070000-0000-4000-8000-00000000010${suffix}`,
    userId: actor, chatId: target, topicId: null,
    type: media ? "file" : "text", content: media ? null : "Fictional outbox HTTP text",
    replyToId: null, forwardedFromId: null,
    mediaBucket: media ? "chat-media" : null,
    mediaPath: media ? `${actor}/fictional-authority.pdf` : null,
    mediaUrl: null,
    mediaMetadata: media ? { kind: "file", file_name: "fictional-authority.pdf",
      mime_type: "application/pdf", size: 17, size_bytes: 17 } : null,
    clientSentAt: "2026-10-03T00:00:00.000Z", tempId: `fictional-http-${suffix}`,
    attempts: 0, nextAttemptAt: now,
  };
}

// Deliberately separate send dependency: appOutbox.ts's private sendEntry and
// immediate timeout/error ACK lookup are NOT loaded by this fixture.
function payload(e) {
  return {
    chat_id: e.chatId, user_id: e.userId, client_message_id: e.clientMessageId,
    client_sent_at: e.clientSentAt, topic_id: e.topicId, type: e.type, content: e.content,
    reply_to_id: e.replyToId, forwarded_from_id: e.forwardedFromId,
    media_bucket: e.mediaBucket, media_path: e.mediaPath, media_url: e.mediaUrl,
    ...(e.mediaMetadata === undefined ? {} : { media_metadata: e.mediaMetadata }),
  };
}

function same(left, right, label) {
  // Never put copied HTTP rows, message content or metadata into failure output.
  assert.ok(isDeepStrictEqual(left, right), label);
}

function assertRow(row, expected) {
  assert.ok(row && typeof row.id === "string", "one real represented/read-back message");
  const wanted = payload(expected);
  const projected = Object.fromEntries(Object.keys(wanted).map((key) => [key, row[key]]));
  projected.client_sent_at = new Date(projected.client_sent_at).toISOString();
  same(projected, wanted, "literal stored identity, content and media snapshot unchanged");
}

const rows = (data) => Array.isArray(data) ? data : data == null ? [] : [data];
const readPath = (e) => `/messages?select=${columns}&chat_id=eq.${e.chatId}` +
  `&user_id=eq.${e.userId}&client_message_id=eq.${e.clientMessageId}`;

function harness(request, expected, { storage = memoryOutboxStorage(), fault, rpc = false } = {}) {
  const events = [], posts = [], reads = [], sentPayloads = [], fatal = [], wakes = new Set();
  const runner = createOutboxRunner({
    storage, now: () => now,
    timers: { set(callback, ms) { const handle = { callback, ms }; wakes.add(handle); return handle; },
      clear(handle) { wakes.delete(handle); } },
    async send(e) {
      sentPayloads.push(payload(e));
      try {
        if (fault === "before-dispatch" && sentPayloads.length === 1)
          throw new TypeError("Fictional transport: failed to fetch before dispatch");
        const response = await request("POST", rpc ? "/rpc/fixture_http_unsupported" :
          `/messages?select=${columns}`, rpc ? {} : payload(e));
        posts.push({ status: response.status, code: response.error?.code ?? null,
          message: response.error?.message ?? null });
        if (response.status >= 200 && response.status < 300 && !response.error) {
          const landed = rows(response.data);
          assert.equal(response.status, 201, "real table INSERT, return=representation");
          assert.equal(landed.length, 1);
          assertRow(landed[0], expected);
          if (fault === "after-commit" && sentPayloads.length === 1)
            throw new TypeError("Fictional transport: failed to fetch after committed response");
          return { sent: landed[0] };
        }
        const readback = await request("GET", readPath(e));
        const found = rows(readback.data);
        reads.push({ status: readback.status, count: found.length });
        assert.equal(readback.status, 200, "actual authenticated RLS readback");
        assert.ok(!readback.error, "readback cannot hide a setup/HTTP error");
        assert.ok(found.length <= 1, "one identity, never multiple ACK candidates");
        if (found.length) { assertRow(found[0], expected); return { sent: found[0] }; }
        return { failed: { status: response.status, error: response.error } };
      } catch (error) {
        if (!(error instanceof TypeError && error.message.startsWith("Fictional transport:"))) fatal.push(error);
        throw error;
      }
    },
    onSent(e, row) { events.push({ kind: "sent", entry: e, row }); },
    onWaiting(e) { events.push({ kind: "waiting", entry: e }); },
    onRefused(e) { events.push({ kind: "refused", entry: e }); },
  });
  return { runner, storage, events, posts, reads, sentPayloads, fatal, wakes };
}

async function settled(h, count) {
  const deadline = Date.now() + 30_000;
  while (h.events.length < count && Date.now() < deadline) await delay(5);
  assert.equal(h.events.length, count, "bounded runner outcome, no duplicate callbacks");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.fatal.length, 0, "adapter/assertion errors cannot count as server refusals");
}

async function held(h, expected) {
  const stored = await h.storage.list(actor);
  assert.equal(stored.length, 1, "unanswered entry remains persisted");
  same(stored[0], { ...expected, attempts: 1, nextAttemptAt: now + 2_000 },
    "first literal 2000ms retry preserves every original entry field");
  return JSON.stringify(stored[0]);
}

async function empty(h) {
  assert.equal(h.runner.size(), 0);
  assert.equal((await h.storage.list(actor)).length, 0);
}

/** Executes only through operator-supplied, same-owned-copy adapters. */
export async function runOutboxHttpAcceptance({ request, query, exec, check, blocker, digest }) {
  for (const callback of [request, query, exec, check, blocker?.exec, blocker?.query, digest])
    assert.equal(typeof callback, "function");
  const completed = [], observations = {};
  const active = new Set();
  const open = (e, options) => { const h = harness(request, e, options); active.add(h); return h; };
  async function run(name, body) {
    let passed = false;
    await check(name, async () => { await body(); passed = true; });
    assert.ok(passed, "check must execute and propagate acceptance failure");
    completed.push(name);
  }
  async function count(e, expected) {
    const [row] = await query(`select count(*)::int as n from public.messages
      where client_message_id=${quote(e.clientMessageId)}`);
    assert.equal(Number(row.n), expected, "privileged committed count across ALL chats/users");
  }
  async function muted(body) {
    const [before] = await query(`select count(*)::int as n from public.mutes
      where user_id='${actor}' and chat_id='${target}' and reason='fictional-outbox-http'`);
    assert.equal(Number(before.n), 0, "no foreign or earlier fixture mute to overwrite");
    try {
      await exec(`insert into public.mutes(user_id,chat_id,reason)
        values ('${actor}','${target}','fictional-outbox-http');`);
      const [row] = await query(`select count(*)::int as n from public.mutes
        where user_id='${actor}' and chat_id='${target}' and reason='fictional-outbox-http'`);
      assert.equal(Number(row.n), 1, "real committed target delivery-authority revocation");
      await body();
    } finally {
      await exec(`delete from public.mutes where user_id='${actor}' and chat_id='${target}'
        and reason='fictional-outbox-http';`);
    }
  }
  async function denied(h, e) {
    await settled(h, 2);
    assert.equal(h.events[1].kind, "refused");
    assert.equal(h.posts.at(-1).status, 403);
    assert.equal(h.posts.at(-1).code, "42501", "RLS refusal, not absent schema or invalid payload");
    same(h.reads.at(-1), { status: 200, count: 0 }, "no committed copy to ACK for a new refused send");
    same(h.sentPayloads[1], payload(e), "fresh retry keeps user/chat/client/content/media identities");
    assert.equal(h.events.filter((event) => event.kind === "sent").length, 0);
    await empty(h); await count(e, 0);
  }

  try {
    // These checks fail early on the wrong seed/config, without reading any
    // unrelated account or copying rows into receipts.
    const [setup] = await query(`select
      to_regprocedure('fixture_coverage.before_write()') is not null as coverage,
      to_regprocedure('public.fixture_http_unsupported()') is not null as rr,
      current_setting('transaction_isolation') as isolation`);
    assert.equal(setup.coverage, true); assert.equal(setup.rr, true);
    assert.equal(setup.isolation, "read committed");
    const state = await request("POST", "/rpc/fixture_http_state", {});
    assert.equal(state.status, 200); assert.ok(!state.error);
    same(state.data, { role: "authenticated", actor: "e5070000-0000-4000-8000-000000000001",
      isolation: "read committed", readonly: "on" }, "real actor/RC PostgREST adapter");
    for (let suffix = 1; suffix <= 7; suffix++) await count(entry(suffix), 0);

    await run("lost committed HTTP response retries one text identity via conflict/readback", async () => {
      const e = entry(1), h = open(e, { fault: "after-commit" });
      await h.runner.start(actor);
      assert.equal((await h.runner.enqueue(e)).kind, "waiting");
      await settled(h, 1); await held(h, e); await count(e, 1);
      const beforeRetry = await digest();
      h.runner.retryNow(); await settled(h, 2);
      assert.equal(h.events[1].kind, "sent");
      same(h.posts.map(({ status, code }) => ({ status, code })),
        [{ status: 201, code: null }, { status: 409, code: "23505" }], "real insert then unique conflict");
      same(h.reads, [{ status: 200, count: 1 }], "real authenticated deduplicated ACK");
      for (const sent of h.sentPayloads) same(sent, payload(e), "unchanged retry request");
      assert.equal(await digest(), beforeRetry, "duplicate conflict/readback has no trigger/accounting effects");
      await empty(h); await count(e, 1); h.runner.stop();
    });

    await run("serialized media entry restores a new runner and the same committed identity", async () => {
      const e = entry(2, true), first = open(e, { fault: "after-commit" });
      await first.runner.start(actor);
      assert.equal((await first.runner.enqueue(e)).kind, "waiting");
      await settled(first, 1); const persisted = await held(first, e); await count(e, 1);
      first.runner.stop(); assert.equal((await first.storage.list(actor)).length, 1);
      const storage = memoryOutboxStorage(); await storage.put(JSON.parse(persisted));
      const restarted = open(e, { storage });
      const beforeRetry = await digest();
      const restored = await restarted.runner.start(actor);
      assert.equal(restored.length, 1);
      same(restored[0], { ...e, attempts: 1, nextAttemptAt: now }, "restored original media snapshot, immediately due");
      await settled(restarted, 1); assert.equal(restarted.events[0].kind, "sent");
      same(restarted.posts.map(({ status, code }) => ({ status, code })),
        [{ status: 409, code: "23505" }], "restart conflicts with the real first commit");
      same(restarted.reads, [{ status: 200, count: 1 }], "restart resolves exactly one real row");
      same(restarted.sentPayloads[0], first.sentPayloads[0], "serialized identity and metadata survive runner restart");
      assert.equal(await digest(), beforeRetry, "restart retry has no additional committed effects");
      await empty(restarted); await count(e, 1); restarted.runner.stop();
      observations.restart = { storage: "serialized record + production memory storage", indexedDbProven: false };
    });

    for (const [suffix, media] of [[3, false], [4, true]])
      await run(`real target mute refuses NEW ${media ? "media" : "text"} after unanswered transport`, async () => {
        const e = entry(suffix, media), h = open(e, { fault: "before-dispatch" });
        await h.runner.start(actor);
        assert.equal((await h.runner.enqueue(e)).kind, "waiting");
        await settled(h, 1); await held(h, e); await count(e, 0);
        await muted(async () => {
          const beforeRetry = await digest(); h.runner.retryNow(); await denied(h, e);
          assert.equal(await digest(), beforeRetry, "refused new send rolls back every trigger effect");
        });
        h.runner.stop();
      });

    await run("mute refuses a new INSERT but permits ACK of the same already committed delivery", async () => {
      const e = entry(5), h = open(e, { fault: "after-commit" });
      await h.runner.start(actor);
      assert.equal((await h.runner.enqueue(e)).kind, "waiting");
      await settled(h, 1); await held(h, e); await count(e, 1);
      await muted(async () => {
        const beforeRetry = await digest(); h.runner.retryNow(); await settled(h, 2);
        assert.equal(h.posts.at(-1).status, 403); assert.equal(h.posts.at(-1).code, "42501");
        same(h.reads.at(-1), { status: 200, count: 1 }, "mute does not revoke reading a delivered row");
        assert.equal(h.events[1].kind, "sent", "ACK of prior delivery, NOT a newly authorized send");
        assertRow(h.events[1].row, e); same(h.sentPayloads[1], payload(e), "same prior delivery identity");
        await empty(h); await count(e, 1); assert.equal(await digest(), beforeRetry);
        observations.cachedAck = { insertStatus: h.posts.at(-1).status, readbackCount: h.reads.at(-1).count,
          runnerOutcome: h.events[1].kind, newCommittedWrites: 0,
          meaning: "adapter ACKs the original delivered row; mute revokes delivery, not SELECT" };
      });
      h.runner.stop();
    });

    await run("real 55P03/500 is removed as refused, not automatically busy-retried", async () => {
      const e = entry(6), h = open(e);
      await h.runner.start(actor);
      try {
        await blocker.exec("begin; set local statement_timeout='20s'; select pg_advisory_xact_lock(270311,1);");
        const [lock] = await blocker.query(`select count(*)::int as n from pg_locks where pid=pg_backend_pid()
          and locktype='advisory' and classid=270311 and objid=1 and objsubid=2
          and mode='ExclusiveLock' and granted`);
        assert.equal(Number(lock.n), 1, "actual other-backend exclusive transaction lock");
        const beforeBusy = await digest();
        assert.equal((await h.runner.enqueue(e)).kind, "refused");
        await settled(h, 1);
        same(h.posts, [{ status: 500, code: "55P03", message: "fixture_coverage_busy" }],
          "actual coverage busy response, not a lock_timeout/setup substitute");
        assert.equal(classifySendFailure({ status: h.posts[0].status, error: { code: h.posts[0].code } }), "refused");
        await empty(h); await count(e, 0);
        assert.equal(await digest(), beforeBusy, "busy refusal has no committed partial effects");
      } finally { await blocker.exec("rollback;"); }
      h.runner.retryNow(); await new Promise((resolve) => setImmediate(resolve));
      assert.equal(h.posts.length, 1, "retryNow cannot retry a removed busy entry");
      assert.equal(h.wakes.size, 0, "no scheduled automatic busy retry");
      observations.busy = { httpStatus: h.posts[0].status, sqlstate: h.posts[0].code,
        runnerOutcome: h.events[0].kind, persistedEntries: 0, automaticRetry: false,
        gap: "current runner removes a retryable-in-principle coverage busy refusal" };
      // Explicit re-enqueue is NOT existing automatic retry behavior.
      await muted(async () => {
        const beforeRetry = await digest();
        assert.equal((await h.runner.enqueue(e)).kind, "refused"); await denied(h, e);
        assert.equal(await digest(), beforeRetry);
      });
      assert.equal((await h.runner.enqueue(e)).kind, "sent"); await settled(h, 3);
      assert.equal(h.posts.at(-1).status, 201);
      for (const sent of h.sentPayloads) same(sent, payload(e), "explicit retries preserve original identity");
      await empty(h); await count(e, 1); h.runner.stop();
    });

    await run("real hoisted RR 0A000/400 rolls back and is refused without retry", async () => {
      // The real RPC probes INSERT id ...0091, not this entry's payload. This
      // case proves HTTP-error classification, NOT sendEntry's RPC transport.
      const e = entry(7), h = open(e, { rpc: true });
      await h.runner.start(actor);
      const beforeIsolation = await digest();
      assert.equal((await h.runner.enqueue(e)).kind, "refused"); await settled(h, 1);
      same(h.posts, [{ status: 400, code: "0A000", message: "fixture_isolation_unsupported" }],
        "actual candidate isolation refusal under HTTP, never a fabricated error RPC");
      assert.equal(classifySendFailure({ status: h.posts[0].status, error: { code: h.posts[0].code } }), "refused");
      await empty(h); await count(e, 0);
      const [probe] = await query("select count(*)::int as n from public.messages where id='e5070000-0000-4000-8000-000000000091'");
      assert.equal(Number(probe.n), 0, "the real coordinator isolation probe INSERT rolled back");
      assert.equal(await digest(), beforeIsolation, "isolation refusal has no committed partial effects");
      h.runner.retryNow(); await new Promise((resolve) => setImmediate(resolve));
      assert.equal(h.posts.length, 1); assert.equal(h.wakes.size, 0);
      observations.isolation = { httpStatus: h.posts[0].status, sqlstate: h.posts[0].code,
        runnerOutcome: h.events[0].kind, persistedEntries: 0, automaticRetry: false };
      h.runner.stop();
    });

    return { completed, observations, runtimeAcceptance: "OPEN", scope: "real runner + separate HTTP send adapter",
      limits: ["Private appOutbox sendEntry/its immediate cached ACK path not loaded",
        "No browser IndexedDB/process durability proof", "No Storage PUT or physical media proof",
        "Real mute revocation, not owner membership deletion/SELECT revocation",
        "Isolation RPC has its own probe INSERT; only its actual error feeds the runner",
        "No retry policy/product source change; no production acceptance"] };
  } finally { for (const h of active) h.runner.stop(); }
}
