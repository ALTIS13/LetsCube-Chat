import assert from "node:assert/strict";
import test from "node:test";
import { memoryOutboxStorage } from "../../artifacts/kub/src/lib/outbox/outboxStorage.ts";
import { appOutboxHarness, fictionalOutboxEntry, postgrestResponse } from "../helpers/app-outbox-harness.mjs";

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

async function unsavedPutReload({ mutate } = {}) {
  const disk = memoryOutboxStorage(), entered = deferred(), writing = deferred();
  let fail = true, posts = 0, pending;
  const h = appOutboxHarness({ mutate, storage: { ...disk, async put(row) {
    entered.resolve(); await writing.promise;
    if (fail) throw Object.assign(Error("OUTBOX_STORAGE_UNAVAILABLE"), { code: "OUTBOX_STORAGE_UNAVAILABLE" });
    await disk.put(row);
  } }, async fetch(input, init) {
    const request = new Request(input, init), url = new URL(request.url);
    assert.equal(url.origin, "http://127.0.0.1:54321"); assert.equal(url.pathname, "/rest/v1/messages");
    if (request.method === "POST") { posts++; return postgrestResponse(503, { code: "FICTIONAL_OFFLINE" }); }
    assert.equal(request.method, "GET"); return postgrestResponse(200, []);
  } });
  try {
    const e = fictionalOutboxEntry(); h.show(e); await h.outbox.start(e.userId);
    const guards = h.load("lib/reloadGuard.ts");
    const { shouldRestartQuietly } = h.load("lib/pwa/appUpdateNotice.ts");
    const quiet = () => shouldRestartQuietly({ pending: true, callBusy: false,
      wouldLose: guards.reloadWouldLose().length !== 0, hiddenSince: 0, lastInteractionAt: 0,
      lastQuietRestartAt: null, now: 1_000_000 });
    assert.deepEqual(guards.reloadWouldLose(), []); assert.equal(quiet(), true);
    pending = h.outbox.enqueue(e); await entered.promise;
    assert.deepEqual(guards.reloadWouldLose(), ["outgoing-in-memory"], "UNSAVED_TEXT_PUT_MUST_VETO_QUIET_RELOAD");
    assert.equal(quiet(), false); assert.equal(posts, 0);
    writing.resolve(); assert.equal((await pending).kind, "refused");
    assert.deepEqual(await disk.list(e.userId), []);
    assert.deepEqual(guards.reloadWouldLose(), ["outgoing-in-memory"]); assert.equal(quiet(), false);
    const shown = h.store.getState().messages[e.chatId][0];
    assert.equal(shown.failed, true);
    assert.equal(shown.send_error, "Не удалось сохранить сообщение на устройстве. Повторите отправку.");
    fail = false; assert.equal((await h.outbox.enqueue(e)).kind, "waiting");
    assert.equal(posts, 1); assert.equal((await disk.list(e.userId)).length, 1);
    assert.deepEqual(guards.reloadWouldLose(), []); assert.equal(quiet(), true);
  } finally { writing.resolve(); await pending; h.close(); }
}

test("actual app pending/failed unsaved text put vetoes quiet reload until committed retry", { timeout: 5000 }, () => unsavedPutReload());

test("actual app unsaved-put hold omission is killed by its quiet-reload loss assertion", { timeout: 5000 }, async () => {
  await assert.rejects(() => unsavedPutReload({ mutate(file, source) {
    if (!file.endsWith("outboxRunner.ts")) return source;
    const before = "const key = keyFor(entry);\n    holdPersistence(key);";
    assert.equal(source.split(before).length, 2);
    return source.replace(before, "const key = keyFor(entry);");
  } }), error => error.code === "ERR_ASSERTION" && /UNSAVED_TEXT_PUT_MUST_VETO_QUIET_RELOAD/.test(error.message));
});

