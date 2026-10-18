import assert from "node:assert/strict";
import nodeTest from "node:test";
import { createOutboxRunner } from "../../artifacts/kub/src/lib/outbox/outboxRunner.ts";
import { browserOutboxStorage, memoryOutboxStorage } from "../../artifacts/kub/src/lib/outbox/outboxStorage.ts";
import { appOutboxHarness, fictionalOutboxEntry, postgrestResponse } from "../helpers/app-outbox-harness.mjs";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const entry = (id = "owned", owner = "A", second = 0) => ({ clientMessageId: id, userId: owner,
  chatId: "owned-chat", topicId: null, type: "text", content: null, replyToId: null,
  forwardedFromId: null, mediaBucket: null, mediaPath: null, mediaUrl: null,
  clientSentAt: `2026-10-18T00:00:0${second}Z`, tempId: `tmp:${id}`, attempts: 0, nextAttemptAt: 0 });
const flush = () => new Promise(resolve => setImmediate(resolve));
const test = (name, run) => nodeTest(name, { timeout: 2000 }, run);
function deferred() { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }
function fixture(t, { remove, put, list, send, createRunner = createOutboxRunner } = {}) {
  const disk = memoryOutboxStorage(), sends = [], sent = [], refused = [], storageErrors = [], timers = new Set();
  const storage = { put: row => put ? put(row, disk) : disk.put(row),
    remove: id => remove ? remove(id, disk) : disk.remove(id), list: uid => list ? list(uid, disk) : disk.list(uid) };
  const runner = createRunner({ storage, async send(row) { sends.push(row.clientMessageId); return send ? send(row) : { failed: { status: 0 } }; },
    onWaiting() {}, onRefused: row => refused.push(row.clientMessageId), onSent: row => sent.push(row.clientMessageId),
    onStorageError: () => storageErrors.push(true), now: () => 0,
    timers: { set(run) { timers.add(run); return run; }, clear(run) { timers.delete(run); } } });
  t.after(() => runner.stop()); return { runner, disk, storage, sends, sent, refused, storageErrors, timers };
}

test("failed discard retains the entry, blocks retryNow/FIFO and permits explicit durable-delete retry", async t => {
  let fail = true;
  const h = fixture(t, { remove: async (id, disk) => { if (fail) throw Error("FICTIONAL_ABORT"); await disk.remove(id); } });
  await h.runner.start("A"); await h.runner.enqueue(entry());
  const failed = await h.runner.discard("owned");
  assert.equal(failed?.ok, false); assert.equal(h.runner.has("owned"), true);
  assert.equal((await h.runner.enqueue(entry())).kind, "refused", "failed cancellation cannot be replaced by a new enqueue");
  assert.equal((await h.runner.retain(entry())).ok, false);
  assert.equal((await h.disk.list("A")).length, 1);
  h.runner.retryNow(); await h.runner.start("A"); await flush(); assert.deepEqual(h.sends, ["owned"]);
  const newer = h.runner.enqueue(entry("newer", "A", 1)); await flush(); assert.deepEqual(h.sends, ["owned"]);
  fail = false; assert.equal((await h.runner.discard("owned")).ok, true);
  h.runner.retryNow(); await newer; assert.deepEqual(h.sends, ["owned", "newer"]);
});

test("inflight delete coalesces and cannot be bypassed by same-ID enqueue or a late send ACK", async t => {
  const deletion = deferred(), sending = deferred(); let removals = 0;
  const h = fixture(t, { send: () => sending.promise, remove: async (id, disk) => { removals++; await deletion.promise; await disk.remove(id); } });
  await h.runner.start("A"); const pending = h.runner.enqueue(entry()); await flush();
  const first = h.runner.discard("owned"), second = h.runner.discard("owned");
  await flush(); const bypass = await h.runner.enqueue(entry());
  assert.equal(bypass.kind, "refused"); assert.equal(removals, 1);
  assert.equal((await h.runner.retain(entry())).ok, false, "pending cancellation also refuses automatic retention");
  sending.resolve({ sent: {} }); await flush(); assert.deepEqual(h.sent, []);
  deletion.resolve(); assert.equal((await first).ok, true); assert.equal((await second).ok, true);
  assert.equal((await pending).kind, "waiting"); assert.equal(h.runner.has("owned"), false);
});

test("failed cancellation survives same-owner stop/start without sending a rehydrated disk row", async t => {
  const h = fixture(t, { remove: async () => { throw Error("FICTIONAL_ABORT"); } });
  await h.runner.start("A"); await h.runner.enqueue(entry()); await h.runner.discard("owned");
  h.runner.stop(); await h.runner.start("A"); h.runner.retryNow(); await flush();
  assert.deepEqual(h.sends, ["owned"]); assert.equal(h.runner.has("owned"), true);
});

