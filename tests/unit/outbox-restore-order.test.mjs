import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import { createOutboxRunner } from "../../artifacts/kub/src/lib/outbox/outboxRunner.ts";
import { memoryOutboxStorage } from "../../artifacts/kub/src/lib/outbox/outboxStorage.ts";

const ME = "11111111-1111-4111-8111-000000000001";
const OTHER = "11111111-1111-4111-8111-000000000002";
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function entry(id, second = 0, userId = ME) {
  return { clientMessageId: id, userId, chatId: "fictional-chat", topicId: null, type: "text", content: "Fictional text",
    replyToId: null, forwardedFromId: null, mediaBucket: null, mediaPath: null, mediaUrl: null,
    clientSentAt: `2026-10-18T00:00:0${second}.000Z`, tempId: `tmp:${id}`, attempts: 0, nextAttemptAt: 0 };
}
async function fixture(t, { stored = [], list, send, put, createRunner = createOutboxRunner } = {}) {
  const disk = memoryOutboxStorage(), sent = [], acknowledged = [], waiting = [], reads = [], timers = new Set();
  for (const row of stored) await disk.put(row);
  const runner = createRunner({
    storage: {
      list(userId) { reads.push(userId); return list ? list(userId, disk) : disk.list(userId); },
      async put(row) { if (put) await put(row); await disk.put(row); },
      remove: id => disk.remove(id),
    },
    send: async row => { sent.push(row.clientMessageId); return send ? send(row) : { sent: { id: `server:${row.clientMessageId}` } }; },
    onSent: row => acknowledged.push(row.clientMessageId), onWaiting: row => waiting.push(row.clientMessageId),
    onRefused() { assert.fail("no fixture refusal"); }, now: () => 0,
    timers: { set(run) { timers.add(run); return run; }, clear(run) { timers.delete(run); } },
  });
  t.after(() => runner.stop());
  return { runner, disk, sent, acknowledged, waiting, reads, timers };
}
const check = (name, run) => test(name, { timeout: 2000 }, run);

async function assertRestoreOrder(t, createRunner = createOutboxRunner) {
  const gate = deferred(), h = await fixture(t, { stored: [entry("older")], list: () => gate.promise, createRunner });
  const starting = h.runner.start(ME);
  const pending = h.runner.enqueue(entry("newer", 1));
  await flush(); const before = [...h.sent];
  gate.resolve([entry("older")]); await starting; await pending; await flush();
  assert.deepEqual(before, [], "RESTORE_BARRIER_MUST_PREVENT_EARLY_SEND");
  assert.deepEqual(h.sent, ["older", "newer"]);
  assert.deepEqual(h.acknowledged, ["older", "newer"]);
}
check("delayed restore sends older before a newly persisted same-chat entry", t => assertRestoreOrder(t));

check("reconnect retries cannot open the restore barrier or repeat its list read", async t => {
  const gate = deferred(), h = await fixture(t, { list: () => gate.promise });
  const starting = h.runner.start(ME), pending = h.runner.enqueue(entry("newer", 1));
  h.runner.retryNow(); h.runner.retryNow(); await flush(); const before = [...h.sent];
  gate.resolve([entry("older")]); await starting; await pending; await flush();
  assert.deepEqual(before, []); assert.deepEqual(h.sent, ["older", "newer"]); assert.deepEqual(h.reads, [ME]);
});

async function assertDuplicateInit(t, createRunner = createOutboxRunner) {
  const gate = deferred(), h = await fixture(t, { list: () => gate.promise, createRunner });
  const first = h.runner.start(ME), second = h.runner.start(ME);
  let settled = false; void second.then(() => { settled = true; });
  await flush(); const early = settled; gate.resolve([entry("older")]);
  const restored = await Promise.all([first, second]); await flush();
  assert.equal(early, false); assert.deepEqual(restored.map(rows => rows.map(row => row.clientMessageId)), [["older"], ["older"]]);
  assert.deepEqual(h.reads, [ME], "DUPLICATE_INIT_MUST_SHARE_ONE_RESTORE"); assert.deepEqual(h.sent, ["older"]);
  await h.runner.start(ME); await flush(); assert.deepEqual(h.reads, [ME]); assert.deepEqual(h.sent, ["older"]);
}
check("duplicate same-owner init waits for the same restore instead of returning a partial queue", t => assertDuplicateInit(t));

function loadedOmission(literal, replacement) {
  const url = new URL("../../artifacts/kub/src/lib/outbox/outboxRunner.ts", import.meta.url);
  const source = readFileSync(url, "utf8");
  assert.equal(source.split(literal).length, 2, "one literal loaded omission target");
  const code = ts.transpileModule(source.replace(literal, () => replacement), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: "outboxRunner.omission.cjs" })(
    createRequire(url), module, module.exports,
  );
  return module.exports.createOutboxRunner;
}

check("loaded omission of the restore send barrier is killed by actual send order", async t => {
  const createRunner = loadedOmission("if (!userId || !restored) return;", "if (!userId) return;");
  await assert.rejects(() => assertRestoreOrder(t, createRunner),
    error => error.code === "ERR_ASSERTION" && /RESTORE_BARRIER_MUST_PREVENT_EARLY_SEND/.test(error.message));
});

