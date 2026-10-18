import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createOutboxRunner } from "../../artifacts/kub/src/lib/outbox/outboxRunner.ts";
import { memoryOutboxStorage } from "../../artifacts/kub/src/lib/outbox/outboxStorage.ts";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = name => readFileSync(new URL(name, root), "utf8").replaceAll("\r\n", "\n");
const source = read("hooks/useMessages.ts"), CHAT = "30000000-0000-0000-0000-000000000001";
const row = () => ({ id: "40000000-0000-0000-0000-000000000001", chat_id: CHAT, user_id: "fictional-peer",
  type: "text", content: null, topic_id: null, created_at: "2026-10-18T00:00:00Z", deleted_at: null,
  sender: { id: "fictional-peer" }, bot_id: null, reply_to_id: null, reactions: [] });
const entry = { clientMessageId: "owned", tempId: "tmp:owned", userId: "fictional-owner", chatId: CHAT,
  topicId: null, type: "text", content: null, clientSentAt: "2026-10-18T00:00:00Z", attempts: 0, nextAttemptAt: 0 };
const bubble = { ...row(), id: entry.tempId, client_message_id: entry.clientMessageId, user_id: entry.userId, pending: true };
const fixtures = new Set();
test.afterEach(async () => { for (const f of fixtures) await f.close(); fixtures.clear(); });
// Reuse only the existing full-hook fixture declarations, not its test cases.
const syntax = ts.createSourceFile("fixture.mjs", readFileSync(new URL("message-producer-lifecycle.test.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let declarations = ["compile", "deferred", "fixture"].map(name => {
  const nodes = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(nodes.length, 1); return nodes[0].getText(syntax);
}).join("\n");
function adapt(before, after) { assert.equal(declarations.split(before).length, 2); declarations = declarations.replace(before, after); }
adapt('"@/lib/outbox/appOutbox": { appOutbox: { enqueue() { throw new Error("outbox mutation outside fixture scope"); } } },',
  '"@/lib/outbox/appOutbox": { appOutbox: outbox },');
adapt('removeMessage() {},', 'removeMessage(chat, id) { publish("remove", id); state.messages[chat] = state.messages[chat].filter(item => item.id !== id); dirty = true; },');
adapt("calls, publications, timers, channels, hold, pending, drain,", "calls, publications, timers, channels, hold, pending, drain, show(message) { methods.addMessage(CHAT, message); },");

async function ready(t, { text = source, held = false } = {}) {
  const disk = memoryOutboxStorage(), deleting = {};
  deleting.promise = new Promise(resolve => { deleting.resolve = resolve; });
  let fail = true, deletes = 0;
  const runner = createOutboxRunner({ storage: { ...disk, async remove(id) {
    deletes++; if (held) await deleting.promise; if (fail) throw Error("FICTIONAL_ABORT"); await disk.remove(id);
  } }, async send() { return { failed: { status: 0 } }; }, onWaiting() {}, onRefused() {}, onSent() {},
    timers: { set: () => 0, clear() {} } });
  await runner.start(entry.userId); await runner.enqueue(entry);
  const mount = new Function("assert", "path", "vm", "ts", "read", "source", "row", "CHAT", "fixtures", "outbox", declarations + "\nreturn fixture;")
    (assert, path, vm, ts, read, text, row, CHAT, fixtures, runner);
  const f = mount({ text }); await f.drain(); f.show({ ...bubble }); await f.drain(); f.clear();
  t.after(() => { runner.stop(); deleting.resolve(); });
  return { f, runner, disk, release: () => deleting.resolve(), permit: () => { fail = false; }, get deletes() { return deletes; } };
}

async function failedDiscard(t, text = source) {
  const h = await ready(t, { text }); await h.f.view.discardLocalMessage(entry.tempId); await h.f.drain();
  assert.equal(h.f.state.messages[CHAT].filter(item => item.id === entry.tempId).length, 1, "FAILED_DELETE_MUST_RETAIN_BUBBLE");
  assert.equal(h.f.view.actionRefusal, "Не удалось удалить сообщение с устройства. Повторите удаление перед перезапуском приложения.");
  assert.equal(h.runner.has(entry.clientMessageId), true);
  h.permit(); await h.f.view.discardLocalMessage(entry.tempId); await h.f.drain();
  assert.equal(h.f.state.messages[CHAT].some(item => item.id === entry.tempId), false);
  assert.equal(h.f.view.actionRefusal, null); assert.deepEqual(await h.disk.list(entry.userId), []);
}
test("actual useMessages retains bubble/refusal on durable-delete failure and removes only after retry commit", failedDiscard);

test("actual useMessages keeps the bubble while delete is held and fences late same-owner epoch completion", async t => {
  const h = await ready(t, { held: true }); h.permit(); const pending = h.f.view.discardLocalMessage(entry.tempId);
  await h.f.drain(); assert.equal(h.f.state.messages[CHAT].some(item => item.id === entry.tempId), true);
  h.f.changeEpoch(); await h.f.drain(); h.f.clear(); h.release(); await pending; await h.f.drain();
  assert.equal(h.f.publications.filter(item => item.kind === "remove").length, 0);
});

test("actual useMessages refuses foreign local deletion without calling outbox", async t => {
  const h = await ready(t); h.f.show({ ...bubble, id: "tmp:foreign", user_id: "fictional-peer" }); await h.f.drain();
  await h.f.view.discardLocalMessage("tmp:foreign"); assert.equal(h.deletes, 0);
});

test("loaded omission of UI failure handling is killed by retained-bubble behavior", async t => {
  assert.equal(source.split("if (!outcome.ok) {").length, 2);
  await assert.rejects(() => failedDiscard(t, source.replace("if (!outcome.ok) {", "if (false) {")),
    error => error.code === "ERR_ASSERTION" && /FAILED_DELETE_MUST_RETAIN_BUBBLE/.test(error.message));
});

test("loaded omission of post-await account fence is killed by actual stale UI publication", async t => {
  const before = "if (!sameAccount()) return;\n    if (!outcome.ok)";
  assert.equal(source.split(before).length, 2);
  const h = await ready(t, { held: true, text: source.replace(before, "if (!outcome.ok)") });
  h.permit(); const pending = h.f.view.discardLocalMessage(entry.tempId); await h.f.drain();
  h.f.changeEpoch(); await h.f.drain(); h.f.clear(); h.release(); await pending; await h.f.drain();
  assert.equal(h.f.publications.filter(item => item.kind === "remove").length, 1);
});