test("discard refuses a foreign owner and late old-owner failure cannot block another owner's same ID", async t => {
  const deletion = deferred();
  const h = fixture(t, { remove: () => deletion.promise });
  await h.runner.start("A"); await h.runner.enqueue(entry());
  assert.equal((await h.runner.discard("owned", "B")).ok, false);
  const old = h.runner.discard("owned", "A"); await flush();
  await h.runner.start("B"); await h.runner.enqueue(entry("owned", "B"));
  deletion.reject(Error("FICTIONAL_ABORT")); assert.equal((await old).ok, false);
  h.runner.retryNow(); await flush(); assert.deepEqual(h.sends, ["owned", "owned", "owned"]);
});

test("discard waits for an already-held put before deleting, with no late write resurrection", async t => {
  const writing = deferred();
  const h = fixture(t, { put: async (row, disk) => { await writing.promise; await disk.put(row); } });
  await h.runner.start("A"); const pending = h.runner.enqueue(entry()); await flush();
  const discard = h.runner.discard("owned"); await flush(); writing.resolve();
  assert.equal((await discard).ok, true); assert.equal((await pending).kind, "waiting");
  assert.deepEqual(await h.disk.list("A"), []); assert.deepEqual(h.sends, []);
});

test("failed put retains failed work without send/unhandled rejection and explicit reenqueue can recover", async t => {
  let fail = true;
  const h = fixture(t, { put: async (row, disk) => { if (fail) throw Error("FICTIONAL_PUT_ABORT"); await disk.put(row); } });
  await h.runner.start("A"); assert.equal((await h.runner.enqueue(entry())).kind, "refused");
  assert.equal(h.runner.has("owned"), true); h.runner.retryNow(); await flush(); assert.deepEqual(h.sends, []);
  fail = false; assert.equal((await h.runner.enqueue(entry())).kind, "waiting"); assert.deepEqual(h.sends, ["owned"]);
});

test("restore failure cannot ACK a held put which later aborts", async t => {
  const listing = deferred(), writing = deferred();
  const h = fixture(t, { list: () => listing.promise, put: () => writing.promise });
  const starting = h.runner.start("A"), pending = h.runner.enqueue(entry()); await flush();
  listing.reject(Error("FICTIONAL_READ_ABORT")); await starting;
  writing.reject(Error("FICTIONAL_PUT_ABORT"));
  assert.equal((await pending).kind, "refused", "a failed write is never a saved waiting message");
  assert.deepEqual(h.sends, []);
});

test("server ACK remains ACK when disk cleanup fails, reports storage error and never auto-resends locally", async t => {
  const h = fixture(t, { send: async () => ({ sent: {} }), remove: async () => { throw Error("FICTIONAL_DELETE_ABORT"); } });
  await h.runner.start("A"); assert.equal((await h.runner.enqueue(entry())).kind, "sent");
  assert.deepEqual(h.sent, ["owned"]); assert.deepEqual(h.storageErrors, [true]);
  h.runner.retryNow(); await flush(); assert.deepEqual(h.sends, ["owned"]);
});

async function postAckCleanup({ discard = true, firstFails = false, mutate } = {}) {
  const disk = memoryOutboxStorage(), entered = deferred(), release = deferred();
  let removes = 0, posts = 0, recencyWrites = 0, sending;
  const h = appOutboxHarness({ mutate,
    storage: { ...disk, async remove(id) {
      if (++removes === 1) {
        entered.resolve(); await release.promise;
        if (firstFails) throw Error("FICTIONAL_POST_ACK_CLEANUP_ABORT");
      }
      await disk.remove(id);
    } },
    async fetch(input, init) {
      const request = new Request(input, init), url = new URL(request.url);
      assert.equal(url.origin, "http://127.0.0.1:54321");
      if (request.method === "POST" && url.pathname === "/rest/v1/messages") {
        posts++;
        const body = await request.json();
        return postgrestResponse(201, { ...body, id: "e5070000-0000-4000-8000-000000000301", created_at: body.client_sent_at });
      }
      assert.equal(request.method, "PATCH"); assert.equal(url.pathname, "/rest/v1/chats");
      recencyWrites++; return new Response(null, { status: 204 });
    },
  });
  try {
    const e = fictionalOutboxEntry(); h.show(e); await h.outbox.start(e.userId);
    sending = h.outbox.enqueue(e);
    await Promise.race([entered.promise, sending.then(outcome => {
      throw Error(`POST_ACK_STAGE_NOT_REACHED:${outcome.kind}:posts=${posts}:removes=${removes}`);
    })]);
    assert.equal(posts, 1, "the real SDK has already returned a successful server ACK");
    assert.equal(h.store.getState().messages[e.chatId].length, 1);
    if (discard) {
      assert.equal((await h.outbox.discard(e.clientMessageId, e.userId)).ok, true);
      h.store.getState().removeMessage(e.chatId, e.tempId);
      assert.equal(h.store.getState().messages[e.chatId].length, 0);
      assert.equal((await disk.list(e.userId)).length, 0);
    }
    release.resolve(); const outcome = await sending; await flush();
    if (discard) {
      assert.equal(h.store.getState().messages[e.chatId].length, 0, "POST_ACK_CANCEL_MUST_NOT_RESURRECT_BUBBLE");
      assert.equal(recencyWrites, 0, "discarded cleanup continuation cannot publish chat recency");
      assert.equal(outcome.kind, "waiting");
    } else {
      assert.equal(outcome.kind, "sent");
      assert.equal(h.store.getState().messages[e.chatId][0].id, "e5070000-0000-4000-8000-000000000301");
      assert.equal(recencyWrites, 1);
    }
    assert.equal(posts, 1); assert.equal((await disk.list(e.userId)).length, 0);
  } finally { release.resolve(); await sending?.catch(() => undefined); h.close(); }
}

