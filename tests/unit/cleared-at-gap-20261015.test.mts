import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { ClearedAtCache } from "../../artifacts/kub/src/lib/clearedAtCache.ts";

type Result = { value: string | null; ok: boolean };
type CacheType = typeof ClearedAtCache;
const MARK = "2026-10-15T12:00:00.000Z";

function deferred() {
  let resolve!: (value: Result) => void;
  const promise = new Promise<Result>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

async function noGap(Cache: CacheType = ClearedAtCache) {
  const cache = new Cache(() => 1_000);
  cache.setLive(true);
  const held = deferred();
  let calls = 0;
  const load = () => { calls += 1; return held.promise; };
  const first = cache.getOrLoad("chat-a", "owner-a", load);
  const second = cache.getOrLoad("chat-a", "owner-a", load);
  assert.equal(second, first, "continuous pending reads coalesce");
  held.resolve({ value: null, ok: true });
  assert.equal(await first, null);
  assert.equal(await second, null);
  assert.equal(calls, 1, "no-gap invokes one loader");
}

function delayedSeed(rejoin: boolean, Cache: CacheType = ClearedAtCache) {
  const cache = new Cache(() => 1_000);
  cache.setLive(true);
  const read = cache.beginMembershipRead();
  cache.setLive(false);
  if (rejoin) cache.setLive(true);
  cache.seedFromMembershipRead("owner-a", [{ chat_id: "chat-a", cleared_at: null }], read);
  assert.equal(cache.hasFresh("chat-a", "owner-a"), false,
    "pre-gap membership snapshot cannot seed after loss, even in the same millisecond");
}

async function replacement(kind: "gap" | "clear", Cache: CacheType = ClearedAtCache) {
  const cache = new Cache(() => 1_000);
  cache.setLive(true);
  const old = deferred();
  const fresh = deferred();
  let oldCalls = 0;
  let freshCalls = 0;
  const loadOld = () => {
    oldCalls += 1;
    return oldCalls === 1 ? old.promise : Promise.resolve({ value: null, ok: true });
  };
  const loadFresh = () => { freshCalls += 1; return fresh.promise; };
  const before = cache.getOrLoad("chat-a", "owner-a", loadOld);
  if (kind === "gap") { cache.setLive(false); cache.setLive(true); }
  else cache.evictChat("chat-a");
  const after = cache.getOrLoad("chat-a", "owner-a", loadFresh);
  let extraCalls = 0;
  try {
    assert.equal(freshCalls, 1, "post-invalidation reader starts a fresh pending request");
    old.resolve({ value: null, ok: true });
    await flush();
    const joined = cache.getOrLoad("chat-a", "owner-a", async () => {
      extraCalls += 1;
      return { value: null, ok: true };
    });
    assert.equal(joined, after, "old completion must retain the newer same-key pending promise");
    assert.equal(oldCalls, 1, "old loader cannot displace a newer pending request");
    assert.equal(extraCalls, 0, "new pending remains coalesced after old completion");
  } finally {
    old.resolve({ value: null, ok: true });
    fresh.resolve({ value: MARK, ok: true });
  }
  assert.equal(await after, MARK);
  assert.equal(await before, kind === "gap" ? undefined : MARK,
    "loss retires the old owner request; per-chat clear follows the current request");
  assert.equal(cache.hasFresh("chat-a", "owner-a"), true);
  assert.equal(await cache.getOrLoad("chat-a", "owner-a", loadFresh), MARK);
  assert.equal(freshCalls, 1);
}

async function noOldRetry(Cache: CacheType = ClearedAtCache) {
  const cache = new Cache(() => 1_000);
  cache.setLive(true);
  const held = deferred();
  let calls = 0;
  const pending = cache.getOrLoad("chat-a", "owner-a", () => {
    calls += 1;
    return calls === 1 ? held.promise : Promise.resolve({ value: MARK, ok: true });
  });
  cache.setLive(false);
  cache.setLive(true);
  cache.setLive(false);
  cache.setLive(true);
  cache.setLive(false);
  held.resolve({ value: null, ok: true });
  assert.equal(await pending, undefined, "retired gap request returns unknown, never an old null mark");
  assert.equal(calls, 1, "repeated loss or cleanup cannot retry an old owner's loader");
  assert.equal(cache.hasFresh("chat-a", "owner-a"), false);
}

async function youngAnswer(seed: boolean, Cache: CacheType = ClearedAtCache) {
  let now = 1_000;
  const cache = new Cache(() => now);
  cache.setLive(true);
  if (seed) cache.seedFromMembershipRead("owner-a", [{ chat_id: "chat-a", cleared_at: null }], cache.beginMembershipRead());
  else await cache.getOrLoad("chat-a", "owner-a", async () => ({ value: null, ok: true }));
  now = 2_000;
  cache.setLive(false);
  cache.setLive(true);
  let calls = 0;
  const load = async () => { calls += 1; return { value: MARK, ok: true }; };
  now = 3_999;
  assert.equal(cache.hasFresh("chat-a", "owner-a"), true, "2999ms answer remains deliberately reusable");
  assert.equal(await cache.getOrLoad("chat-a", "owner-a", load), null);
  assert.equal(calls, 0);
  now = 4_000;
  assert.equal(cache.hasFresh("chat-a", "owner-a"), false, "3000ms pre-gap answer must expire");
  assert.equal(await cache.getOrLoad("chat-a", "owner-a", load), MARK);
  assert.equal(calls, 1);
}

async function duringGap(Cache: CacheType = ClearedAtCache) {
  const cache = new Cache(() => 1_000);
  cache.setLive(true);
  cache.setLive(false);
  const read = cache.beginMembershipRead();
  const held = deferred();
  const pending = cache.getOrLoad("chat-a", "owner-a", () => held.promise);
  cache.setLive(true);
  cache.seedFromMembershipRead("owner-a", [{ chat_id: "chat-a", cleared_at: null }], read);
  held.resolve({ value: null, ok: true });
  assert.equal(await pending, undefined, "rejoin retires in-gap pending read");
  assert.equal(cache.hasFresh("chat-a", "owner-a"), false, "rejoin retires in-gap membership seed");
}

async function continuousLive(Cache: CacheType = ClearedAtCache) {
  let now = 1_000;
  const cache = new Cache(() => now);
  cache.setLive(true);
  const read = cache.beginMembershipRead();
  const held = deferred();
  const pending = cache.getOrLoad("chat-a", "owner-a", () => held.promise);
  now = 1_001;
  cache.setLive(true);
  cache.seedFromMembershipRead("owner-a", [{ chat_id: "chat-b", cleared_at: MARK }], read);
  held.resolve({ value: null, ok: true });
  assert.equal(await pending, null, "duplicate live notification leaves current direct read intact");
  now = 10_000;
  assert.equal(cache.hasFresh("chat-a", "owner-a"), true, "continuous live read retains long-lived trust");
  assert.equal(cache.hasFresh("chat-b", "owner-a"), true, "continuous membership seed retains trust");
}

test("no-gap pending control coalesces and preserves null", () => noGap());
for (const rejoin of [false, true]) {
  test(`delayed pre-gap membership seed is refused after ${rejoin ? "loss/rejoin" : "loss"}`, () => delayedSeed(rejoin));
}
test("loss/rejoin starts fresh pending and old completion cannot erase it", () => replacement("gap"));
test("per-chat clear old completion cannot erase newer pending", () => replacement("clear"));
test("repeated loss and owner cleanup do not retry an old loader", () => noOldRetry());
for (const seed of [false, true]) test(`completed young ${seed ? "membership" : "direct"} answer keeps literal 3s reuse`, () => youngAnswer(seed));
test("a read begun during loss cannot seed across rejoin", () => duringGap());
test("duplicate live notification without a gap does not retire a current read", () => continuousLive());

test("current failure remains unknown and never populates answers", async () => {
  const cache = new ClearedAtCache(() => 1_000);
  cache.setLive(true);
  assert.equal(await cache.getOrLoad("chat-a", "owner-a", async () => ({ value: null, ok: false })), undefined);
  assert.equal(cache.hasFresh("chat-a", "owner-a"), false);
  assert.equal(await cache.getOrLoad("chat-a", "owner-a", async () => ({ value: MARK, ok: true })), MARK);
});

test("newer same-generation membership answer wins over failed pending direct read", async () => {
  let now = 1_000;
  const cache = new ClearedAtCache(() => now);
  cache.setLive(true);
  const held = deferred();
  const pending = cache.getOrLoad("chat-a", "owner-a", () => held.promise);
  now = 1_001;
  cache.seedFromMembershipRead("owner-a", [{ chat_id: "chat-a", cleared_at: MARK }], cache.beginMembershipRead());
  held.resolve({ value: null, ok: false });
  assert.equal(await pending, MARK);
});

test("per-chat clear keeps unrelated completed answers", async () => {
  const cache = new ClearedAtCache(() => 1_000);
  cache.seedFromMembershipRead("owner-a", [
    { chat_id: "chat-a", cleared_at: null }, { chat_id: "chat-b", cleared_at: MARK },
  ], cache.beginMembershipRead());
  cache.evictChat("chat-a");
  assert.equal(cache.hasFresh("chat-a", "owner-a"), false);
  assert.equal(await cache.getOrLoad("chat-b", "owner-a", async () => { throw new Error("unrelated answer lost"); }), MARK);
});

test("current throwing load releases pending without caching or automatic retry", async () => {
  const cache = new ClearedAtCache(() => 1_000);
  let calls = 0;
  await assert.rejects(cache.getOrLoad("chat-a", "owner-a", async () => {
    calls += 1;
    throw new Error("fictional transport failure");
  }), /fictional transport failure/);
  assert.equal(calls, 1);
  assert.equal(cache.hasFresh("chat-a", "owner-a"), false);
  assert.equal(await cache.getOrLoad("chat-a", "owner-a", async () => ({ value: MARK, ok: true })), MARK);
});

test("new completed answer survives an older gap completion", async () => {
  const cache = new ClearedAtCache(() => 1_000);
  cache.setLive(true);
  const old = deferred();
  const pending = cache.getOrLoad("chat-a", "owner-a", () => old.promise);
  cache.setLive(false);
  cache.setLive(true);
  assert.equal(await cache.getOrLoad("chat-a", "owner-a", async () => ({ value: MARK, ok: true })), MARK);
  old.resolve({ value: null, ok: true });
  assert.equal(await pending, undefined);
  assert.equal(await cache.getOrLoad("chat-a", "owner-a", async () => { throw new Error("winner lost"); }), MARK);
});

test("several retired pending generations cannot erase the current pending", async () => {
  const cache = new ClearedAtCache(() => 1_000);
  cache.setLive(true);
  const first = deferred(), second = deferred(), current = deferred();
  const a = cache.getOrLoad("chat-a", "owner-a", () => first.promise);
  cache.setLive(false);
  cache.setLive(true);
  const b = cache.getOrLoad("chat-a", "owner-a", () => second.promise);
  cache.setLive(false);
  cache.setLive(true);
  const c = cache.getOrLoad("chat-a", "owner-a", () => current.promise);
  second.resolve({ value: null, ok: true });
  first.resolve({ value: null, ok: true });
  assert.equal(await a, undefined);
  assert.equal(await b, undefined);
  assert.equal(cache.getOrLoad("chat-a", "owner-a", async () => { throw new Error("pending lost"); }), c);
  current.resolve({ value: MARK, ok: true });
  assert.equal(await c, MARK);
});

const source = readFileSync(new URL("../../artifacts/kub/src/lib/clearedAtCache.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function compiledMutation(needle: string, replacement: string): CacheType {
  assert.equal(source.split(needle).length - 1, 1, "exact actual-source mutation anchor");
  const exports: { ClearedAtCache?: CacheType } = {};
  const output = ts.transpileModule(source.replace(needle, replacement), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(output, { exports }, { timeout: 1_000 });
  assert.equal(typeof exports.ClearedAtCache, "function", "actual cache compiled");
  return exports.ClearedAtCache!;
}

const transition = "    this.generation += 1;\n    this.connectionGeneration += 1;\n    // Retire loaders across loss/rejoin, but preserve completed young answers.\n    this.pending.clear();";
for (const [name, needle, replacementText, contract, oracle] of [
  ["membership generation omitted", transition, transition.replace("this.generation += 1;", ""),
    (Cache: CacheType) => delayedSeed(true, Cache), "pre-gap membership snapshot cannot seed"],
  ["pending invalidation omitted", "    this.pending.clear();", "",
    (Cache: CacheType) => replacement("gap", Cache), "post-invalidation reader starts a fresh pending"],
  ["old gap completion fence omitted", "      if (connectionGeneration !== this.connectionGeneration) return undefined;", "",
    (Cache: CacheType) => noOldRetry(Cache), "retired gap request returns unknown"],
  ["new pending identity guard omitted", "        if (this.pending.get(key) === request) this.pending.delete(key);", "        this.pending.delete(key);",
    (Cache: CacheType) => replacement("clear", Cache), "old completion must retain the newer"],
  ["rejoin invalidation omitted", transition, `    if (!live) {\n${transition}\n    }`,
    (Cache: CacheType) => duringGap(Cache), "rejoin retires in-gap pending"],
  ["continuous-live guard omitted", "    if (live && this.liveSince !== null) return;", "",
    (Cache: CacheType) => continuousLive(Cache), "duplicate live notification leaves current"],
  ["young completed answers erased", "    this.pending.clear();", "    this.pending.clear();\n    this.answers.clear();",
    (Cache: CacheType) => youngAnswer(false, Cache), "2999ms answer remains deliberately reusable"],
  ["reuse threshold changed to 2999", "const CLEARED_AT_REUSE_MS = 3_000;", "const CLEARED_AT_REUSE_MS = 2_999;",
    (Cache: CacheType) => youngAnswer(true, Cache), "2999ms answer remains deliberately reusable"],
] as const) test(`compiled literal omission rejected: ${name}`, async () => {
  const Cache = compiledMutation(needle, replacementText);
  await assert.rejects(async () => contract(Cache), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "ERR_ASSERTION", "compiler/setup error is not a mutation kill");
    assert.ok((error as Error).message.includes(oracle), oracle);
    return true;
  });
});
