import assert from "node:assert/strict";
import test from "node:test";
import { appOutboxHarness, fictionalOutboxEntry, flushUntil, postgrestResponse } from "../helpers/app-outbox-harness.mjs";
import { classifySendFailure } from "../../artifacts/kub/src/lib/outbox/outboxRules.ts";

function transport() {
  const posts = [], reads = [], other = [];
  let mode = "busy", landed = null;
  return {
    posts, reads, other,
    setMode(value) { mode = value; },
    async fetch(input, init) {
      const request = new Request(input, init), url = new URL(request.url);
      assert.equal(url.origin, "http://127.0.0.1:54321");
      if (request.method === "POST" && url.pathname === "/rest/v1/messages") {
        const body = await request.json();
        posts.push(body);
        assert.ok(request.headers.get("Prefer").includes("return=representation"));
        if (mode === "busy") return postgrestResponse(500, { code: "55P03", message: "fixture_coverage_busy", details: null, hint: null });
        if (mode === "denied") return postgrestResponse(403, { code: "42501", message: "fictional mute", details: null, hint: null });
        if (mode === "internal") return postgrestResponse(500, { code: "XX000", message: "fictional internal failure", details: null, hint: null });
        if (mode === "unsupported") return postgrestResponse(400, { code: "0A000", message: "fixture_isolation_unsupported", details: null, hint: null });
        if (landed) return postgrestResponse(409, { code: "23505", message: "fictional duplicate", details: null, hint: null });
        landed = { ...body, id: "e5070000-0000-4000-8000-000000000301", created_at: body.client_sent_at };
        if (mode === "lost") throw new TypeError("Failed to fetch");
        return postgrestResponse(201, landed);
      }
      if (request.method === "GET" && url.pathname === "/rest/v1/messages") {
        reads.push(Object.fromEntries(url.searchParams));
        return postgrestResponse(200, landed ? [landed] : []);
      }
      assert.equal(request.method, "PATCH");
      assert.equal(url.pathname, "/rest/v1/chats");
      other.push(Object.fromEntries(url.searchParams));
      return new Response(null, { status: 204 });
    },
  };
}

for (const media of [false, true]) {
  test(`actual app ${media ? "media" : "text"} send retains busy entry and repeats its exact identity`, async () => {
    const io = transport(), h = appOutboxHarness({ fetch: io.fetch });
    const e = fictionalOutboxEntry(media ? { type: "file", content: null, mediaBucket: "chat-media",
      mediaPath: "e5070000-0000-4000-8000-000000000001/fictional.pdf",
      mediaMetadata: { kind: "file", file_name: "fictional.pdf", size_bytes: 17 } } : {});
    try {
      h.show(e); await h.outbox.start(e.userId);
      assert.equal((await h.outbox.enqueue(e)).kind, "waiting");
      const kept = await h.storage.list(e.userId);
      assert.equal(kept.length, 1);
      assert.equal(kept[0].attempts, 1);
      assert.equal(kept[0].clientMessageId, "e5070000-0000-4000-8000-000000000201");
      const shown = h.store.getState().messages[e.chatId][0];
      assert.equal(shown.pending, true); assert.equal(shown.failed, false);
      assert.deepEqual(io.reads.map(({ chat_id, user_id, client_message_id }) => ({ chat_id, user_id, client_message_id })),
        [{ chat_id: "eq.e5070000-0000-4000-8000-000000000005", user_id: "eq.e5070000-0000-4000-8000-000000000001",
          client_message_id: "eq.e5070000-0000-4000-8000-000000000201" }]);
      io.setMode("answer"); h.outbox.retryNow();
      await flushUntil(() => h.store.getState().messages[e.chatId][0]?.id === "e5070000-0000-4000-8000-000000000301");
      assert.equal((await h.storage.list(e.userId)).length, 0);
      assert.equal(io.posts.length, 2); assert.deepEqual(io.posts[1], io.posts[0]);
      assert.equal(io.other.length, 1, "only the acknowledged row updates chat recency");
    } finally { h.close(); }
  });
}

test("actual app rechecks send authority after busy instead of granting cached permission", async () => {
  const io = transport(), h = appOutboxHarness({ fetch: io.fetch }), e = fictionalOutboxEntry();
  try {
    h.show(e); await h.outbox.start(e.userId);
    assert.equal((await h.outbox.enqueue(e)).kind, "waiting");
    io.setMode("denied"); h.outbox.retryNow();
    await flushUntil(() => h.store.getState().messages[e.chatId][0]?.failed === true);
    assert.equal((await h.storage.list(e.userId)).length, 0);
    assert.equal(io.posts.length, 2); assert.deepEqual(io.posts[1], io.posts[0]);
    h.outbox.retryNow(); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(io.posts.length, 2); assert.equal(io.other.length, 0);
  } finally { h.close(); }
});

