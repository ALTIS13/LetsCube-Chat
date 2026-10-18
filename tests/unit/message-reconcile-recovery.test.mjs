import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8").replaceAll("\r\n", "\n");
const source = read("hooks/useMessages.ts");
const CHAT = "30000000-0000-4000-8000-000000000001";
const row = (n = 1) => ({ id: `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`, chat_id: CHAT,
  user_id: "fictional-peer", bot_id: null, topic_id: null, type: "text", content: null,
  created_at: `2026-10-18T00:00:0${n}Z`, deleted_at: null, sender: { id: "fictional-peer" }, reactions: [], reply_to_id: null });
const fixtures = new Set();
test.afterEach(async () => { for (const f of fixtures) await f.close(); fixtures.clear(); });

// Reuse the mounted-hook harness declarations, not its accepted tests. Keep the
// real cache/privacy modules and store structural sharing; only IO/React/time are ports.
const syntax = ts.createSourceFile("harness.mjs", readFileSync(new URL("message-producer-lifecycle.test.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let declarations = ["compile", "deferred", "fixture"].map((name) => {
  const nodes = syntax.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(nodes.length, 1); return nodes[0].getText(syntax);
}).join("\n");
const storeSyntax = ts.createSourceFile("store.ts", read("store/app.store.ts"), ts.ScriptTarget.Latest, true);
const setters = [];
function findSetter(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(storeSyntax) === "setMessages") setters.push(node.initializer.getText(storeSyntax));
  ts.forEachChild(node, findSetter);
}
findSetter(storeSyntax); assert.equal(setters.length, 1);
const storeSource = ["compareMessages", "sortMessages"].map((name) => {
  const nodes = storeSyntax.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(nodes.length, 1); return nodes[0].getText(storeSyntax);
}).join("\n") + `\nexport function makeSetter(set:any,shareById:any){return ${setters[0]};}`;
function adapt(anchor, replacement) {
  assert.equal(declarations.split(anchor).length, 2, "one harness adaptation anchor");
  declarations = declarations.replace(anchor, replacement);
}
adapt("let cursor = 0, dirty = true, mounted = true, view, nextTimer = 0;",
  "let cursor = 0, dirty = true, mounted = true, view, nextTimer = 0, clock = 10000;");
adapt("in() { return query; }", "in(key, value) { predicates.push([key, value]); return query; }");
adapt("const methods = {", "let actualSetMessages; const methods = {");
adapt('setMessages(chatId, messages) { publish("messages", chatId); state = { ...state, messages: { ...state.messages, [chatId]: messages } }; dirty = true; },',
  "setMessages(chatId, messages) { actualSetMessages(chatId, messages); },");
adapt("calls.push({ name, table, predicates, epoch: state.accountEpoch });",
  "calls.push({ name, table, predicates, epoch: state.accountEpoch, at: clock });");
adapt("const setTimeout = (callback, ms) => { timers.set(++nextTimer, { callback, ms }); return nextTimer; };",
  "const setTimeout = (callback, ms) => { timers.set(++nextTimer, { callback, ms, due: clock + ms }); return nextTimer; };");
adapt("const globals = { testImportMeta: { env: { DEV: false } },",
  "const globals = { Date: class extends Date { static now() { return clock; } }, testImportMeta: { env: { DEV: false } },");
adapt('const hook = load("hooks/useMessages.ts").useMessages;', `
  delete aliases['@/lib/clearedAtCache']; delete aliases['@/lib/hiddenMessagesLive'];
  const markCache = load('lib/clearedAtCache.ts').clearedAtCache;
  const hides = load('lib/hiddenMessagesLive.ts').hiddenMessagesLive;
  markCache.setLive(true); hides.joined(); hides.pingReturned();
  actualSetMessages = compile(storeSource, () => { throw Error('STORE_IMPORT_REFUSED'); }, globals).makeSetter(update => {
    const previous = state, next = update(state); if (next === state) return;
    publish('messages', CHAT); state = {...state,...next}; dirty = true;
    for (const callback of subscribers) callback(state, previous);
  }, load('lib/structuralSharing.ts').shareById);
  const hook = load('hooks/useMessages.ts').useMessages;`);
