import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8").replaceAll("\r\n", "\n");
const consumerSource = read("lib/deliveryReceipts.ts");
const schedulerSource = read("lib/receiptScheduler.ts");
const CHAT = "8c7c07ca-f2b2-4a9d-9c8d-e186ba40268d";
const FIRST = "2026-10-07T00:00:01.123456Z";
const SECOND = "2026-10-07T00:00:01.123457Z";

function compile(source, imports, globals = {}) {
  const module = { exports: {} };
  const result = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    transformers: { before: [(context) => {
      const visit = (node) => ts.isMetaProperty(node) ? ts.factory.createIdentifier("testImportMeta")
        : ts.visitEachChild(node, visit, context);
      return (node) => ts.visitNode(node, visit);
    }] },
  });
  assert.equal(result.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(result.outputText, {
    module, exports: module.exports,
    require(name) { assert.ok(Object.hasOwn(imports, name), `unexpected dependency ${name}`); return imports[name]; },
    ...globals,
  });
  return module.exports;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

// The consumer, scheduler, availability and microsecond parser are real source.
// Only store notifications, timers, RPC replies and event publication are fictional.
function fixture({ consumer = consumerSource, scheduler = schedulerSource } = {}) {
  let state = { currentUser: { id: "A" }, accountEpoch: 1 }, nextTimer = 0;
  const timers = new Map(), listeners = new Set(), calls = [], reads = [], errors = [], answers = [];
  const clock = {
    setTimeout(callback, ms) { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const availabilityModule = compile(read("lib/rpcAvailability.ts"), {});
  const availability = availabilityModule.createRpcAvailability({ now: () => 0 });
  const schedulerModule = compile(scheduler, {
    "./readMarkWatermark.ts": compile(read("lib/readMarkWatermark.ts"), {}),
  });
  const useAppStore = {
    getState: () => state,
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
  };
  const api = compile(consumer, {
    "@/store/app.store": { useAppStore },
    "@/lib/receiptScheduler": schedulerModule,
    "@/lib/rpcAvailability": { ...availabilityModule, rpcAvailability: availability },
    "@/lib/notificationEvents": { dispatchChatNotificationsRead(detail) {
      reads.push({ userId: state.currentUser?.id ?? null, epoch: state.accountEpoch, ...detail });
    } },
  }, { ...clock, Date, testImportMeta: { env: { DEV: true } }, console: { warn: (name) => errors.push(name) } });
  const client = { rpc(fn, args) {
    calls.push({ userId: state.currentUser?.id ?? null, epoch: state.accountEpoch, fn, args });
    return answers.shift() ?? Promise.resolve({ error: null });
  } };
  const drain = () => new Promise((resolve) => setImmediate(resolve));
  return {
    api, client, calls, reads, errors, timers, answers, availability, schedulerModule, clock, drain,
    change(userId, notify = true) {
      const previous = state;
      state = { currentUser: userId ? { id: userId } : null, accountEpoch: state.accountEpoch + 1 };
      if (notify) for (const listener of listeners) listener(state, previous);
    },
    hold() { const held = deferred(); answers.push(held.promise); return held; },
    async flush() {
      for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); }
      await drain();
    },
  };
}

async function confirmedOwner(lane, options, roundTrip = false) {
  const f = fixture(options);
  f.api[lane](f.client, CHAT, FIRST); await f.flush();
  assert.equal(f.calls.length, 1, "A receipt positive control");
  assert.equal(f.calls[0].userId, "A");
  if (roundTrip) { f.change(null); f.change("A"); } else f.change("B");
  f.api[lane](f.client, CHAT, FIRST); await f.flush();
  assert.equal(f.calls.length, 2, "new owner must report its own equal watermark");
  assert.equal(f.calls[1].epoch, roundTrip ? 3 : 2);
}

for (const lane of ["scheduleMarkChatRead", "scheduleMarkChatDelivered"]) {
  test(`actual consumer: ${lane} confirmed A watermark cannot suppress B`, () => confirmedOwner(lane));
  test(`actual consumer: ${lane} same-owner epoch ABA gets a fresh watermark`, () => confirmedOwner(lane, undefined, true));
}

async function cancelledTimers(options) {
  const f = fixture(options);
  f.api.scheduleMarkChatRead(f.client, CHAT, FIRST);
  f.api.scheduleMarkChatDelivered(f.client, CHAT, FIRST);
  assert.deepEqual([...f.timers.values()].map((timer) => timer.ms).sort((a, b) => a - b), [700, 2500],
    "read/delivered debounce remains 700/2500 ms");
  f.change("B");
  assert.equal(f.timers.size, 0, "owner replacement cancels both receipt lanes immediately");
}
test("actual consumer: account replacement cancels both pending lanes", () => cancelledTimers());

async function retiredTimer(options, notify = true) {
  const f = fixture(options);
  f.api.scheduleMarkChatRead(f.client, CHAT, FIRST);
  const queued = [...f.timers.values()][0].callback;
  f.change("B", notify);
  queued(); await f.drain();
  assert.equal(f.calls.length, 0, "retired timer cannot dispatch with current account authority");
}
test("actual consumer: a queued callback stays inert after its timer is cancelled", () => retiredTimer());
test("actual consumer: current store fences a timer before transition listeners run", () => retiredTimer(undefined, false));
async function retiredEpoch(options) {
  const f = fixture(options); f.api.scheduleMarkChatRead(f.client, CHAT, FIRST);
  const queued = [...f.timers.values()][0].callback; f.change("A", false);
  queued(); await f.drain();
  assert.equal(f.calls.length, 0, "advanced account epoch fences the queued receipt before notification");
}
test("actual consumer: synchronous epoch guard fences same-owner replacement before listeners", () => retiredEpoch());

async function lateReply(error, options, reject = false) {
  const f = fixture(options), old = f.hold();
  f.api.scheduleMarkChatRead(f.client, CHAT, FIRST); await f.flush();
  assert.equal(f.calls[0].userId, "A", "A dispatch positive control");
  assert.equal(f.reads.length, 0, "old RPC is actually held");
  f.change("B");
  const before = f.calls.length;
  if (reject) old.reject(new Error("fictional offline")); else old.resolve({ error });
  await f.drain();
  assert.equal(f.calls.length, before, "retired reply cannot start a fallback RPC");
  assert.equal(f.availability.shouldTry("mark_chat_read_through"), true, "retired reply cannot change shared RPC capability");
  assert.equal(f.errors.length, 0, "retired reply cannot publish an error");
  assert.equal(f.reads.length, 0, "retired ACK cannot publish a read event into B");
}
test("actual consumer: old ACK cannot publish into B", () => lateReply(null));
test("actual consumer: old missing-RPC reply cannot fall back under B", () => lateReply({ code: "PGRST202" }));
test("actual consumer: old RPC error cannot publish into B", () => lateReply({ code: "42501" }));
test("actual consumer: old thrown RPC cannot publish into B", () => lateReply(null, undefined, true));
test("actual consumer: signed-out receipt calls schedule nothing", async () => {
  const f = fixture(); f.change(null);
  f.api.scheduleMarkChatRead(f.client, CHAT, FIRST); f.api.scheduleMarkChatDelivered(f.client, CHAT, FIRST);
  assert.equal(f.timers.size, 0, "signed-out consumer cannot schedule receipts"); await f.flush();
  assert.equal(f.calls.length, 0);
});

test("actual consumer: current owner keeps debounce, equal suppression and microseconds", async () => {
  const f = fixture();
  f.api.scheduleMarkChatRead(f.client, CHAT, FIRST); f.api.scheduleMarkChatRead(f.client, CHAT, SECOND);
  assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].ms, 700);
  await f.flush(); assert.equal(f.calls[0].args.p_read_through, SECOND);
  f.api.scheduleMarkChatRead(f.client, CHAT, SECOND); await f.flush(); assert.equal(f.calls.length, 1);
  f.api.scheduleMarkChatRead(f.client, CHAT, "2026-10-07T00:00:01.123458Z"); await f.flush();
  assert.equal(f.calls.length, 2);
});
test("actual consumer: current missing RPC falls back and publishes exactly one read", async () => {
  const f = fixture(); f.answers.push(Promise.resolve({ error: { code: "PGRST202" } }));
  f.api.scheduleMarkChatRead(f.client, CHAT, FIRST); await f.flush();
  assert.deepEqual(f.calls.map((call) => call.fn), ["mark_chat_read_through", "mark_chat_read"]);
  assert.equal(f.reads.length, 1); assert.equal(f.reads[0].readUntil, FIRST);
});
test("actual consumer: current error stays retryable", async () => {
  const f = fixture(); f.answers.push(Promise.resolve({ error: { code: "57014" } }));
  f.api.scheduleMarkChatRead(f.client, CHAT, FIRST); await f.flush();
  assert.equal(f.errors.length, 1); assert.equal(f.reads.length, 0);
  f.api.scheduleMarkChatRead(f.client, CHAT, FIRST); await f.flush();
  assert.equal(f.calls.length, 2); assert.equal(f.reads.length, 1);
});

