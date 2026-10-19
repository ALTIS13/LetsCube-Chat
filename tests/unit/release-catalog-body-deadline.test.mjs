import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createReleaseCatalogClient, RELEASE_CATALOG_TIMEOUT_MS } from "../../artifacts/kub/src/lib/releaseCatalog.ts";

const manifest = version => ({
  schemaVersion: 1, platform: "android", channel: "stable", available: true, version, build: 1,
  publishedAt: "2026-10-19T00:00:00.000Z", minimumSupportedVersion: null, mandatory: false,
  notes: "Synthetic catalog", highlights: [],
  artifact: { url: `https://api.letscube.ru/releases/files/android/${version}/synthetic.apk`, size: 1234, sha256: "a".repeat(64) },
});
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function heldBody(status = 200) {
  let controller, closed = false, cancellations = 0;
  const response = new Response(new ReadableStream({ start(value) { controller = value; }, cancel() { closed = true; cancellations++; } }), { status });
  return { response, cancellations: () => cancellations, release(value = manifest("0.1.0")) {
    if (closed) return; closed = true;
    controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close();
  } };
}

test("HTTP200 headers do not end the literal5000ms deadline; a stuck JSON body releases retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const held = heldBody(), cache = storage();
  let signal, outcome = null, reads = 0;
  const client = createReleaseCatalogClient({ storage: cache, fetchImpl: async (_url, init) => {
    reads++; signal = init.signal;
    return reads === 1 ? held.response : Response.json(manifest("0.2.0"));
  } });
  const operation = client.load("android").then(value => { outcome = { value }; }, error => { outcome = { error }; });
  try {
    await flush(); assert.equal(held.response.bodyUsed, true, "control: actual Response.json consumption has begun");
    t.mock.timers.tick(4_999); await flush(); assert.equal(outcome, null);
    t.mock.timers.tick(1); await flush();
    assert.equal(outcome?.error?.code, "network_timeout", "body must not remain pending after headers");
    assert.equal(signal.aborted, true); assert.equal(cache.values.size, 0);
    const fresh = await client.load("android", "stable", { force: true });
    assert.equal(fresh.manifest.version, "0.2.0"); assert.equal(fresh.source, "network");
    held.release(); await operation; await flush();
    assert.equal(JSON.parse([...cache.values.values()][0]).manifest.version, "0.2.0", "late old body cannot overwrite a successful retry");
    assert.equal(reads, 2);
  } finally { held.release(); await operation; }
});

test("headers and JSON share one budget rather than a fresh timeout for each stage", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const held = heldBody(); let outcome = null;
  const client = createReleaseCatalogClient({ storage: storage(), fetchImpl: async () => {
    await new Promise(resolve => setTimeout(resolve, 4_000)); return held.response;
  } });
  const operation = client.load("android").then(value => { outcome = { value }; }, error => { outcome = { error }; });
  try {
    t.mock.timers.tick(4_000); await flush(); assert.equal(held.response.bodyUsed, true);
    t.mock.timers.tick(999); await flush(); assert.equal(outcome, null);
    t.mock.timers.tick(1); await flush(); assert.equal(outcome?.error?.code, "network_timeout");
  } finally { held.release(); await operation; }
});

test("body timeout preserves the exact stale cache and a fresh forced retry replaces it", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const held = heldBody(), cache = storage(); let mode = "first";
  const client = createReleaseCatalogClient({ storage: cache, fetchImpl: async () => mode === "held" ? held.response : Response.json(manifest(mode === "first" ? "0.1.0" : "0.2.0")) });
  await client.load("android"); const original = [...cache.values.values()][0]; mode = "held";
  const operation = client.load("android", "stable", { force: true });
  try {
    await flush(); t.mock.timers.tick(5_000); await flush();
    const stale = await operation;
    assert.equal(stale.source, "stale-cache"); assert.equal(stale.stale, true);
    assert.equal(stale.manifest.version, "0.1.0"); assert.equal([...cache.values.values()][0], original);
    mode = "retry"; const fresh = await client.load("android", "stable", { force: true });
    assert.equal(fresh.source, "network"); assert.equal(fresh.stale, false); assert.equal(fresh.manifest.version, "0.2.0");
    held.release(); await flush();
    assert.equal(JSON.parse([...cache.values.values()][0]).manifest.version, "0.2.0");
  } finally { held.release(); await operation; }
});

test("a completed body before the deadline clears the timer and is never subsequently aborted", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const held = heldBody(); let signal;
  const client = createReleaseCatalogClient({ storage: storage(), fetchImpl: async (_url, init) => { signal = init.signal; return held.response; } });
  const operation = client.load("android");
  await flush(); t.mock.timers.tick(4_999); held.release();
  assert.equal((await operation).source, "network");
  t.mock.timers.tick(10_000); assert.equal(signal.aborted, false);
});

test("HTTP refusal cancels its unread body without waiting for JSON; malformed JSON remains retryable", async () => {
  const refused = heldBody(503); let mode = "status";
  const client = createReleaseCatalogClient({ storage: storage(), fetchImpl: async () => mode === "status" ? refused.response : mode === "json" ? new Response("{") : Response.json(manifest("0.2.0")) });
  await assert.rejects(client.load("android"), error => error.code === "network");
  assert.equal(refused.cancellations(), 1); assert.equal(refused.response.bodyUsed, true);
  mode = "json"; await assert.rejects(client.load("android"), error => error.code === "network");
  mode = "success"; assert.equal((await client.load("android")).manifest.version, "0.2.0");
});

test("loaded header-only omission fails the same body deadline oracle", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  assert.equal(RELEASE_CATALOG_TIMEOUT_MS, 5_000);
  const source = readFileSync(new URL("../../artifacts/kub/src/lib/releaseCatalog.ts", import.meta.url), "utf8");
  const replacements = [
    ["const payload = await fetchJsonWithTimeout(", "const response = await fetchJsonWithTimeout("],
    ["parseReleaseManifest(payload, platform, channel)", "parseReleaseManifest(await response.json(), platform, channel)"],
    ["return await response.json();", "return response;"],
  ];
  let mutant = source;
  for (const [from, to] of replacements) { assert.equal(mutant.split(from).length - 1, 1); mutant = mutant.replace(from, to); }
  const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
  const { transformSync } = createRequire(requireKub.resolve("vite"))("esbuild");
  const code = transformSync(mutant, { loader: "ts", format: "esm" }).code;
  const changed = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
  const held = heldBody(); let outcome = null;
  const client = changed.createReleaseCatalogClient({ storage: storage(), fetchImpl: async () => held.response });
  const operation = client.load("android").then(value => { outcome = { value }; }, error => { outcome = { error }; });
  try {
    await flush(); assert.equal(held.response.bodyUsed, true); t.mock.timers.tick(5_000); await flush();
    assert.throws(() => assert.equal(outcome?.error?.code, "network_timeout"), /AssertionError/, "same oracle rejects reintroduced header-only deadline");
  } finally { held.release(); await operation; }
});