adapt("calls, publications, timers, channels, hold, pending, drain,", `
    calls, publications, timers, channels, hold, pending, drain, markCache, hides,
    publishRows(rows) { methods.setMessages(CHAT, rows); },
    subscribe: useAppStore.subscribe,
    get now() { return clock; }, emit(type) { globals.window.dispatchEvent({type}); },
    async advance(ms) {
      const end = clock + ms; let count = 0;
      while (true) {
        const next = [...timers].filter(([,t]) => t.due <= end).sort((a,b) => a[1].due-b[1].due || a[0]-b[0])[0];
        if (!next) break;
        assert.ok(++count < 500, 'bounded timer drain');
        clock = next[1].due; timers.delete(next[0]); next[1].callback(); await drain();
      }
      clock = end; await drain();
    },`);
const mount = new Function("assert", "path", "vm", "ts", "read", "source", "row", "CHAT", "fixtures", "storeSource", declarations + "\nreturn fixture;")
  (assert, path, vm, ts, read, source, row, CHAT, fixtures, storeSource);
const count = (f, name) => f.calls.filter((call) => call.name === name).length;
const channel = (f) => f.channels.filter((item) => item.name === `messages:chat:${CHAT}`).at(-1);
async function ready({ text = source, rows = [row()] } = {}) {
  const f = mount({ text, historyRows: rows }); await f.drain();
  assert.equal(f.view.messages.length, 1, "cold hook positive");
  channel(f).status("SUBSCRIBED"); await f.advance(700); await f.advance(4000); f.clear(); return f;
}
async function recovery({ text = source, joinAfter = 100, error = true, online = true } = {}) {
  const f = await ready({ text }), began = f.now;
  f.markCache.setLive(false); f.hides.lost();
  if (error) channel(f).status("CHANNEL_ERROR");
  if (online) f.emit("online");
  if (joinAfter !== null) {
    await f.advance(joinAfter); f.markCache.setLive(true); f.hides.joined(); f.hides.pingReturned(); channel(f).status("SUBSCRIBED");
  }
  await f.advance(2500);
  return { f, starts: f.calls.filter((call) => call.name === "history").map((call) => call.at - began) };
}
async function fastRecovery(text = source) {
  const { starts } = await recovery({ text });
  assert.deepEqual(starts, [700], "one joined read, no obsolete fallback");
}
async function cached({ text = source, changed = true } = {}) {
  const rows = [row()], f = await ready({ text, rows }); f.unmount(); f.hides.lost(); f.hides.joined(); f.hides.pingReturned();
  const held = f.hold("hidden"); await f.remount(); assert.ok(f.pending.includes(held));
  if (changed) rows.unshift(row(2));
  f.clear(); channel(f).status("SUBSCRIBED"); await f.advance(700);
  assert.equal(count(f, "history"), 1); assert.equal(f.view.messages.length, changed ? 2 : 1);
  return { f, held };
}
async function releaseCached(f, held) { held.resolve({ data: [], error: null }); await f.drain(); }
async function successfulCache(text = source) {
  const { f, held } = await cached({ text }); await releaseCached(f, held);
  assert.equal(count(f, "history"), 1, "newer authoritative page satisfies old sanitizer");
}