async function cancellationReload({ mutate } = {}) {
  const disk = memoryOutboxStorage(), remove = deferred(); let fail = true, deletes = 0, posts = 0, pending;
  const storage = { ...disk, async remove(id) {
    if (++deletes === 1) await remove.promise;
    if (fail) throw Error("FICTIONAL_DELETE_ABORT");
    await disk.remove(id);
  } };
  const fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    assert.equal(url.origin, "http://127.0.0.1:54321"); assert.equal(url.pathname, "/rest/v1/messages");
    if (request.method === "POST") { posts++; return postgrestResponse(503, { code: "FICTIONAL_OFFLINE" }); }
    assert.equal(request.method, "GET"); return postgrestResponse(200, []);
  };
  const h = appOutboxHarness({ storage, fetch, mutate });
  try {
    const e = fictionalOutboxEntry(); h.show(e); await h.outbox.start(e.userId);
    assert.equal((await h.outbox.enqueue(e)).kind, "waiting"); assert.equal(posts, 1);
    const guards = h.load("lib/reloadGuard.ts");
    const { shouldRestartQuietly } = h.load("lib/pwa/appUpdateNotice.ts");
    const quiet = () => shouldRestartQuietly({ pending: true, callBusy: false,
      wouldLose: guards.reloadWouldLose().length !== 0, hiddenSince: 0, lastInteractionAt: 0,
      lastQuietRestartAt: null, now: 1_000_000 });
    assert.deepEqual(guards.reloadWouldLose(), []); assert.equal(quiet(), true, "known idle control can reload");
    pending = h.outbox.discard(e.clientMessageId, e.userId);
    assert.deepEqual(guards.reloadWouldLose(), ["outgoing-in-memory"], "PENDING_TEXT_CANCEL_MUST_VETO_QUIET_RELOAD");
    assert.equal(quiet(), false);
    remove.resolve(); assert.equal((await pending).ok, false);
    assert.deepEqual(guards.reloadWouldLose(), ["outgoing-in-memory"]); assert.equal(quiet(), false);
    h.outbox.stop(); await h.outbox.start(e.userId); h.outbox.retryNow();
    assert.equal(posts, 1); assert.deepEqual(guards.reloadWouldLose(), ["outgoing-in-memory"]);
    fail = false; assert.equal((await h.outbox.discard(e.clientMessageId, e.userId)).ok, true);
    assert.deepEqual(guards.reloadWouldLose(), []); assert.equal(quiet(), true);
    assert.deepEqual(await disk.list(e.userId), []);
    let freshPosts = 0;
    const fresh = appOutboxHarness({ storage: disk, async fetch() { freshPosts++; assert.fail("committed discard must not send after a quiet reload"); } });
    try { assert.deepEqual(await fresh.outbox.start(e.userId), []); assert.equal(freshPosts, 0); }
    finally { fresh.close(); }
  } finally { remove.resolve(); await pending; h.close(); }
}

test("actual app pending/failed text cancellation vetoes quiet reload until explicit committed delete retry", { timeout: 5000 }, () => cancellationReload());

test("actual app quiet-reload wiring omission is killed by the pending-cancellation loss assertion", { timeout: 5000 }, async () => {
  await assert.rejects(() => cancellationReload({ mutate(file, source) {
    if (!file.endsWith("appOutbox.ts")) return source;
    const before = 'holdPersistence: () => guardAgainstReload("outgoing-in-memory"),';
    assert.equal(source.split(before).length, 2);
    return source.replace(before, "");
  } }), error => error.code === "ERR_ASSERTION" && /PENDING_TEXT_CANCEL_MUST_VETO_QUIET_RELOAD/.test(error.message));
});

test("a stale-owner committed delete releases its reload hold without publishing into the new owner", { timeout: 5000 }, async () => {
  const disk = memoryOutboxStorage(), entered = deferred(), removal = deferred();
  const h = appOutboxHarness({ storage: { ...disk, async remove(id) { entered.resolve(); await removal.promise; await disk.remove(id); } },
    fetch() { assert.fail("this fixture performs no send"); } });
  let pending;
  try {
    const e = fictionalOutboxEntry(); await h.outbox.start(e.userId); await disk.put(e);
    const guards = h.load("lib/reloadGuard.ts");
    pending = h.outbox.discard(e.clientMessageId, e.userId); await entered.promise;
    assert.deepEqual(guards.reloadWouldLose(), ["outgoing-in-memory"]);
    h.outbox.stop(); await h.outbox.start("other-owner");
    assert.deepEqual(guards.reloadWouldLose(), ["outgoing-in-memory"]);
    removal.resolve(); assert.equal((await pending).ok, false, "old-owner result cannot publish after account switch");
    assert.deepEqual(await disk.list(e.userId), []);
    assert.deepEqual(guards.reloadWouldLose(), [], "COMMITTED_STALE_DELETE_MUST_RELEASE_ITS_HOLD");
    assert.equal(h.outbox.size(), 0);
  } finally { removal.resolve(); await pending; h.close(); }
});
