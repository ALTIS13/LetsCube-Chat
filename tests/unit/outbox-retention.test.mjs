import assert from "node:assert/strict";
import test from "node:test";
import { memoryOutboxStorage } from "../../artifacts/kub/src/lib/outbox/outboxStorage.ts";
import { appOutboxHarness, fictionalOutboxEntry, flushUntil, postgrestResponse } from "../helpers/app-outbox-harness.mjs";

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const flush = () => new Promise(resolve => setImmediate(resolve));

async function explicitRetryQueue({ mutate } = {}) {
  const disk = memoryOutboxStorage(), ack = deferred(); let puts = 0, posts = 0, pending;
  const h = appOutboxHarness({ mutate, storage: { ...disk, async put(row) {
    if (++puts === 1) throw Object.assign(Error("OUTBOX_STORAGE_UNAVAILABLE"), { code: "OUTBOX_STORAGE_UNAVAILABLE" });
    await disk.put(row);
  } }, async fetch(input, init) {
    const request = new Request(input, init), url = new URL(request.url);
    assert.equal(url.origin, "http://127.0.0.1:54321");
    if (request.method === "POST" && url.pathname === "/rest/v1/messages") {
      posts++; const body = await request.json(); await ack.promise;
      return postgrestResponse(201, { ...body, id: "e5070000-0000-4000-8000-000000000301", created_at: body.client_sent_at });
    }
    assert.equal(request.method, "PATCH"); assert.equal(url.pathname, "/rest/v1/chats");
    return new Response(null, { status: 204 });
  } });
  try {
    const e = fictionalOutboxEntry(); h.show(e); await h.outbox.start(e.userId);
    assert.equal((await h.outbox.enqueue(e)).kind, "refused");
    assert.equal(h.outbox.has(e.clientMessageId), true);
    assert.equal(h.outbox.isQueued(e.clientMessageId), false, "FAILED_PUT_IS_PRESENT_BUT_NOT_LIVE_QUEUED");
    assert.equal((await h.outbox.retain(e)).ok, true);
    assert.equal(h.outbox.has(e.clientMessageId), true);
    assert.equal(h.outbox.isQueued(e.clientMessageId), false, "retain cannot silently resume a failed attempt");
    h.outbox.retryNow(); await flush(); assert.equal(posts, 0);
    pending = h.outbox.enqueue(e); await flushUntil(() => posts === 1);
    assert.equal(h.outbox.isQueued(e.clientMessageId), true, "EXPLICIT_REENQUEUE_RESTORES_LIVE_QUEUE");
    assert.equal((await h.outbox.retain(e)).ok, true);
    assert.equal(h.outbox.isQueued(e.clientMessageId), true, "retain cannot replace a genuine held send waiter");
    ack.resolve(); assert.equal((await pending).kind, "sent");
    assert.equal(posts, 1); assert.equal(h.outbox.has(e.clientMessageId), false);
    assert.equal(h.outbox.isQueued(e.clientMessageId), false);
    assert.deepEqual(await disk.list(e.userId), []);
  } finally { ack.resolve(); await pending; h.close(); }
}

test("failed first PUT remains present while only explicit reenqueue restores the live queue and held waiter", { timeout: 5000 }, () => explicitRetryQueue());

for (const [name, from, failure] of [
  ["failed-work-state", "requiresExplicitRetry.add(queued.clientMessageId);", "FAILED_PUT_IS_PRESENT_BUT_NOT_LIVE_QUEUED"],
  ["explicit-reenqueue-state", "requiresExplicitRetry.delete(queued.clientMessageId);", "EXPLICIT_REENQUEUE_RESTORES_LIVE_QUEUE"],
]) test(`actual live-queue ${name} omission is killed by a literal state assertion`, { timeout: 5000 }, async () => {
  await assert.rejects(() => explicitRetryQueue({ mutate(file, source) {
    if (!file.endsWith("outboxRunner.ts")) return source;
    assert.equal(source.split(from).length, 2); return source.replace(from, "");
  } }), error => error.code === "ERR_ASSERTION" && error.message.includes(failure));
});

async function retentionDiscard({ mutate } = {}) {
  const disk = memoryOutboxStorage(), entered = deferred(), writing = deferred();
  let puts = 0, deletes = 0, retaining, discarding;
  const h = appOutboxHarness({ mutate, storage: { ...disk,
    async put(row) { puts++; entered.resolve(); await writing.promise; await disk.put(row); },
    async remove(id) { deletes++; await disk.remove(id); },
  }, fetch() { assert.fail("persistence-only retention and committed cancellation must never send"); } });
  try {
    const e = fictionalOutboxEntry(); await h.outbox.start(e.userId);
    const guards = h.load("lib/reloadGuard.ts");
    retaining = h.outbox.retain(e); await entered.promise;
    assert.equal(h.outbox.has(e.clientMessageId), false, "retention does not enqueue or replace a send waiter");
    assert.deepEqual(guards.reloadWouldLose(), ["outgoing-in-memory"]);
    discarding = h.outbox.discard(e.clientMessageId, e.userId); await flush();
    assert.equal(deletes, 0, "DISCARD_MUST_WAIT_FOR_RETAINED_WRITE");
    writing.resolve(); assert.equal((await retaining).ok, false);
    assert.equal((await discarding).ok, true);
    assert.equal(puts, 1); assert.equal(deletes, 1);
    assert.deepEqual(await disk.list(e.userId), []); assert.deepEqual(guards.reloadWouldLose(), []);
    const late = await h.outbox.retain(e);
    assert.equal(late.ok, false, "COMMITTED_DISCARD_MUST_REFUSE_OLD_RETAIN");
    assert.equal(late.error.message, "OUTBOX_DISCARD_PENDING");
    // Explicit enqueue after commit is covered by restore-order; only automatic
    // retention remains tombstoned across this singleton's stop/start.
    h.outbox.stop(); await h.outbox.start(e.userId);
    assert.equal((await h.outbox.retain(e)).ok, false);
    assert.equal(puts, 1); assert.deepEqual(await disk.list(e.userId), []);
    assert.deepEqual(guards.reloadWouldLose(), [], "refusing a tombstoned ID cannot leak a new reload hold");
  } finally { writing.resolve(); await retaining; await discarding; h.close(); }
}