test("recovery coalesces pending error/online/join while preserving literal 600ms join delay", () => fastRecovery());
async function joinedDeadline(text = source, repeated = false) {
  const f = await ready({ text }), began = f.now; channel(f).status("SUBSCRIBED");
  if (repeated) {
    for (const signal of ["online", "CHANNEL_ERROR", "online", "TIMED_OUT", "online"]) {
      await f.advance(100);
      if (signal === "online") f.emit(signal); else channel(f).status(signal);
    }
  } else { await f.advance(500); f.emit("online"); }
  await f.advance(99); assert.equal(count(f, "history"), 0, "joined read must not run before 600ms");
  await f.advance(1);
  assert.deepEqual(f.calls.filter((call) => call.name === "history").map((call) => call.at - began), [600],
    "late fallback cannot postpone joined catchup past 600ms");
  await f.advance(1000); assert.equal(count(f, "history"), 1, "coalesced fallbacks cannot leave a later duplicate");
}
test("join then late fallback preserves the already-scheduled literal 600ms deadline", () => joinedDeadline());
test("repeated fallback signals before deadline cannot starve the joined catchup", () => joinedDeadline(source, true));
test("online alone and failed channel alone preserve literal 900ms fallback without a join", async () => {
  for (const flags of [{ error: false }, { online: false }]) {
    const { starts } = await recovery({ ...flags, joinAfter: null }); assert.deepEqual(starts, [900]);
  }
});
test("prejoin read cannot replace the required later postjoin page/privacy checks", async () => {
  const { f, starts } = await recovery({ joinAfter: 1181 });
  assert.deepEqual(starts, [900, 1781]); assert.ok(count(f, "mark") >= 1); assert.ok(count(f, "hidden") >= 1);
});
test("held prejoin page cannot consume fresh postjoin catchup or publish after it", async () => {
  const f = await ready(); f.hides.lost(); f.markCache.setLive(false);
  const old = f.hold("history"); f.emit("online"); await f.advance(900); assert.ok(f.pending.includes(old));
  await f.advance(100); f.markCache.setLive(true); f.hides.joined(); f.hides.pingReturned(); channel(f).status("SUBSCRIBED");
  await f.advance(600); assert.equal(count(f, "history"), 2); assert.ok(count(f, "hidden") >= 1);
  f.clear(); old.resolve({ data: [row(2)], error: null }); await f.drain();
  assert.equal(f.view.messages.length, 1); assert.equal(f.publications.length, 0);
});
test("late cached sanitizer reuses only a newer successful authoritative page", () => successfulCache());
test("unchanged page keeps actual store identity and creates no sanitizer loop", async () => {
  const f = await ready(), held = f.state.messages; await f.view.refetch(); await f.drain(); assert.equal(f.state.messages, held);
  const cachedPage = await cached({ changed: false }); await releaseCached(cachedPage.f, cachedPage.held);
  assert.equal(count(cachedPage.f, "history"), 1);
});
async function unverifiedRow(text = source) {
  const { f, held } = await cached({ text }); const before = count(f, "hidden");
  f.publishRows([...f.state.messages[CHAT], row(3)]); await f.drain(); await releaseCached(f, held);
  assert.equal(count(f, "history"), 2, "unverified array requires reconciliation");
  assert.ok(count(f, "hidden") > before, "new unverified ID requires privacy IO");
}
test("another realtime producer's unverified row invalidates the exact-array proof", () => unverifiedRow());
async function reentrantRow(text = source) {
  const rows = [row()], f = await ready({ text, rows }); f.unmount(); f.hides.lost(); f.hides.joined(); f.hides.pingReturned();
  const held = f.hold("hidden"); await f.remount(); rows.unshift(row(2));
  const unsubscribe = f.subscribe((next, previous) => {
    if (next.messages === previous.messages) return;
    unsubscribe(); f.publishRows([...f.state.messages[CHAT], row(3)]);
  });
  f.clear(); channel(f).status("SUBSCRIBED"); await f.advance(700); assert.equal(f.view.messages.length, 3);
  await releaseCached(f, held);
  assert.equal(count(f, "history"), 2, "reentrant producer cannot borrow the committed-page proof");
}
test("synchronous store subscriber cannot attach an unverified row to the successful page proof", () => reentrantRow());
async function failedRead(text = source) {
  const { f, held } = await cached({ text }); const failed = f.hold("history"), pending = f.view.refetch(); await f.drain();
  failed.resolve({ data: null, error: { code: "FICTITIOUS_FAILURE" } }); await pending; await f.drain();
  assert.equal(f.view.historyPending, false, "verified chat alone is not sufficient proof");
  await releaseCached(f, held); assert.equal(count(f, "history"), 3, "failed newer read cannot authorize a skip");
}
test("failed newer history read cannot stand in for current authoritative verification", () => failedRead());
test("privacy generation loss during a held check cannot publish the new page", async () => {
  const rows = [row()], f = await ready({ rows }); rows.unshift(row(2)); f.hides.lost();
  const held = f.hold("hidden"); channel(f).status("SUBSCRIBED"); await f.advance(600);
  assert.ok(f.pending.includes(held)); assert.equal(f.view.messages.length, 1);
  f.hides.joined(); f.hides.pingReturned(); f.clear(); held.resolve({ data: [], error: null }); await f.drain();
  assert.equal(f.view.messages.length, 1); assert.equal(f.publications.filter((p) => p.kind === "messages").length, 0);
});
test("retired epoch/unmount prevent held publication and queued recovery IO", async () => {
  for (const retire of [(f) => f.changeEpoch(false), (f) => f.unmount()]) {
    const f = await ready(), held = f.hold("history"), pending = f.view.refetch(); await f.drain();
    channel(f).status("SUBSCRIBED"); retire(f); f.clear(); held.resolve({ data: [row(2)], error: null }); await pending; await f.advance(1000);
    assert.equal(f.calls.length, 0); assert.equal(f.publications.length, 0);
  }
});
test("topic change cancels pending recovery without rejoining the chat channel", async () => {
  const f = await ready(), joined = channel(f), channels = f.channels.filter((item) => item.name === joined.name).length;
  joined.status("SUBSCRIBED"); f.switchTopic("fictional-topic"); await f.drain(); f.clear(); await f.advance(1000);
  assert.equal(f.calls.length, 0); assert.equal(f.channels.filter((item) => item.name === joined.name).length, channels);
});

