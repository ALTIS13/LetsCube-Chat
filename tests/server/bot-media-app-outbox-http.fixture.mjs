import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { appOutboxHarness, fictionalOutboxEntry, postgrestResponse } from "../helpers/app-outbox-harness.mjs";
import { gatewayHttp } from "./bot-media-http.fixture.mjs";
import { fullSchemaIds as q } from "./bot-media-authority-full-schema.fixture.mjs";
import { toBotApiErrorResponse } from "../../artifacts/api-server/src/bot/errors.ts";

const actor = "e5070000-0000-4000-8000-000000000001";
const chat = "e5070000-0000-4000-8000-000000000005";
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const same = (a, b, label) => assert.ok(isDeepStrictEqual(a, b), label);
const rows = (value) => Array.isArray(value) ? value : value == null ? [] : [value];

// Actual appOutbox private send/ACK + real supabase-js query builder. The
// operator supplies only isolated HTTP and SQL sessions; Node uses memory
// device storage. Browser IndexedDB acceptance lives in offline-outbox.spec.ts.
export async function runAppOutboxHttpAcceptance({ request, query, exec, blocker, digest, check }) {
  const done = [], loaded = new Set(), harnesses = new Set();
  const open = (entry, { fault, unsupported = false } = {}) => {
    const posts = [], replies = [], reads = [], failures = [], patches = [], timers = new Set();
    let finishedPatches = 0;
    let elapsed = 0, emittedFault = false;
    const clock = {
      now: () => Date.parse("2026-10-03T00:00:00.000Z") + elapsed,
      set(run, ms) { const timer = { run, at: elapsed + ms }; timers.add(timer); return timer; },
      clear(timer) { timers.delete(timer); },
    };
    const h = appOutboxHarness({ clock, async fetch(input, init) {
      try {
        const req = new Request(input, init), url = new URL(req.url);
        assert.equal(url.origin, "http://127.0.0.1:54321");
        assert.ok(["/rest/v1/messages", "/rest/v1/chats"].includes(url.pathname));
        const path = url.pathname.slice("/rest/v1".length) + url.search;
        const body = req.method === "GET" ? undefined : await req.json();
        const headers = {};
        for (const name of ["Accept", "Prefer"]) if (req.headers.has(name)) headers[name] = req.headers.get(name);
        if (req.method === "POST") {
          assert.equal(body.user_id, actor); assert.equal(body.chat_id, chat);
          posts.push(structuredClone(body));
          assert.ok(req.headers.get("Prefer").includes("return=representation"));
          if (fault === "before-dispatch" && !emittedFault) {
            emittedFault = true; throw new TypeError("Fictional fetch failed before dispatch");
          }
        }
        if (req.method === "GET") {
          same({ chat_id: url.searchParams.get("chat_id"), user_id: url.searchParams.get("user_id"),
            client_message_id: url.searchParams.get("client_message_id") },
          { chat_id: "eq." + chat, user_id: "eq." + actor, client_message_id: "eq." + entry.clientMessageId },
          "actual ACK is scoped to exact actor, chat and client identity");
        }
        if (req.method === "PATCH") {
          assert.equal(url.searchParams.get("id"), "eq." + chat);
          patches.push(body);
        }
        const response = await request(unsupported && req.method === "POST" ? "POST" : req.method,
          unsupported && req.method === "POST" ? "/rpc/fixture_http_unsupported" : path,
          unsupported && req.method === "POST" ? {} : body, "authenticated", headers);
        if (req.method === "POST") replies.push({ status: response.status, code: response.error?.code ?? null });
        if (req.method === "PATCH") finishedPatches++;
        if (req.method === "GET") reads.push({ status: response.status, count: rows(response.data).length });
        if (req.method === "POST" && fault === "after-commit" && !emittedFault) {
          assert.equal(response.status, 201); emittedFault = true;
          throw new TypeError("Fictional fetch failed after committed response");
        }
        return response.status === 204 ? new Response(null, { status: 204 }) :
          postgrestResponse(response.status, response.error ?? response.data);
      } catch (error) {
        if (!(error instanceof TypeError && error.message.startsWith("Fictional fetch failed"))) failures.push(error);
        throw error;
      }
    } });
    for (const file of h.loaded) loaded.add(file);
    h.show(entry); harnesses.add(h);
    return { ...h, posts, replies, reads, failures, patches, timers, finishedPatches: () => finishedPatches, tick(ms) {
      elapsed += ms;
      for (const t of [...timers]) if (t.at <= elapsed) { timers.delete(t); t.run(); }
    } };
  };
  const settled = async (h, entry, kind) => {
    const deadline = Date.now() + 30_000;
    const ready = () => {
      const row = h.store.getState().messages[chat]?.find((m) => m.client_message_id === entry.clientMessageId);
      return kind === "sent" ? Boolean(row && row.id !== entry.tempId) : row?.failed === true;
    };
    while (!ready() && Date.now() < deadline) await delay(10);
    assert.ok(ready(), "bounded actual app outcome");
    assert.equal(h.failures.length, 0, "adapter/assertion errors cannot become a server refusal");
    while (h.finishedPatches() !== h.patches.length && Date.now() < deadline) await delay(10);
    assert.equal(h.finishedPatches(), h.patches.length, "recency writes finish before comparing database effects");
  };
  const count = async (entry, expected) => {
    const [row] = await query(`select count(*)::int as n from public.messages where client_message_id=${quote(entry.clientMessageId)}`);
    assert.equal(Number(row.n), expected, "exact committed identity count across all actors/chats");
  };
  const busy = async (body) => {
    try {
      await blocker.exec("begin; select pg_advisory_xact_lock(270311,1);");
      const [lock] = await blocker.query("select count(*)::int n from pg_locks where pid=pg_backend_pid() and locktype='advisory' and classid=270311 and objid=1 and objsubid=2 and mode='ExclusiveLock' and granted");
      assert.equal(Number(lock.n), 1);
      await body();
    } finally { await blocker.exec("rollback;"); }
  };
  const muted = async (body) => {
    const [before] = await query(`select count(*)::int n from public.mutes where user_id='${actor}' and chat_id='${chat}' and reason='fictional-app-outbox-http'`);
    assert.equal(Number(before.n), 0);
    try {
      await exec(`insert into public.mutes(user_id,chat_id,reason) values('${actor}','${chat}','fictional-app-outbox-http');`);
      await body();
    } finally { await exec(`delete from public.mutes where user_id='${actor}' and chat_id='${chat}' and reason='fictional-app-outbox-http';`); }
  };
  const run = async (name, body) => {
    let passed = false;
    await check(name, async () => { await body(); passed = true; });
    assert.ok(passed, "acceptance check must propagate failure"); done.push(name);
  };
  const entry = (suffix, media = false) => fictionalOutboxEntry({
    clientMessageId: `e5070000-0000-4000-8000-00000000020${suffix}`, tempId: `fictional-app-outbox-20${suffix}`,
    ...(media ? { type: "file", content: null, mediaBucket: "chat-media",
      mediaPath: `${actor}/fictional-authority.pdf`, mediaMetadata: { kind: "file",
        file_name: "fictional-authority.pdf", mime_type: "application/pdf", size_bytes: 17, size: 17 } } : {}),
  });

  try {
    const state = await request("POST", "/rpc/fixture_http_state", {});
    assert.equal(state.status, 200);
    same(state.data, { role: "authenticated", actor, isolation: "read committed", readonly: "on" }, "actual actor/RC HTTP setup");
    for (let suffix = 1; suffix <= 6; suffix++) await count(entry(suffix), 0);
    for (const [suffix, media] of [[1, false], [2, true]]) {
      await run(`actual app ${media ? "media" : "text"} busy retry retains payload then commits once`, async () => {
        const e = entry(suffix, media), h = open(e); await h.outbox.start(actor);
        await busy(async () => {
          const before = await digest();
          assert.equal((await h.outbox.enqueue(e)).kind, "waiting");
          same(h.replies, [{ status: 500, code: "55P03" }], "real PostgREST lock-unavailable response");
          assert.equal(h.failures.length, 0);
          const held = await h.storage.list(actor);
          assert.equal(held.length, 1); assert.equal(held[0].attempts, 1);
          same(held[0], { ...e, attempts: 1, nextAttemptAt: Date.parse("2026-10-03T00:00:00.000Z") + 2_000 }, "whole payload preserved");
          same(h.reads, [{ status: 200, count: 0 }], "immediate ACK sees no uncommitted copy");
          await count(e, 0); assert.equal(await digest(), before, "busy rolls back every application effect");
        });
        h.tick(1_999); await delay(10); assert.equal(h.posts.length, 1);
        h.tick(1); await settled(h, e, "sent");
        assert.equal(h.replies.at(-1).status, 201);
        same(h.posts[1], h.posts[0], "scheduled retry uses the same actor/client/media request");
        assert.equal(h.posts.length, 2); await count(e, 1);
        assert.equal((await h.storage.list(actor)).length, 0); h.close();
      });
    }
    for (const [suffix, media] of [[3, false], [4, true]]) {
      await run(`actual app ${media ? "media" : "text"} retry cannot survive current mute`, async () => {
        const e = entry(suffix, media), h = open(e); await h.outbox.start(actor);
        await busy(async () => { assert.equal((await h.outbox.enqueue(e)).kind, "waiting"); });
        await muted(async () => {
          const before = await digest(); h.outbox.retryNow(); await settled(h, e, "refused");
          same(h.replies.at(-1), { status: 403, code: "42501" }, "actual new delivery authority refused");
          assert.equal((await h.storage.list(actor)).length, 0);
          same(h.posts[1], h.posts[0], "fresh retry does not change sender or request identity");
          same(h.reads.at(-1), { status: 200, count: 0 }, "no delivery to ACK");
          await count(e, 0); assert.equal(await digest(), before); assert.equal(h.patches.length, 0);
        });
        h.close();
      });
    }
    await run("actual app immediately ACKs committed media after lost response and current mute", async () => {
      const e = entry(5, true), h = open(e, { fault: "after-commit" }); await h.outbox.start(actor);
      assert.equal((await h.outbox.enqueue(e)).kind, "sent");
      await settled(h, e, "sent");
      await count(e, 1); assert.equal(h.posts.length, 1);
      same(h.reads, [{ status: 200, count: 1 }], "private app ACK sees the committed delivery");
      assert.equal((await h.storage.list(actor)).length, 0); h.close();
      // Replay the same delivered identity under a real mute: a denied INSERT
      // can ACK a prior delivery, never manufacture another authorized send.
      await muted(async () => {
        const replay = open(e); await replay.outbox.start(actor);
        const before = await digest();
        assert.equal((await replay.outbox.enqueue(e)).kind, "sent");
        await settled(replay, e, "sent");
        same(replay.replies, [{ status: 403, code: "42501" }], "denied duplicate INSERT before ACK of prior delivery");
        await count(e, 1); assert.equal(replay.posts.length, 1);
        same(replay.reads, [{ status: 200, count: 1 }], "ACK after mute is scoped to the prior delivered row");
        assert.equal(await digest(), before); replay.close();
      });
    });
    await run("actual app refuses real unsupported isolation without busy retry", async () => {
      const e = entry(6), h = open(e, { unsupported: true }); await h.outbox.start(actor);
      const before = await digest(); assert.equal((await h.outbox.enqueue(e)).kind, "refused");
      same(h.replies, [{ status: 400, code: "0A000" }], "actual isolation refusal, not adapter failure");
      await count(e, 0); assert.equal((await h.storage.list(actor)).length, 0);
      h.outbox.retryNow(); await delay(10); assert.equal(h.posts.length, 1);
      assert.equal(await digest(), before); assert.equal(h.failures.length, 0); h.close();
    });
    return { done, loaded: [...loaded], actualAppSendAck: true, actualSupabaseBuilder: true,
      indexedDbProven: false, uploadPutPerformed: false };
  } finally { for (const h of harnesses) h.close(); }
}

