import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { ClearedAtCache } from "../../artifacts/kub/src/lib/clearedAtCache.ts";

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = name => readFileSync(new URL(name, root), "utf8").replaceAll("\r\n", "\n");
const source = read("hooks/useMessages.ts");
const cacheSource = read("lib/clearedAtCache.ts");
const CHAT = "30000000-0000-0000-0000-000000000001";
const row = () => ({ id: "40000000-0000-0000-0000-000000000001", chat_id: CHAT,
  user_id: "fictional-peer", bot_id: null, topic_id: null, type: "text", content: null,
  created_at: "2026-10-19T00:00:01Z", deleted_at: null, sender: { id: "fictional-peer" }, reactions: [], reply_to_id: null });
const fixtures = new Set();
test.before(() => assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0"));
test.afterEach(async () => { for (const f of fixtures) await f.close(); fixtures.clear(); });

// Reuse only the inspected executor declarations, not its accepted test cohort.
// Actual useMessages, ClearedAtCache and HiddenMessagesLive run; React/REST/clock leaves are fictional.
const harness = readFileSync(new URL("message-producer-lifecycle.test.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("harness.mjs", harness, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let declarations = ["compile", "deferred", "fixture"].map(name => {
  const nodes = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.equal(nodes.length, 1); return nodes[0].getText(ast);
}).join("\n");
function adapt(from, to) {
  assert.equal(declarations.split(from).length - 1, 1, "exact inspected fixture adaptation");
  declarations = declarations.replace(from, to);
}
adapt('const hook = load("hooks/useMessages.ts").useMessages;', `
  delete aliases["@/lib/clearedAtCache"]; delete aliases["@/lib/hiddenMessagesLive"];
  const markCache = load("lib/clearedAtCache.ts").clearedAtCache;
  const hides = load("lib/hiddenMessagesLive.ts").hiddenMessagesLive;
  markCache.setLive(true); hides.joined(); hides.pingReturned();
  const hook = load("hooks/useMessages.ts").useMessages;`);
adapt('calls, publications, timers, channels, hold, pending, drain,',
  'calls, publications, timers, channels, hold, pending, drain, markCache, hides,');
const fixture = new Function("assert", "path", "vm", "ts", "read", "source", "row", "CHAT", "fixtures",
  `${declarations}\nreturn fixture;`)(assert, path, vm, ts, read, source, row, CHAT, fixtures);

async function unrelatedPending(Cache = ClearedAtCache) {
  const cache = new Cache(() => 1000);
  let finish, calls = 0;
  const load = () => {
    calls++;
    return calls === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ value: null, ok: true });
  };
  const pending = cache.getOrLoad("chat-a", "owner-a", load);
  assert.equal(cache.getOrLoad("chat-a", "owner-a", load), pending, "same pair coalesces before invalidation");
  cache.evictChat("chat-b");
  finish({ value: null, ok: true });
  assert.equal(await pending, null);
  assert.equal(calls, 1, "unrelated chat eviction must not replay this membership read");
  assert.equal(cache.hasFresh("chat-a", "owner-a"), true);
}

test("unrelated chat invalidation preserves the exact pending membership request", () => unrelatedPending());

async function foreignBurst(Cache = ClearedAtCache) {
  const cache = new Cache(() => 1000);
  let calls = 0;
  await cache.getOrLoad("chat-a", "owner-a", async () => {
    calls++;
    await Promise.resolve();
    if (calls < 5) cache.evictChat(`foreign-${calls}`);
    return { value: null, ok: true };
  });
  assert.equal(calls, 1, "foreign membership churn must not create sequential retry waves");
}
test("foreign membership churn cannot multiply sequential history-boundary reads", () => foreignBurst());

