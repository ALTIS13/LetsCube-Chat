import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8").replaceAll("\r\n", "\n");
const source = read("hooks/useMessages.ts");
const CHAT = "30000000-0000-0000-0000-000000000001";
const row = (n = 1) => ({
  id: `40000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
  chat_id: CHAT, user_id: "fictional-peer", bot_id: null, topic_id: null,
  type: "text", content: null, created_at: `2026-10-07T00:00:0${n}Z`,
  deleted_at: null, sender: { id: "fictional-peer" }, reactions: [], reply_to_id: null,
});
const fixtures = new Set();
test.afterEach(async () => {
  for (const f of fixtures) await f.close();
  fixtures.clear();
});

// Reuse declarations, not accepted tests. Replace only cache fakes with the
// actual compiled cache modules; React commits, REST and channel status are fake.
const harness = readFileSync(new URL("message-producer-lifecycle.test.mjs", import.meta.url), "utf8");
const syntax = ts.createSourceFile("harness.mjs", harness, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let declarations = ["compile", "deferred", "fixture"].map((name) => {
  const matches = syntax.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(matches.length, 1, `one ${name} declaration`);
  return matches[0].getText(syntax);
}).join("\n");
const anchor = 'const hook = load("hooks/useMessages.ts").useMessages;';
assert.equal(declarations.split(anchor).length - 1, 1);
declarations = declarations.replace(anchor, `
  delete aliases["@/lib/clearedAtCache"];
  delete aliases["@/lib/hiddenMessagesLive"];
  const markCache = load("lib/clearedAtCache.ts").clearedAtCache;
  const hides = load("lib/hiddenMessagesLive.ts").hiddenMessagesLive;
  markCache.setLive(true);
  hides.joined();
  hides.pingReturned();
  const hook = load("hooks/useMessages.ts").useMessages;
`);
function harnessReplace(needle, replacement) {
  assert.equal(declarations.split(needle).length - 1, 1, "one harness adaptation anchor");
  declarations = declarations.replace(needle, replacement);
}
harnessReplace('in() { return query; }', 'in(key, value) { predicates.push([key, value]); return query; }');
harnessReplace('calls, publications, timers, channels, hold, pending, drain,',
  'calls, publications, timers, channels, hold, pending, drain, markCache, hides,');
const fixture = new Function("assert", "path", "vm", "ts", "read", "source", "row", "CHAT", "fixtures",
  `${declarations}\nreturn fixture;`)(assert, path, vm, ts, read, source, row, CHAT, fixtures);

const count = (f, name) => f.calls.filter((call) => call.name === name).length;
const ids = (rows) => Array.from(rows, (message) => message.id);
async function reopened(text = source, initial = [row()]) {
  const rows = initial.slice();
  const f = fixture({ text, historyRows: rows });
  await f.drain();
  assert.equal(f.view.messages.length, initial.length, "cold fetch positive control");
  assert.equal(count(f, "hidden"), 1, "cold privacy-read control");
  f.unmount();
  f.clear();
  await f.remount();
  assert.equal(f.view.messages.length, initial.length, "trusted cache renders after verification microtasks");
  assert.equal(f.calls.filter((call) => ["history", "mark", "hidden"].includes(call.name)).length, 0,
    "trusted warm reopen itself makes no history/privacy request");
  return { f, rows };
}

async function reconcile(f) {
  f.clear();
  const hidden = f.hold("hidden");
  const channel = f.channels.filter((entry) => entry.name === `messages:chat:${CHAT}`).at(-1);
  assert.ok(channel);
  channel.status("SUBSCRIBED");
  await f.fireTimers();
  assert.equal(f.calls.filter((call) => call.name === "history").length, 1, "one join reconciliation");
  assert.equal(f.calls.filter((call) => call.name === "mark").length, 0, "actual membership cache reused");
  assert.equal(f.view.messages.length, 1, "held rows retained during hidden-read wait");
  assert.equal(f.view.loading, false);
  assert.equal(f.view.historyPending, false);
  return hidden;
}

async function trusted(text = source) {
  const { f } = await reopened(text);
  const hidden = await reconcile(f);
  const requests = count(f, "hidden");
  hidden.resolve({ data: [], error: null });
  await f.drain();
  assert.equal(requests, 0, "unchanged trusted IDs should reuse live hidden verification");
}
test("live verified unchanged IDs reuse hidden verification after join", () => trusted());

async function newMessage(text = source) {
  const { f, rows } = await reopened(text);
  rows.unshift(row(2));
  const hidden = await reconcile(f);
  assert.equal(count(f, "hidden"), 1, "new message ID needs privacy read");
  assert.ok(f.pending.includes(hidden), "actual hidden-ID provider await reached");
  hidden.resolve({ data: [], error: null });
  await f.drain();
  assert.equal(f.view.messages.length, 2, "new row published only after privacy answer");
}
test("new unverified message ID requires privacy read", () => newMessage());

async function newReply(text = source) {
  const { f, rows } = await reopened(text);
  rows[0] = { ...row(), reply_to_id: row(9).id, reply_to: row(9) };
  const hidden = await reconcile(f);
  assert.equal(count(f, "hidden"), 1, "new reply ID needs privacy read");
  hidden.resolve({ data: [{ message_id: row(9).id }], error: null });
  await f.drain();
  assert.equal(f.view.messages[0].reply_to, undefined, "hidden new reply is scrubbed");
  assert.equal(f.hides.canSkip(CHAT, [row().id, row(9).id]), true, "real answer marks complete checked IDs");
}
test("new reply ID on a known message requires privacy read", () => newReply());

async function trustGap(kind, text = source) {
  const { f } = await reopened(text);
  if (kind === "lost") f.hides.lost();
  else if (kind === "joined") f.hides.joined();
  else f.hides.heard({ chatId: CHAT, messageId: row().id, hidden: false });
  const hidden = await reconcile(f);
  assert.equal(count(f, "hidden"), 1, "invalidated live trust needs privacy read");
  hidden.resolve({ data: [], error: null });
  await f.drain();
  assert.equal(f.view.messages.length, 1);
}
for (const kind of ["lost", "joined", "unhide"]) {
  test(`${kind}: invalidated trust cannot skip privacy read`, () => trustGap(kind));
}

async function currentHide(text = source) {
  const { f } = await reopened(text, [
    { ...row(2), reply_to_id: row().id, reply_to: row() }, row(),
  ]);
  f.hides.heard({ chatId: CHAT, messageId: row().id, hidden: true });
  await f.drain();
  assert.deepEqual(ids(f.view.messages), [row(2).id], "live hide control");
  f.clear();
  await f.view.refetch({ background: true });
  await f.drain();
  assert.equal(count(f, "hidden"), 0, "known hidden IDs remain trusted");
  assert.deepEqual(ids(f.view.messages), [row(2).id], "skip cannot resurrect locally hidden row");
  assert.equal(f.view.messages[0].reply_to, undefined, "skip cannot expose locally hidden reply");
  assert.deepEqual(ids(f.state.messages[CHAT]), [row(2).id], "locally hidden row must be removed from held store");
  assert.equal(f.state.messages[CHAT][0].reply_to, undefined, "held hidden reply must be scrubbed");
}
test("current hide survives trusted skip and sanitizes replies", () => currentHide());

async function existingOnlyId(text = source) {
  const { f } = await reopened(text);
  f.state.messages[CHAT] = [row(), { ...row(2), reply_to_id: row(9).id, reply_to: row(9) }];
  f.clear();
  const hidden = f.hold("hidden");
  const pending = f.view.refetch({ background: true });
  await f.drain();
  assert.equal(count(f, "hidden"), 1, "existing-only IDs must participate in trust check");
  hidden.resolve({ data: [{ message_id: row(2).id }], error: null });
  await pending;
  await f.drain();
  assert.deepEqual(ids(f.view.messages), [row().id], "existing-only hidden row cannot survive merge");
}
test("existing-only message and reply IDs participate in skip eligibility", () => existingOnlyId());

async function concurrentAddition(text = source) {
  const { f, rows } = await reopened(text);
  rows.unshift(row(2));
  const first = await reconcile(f);
  f.state.messages[CHAT] = [row(), { ...row(3), reply_to_id: row(9).id, reply_to: row(9) }];
  const second = f.hold("hidden");
  first.resolve({ data: [{ message_id: row(2).id }], error: null });
  await f.drain();
  assert.equal(count(f, "hidden"), 2, "concurrent unknown IDs require another read");
  const readIds = f.calls.filter((call) => call.name === "hidden").at(-1).predicates
    .find(([key]) => key === "message_id")[1];
  assert.deepEqual(Array.from(readIds), [row(3).id, row(9).id], "concurrent row plus reply are checked");
  second.resolve({ data: [{ message_id: row(9).id }], error: null });
  await f.drain();
  assert.deepEqual(ids(f.view.messages), [row().id, row(3).id], "new concurrent row retained, hidden fetched row removed");
  assert.equal(f.view.messages[1].reply_to, undefined, "concurrent hidden reply scrubbed");
  assert.equal(f.hides.canSkip(CHAT, [row().id, row(2).id, row(3).id, row(9).id]), true,
    "both real reads mark their complete verified ID set");
  rows.unshift({ ...row(3), reply_to_id: row(9).id, reply_to: row(9) });
  f.clear();
  await f.view.refetch({ background: true });
  await f.drain();
  assert.equal(count(f, "hidden"), 0, "verified additions can reuse live trust");
  assert.deepEqual(ids(f.view.messages), [row().id, row(3).id], "real read hidden IDs remain remembered on later skip");
}
test("concurrent unknown additions during real await get their own privacy read", () => concurrentAddition());

async function retired(kind, text = source) {
  const { f, rows } = await reopened(text);
  rows.unshift(row(2));
  f.clear();
  const hidden = f.hold("hidden");
  const pending = f.view.refetch({ background: true });
  await f.drain();
  assert.ok(f.pending.includes(hidden), "real privacy read reached before retirement");
  let later;
  if (kind === "owner") f.state.currentUser = { id: "fictional-other-owner" };
  if (kind === "epoch") f.changeEpoch(false);
  if (kind === "unmount") f.unmount();
  if (kind === "request" || kind === "topic") {
    later = f.hold("history");
    if (kind === "request") void f.view.refetch({ background: true });
    else f.switchTopic("fictional-other-topic");
    await f.drain();
    assert.ok(f.pending.includes(later), "replacement read held independently");
  }
  const before = f.state.messages[CHAT];
  f.clear();
  hidden.resolve({ data: [{ message_id: row().id }], error: null });
  await pending;
  await f.drain();
  assert.equal(f.state.messages[CHAT], before, "retired read cannot publish messages");
  assert.equal(f.publications.length, 0, "retired read cannot publish hook state or receipts");
}
for (const kind of ["owner", "epoch", "unmount", "request", "topic"]) {
  test(`${kind}: pending real privacy read cannot publish after retirement`, () => retired(kind));
}

async function synchronousSkip(text = source) {
  const { f, rows } = await reopened(text);
  rows[0] = { ...row(), edited_at: "2026-10-07T00:02:00Z" };
  const canSkip = f.hides.canSkip.bind(f.hides);
  let committedAtLoss;
  f.hides.canSkip = (...args) => {
    const trusted = canSkip(...args);
    if (trusted) Promise.resolve().then(() => {
      committedAtLoss = f.publications.filter((entry) => entry.kind === "messages").length;
      f.hides.lost();
    });
    return trusted;
  };
  f.clear();
  await f.view.refetch({ background: true });
  await f.drain();
  assert.equal(committedAtLoss, 1, "trusted branch commits before trust-change microtask");
  assert.equal(count(f, "hidden"), 0);
}
test("trusted skip does not yield between trust decision and publication", () => synchronousSkip());

function mutate(needle, replacement) {
  assert.equal(source.split(needle).length - 1, 1, "one compiled mutation anchor");
  return source.replace(needle, replacement);
}
const decision = "hiddenMessagesLive.canSkip(chatId, [...checkedIds])";
const omissions = [
  ["skip omitted", () => mutate(decision, "false"), trusted, "unchanged trusted IDs"],
  ["new-ID trust bypassed", () => mutate(decision, `(heldWhenAsked.length > 0 || ${decision})`), newMessage, "held rows retained"],
  ["reply IDs omitted", () => mutate(decision,
    "hiddenMessagesLive.canSkip(chatId, [...fetched, ...existing].map((message) => message.id))"), newReply, "new reply ID"],
  ["existing IDs omitted", () => mutate(decision,
    "hiddenMessagesLive.canSkip(chatId, getMessageAndReplyIds(fetched))"), existingOnlyId, "existing-only IDs"],
  ["trusted branch yields", () => mutate("? new Set<string>()", "? await Promise.resolve(new Set<string>())"),
    synchronousSkip, "trust-change microtask"],
  ["local hidden IDs omitted", () => mutate(
    "const effectiveHiddenIds = new Set([...hiddenMessageIdsRef.current, ...fetchedHiddenIds]);\n        const visibleFetched",
    "const effectiveHiddenIds = new Set(fetchedHiddenIds);\n        const visibleFetched"), currentHide, "locally hidden row"],
  ["concurrent extra-ID read omitted", () => mutate(
    "const addedHiddenIds = await fetchHiddenMessageIdSet(supabase, addedIds, isCurrent);",
    "const addedHiddenIds = new Set<string>();"), concurrentAddition, "concurrent unknown IDs"],
  ["remember omitted", () => mutate(
    "rememberHiddenMessageIds(fetchedHiddenIds);\n        hiddenMessagesLive.markVerified(chatId, checkedIds, hiddenReadAt);",
    "hiddenMessagesLive.markVerified(chatId, checkedIds, hiddenReadAt);"), concurrentAddition, "remain remembered"],
  ...["lost", "joined", "unhide"].map((kind) => [
    `${kind} trust bypassed`, () => mutate(decision, `(heldWhenAsked.length > 0 || ${decision})`),
    (text) => trustGap(kind, text), "invalidated live trust",
  ]),
  ["owner guard omitted", () => mutate("useAppStore.getState().currentUser?.id === userId &&", ""),
    (text) => retired("owner", text), "retired read cannot publish"],
  ["epoch guard omitted", () => mutate("\n    useAppStore.getState().accountEpoch === epoch);", "\n    true);"),
    (text) => retired("epoch", text), "retired read cannot publish"],
];
for (const [name, changed, scenario, oracle] of omissions) {
  test(`compiled omission rejected: ${name}`, async () => {
    await assert.rejects(() => scenario(changed()), (error) => {
      assert.equal(error.code, "ERR_ASSERTION", "compiler/setup failures do not kill mutants");
      assert.ok(error.message.includes(oracle), `expected behavioral oracle: ${oracle}`);
      return true;
    });
  });
}