export async function runGatewayBusyHttpAcceptance({ request, query, exec, blocker, digest, check }) {
  const done = [];
  const run = async (name, body) => {
    let passed = false;
    await check(name, async () => { await body(); passed = true; });
    assert.ok(passed); done.push(name);
  };
  const ledgerCount = async (key, expected) => {
    const [row] = await query(`select count(*)::int n from private.bot_operation_idempotency where bot_id='${q.bot}' and idempotency_key=${quote(key)}`);
    assert.equal(Number(row.n), expected);
  };
  const busyEnvelope = async (send, input) => {
    await assert.rejects(() => send(input), (error) => {
      const response = toBotApiErrorResponse(error, "fictional-busy-http");
      same(response, { status: 503, body: { ok: false, error: { code: "service_unavailable",
        message: "Service unavailable", request_id: "fictional-busy-http", retry_after: 2 } } },
      "literal sanitized retry contract through actual error mapper");
      return true;
    });
  };
  await run("actual gateway busy envelope repeats original file-id request without accounting duplication", async () => {
    const { send, control } = gatewayHttp(request);
    const input = { chat_id: q.sourceChat, file_id: q.source, idempotency_key: "fictional-busy-gateway-new" };
    await ledgerCount(input.idempotency_key, 0);
    try {
      await blocker.exec("begin;select pg_advisory_xact_lock(270311,1);");
      const before = await digest(); await busyEnvelope(send, input);
      await ledgerCount(input.idempotency_key, 0); assert.equal(await digest(), before);
    } finally { await blocker.exec("rollback;"); }
    const row = await send(input); assert.equal(row.chat_id, q.sourceChat);
    await ledgerCount(input.idempotency_key, 1);
    const before = await digest(); same(await send(input), row, "same delivered message after retry");
    assert.equal(await digest(), before);
    const writes = control.calls.filter((c) => c.name === "bot_message_command_internal");
    assert.equal(writes.length, 2); same(writes[0].args, writes[1].args, "exact original request fingerprint/idempotency identity");
  });
  await run("actual gateway cached retry refuses busy membership before returning prior delivery", async () => {
    const { send } = gatewayHttp(request);
    const input = { chat_id: q.sourceChat, file_id: q.source, idempotency_key: "fictional-busy-gateway-cached" };
    const prior = await send(input);
    try {
      await blocker.exec(`begin;update public.chat_bot_members set privacy_mode='restricted' where bot_id='${q.bot}' and chat_id='${q.sourceChat}';`);
      const before = await digest(); await busyEnvelope(send, input); assert.equal(await digest(), before);
    } finally { await blocker.exec("rollback;"); }
    const before = await digest(); same(await send(input), prior, "original delivery recovered after contention");
    assert.equal(await digest(), before); await ledgerCount(input.idempotency_key, 1);
  });
  await run("actual gateway retry after busy rechecks revoked membership and commits nothing", async () => {
    const { send } = gatewayHttp(request);
    const input = { chat_id: q.sourceChat, file_id: q.source, idempotency_key: "fictional-busy-gateway-revoked" };
    try {
      await blocker.exec(`begin;update public.chat_bot_members set privacy_mode='restricted' where bot_id='${q.bot}' and chat_id='${q.sourceChat}';`);
      const before = await digest(); await busyEnvelope(send, input); assert.equal(await digest(), before);
    } finally { await blocker.exec("rollback;"); }
    await exec(`update public.chat_bot_members set removed_at=now() where bot_id='${q.bot}' and chat_id='${q.sourceChat}';`);
    try {
      const before = await digest(); await assert.rejects(() => send(input), { code: "forbidden" });
      await ledgerCount(input.idempotency_key, 0); assert.equal(await digest(), before);
    } finally { await exec(`update public.chat_bot_members set removed_at=null where bot_id='${q.bot}' and chat_id='${q.sourceChat}';`); }
  });
  return { done, automaticRetry: false, uploadPutPerformed: false };
}