test("actual app post-ACK held cleanup without discard still publishes the acknowledged row once", () => postAckCleanup({ discard: false }));
test("actual app post-ACK discard cannot be undone by the older held cleanup completion", () => postAckCleanup());
test("actual app post-ACK discard cannot be undone by the older held cleanup rejection", () => postAckCleanup({ firstFails: true }));
test("actual app post-ACK ownership-check omission is killed by real-store resurrection", async () => {
  const before = "if (!ownsSession() || entries.get(entry.clientMessageId) !== entry || cancelled(entry)) return;\n      entries.delete(entry.clientMessageId);\n      busy.delete(entry.clientMessageId);";
  await assert.rejects(() => postAckCleanup({ mutate(file, source) {
    if (!file.endsWith("outboxRunner.ts")) return source;
    assert.equal(source.split(before).length, 2);
    return source.replace(before, "if (!ownsSession()) return;\n      entries.delete(entry.clientMessageId);\n      busy.delete(entry.clientMessageId);");
  } }), error => error.code === "ERR_ASSERTION" && /POST_ACK_CANCEL_MUST_NOT_RESURRECT_BUBBLE/.test(error.message));
});

test("failed discard while restore holds a snapshot retains it but cannot open the restore/send fence", async t => {
  const listing = deferred();
  const h = fixture(t, { list: () => listing.promise, remove: async () => { throw Error("FICTIONAL_DELETE_ABORT"); } });
  const start = h.runner.start("A"); await flush(); assert.equal((await h.runner.discard("owned")).ok, false);
  listing.resolve([entry()]); await start; await flush();
  assert.equal(h.runner.has("owned"), true); h.runner.retryNow(); await flush(); assert.deepEqual(h.sends, []);
});

test("actual app marks a failed durable put visibly failed, with no SDK request", async () => {
  const storage = { ...memoryOutboxStorage(), async put() {
    throw Object.assign(Error("OUTBOX_STORAGE_UNAVAILABLE"), { code: "OUTBOX_STORAGE_UNAVAILABLE" });
  } };
  const h = appOutboxHarness({ storage, fetch() { assert.fail("failed persistence cannot reach SDK transport"); } });
  try {
    const e = fictionalOutboxEntry(); h.show(e); await h.outbox.start(e.userId);
    assert.equal((await h.outbox.enqueue(e)).kind, "refused");
    const shown = h.store.getState().messages[e.chatId][0];
    assert.equal(shown.failed, true); assert.equal(shown.pending, false);
    assert.equal(shown.send_error, "Не удалось сохранить сообщение на устройстве. Повторите отправку.");
  } finally { h.close(); }
});

test("unavailable IndexedDB is an explicit error, never a successful memory-mode put/delete/list", async () => {
  const storage = browserOutboxStorage();
  for (const action of [() => storage.put(entry()), () => storage.remove("owned"), () => storage.list("A")]) {
    await assert.rejects(action, { code: "OUTBOX_STORAGE_UNAVAILABLE" });
  }
});

test("loaded omission of cancellation scheduling guard is killed by literal no-auto-send assertion", async t => {
  const url = new URL("../../artifacts/kub/src/lib/outbox/outboxRunner.ts", import.meta.url);
  const source = readFileSync(url, "utf8"), before = ".filter(cancelled).map";
  assert.equal(source.split(before).length, 2);
  const code = ts.transpileModule(source.replace(before, ".filter(() => false).map"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  runInThisContext(`(function(module,exports,require){${code}\n})`)(module, module.exports, createRequire(url));
  const h = fixture(t, { createRunner: module.exports.createOutboxRunner, remove: async () => { throw Error("FICTIONAL_ABORT"); } });
  await h.runner.start("A"); await h.runner.enqueue(entry()); await h.runner.discard("owned");
  h.runner.retryNow(); await flush();
  assert.throws(() => assert.equal(h.sends.length, 1), { code: "ERR_ASSERTION", actual: 2, expected: 1 });
});