async function disposedCallback(options) {
  const f = fixture(options);
  const scheduler = f.schedulerModule.createReceiptScheduler({
    setTimer: f.clock.setTimeout, clearTimer: f.clock.clearTimeout, now: () => 0,
    availability: f.availability, isMissingRpc: () => false,
  });
  scheduler.scheduleRead(f.client, CHAT, FIRST);
  const queued = [...f.timers.values()][0].callback;
  scheduler.dispose(); scheduler.dispose();
  assert.equal(f.timers.size, 0, "disposal clears pending timers");
  queued(); await f.drain();
  assert.equal(f.calls.length, 0, "disposed scheduler cannot dispatch a queued callback without an owner adapter");
}
test("actual scheduler: idempotent disposal fences a callback already queued by the timer runtime", () => disposedCallback());
test("actual consumer: late A ACK cannot disturb B's newer confirmed watermark", async () => {
  const f = fixture(), old = f.hold();
  f.api.scheduleMarkChatRead(f.client, CHAT, FIRST); await f.flush();
  f.change("B"); f.api.scheduleMarkChatRead(f.client, CHAT, SECOND); await f.flush();
  assert.equal(f.reads.length, 1); assert.equal(f.reads[0].readUntil, SECOND);
  old.resolve({ error: null }); await f.drain();
  assert.equal(f.reads.length, 1, "late A ACK leaves B's read event untouched");
  f.api.scheduleMarkChatRead(f.client, CHAT, FIRST); f.api.scheduleMarkChatRead(f.client, CHAT, SECOND);
  await f.flush(); assert.equal(f.calls.length, 2, "B keeps its own confirmed watermark after A settles");
});