test("literal global-generation replay mutant is rejected by the unrelated-chat control", async () => {
  const capture = "    const connectionGeneration = this.connectionGeneration;";
  const fence = "      if (this.pending.get(key) !== request) {";
  assert.equal(cacheSource.split(capture).length - 1, 1, "exact generation capture anchor");
  assert.equal(cacheSource.split(fence).length - 1, 1, "exact pending ownership anchor");
  const mutated = cacheSource
    .replace(capture, `    const generation = this.generation;\n${capture}`)
    .replace(fence, "      if (generation !== this.generation) {\n        if (this.pending.get(key) === request) this.pending.delete(key);");
  const exports = {};
  const output = ts.transpileModule(mutated, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(output, { exports }, { timeout: 1000 });
  assert.equal(typeof exports.ClearedAtCache, "function", "actual mutated cache compiled");
  await assert.rejects(() => unrelatedPending(exports.ClearedAtCache), error => {
    assert.equal(error.code, "ERR_ASSERTION", "setup/compiler failure is not a mutation kill");
    assert.ok(error.message.includes("unrelated chat eviction must not replay this membership read"));
    return true;
  });
});

async function warmFixture() {
  const f = fixture(); await f.drain();
  assert.equal(f.view.messages.length, 1, "actual cold-fetch visible-history positive control");
  assert.equal(f.calls.filter(c => c.name === "hidden").length, 1, "cold privacy verification control");
  f.unmount(); f.markCache.evictChat(CHAT); f.clear();
  const held = f.hold("mark"); await f.remount();
  assert.ok(f.pending.includes(held), "real warm-cache admission is awaiting membership");
  assert.equal(f.view.historyPending, true);
  assert.equal(f.view.messages.length, 0, "held rows must not appear before the current boundary answer");
  return { f, held };
}

test("actual warm history becomes visible after its one membership answer despite another chat eviction", async () => {
  const { f, held } = await warmFixture();
  f.markCache.evictChat("unrelated-chat");
  const retry = f.hold("mark");
  try {
    held.resolve({ data: { cleared_at: null }, error: null }); await f.drain();
    assert.equal(f.calls.filter(c => c.name === "mark").length, 1, "unrelated invalidation must not add a serial warm-history gate");
    assert.equal(f.view.messages.length, 1, "cached history should be admitted by the completed current answer");
    assert.equal(f.view.historyPending, false);
    assert.equal(f.calls.filter(c => c.name === "history").length, 0, "reopen need not refetch the trusted held page");
  } finally { retry.resolve({ data: { cleared_at: null }, error: null }); await f.drain(); }
});

test("actual warm history still refuses a same-chat clear until the replacement answer", async () => {
  const { f, held } = await warmFixture();
  f.markCache.evictChat(CHAT); const replacement = f.hold("mark");
  held.resolve({ data: { cleared_at: null }, error: null }); await f.drain();
  assert.equal(f.calls.filter(c => c.name === "mark").length, 2);
  assert.equal(f.view.messages.length, 0, "an invalidated old uncleared answer cannot reveal held history");
  replacement.resolve({ data: { cleared_at: "2026-10-20T00:00:00Z" }, error: null }); await f.drain();
  assert.equal(f.view.messages.length, 0);
  assert.equal(f.view.historyPending, false);
});

test("actual warm history stays unknown across a connection gap, without replaying its retired loader", async () => {
  const { f, held } = await warmFixture();
  f.markCache.setLive(false); f.markCache.setLive(true);
  held.resolve({ data: { cleared_at: null }, error: null }); await f.drain();
  assert.equal(f.calls.filter(c => c.name === "mark").length, 1);
  assert.equal(f.view.messages.length, 0);
  assert.equal(f.view.historyPending, false, "current verification failure ends busy state and shows an error");
  assert.ok(f.view.historyError);
});

test("actual warm membership answer cannot publish through a retired account epoch", async () => {
  const { f, held } = await warmFixture();
  f.changeEpoch(false); f.clear();
  held.resolve({ data: { cleared_at: null }, error: null }); await f.drain();
  assert.equal(f.publications.length, 0);
  assert.equal(f.calls.length, 0);
});