check("loaded omission of duplicate init coalescing is killed by the shared restore contract", async t => {
  const createRunner = loadedOmission("if (restoring) return restoring;", "");
  await assert.rejects(() => assertDuplicateInit(t, createRunner),
    error => error.code === "ERR_ASSERTION" && /DUPLICATE_INIT_MUST_SHARE_ONE_RESTORE/.test(error.message));
});

check("restore rejection stays closed and settles queued work as waiting until explicit init succeeds", async t => {
  const gate = deferred(); let fail = true;
  const h = await fixture(t, { stored: [entry("older")], list: (uid, disk) => fail ? gate.promise : disk.list(uid) });
  const starting = h.runner.start(ME).then(rows => ({ rows }), error => ({ error }));
  const pending = h.runner.enqueue(entry("newer", 1)); await flush(); gate.reject(Error("FICTIONAL_LIST_FAILURE"));
  const result = await starting;
  assert.equal(result.error, undefined, "initialization must not leak an unhandled list rejection");
  assert.equal((await pending).kind, "waiting"); assert.deepEqual(h.sent, []);
  h.runner.retryNow(); await flush(); assert.deepEqual(h.reads, [ME]); assert.deepEqual(h.sent, []);
  assert.equal((await h.runner.enqueue(entry("latest", 2))).kind, "waiting");
  assert.deepEqual(h.sent, []); assert.equal((await h.disk.list(ME)).length, 3);
  fail = false; await h.runner.start(ME); await flush();
  assert.deepEqual(h.reads, [ME, ME]); assert.deepEqual(h.sent, ["older", "newer", "latest"]);
});

check("synchronous list failure also leaves an explicit same-owner init retryable", async t => {
  let fail = true;
  const h = await fixture(t, { list: (uid, disk) => { if (fail) throw Error("FICTIONAL_SYNC_FAILURE"); return disk.list(uid); } });
  assert.deepEqual(await h.runner.start(ME), []); assert.deepEqual(h.sent, []);
  fail = false; await h.runner.start(ME);
  assert.equal((await h.runner.enqueue(entry("newer", 1))).kind, "sent"); assert.deepEqual(h.reads, [ME, ME]);
});

for (const reset of ["account switch", "same-owner stop/start"]) {
  for (const completion of ["resolve", "reject"]) {
    check(`${reset}: stale ${completion} cannot unlock or erase the current restore`, async t => {
      const old = deferred(), current = deferred(); let read = 0;
      const h = await fixture(t, { list: () => ++read === 1 ? old.promise : current.promise });
      const first = h.runner.start(ME).catch(() => []); await flush();
      const abandoned = h.runner.enqueue(entry("before-reset", 1)); await flush();
      if (reset === "same-owner stop/start") h.runner.stop();
      const nextOwner = reset === "account switch" ? OTHER : ME, next = h.runner.start(nextOwner);
      const pending = h.runner.enqueue(entry("after-reset", 2, nextOwner)); await flush();
      old[completion](completion === "resolve" ? [entry("old-session")] : Error("FICTIONAL_STALE_FAILURE"));
      await first; await flush(); const before = [...h.sent];
      current.resolve([entry("current-older", 0, nextOwner)]); await next; await pending; await flush();
      assert.equal((await abandoned).kind, "waiting"); assert.deepEqual(before, []);
      assert.deepEqual(h.sent, ["current-older", "after-reset"]); assert.equal(h.runner.has("old-session"), false);
      assert.deepEqual(h.reads, [ME, nextOwner]);
    });
  }
}

check("stop disposes a pending restore without late sends, hydration or timers", async t => {
  const gate = deferred(), h = await fixture(t, { list: () => gate.promise });
  const starting = h.runner.start(ME), pending = h.runner.enqueue(entry("newer", 1)); await flush();
  h.runner.stop(); gate.resolve([entry("older")]);
  assert.deepEqual(await starting, []); assert.equal((await pending).kind, "waiting"); await flush();
  assert.deepEqual(h.sent, []); assert.equal(h.runner.size(), 0); assert.equal(h.timers.size, 0);
  assert.deepEqual((await h.disk.list(ME)).map(row => row.clientMessageId), ["newer"]);
});

check("a held enqueue stays unsent until its own persistence finishes after restore", async t => {
  const list = deferred(), put = deferred();
  const h = await fixture(t, { list: () => list.promise, put: row => row.clientMessageId === "newer" ? put.promise : undefined });
  const starting = h.runner.start(ME), pending = h.runner.enqueue(entry("newer", 1));
  list.resolve([entry("older")]); await starting; await flush(); assert.deepEqual(h.sent, ["older"]);
  put.resolve(); assert.equal((await pending).kind, "sent"); assert.deepEqual(h.sent, ["older", "newer"]);
});