function mutate(anchor, replacement) {
  assert.equal(source.split(anchor).length, 2, "one production mutation anchor");
  return source.replace(anchor, replacement);
}
test("loaded omissions kill independent join timers and non-authoritative cache shortcuts", async () => {
  const independentJoin = mutate("scheduleRecoveryReconcile(ACTIVE_CHAT_RECONCILE_DELAY_MS);",
    "window.setTimeout(() => { if (isCurrent()) void fetchMessagesRef.current({ background: true }); }, ACTIVE_CHAT_RECONCILE_DELAY_MS);");
  await assert.rejects(() => fastRecovery(independentJoin), /one joined read, no obsolete fallback/);
  await assert.rejects(() => unverifiedRow(mutate("proof.messages === latest", "true")), /unverified array requires reconciliation/);
  await assert.rejects(() => failedRead(mutate("proof.isCurrent()", "true")), /failed newer read cannot authorize a skip/);
  await assert.rejects(() => reentrantRow(mutate("sameData(committedMessages, reconciledMessages)", "true")), /reentrant producer cannot borrow/);
});
test("loaded delay mutations violate literal recovery timing instead of passing a self-derived expectation", async () => {
  await assert.rejects(() => fastRecovery(mutate("const ACTIVE_CHAT_RECONCILE_DELAY_MS = 600;", "const ACTIVE_CHAT_RECONCILE_DELAY_MS = 601;")), /one joined read/);
  const text = mutate("const ACTIVE_CHAT_RECONNECT_DELAY_MS = 900;", "const ACTIVE_CHAT_RECONNECT_DELAY_MS = 901;");
  const { starts } = await recovery({ text, joinAfter: null, error: false }); assert.deepEqual(starts, [901]); assert.notDeepEqual(starts, [900]);
});
test("loaded earliest-deadline omission recreates late and repeated fallback starvation", async () => {
  const text = mutate("recoveryTimerDueRef.current <= dueAt", "false");
  await assert.rejects(() => joinedDeadline(text), /late fallback cannot postpone joined catchup past 600ms/);
  await assert.rejects(() => joinedDeadline(text, true), /late fallback cannot postpone joined catchup past 600ms/);
});
