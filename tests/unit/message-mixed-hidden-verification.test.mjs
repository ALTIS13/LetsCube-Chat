import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = name => readFileSync(new URL(name, root), "utf8").replaceAll("\r\n", "\n");
const source = read("hooks/useMessages.ts");
const CHAT = "30000000-0000-0000-0000-000000000001";
const row = (n = 1) => ({
  id: `40000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
  chat_id: CHAT, user_id: "fictional-peer", bot_id: null, topic_id: null, type: "text", content: null,
  created_at: new Date(Date.UTC(2026, 9, 19) + n * 1000).toISOString(), deleted_at: null,
  sender: { id: "fictional-peer" }, reactions: [], reply_to_id: null,
});
const fixtures = new Set();
test.before(() => assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0"));
test.afterEach(async () => { for (const f of fixtures) await f.close(); fixtures.clear(); });

// Reuse the accepted executor, not its tests: entire useMessages/cache source
// executes; React commits, REST/channel ports and clocks remain fictional.
const harness = readFileSync(new URL("message-producer-lifecycle.test.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("harness.mjs", harness, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let declarations = ["compile", "deferred", "fixture"].map(name => {
  const nodes = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.equal(nodes.length, 1); return nodes[0].getText(ast);
}).join("\n");
function adapt(from, to) {
  assert.equal(declarations.split(from).length, 2, "one existing executor adaptation site");
  declarations = declarations.replace(from, to);
}
adapt('in() { return query; }', 'in(key, value) { predicates.push([key, value]); return query; }');
adapt('historyRows = [row()] } = {})', 'historyRows = [row()], hiddenRows = [] } = {})');
adapt(': name === "joined" ? row() : name === "older" ? [row(102)] : [];',
  ': name === "joined" ? row() : name === "older" ? [row(102)] : name === "hidden" ? (predicates.find(([key]) => key === "message_id")?.[1] ?? []).filter(id => hiddenRows.includes(id)).map(message_id => ({ message_id })) : [];');
adapt('const globals = { testImportMeta:', 'let now = 10000;\n const globals = { Date: class extends Date { static now() { return now; } }, testImportMeta:');
adapt('const hook = load("hooks/useMessages.ts").useMessages;', `
  delete aliases["@/lib/clearedAtCache"]; delete aliases["@/lib/hiddenMessagesLive"];
  const markCache = load("lib/clearedAtCache.ts").clearedAtCache;
  const hides = load("lib/hiddenMessagesLive.ts").hiddenMessagesLive;
  markCache.setLive(true); hides.joined(); hides.pingReturned();
  const hook = load("hooks/useMessages.ts").useMessages;`);
adapt('calls, publications, timers, channels, hold, pending, drain,', `
    calls, publications, timers, channels, hold, pending, drain, markCache, hides,
    setHeld(rows) { state.messages[CHAT] = rows; dirty = true; flush(); },
    advance(ms) { now += ms; },`);
const fixture = new Function("assert", "path", "vm", "ts", "read", "source", "row", "CHAT", "fixtures",
  `${declarations}\nreturn fixture;`)(assert, path, vm, ts, read, source, row, CHAT, fixtures);
const ids = rows => Array.from(rows, m => m.id);
const hiddenCalls = f => f.calls.filter(c => c.name === "hidden");
const requestedIds = f => hiddenCalls(f).flatMap(c => Array.from(c.predicates.find(([key]) => key === "message_id")[1]));

async function mixed({ text = source, reply = false, fresh = true } = {}) {
  const held = Array.from({ length: 1000 }, (_, i) => row(i + 1));
  if (reply) held[0] = { ...held[0], reply_to_id: row(2).id, ...(reply === "preview" ? { reply_to: row(2) } : {}) };
  const history = held.slice(-100).reverse();
  const f = fixture({ text, historyRows: history }); await f.drain();
  assert.equal(f.view.messages.length, 100, "actual initial100-row history control");
  assert.equal(hiddenCalls(f).length, 1, "initial privacy query control");
  f.setHeld(held); f.hides.markVerified(CHAT, ids(held), 10000);
  assert.equal(f.view.messages.length, 1000, "actual hook sees seeded loaded history");
  assert.equal(f.hides.canSkip(CHAT, ids(held)), true, "actual live ping/read proof for all1000 held IDs");
  if (fresh) history.splice(0, history.length, row(1001), ...held.slice(-99).reverse());
  f.clear(); return { f, held, history };
}

async function oneMissing(text = source) {
  const { f, history } = await mixed({ text }); await f.view.refetch({ background: true }); await f.drain();
  assert.equal(hiddenCalls(f).length, 1, "1000 trusted +1 fresh must issue one hidden read, not11");
  assert.deepEqual(requestedIds(f), ids([...history].reverse()), "read the current100-row page, not all1000 trusted held rows");
  assert.equal(f.view.messages.length, 1001, "fresh nonhidden row and all held rows remain visible");
}
test("actual hook:1000 trusted held +1 fresh reads only the current100-row page", () => oneMissing());

test("actual hook: unchanged fully trusted1000 IDs need no hidden read", async () => {
  const { f } = await mixed({ fresh: false }); await f.view.refetch({ background: true }); await f.drain();
  assert.equal(hiddenCalls(f).length, 0); assert.equal(f.view.messages.length, 1000);
});

for (const trust of ["lost", "rejoined", "unhide"]) test(`actual hook: ${trust} trust requires full1001-ID verification`, async () => {
  const { f } = await mixed();
  if (trust === "unhide") f.hides.heard({ chatId: CHAT, messageId: row(1).id, hidden: false });
  else { f.hides.lost(); if (trust === "rejoined") { f.hides.joined(); f.hides.pingReturned(); } }
  await f.view.refetch({ background: true }); await f.drain();
  assert.equal(hiddenCalls(f).length, 11, "unproven generation must not reuse old ID trust");
  assert.equal(new Set(requestedIds(f)).size, 1001);
});

for (const reply of ["id", "preview"]) test(`actual hook: held reply ${reply} uncertainty retains full verification`, async () => {
  const { f } = await mixed({ reply }); await f.view.refetch({ background: true }); await f.drain();
  assert.equal(hiddenCalls(f).length, 11, "reply uncertainty must retain the full verification path");
  assert.ok(requestedIds(f).includes(row(2).id));
});

async function denyFresh(text = source) {
  const { f } = await mixed({ text }); const hidden = f.hold("hidden");
  const pending = f.view.refetch({ background: true }); await f.drain();
  assert.equal(f.view.messages.length, 1000, "fresh row is not admitted before privacy answer");
  assert.ok(f.pending.includes(hidden), "real fresh-ID read is held before publication");
  hidden.resolve({ data: [{ message_id: row(1001).id }], error: null }); await pending; await f.drain();
  assert.equal(f.view.messages.some(m => m.id === row(1001).id), false, "hidden fresh row must not be published");
  assert.equal(f.view.messages.length, 1000);
}
test("actual hook: a hidden fresh row never leaks through missing-only verification", () => denyFresh());

for (const boundary of ["lost", "same-tick-rejoin", "same-UID-epoch", "other-user", "unmount"]) {
  test(`actual mixed read refuses completion after ${boundary}`, async () => {
    const { f } = await mixed(); const hidden = f.hold("hidden");
    const pending = f.view.refetch({ background: true }); await f.drain();
    assert.ok(f.pending.includes(hidden));
    if (boundary === "lost" || boundary === "same-tick-rejoin") {
      f.hides.lost(); if (boundary === "same-tick-rejoin") { f.hides.joined(); f.hides.pingReturned(); }
    } else if (boundary === "same-UID-epoch") f.changeEpoch(false);
    else if (boundary === "other-user") f.state.currentUser = { id: "fictional-other-owner" };
    else f.unmount();
    const before = f.state.messages[CHAT]; f.clear();
    hidden.resolve({ data: [], error: null }); await pending; await f.drain();
    assert.equal(f.state.messages[CHAT], before, "retired read cannot publish history");
    assert.equal(f.publications.filter(p => p.kind === "messages").length, 0);
  });
}

test("actual mixed read refuses a failed missing-ID privacy answer", async () => {
  const { f } = await mixed(); const hidden = f.hold("hidden"); const before = f.state.messages[CHAT];
  const pending = f.view.refetch({ background: true }); await f.drain();
  hidden.resolve({ data: null, error: { message: "fictional offline" } }); await pending; await f.drain();
  assert.equal(f.state.messages[CHAT], before);
  assert.equal(f.view.messages.some(m => m.id === row(1001).id), false, "failed privacy answer cannot admit the fresh row");
});

test("actual mixed read verifies a concurrent added row before admitting it", async () => {
  const { f, history } = await mixed(); const first = f.hold("hidden"), second = f.hold("hidden");
  const pending = f.view.refetch({ background: true }); await f.drain();
  f.setHeld([...f.state.messages[CHAT], row(1002)]);
  first.resolve({ data: [], error: null }); await f.drain();
  assert.ok(f.pending.includes(second), "changed array reaches an added-ID read");
  second.resolve({ data: [{ message_id: row(1002).id }], error: null }); await pending; await f.drain();
  assert.equal(hiddenCalls(f).length, 2); assert.deepEqual(requestedIds(f), [...ids([...history].reverse()), row(1002).id]);
  assert.equal(f.view.messages.some(m => m.id === row(1002).id), false);
  assert.equal(f.view.messages.some(m => m.id === row(1001).id), true);
});

test("actual mixed read rechecks a concurrent reply to a previously trusted ID", async () => {
  const { f } = await mixed(); const first = f.hold("hidden"), reply = f.hold("hidden");
  const pending = f.view.refetch({ background: true }); await f.drain();
  f.setHeld([...f.state.messages[CHAT], { ...row(1002), reply_to_id: row(2).id, reply_to: row(2) }]);
  f.clear(); first.resolve({ data: [], error: null }); await f.drain();
  assert.ok(f.pending.includes(reply), "concurrent reply uncertainty triggers a fresh read");
  assert.ok(requestedIds(f).includes(row(2).id), "concurrent reply target must not be skipped as previously verified");
  reply.resolve({ data: [{ message_id: row(2).id }], error: null }); await pending; await f.drain();
  assert.equal(f.view.messages.some(m => m.id === row(2).id), false);
  assert.equal(f.view.messages.find(m => m.id === row(1002).id)?.reply_to, undefined, "hidden joined preview is sanitized");
});

test("actual all-verified reply payload is sanitized by a freshly heard live hide", async () => {
  const { f, history } = await mixed({ fresh: false });
  history[0] = { ...history[0], reply_to_id: row(2).id, reply_to: row(2) };
  const held = f.hold("history"), pending = f.view.refetch({ background: true }); await f.drain();
  f.hides.heard({ chatId: CHAT, messageId: row(2).id, hidden: true }); await f.drain();
  held.resolve({ data: history, error: null }); await pending; await f.drain();
  assert.equal(hiddenCalls(f).length, 0, "complete live proof remains the synchronous fast path");
  assert.equal(f.view.messages.some(m => m.id === row(2).id), false, "heard hide survives a freshly joined payload");
  assert.equal(f.view.messages.find(m => m.id === row(1000).id).reply_to, undefined, "fresh joined reply cannot expose the hidden target");
});

async function knownHiddenRemount(text = source, fresh = true, { reply = false, refuse = false } = {}) {
  const history = [row(3), row(2), row(1)];
  const f = fixture({ text, historyRows: history, hiddenRows: [row(2).id] }); await f.drain();
  assert.deepEqual(ids(f.view.messages), [row(1).id, row(3).id], "initial actual privacy answer removes hidden row");
  assert.equal(f.hides.canSkip(CHAT, [row(2).id]), true, "actual first read marks the hidden ID verified, not visible");
  f.unmount();
  if (fresh) history.unshift(row(4));
  if (reply) history[0] = { ...history[0], reply_to_id: row(2).id, reply_to: row(2) };
  await f.remount();
  assert.deepEqual(ids(f.view.messages), [row(1).id, row(3).id], "remount starts from sanitized held history");
  f.clear();
  const hidden = refuse ? f.hold("hidden") : null;
  const pending = f.view.refetch({ background: true }); await f.drain();
  if (refuse) {
    assert.ok(f.pending.includes(hidden), "lost local hidden result requires an actual privacy answer");
    assert.deepEqual(ids(f.view.messages), [row(1).id, row(3).id], "held privacy answer cannot expose raw page rows");
    hidden.resolve({ data: null, error: { message: "fictional privacy refusal" } });
    await pending; await f.drain();
    assert.deepEqual(ids(f.view.messages), [row(1).id, row(3).id], "refused recovery preserves sanitized held rows only");
    return;
  }
  await pending; await f.drain();
  assert.equal(f.view.messages.some(m => m.id === row(2).id), false, "KNOWN_HIDDEN_REMOUNT_MUST_NOT_RESURRECT");
  assert.equal(f.view.messages.some(m => m.id === row(4).id), fresh, "fresh allowed row is admitted only when returned");
  assert.equal(hiddenCalls(f).length, 1, "missing hidden result is recovered in one current-page read");
  assert.ok(requestedIds(f).includes(row(2).id), "verified proof alone cannot replace the lost hidden result");
  if (reply) assert.equal(f.view.messages.find(m => m.id === history[0].id).reply_to, undefined,
    "fresh joined preview cannot expose the recovered hidden target");
  f.clear(); await f.view.refetch({ background: true }); await f.drain();
  assert.equal(hiddenCalls(f).length, 0, "once recovered, current local hidden result permits the synchronous skip");
  assert.equal(f.view.messages.some(m => m.id === row(2).id), false);
}
for (const fresh of [true, false]) test(`actual hook: known hidden result survives remount, fresh=${fresh}`,
  () => knownHiddenRemount(source, fresh));
test("actual hook: fresh joined reply after remount cannot expose a previously hidden target",
  () => knownHiddenRemount(source, true, { reply: true }));
test("actual hook: refused hidden-result recovery after remount never admits raw history",
  () => knownHiddenRemount(source, true, { refuse: true }));

function mutate(from, to) {
  assert.equal(source.split(from).length, 2, "exactly one loaded omission site");
  return source.replace(from, to);
}
test("loaded omission: removing missing-only selection recreates eleven hidden reads", async () => {
  const text = mutate('[...checkedIds].filter((id) => fetchedIds.has(id) || !hiddenMessagesLive.canSkip(chatId, [id]))', '[...checkedIds]');
  await assert.rejects(() => oneMissing(text), /1000 trusted \+1 fresh must issue one hidden read/);
});
test("loaded omission: skipping an unknown fresh ID leaks it before the held privacy answer", async () => {
  const text = mutate('[...checkedIds].filter((id) => fetchedIds.has(id) || !hiddenMessagesLive.canSkip(chatId, [id]))',
    '(heldWhenAsked.length >= 1000 ? [] : [...checkedIds].filter((id) => fetchedIds.has(id) || !hiddenMessagesLive.canSkip(chatId, [id])))');
  await assert.rejects(() => denyFresh(text), /fresh row is not admitted before privacy answer/);
});

test("loaded omission: dropping fresh-page IDs loses a hidden result after remount", async () => {
  const text = mutate('fetchedIds.has(id) || !hiddenMessagesLive.canSkip(chatId, [id])',
    '!hiddenMessagesLive.canSkip(chatId, [id])');
  await assert.rejects(() => knownHiddenRemount(text), /KNOWN_HIDDEN_REMOUNT_MUST_NOT_RESURRECT/);
});

test("loaded omission: proof-only synchronous skip loses an all-verified hidden result after remount", async () => {
  const text = mutate(' && pageResultsKnown', '');
  await assert.rejects(() => knownHiddenRemount(text, false), /KNOWN_HIDDEN_REMOUNT_MUST_NOT_RESURRECT/);
});