check("restore cannot replace an already enqueued same-ID snapshot or send it twice", async t => {
  const gate = deferred(), payloads = [];
  const h = await fixture(t, { list: () => gate.promise, send: async row => { payloads.push(row.content); return { sent: row }; } });
  const starting = h.runner.start(ME), pending = h.runner.enqueue({ ...entry("same"), content: "Current queued text" });
  await flush(); gate.resolve([{ ...entry("same"), content: "Stale stored text" }]); await starting; await pending; await flush();
  assert.deepEqual(payloads, ["Current queued text"]); assert.deepEqual(h.sent, ["same"]);
});

check("discard during restore settles waiting without sending the discarded entry", async t => {
  const gate = deferred(), h = await fixture(t, { list: () => gate.promise });
  const starting = h.runner.start(ME), pending = h.runner.enqueue(entry("discarded", 1)); await flush();
  await h.runner.discard("discarded"); const timersBefore = h.timers.size;
  gate.resolve([entry("older")]); await starting; await flush();
  assert.equal((await pending).kind, "waiting"); assert.equal(timersBefore, 0); assert.deepEqual(h.sent, ["older"]);
});

async function assertDiscardedSnapshot(t, enqueued, createRunner = createOutboxRunner) {
  const gate = deferred(), row = entry("discarded");
  const h = await fixture(t, { stored: enqueued ? [] : [row], list: () => gate.promise, createRunner });
  const starting = h.runner.start(ME), pending = enqueued ? h.runner.enqueue(row) : null;
  await flush(); await h.runner.discard("discarded");
  assert.deepEqual(await h.disk.list(ME), []);
  if (pending) assert.equal((await pending).kind, "waiting");
  gate.resolve([row]); const restored = await starting; await flush();
  assert.deepEqual(h.sent, [], "DISCARD_MUST_SURVIVE_STALE_RESTORE_SNAPSHOT");
  assert.deepEqual(restored, []); assert.equal(h.runner.size(), 0);
  assert.equal((await h.runner.enqueue(entry("fresh", 1))).kind, "sent"); assert.deepEqual(h.sent, ["fresh"]);
}
for (const enqueued of [false, true]) {
  check(`discarded ${enqueued ? "newly enqueued" : "previously stored"} entry cannot return from its stale restore snapshot`,
    t => assertDiscardedSnapshot(t, enqueued));
}

check("loaded omission of restore discard tombstones is killed by stale snapshot publication", async t => {
  const createRunner = loadedOmission("discardedDuringRestore.has(entry.clientMessageId) || ", "");
  await assert.rejects(() => assertDiscardedSnapshot(t, true, createRunner),
    error => error.code === "ERR_ASSERTION" && /DISCARD_MUST_SURVIVE_STALE_RESTORE_SNAPSHOT/.test(error.message));
});

check("discard tombstones survive a failed restore until successful same-owner initialization", async t => {
  const failed = deferred(), retry = deferred(); let reads = 0;
  const h = await fixture(t, { stored: [entry("discarded")], list: () => ++reads === 1 ? failed.promise : retry.promise });
  const first = h.runner.start(ME); await flush(); await h.runner.discard("discarded");
  failed.reject(Error("FICTIONAL_LIST_FAILURE")); await first;
  const second = h.runner.start(ME); retry.resolve([entry("discarded")]);
  assert.deepEqual(await second, []); await flush(); assert.deepEqual(h.sent, []);
  assert.equal((await h.runner.enqueue(entry("discarded", 1))).kind, "sent");
  assert.deepEqual(h.sent, ["discarded"]);
});

for (const completion of ["resolve", "reject"]) {
  check(`stale owner restore ${completion} cannot clear the next owner's discard tombstones`, async t => {
    const old = deferred(), current = deferred(); let reads = 0;
    const h = await fixture(t, { list: () => ++reads === 1 ? old.promise : current.promise });
    const first = h.runner.start(ME); await flush(); const second = h.runner.start(OTHER);
    const row = entry("discarded", 0, OTHER), pending = h.runner.enqueue(row);
    await flush(); await h.runner.discard("discarded"); assert.equal((await pending).kind, "waiting");
    old[completion](completion === "resolve" ? [] : Error("FICTIONAL_STALE_FAILURE")); await first; await flush();
    current.resolve([row]); assert.deepEqual(await second, []); await flush(); assert.deepEqual(h.sent, []);
  });
}

check("explicit current reenqueue keeps its new payload despite an older discarded snapshot", async t => {
  const gate = deferred(), payloads = [];
  const h = await fixture(t, { list: () => gate.promise, send: async row => { payloads.push(row.content); return { sent: row }; } });
  const starting = h.runner.start(ME), row = entry("same");
  const first = h.runner.enqueue(row); await flush(); await h.runner.discard("same");
  assert.equal((await first).kind, "waiting");
  const second = h.runner.enqueue({ ...row, content: "Explicit current reenqueue" }); await flush();
  gate.resolve([row]); await starting; assert.equal((await second).kind, "sent"); await flush();
  assert.deepEqual(h.sent, ["same"]); assert.deepEqual(payloads, ["Explicit current reenqueue"]);
});
