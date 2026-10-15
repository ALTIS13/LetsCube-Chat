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
  type: "text", content: "fictional", created_at: `2026-10-07T00:00:0${n}.123456Z`,
  deleted_at: null, sender: { id: "fictional-peer" }, reactions: [], reply_to_id: null,
});
const fixtures = new Set();
test.afterEach(async () => {
  for (const f of fixtures) await f.close();
  fixtures.clear();
});

// Reuse only the existing harness declarations, without registering or rerunning
// its accepted tests. The full current hook and its pure helpers are compiled.
const harness = readFileSync(new URL("message-producer-lifecycle.test.mjs", import.meta.url), "utf8");
const syntax = ts.createSourceFile("harness.mjs", harness, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = ["compile", "deferred", "fixture"];
const declarations = names.map((name) => {
  const matches = syntax.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(matches.length, 1, `one existing ${name} harness declaration`);
  return matches[0].getText(syntax);
}).join("\n");
const fixture = new Function("assert", "path", "vm", "ts", "read", "source", "row", "CHAT", "fixtures",
  `${declarations}\nreturn fixture;`)(assert, path, vm, ts, read, source, row, CHAT, fixtures);

async function ready(text = source) {
  const f = fixture({ text, historyRows: [row(2), row(1)] });
  await f.drain();
  assert.deepEqual(Array.from(f.view.messages, (m) => m.id), [row(1).id, row(2).id], "loaded hook control");
  f.unmount();
  await f.remount();
  assert.deepEqual(Array.from(f.view.messages, (m) => m.id), [row(1).id, row(2).id], "cached reentry control");
  const channel = f.channels.filter((entry) => entry.name === `messages:chat:${CHAT}`).at(-1);
  assert.ok(channel, "actual message channel registered");
  channel.status("SUBSCRIBED");
  await f.fireTimers();
  assert.deepEqual(Array.from(f.view.messages, (m) => m.id), [row(1).id, row(2).id], "post-join reconciliation control");
  const binding = (event) => channel.bindings.find((entry) => entry.filter.table === "messages" && entry.filter.event === event).callback;
  return { f, update: binding("UPDATE"), insert: binding("INSERT") };
}

async function holdUpdate(context, message = { ...row(1), content: "fictional-edited", edited_at: "2026-10-07T00:01:00Z" }) {
  const { f, update } = context;
  const joined = f.hold("joined");
  const hidden = f.hold("hidden");
  const pending = update({ new: message });
  await f.drain();
  joined.resolve({ data: message, error: null });
  await f.drain();
  assert.ok(f.pending.includes(hidden), "UPDATE reached its actual hidden-read await");
  return { pending, hidden };
}

async function concurrentInsert(text = source) {
  const context = await ready(text);
  const { f, insert } = context;
  const held = await holdUpdate(context);
  await insert({ new: row(3) });
  assert.equal(f.state.messages[CHAT].length, 3, "actual INSERT positive control");
  held.hidden.resolve({ data: [], error: null });
  await held.pending;
  assert.deepEqual(Array.from(f.state.messages[CHAT], (m) => m.id), [row(1).id, row(2).id, row(3).id],
    "delayed UPDATE must not erase the incoming row");
}
test("same UID/epoch: delayed UPDATE preserves a concurrent realtime INSERT", () => concurrentInsert());

for (const kind of ["edit", "delete"]) {
  test(`same UID/epoch: delayed UPDATE preserves a concurrent other-row ${kind}`, async () => {
    const context = await ready();
    const { f, update } = context;
    const held = await holdUpdate(context);
    const fresh = { ...row(2), ...(kind === "edit"
      ? { content: "fictional-newer", edited_at: "2026-10-07T00:02:00Z" }
      : { content: null, deleted_at: "2026-10-07T00:02:00Z" }) };
    const joined = f.hold("joined");
    const pending = update({ new: fresh });
    await f.drain();
    joined.resolve({ data: fresh, error: null });
    await pending;
    assert.equal(f.state.messages[CHAT].find((m) => m.id === fresh.id)[kind === "edit" ? "content" : "deleted_at"],
      kind === "edit" ? "fictional-newer" : "2026-10-07T00:02:00Z", "concurrent UPDATE positive control");
    held.hidden.resolve({ data: [], error: null });
    await held.pending;
    assert.equal(f.state.messages[CHAT].find((m) => m.id === fresh.id)[kind === "edit" ? "content" : "deleted_at"],
      kind === "edit" ? "fictional-newer" : "2026-10-07T00:02:00Z", "delayed UPDATE must retain another row's newer state");
  });
}

async function sameRow(text = source) {
  const context = await ready(text);
  const { f, update } = context;
  const held = await holdUpdate(context);
  const fresh = { ...row(1), content: "fictional-newest", edited_at: "2026-10-07T00:03:00Z" };
  const joined = f.hold("joined");
  const pending = update({ new: fresh });
  await f.drain();
  joined.resolve({ data: fresh, error: null });
  await pending;
  assert.equal(f.state.messages[CHAT][0].content, "fictional-newest", "newer edit positive control");
  held.hidden.resolve({ data: [], error: null });
  await held.pending;
  assert.equal(f.state.messages[CHAT][0].content, "fictional-newest", "older same-row response must not replace a newer edit");
}
test("same UID/epoch: older same-row UPDATE cannot undo a newer edit", () => sameRow());

async function revisionCase(spec, text = source) {
  const context = await ready(text);
  const { f } = context;
  const initial = { ...row(1), ...spec.initial };
  f.state.messages[CHAT] = [initial, row(2)];
  const held = await holdUpdate(context, { ...initial, ...spec.reply });
  if (spec.changed) f.state.messages[CHAT] = [{ ...initial, ...spec.changed }, row(2)];
  if (spec.remove) f.state.messages[CHAT] = [row(2)];
  const before = f.state.messages[CHAT];
  held.hidden.resolve({ data: [], error: null });
  await held.pending;
  if (spec.remove) {
    assert.equal(f.state.messages[CHAT], before, "absent target must remain absent without publication");
    return;
  }
  const actual = f.state.messages[CHAT][0];
  assert.equal(actual.content, spec.want, "literal revision admission must preserve the right row");
  if (spec.deleted !== undefined) assert.equal(actual.deleted_at, spec.deleted, "deleted target must never resurrect");
  if (spec.mediaPath !== undefined) assert.equal(actual.media_path, spec.mediaPath, "canonical media clear is retained");
}

const tied = { initial: { edited_at: "2026-10-07T00:01:00Z" },
  reply: { content: "fictional-reply", edited_at: "2026-10-07T00:01:00Z" },
  changed: { content: "fictional-held", edited_at: "2026-10-07T00:01:00Z" }, want: "fictional-held" };
const deleted = { reply: { content: "fictional-reply", edited_at: "2026-10-07T00:03:00Z" },
  changed: { content: null, deleted_at: "2026-10-07T00:02:00Z" }, want: null, deleted: "2026-10-07T00:02:00Z" };
const older = { initial: { content: "fictional-held", edited_at: "2026-10-07T00:03:00Z" },
  reply: { content: "fictional-reply", edited_at: "2026-10-07T00:02:00Z" }, want: "fictional-held" };
const revisions = [
  ["target removed during await", { remove: true }],
  ["target deleted during await", deleted],
  ["unchanged held revision is newer", older],
  ["equal revision with unchanged target accepts enrichment", { initial: tied.initial, reply: tied.reply, want: "fictional-reply" }],
  ["equal revision with changed target retains held row", tied],
  ["sub-ms parse collision retains changed held row", { ...tied,
    reply: { content: "fictional-reply", edited_at: "2026-10-07T00:01:00.000999Z" },
    changed: { content: "fictional-held", edited_at: "2026-10-07T00:01:00.000111Z" } }],
  ["equal instant with timezone offset retains changed held row", { ...tied,
    reply: { content: "fictional-reply", edited_at: "2026-10-07T03:01:00+03:00" } }],
  ["unknown changed revision is not orderable", { reply: { content: "fictional-reply", edited_at: null },
    changed: { content: "fictional-held", edited_at: "invalid" }, want: "fictional-held" }],
  ["invalid reply cannot replace known held revision", { ...older, reply: { content: "fictional-reply", edited_at: "invalid" } }],
  ["strictly newer reply may replace changed target", { ...tied,
    reply: { content: "fictional-reply", edited_at: "2026-10-07T00:02:00Z" }, want: "fictional-reply" }],
  ["deletion still clears canonical content and media", { ...older,
    initial: { ...older.initial, media_path: "fictional/path" },
    reply: { content: null, media_path: null, edited_at: null, deleted_at: "2026-10-07T00:04:00Z" },
    want: null, deleted: "2026-10-07T00:04:00Z", mediaPath: null }],
];
for (const [name, spec] of revisions) test(`revision calibration: ${name}`, () => revisionCase(spec));

function mutate(needle, replacement) {
  assert.equal(source.split(needle).length - 1, 1, "compiled mutation binds exactly one production location");
  return source.replace(needle, replacement);
}
const admission = "if (!nextMessage.deleted_at && (held.deleted_at || heldIsNewer || (held !== heldWhenAsked && !replyIsNewer))) return;";
const omissions = [
  ["pre-await array snapshot", () => {
    const line = "const current = useAppStore.getState().messages[payload.new.chat_id] ?? [];";
    const current = mutate(line, "");
    const needle = "const heldWhenAsked = useAppStore.getState().messages[chatId]?.find((message) => message.id === payload.new.id);";
    assert.equal(current.split(needle).length - 1, 1);
    return current.replace(needle, `${needle}\n${line}`);
  }, concurrentInsert, "delayed UPDATE must not erase the incoming row"],
  ["omit revision admission", () => mutate(admission, ""), sameRow, "older same-row response must not replace a newer edit"],
  ["omit deletion protection", () => mutate("held.deleted_at || heldIsNewer", "heldIsNewer"),
    (text) => revisionCase(deleted, text), "literal revision admission"],
  ["omit changed-row tie protection", () => mutate("(held !== heldWhenAsked && !replyIsNewer)", "false"),
    (text) => revisionCase(tied, text), "literal revision admission"],
  ["treat tied revision as newer", () => mutate("replyRevision > heldRevision", "replyRevision >= heldRevision"),
    (text) => revisionCase(tied, text), "literal revision admission"],
  ["omit known newer held revision", () => mutate("held.deleted_at || heldIsNewer ||", "held.deleted_at ||"),
    (text) => revisionCase(older, text), "literal revision admission"],
  ["bypass absent target admission with publication", () => mutate("if (!held) return;", "if (!held) return setMessages(payload.new.chat_id, current.slice());"),
    (text) => revisionCase({ remove: true }, text), "absent target must remain absent"],
];
for (const [name, changed, scenario, oracle] of omissions) {
  test(`compiled omission rejected: ${name}`, async () => {
    await assert.rejects(() => scenario(changed()), (error) => {
      assert.equal(error.code, "ERR_ASSERTION", "only a behavioral assertion kills a compiled mutant");
      assert.ok(error.message.includes(oracle), `expected oracle: ${oracle}`);
      return true;
    });
  });
}

for (const boundary of ["same-UID-new-epoch", "other-user"]) {
  test(`control: delayed UPDATE is inert after ${boundary}`, async () => {
    const context = await ready();
    const { f } = context;
    const held = await holdUpdate(context);
    if (boundary === "same-UID-new-epoch") f.changeEpoch(false);
    else f.state.currentUser = { id: "fictional-other-owner" };
    const before = f.state.messages[CHAT];
    f.clear();
    held.hidden.resolve({ data: [], error: null });
    await held.pending;
    assert.equal(f.state.messages[CHAT], before, "retired callback cannot replace rows");
    assert.equal(f.publications.length, 0, "retired callback cannot publish state");
  });
}

for (const boundary of ["topic-switch", "unmount"]) {
  test(`control: delayed UPDATE is inert after ${boundary}`, async () => {
    const context = await ready();
    const { f } = context;
    const held = await holdUpdate(context);
    if (boundary === "topic-switch") { f.switchTopic("fictional-other-topic"); await f.drain(); }
    else f.unmount();
    const before = f.state.messages[CHAT];
    f.clear();
    held.hidden.resolve({ data: [], error: null });
    await held.pending;
    assert.equal(f.state.messages[CHAT], before, "retired scope cannot replace rows");
    assert.equal(f.publications.length, 0, "retired scope cannot publish state");
  });
}