for (const mode of ["internal", "unsupported"]) {
  test(`actual app does not busy-retry ${mode} failure`, async () => {
    const io = transport(); io.setMode(mode);
    const h = appOutboxHarness({ fetch: io.fetch }), e = fictionalOutboxEntry();
    try {
      h.show(e); await h.outbox.start(e.userId);
      assert.equal((await h.outbox.enqueue(e)).kind, "refused");
      assert.equal((await h.storage.list(e.userId)).length, 0);
      h.outbox.retryNow(); await new Promise((resolve) => setImmediate(resolve));
      assert.equal(io.posts.length, 1); assert.equal(io.other.length, 0);
    } finally { h.close(); }
  });
}

test("actual app immediately ACKs a committed response loss without reinserting", async () => {
  const io = transport(); io.setMode("lost");
  const h = appOutboxHarness({ fetch: io.fetch }), e = fictionalOutboxEntry();
  try {
    h.show(e); await h.outbox.start(e.userId);
    assert.equal((await h.outbox.enqueue(e)).kind, "sent");
    assert.equal(io.posts.length, 1); assert.equal(io.reads.length, 1);
    assert.equal((await h.storage.list(e.userId)).length, 0);
    assert.equal(h.store.getState().messages[e.chatId][0].id, "e5070000-0000-4000-8000-000000000301");
  } finally { h.close(); }
});

test("only literal 500/55P03 is treated as a rolled-back busy send", () => {
  const cases = [
    [500, "55P03", "unanswered"], [500, "55000", "refused"], [500, "40P01", "refused"],
    [500, "40001", "refused"], [500, "XX000", "refused"], [500, undefined, "refused"],
    [403, "55P03", "refused"], [400, "0A000", "refused"], [null, "55P03", "refused"],
  ];
  for (const [status, code, expected] of cases) assert.equal(classifySendFailure({ status, error: { code } }), expected);
});

async function scheduledRetry(mutate) {
  let elapsed = 0;
  const pending = new Set();
  const clock = {
    now: () => Date.parse("2026-10-03T00:00:00.000Z") + elapsed,
    set(run, ms) { const timer = { run, at: elapsed + ms }; pending.add(timer); return timer; },
    clear(timer) { pending.delete(timer); },
  };
  const io = transport(), h = appOutboxHarness({ fetch: io.fetch, clock, mutate }), e = fictionalOutboxEntry();
  try {
    h.show(e); await h.outbox.start(e.userId);
    assert.equal((await h.outbox.enqueue(e)).kind, "waiting");
    await flushUntil(() => pending.size === 2); // ACK deadline and runner wake.
    assert.equal(Math.min(...[...pending].map((t) => t.at)), 2_000);
    elapsed = 1_999;
    for (const timer of [...pending]) if (timer.at <= elapsed) { pending.delete(timer); timer.run(); }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(io.posts.length, 1, "no immediate retry loop");
    io.setMode("answer"); elapsed = 2_000;
    for (const timer of [...pending]) if (timer.at <= elapsed) { pending.delete(timer); timer.run(); }
    await flushUntil(() => h.store.getState().messages[e.chatId][0]?.id === "e5070000-0000-4000-8000-000000000301");
    assert.equal(io.posts.length, 2); assert.deepEqual(io.posts[1], io.posts[0]);
  } finally { h.close(); }
}

test("actual app schedules busy retry after literal two seconds, without an online event", async () => {
  await scheduledRetry();
});

test("removing the busy SQLSTATE rule is detected through actual app behavior", async () => {
  await assert.rejects(() => scheduledRetry((file, source) => file.endsWith("outboxRules.ts")
    ? source.replace('error.code === "55P03"', 'error.code === "disabled"') : source),
  (error) => error.code === "ERR_ASSERTION" && error.actual === "refused" && error.expected === "waiting");
});

test("mutating the first retry delay cannot hide behind its own constant", async () => {
  await assert.rejects(() => scheduledRetry((file, source) => file.endsWith("outboxRules.ts")
    ? source.replace('[2_000, 5_000', '[1_000, 5_000') : source),
  (error) => error.code === "ERR_ASSERTION" && error.actual === 1_000 && error.expected === 2_000);
});