test("actual app retained prefix and discard share one write barrier and a committed same-lifetime tombstone", { timeout: 5000 }, () => retentionDiscard());

test("retention reports failed persistence, stays reload-held and retries without enqueue/send effects", { timeout: 5000 }, async () => {
  const disk = memoryOutboxStorage(); let fail = true, puts = 0;
  const h = appOutboxHarness({ storage: { ...disk, async put(row) {
    puts++;
    if (fail) throw Object.assign(Error("OUTBOX_STORAGE_UNAVAILABLE"), { code: "OUTBOX_STORAGE_UNAVAILABLE" });
    await disk.put(row);
  } }, fetch() { assert.fail("retain must never send"); } });
  try {
    const e = fictionalOutboxEntry(); await h.outbox.start(e.userId);
    const guards = h.load("lib/reloadGuard.ts");
    const foreign = await h.outbox.retain({ ...e, userId: "another-owner" });
    assert.equal(foreign.ok, false); assert.equal(foreign.error.message, "OUTBOX_SCOPE_CHANGED");
    assert.equal(puts, 0); assert.deepEqual(guards.reloadWouldLose(), []);
    const failed = await h.outbox.retain(e);
    assert.equal(failed.ok, false); assert.equal(failed.error.code, "OUTBOX_STORAGE_UNAVAILABLE");
    assert.equal(h.outbox.size(), 0); assert.deepEqual(await disk.list(e.userId), []);
    assert.deepEqual(guards.reloadWouldLose(), ["outgoing-in-memory"]);
    fail = false; assert.equal((await h.outbox.retain(e)).ok, true);
    assert.equal(h.outbox.size(), 0); assert.equal((await disk.list(e.userId)).length, 1);
    assert.deepEqual(guards.reloadWouldLose(), []);
    assert.equal((await h.outbox.discard(e.clientMessageId)).ok, true);
    assert.deepEqual(await disk.list(e.userId), []); assert.deepEqual(guards.reloadWouldLose(), []);
  } finally { h.close(); }
});

test("an earlier committed retention cannot release a later pending/failed write's shared reload hold", { timeout: 5000 }, async () => {
  const disk = memoryOutboxStorage(), first = deferred(), second = deferred(); let puts = 0, one, two;
  const h = appOutboxHarness({ storage: { ...disk, async put(row) {
    if (++puts === 1) { await first.promise; await disk.put(row); }
    else { await second.promise; throw Error("FICTIONAL_PUT_ABORT"); }
  } }, fetch() { assert.fail("retain must never send"); } });
  try {
    const e = fictionalOutboxEntry(); await h.outbox.start(e.userId);
    const guards = h.load("lib/reloadGuard.ts");
    one = h.outbox.retain(e); two = h.outbox.retain({ ...e, content: "Fictional revised prefix" });
    await flush(); assert.equal(puts, 1);
    first.resolve(); assert.equal((await one).ok, true); await flush();
    assert.equal(puts, 2); assert.deepEqual(guards.reloadWouldLose(), ["outgoing-in-memory"]);
    second.resolve(); assert.equal((await two).ok, false);
    assert.deepEqual(guards.reloadWouldLose(), ["outgoing-in-memory"]);
    assert.equal((await h.outbox.discard(e.clientMessageId)).ok, true);
    assert.deepEqual(guards.reloadWouldLose(), []); assert.deepEqual(await disk.list(e.userId), []);
  } finally { first.resolve(); second.resolve(); await one; await two; h.close(); }
});

for (const [name, from, to, failure] of [
  ["write-barrier", "await writes.get(key)?.catch(() => undefined);", "", "DISCARD_MUST_WAIT_FOR_RETAINED_WRITE"],
  ["committed-tombstone", "entries.delete(clientMessageId);\n          busy.delete(clientMessageId);",
    "entries.delete(clientMessageId);\n          busy.delete(clientMessageId);\n          cancellations.delete(key);", "COMMITTED_DISCARD_MUST_REFUSE_OLD_RETAIN"],
]) test(`actual retention ${name} omission is killed by a literal outcome assertion`, { timeout: 5000 }, async () => {
  await assert.rejects(() => retentionDiscard({ mutate(file, source) {
    if (!file.endsWith("outboxRunner.ts")) return source;
    assert.equal(source.split(from).length, 2); return source.replace(from, to);
  } }), error => error.code === "ERR_ASSERTION" && error.message.includes(failure));
});