const mutations = [
  ["retain owner across transition", "consumer",
    "useAppStore.subscribe(() => {\n  if (owner && !isCurrentOwner(owner)) retireOwner();\n});",
    "useAppStore.subscribe(() => {});", cancelledTimers,
    "owner replacement cancels both receipt lanes immediately"],
  ["omit synchronous store authority", "consumer",
    "return owner === candidate && state.currentUser?.id === candidate.userId\n    && state.accountEpoch === candidate.accountEpoch;",
    "return owner === candidate;", options => retiredTimer(options, false),
    "retired timer cannot dispatch with current account authority"],
  ["omit account epoch", "consumer", "&& state.accountEpoch === candidate.accountEpoch", "", retiredEpoch,
    "advanced account epoch fences the queued receipt before notification"],
  ["ignore captured owner predicate", "scheduler", "!disposed && (deps.isCurrent?.() ?? true)", "!disposed",
    options => retiredTimer(options, false), "retired timer cannot dispatch with current account authority"],
  ["leave old timers queued", "scheduler", "for (const timer of lane.timers.values()) deps.clearTimer(timer);", "",
    cancelledTimers, "owner replacement cancels both receipt lanes immediately"],
  ["omit disposed fence", "scheduler", "disposed = true;", "", disposedCallback,
    "disposed scheduler cannot dispatch a queued callback without an owner adapter"],
  ["let retired reply poison RPC capability", "scheduler", "if (!isCurrent()) return result;", "",
    options => lateReply({ code: "PGRST202" }, options), "retired reply cannot change shared RPC capability"],
  ["publish retired ACK", "scheduler",
    "void send(client, chatId, pending.raw).then(({ error, rpcName }) => {\n        if (!isCurrent()) return;",
    "void send(client, chatId, pending.raw).then(({ error, rpcName }) => {",
    options => lateReply(null, options), "retired ACK cannot publish a read event into B"],
  ["change read debounce", "scheduler", "READ_DEBOUNCE_MS = 700", "READ_DEBOUNCE_MS = 701", cancelledTimers,
    "read/delivered debounce remains 700/2500 ms"],
  ["change delivered debounce", "scheduler", "DELIVERED_DEBOUNCE_MS = 2500", "DELIVERED_DEBOUNCE_MS = 2501", cancelledTimers,
    "read/delivered debounce remains 700/2500 ms"],
];

for (const [name, file, before, after, scenario, oracle] of mutations) {
  test(`compiled source mutation refused: ${name}`, async () => {
    const source = file === "consumer" ? consumerSource : schedulerSource;
    assert.equal(source.split(before).length - 1, 1, "mutation must change exactly one production boundary");
    await assert.rejects(() => scenario({ [file]: source.replace(before, after) }), (error) => {
      assert.equal(error.code, "ERR_ASSERTION", "compile/setup failures do not kill a mutant");
      assert.equal(error.message.split("\n")[0], oracle, "independent literal behavior must reject the mutant");
      return true;
    });
  });
}
