import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { snapshotNativePushDescriptor, nativePushDescriptorFingerprint } from "../../supabase/functions/send-push-notifications/native-push-descriptor.ts";

const sourceUrl = new URL("../../supabase/functions/send-push-notifications/index.ts", import.meta.url);
const source = readFileSync(sourceUrl, "utf8").replaceAll("\r\n", "\n");
const id = n => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
let handler, env, f;
const originalFetch = globalThis.fetch;
globalThis.Deno = { env: { get: key => env[key] }, serve: callback => { handler = callback; } };
globalThis.__nativeBindingWeb = { setVapidDetails() {}, sendNotification() { assert.fail("unexpected Web provider"); } };
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === "npm:web-push@3.6.7"
    ? { url: "data:text/javascript,export default globalThis.__nativeBindingWeb", shortCircuit: true }
    : next(specifier, context);
} });
await import(sourceUrl); hooks.deregister();
test.after(() => { globalThis.fetch = originalFetch; delete globalThis.Deno; delete globalThis.__nativeBindingWeb; });

// Independent wire oracle: null is a typed negative-length frame, not empty text.
function fingerprint(d) {
  return "v1:" + createHash("sha256").update(Buffer.concat(
    [d.id.toLowerCase(), d.user_id.toLowerCase(), d.platform, d.provider, d.token,
      d.app_version, d.session_id?.toLowerCase() ?? null].flatMap(value => {
      if (value === null) return [Buffer.from("-1:")];
      const bytes = Buffer.from(value, "utf8"); return [Buffer.from(`${bytes.length}:`), bytes];
    }))).digest("hex");
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function configure(provider = "fcm", options = {}) {
  env = { KUB_PUSH_DISPATCH_TOKEN: "fictional-dispatch", SUPABASE_URL: "https://fixture.invalid",
    SUPABASE_SECRET_KEY: "fictional-backend", VAPID_PUBLIC_KEY: "fictional", VAPID_PRIVATE_KEY: "fictional",
    FCM_PROJECT_ID: "fictional", FCM_CLIENT_EMAIL: "fictional@example.invalid", FCM_PRIVATE_KEY: privateKey,
    WNS_TENANT_ID: "fictional", WNS_CLIENT_ID: "fictional", WNS_CLIENT_SECRET: "fictional" };
  const descriptor = { id: id(52), user_id: id(1), platform: provider === "wns" ? "windows" : "android", provider,
    token: provider === "wns" ? "https://db5.notify.windows.com/?fictional=A" : "fictional:\u00e9\u{1f9ca}",
    app_version: "0.1.21", session_id: id(30), enabled: true, revoked_at: null, ...options.cached };
  f = { cached: descriptor, live: { ...descriptor, enabled: true, revoked_at: null }, requests: [], providers: [],
    events: [], patches: [], token: null, entered: deferred(), release: deferred(), options };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)); const args = init.body && init.method === "POST" && url.hostname === "fixture.invalid"
      ? JSON.parse(init.body) : null;
    f.requests.push({ url, init, args });
    if (url.pathname.endsWith("/push_outbox_claim")) return Response.json([]);
    if (url.pathname.endsWith("/native_push_outbox_claim")) {
      f.token = args.p_claim_token;
      return Response.json([{ id: id(160), device_id: id(52), attempt_count: 0,
        payload: { kind: "message", title: "LETSCUBE", body: "Fictional", chatId: id(10), messageId: id(40) } }]);
    }
    if (url.pathname === "/rest/v1/user_push_devices") {
      if (init.method === "PATCH") {
        f.patches.push({ url, patch: JSON.parse(init.body) });
        const matches = [...url.searchParams].every(([key, value]) => value === "is.null"
          ? f.live[key] === null : value === `eq.${f.live[key]}`);
        if (matches) Object.assign(f.live, JSON.parse(init.body));
        return Response.json([]);
      }
      const columns = url.searchParams.get("select").split(",");
      const rows = options.missing ? [] : [Object.fromEntries(columns.map(key => [key, descriptor[key]]))];
      if (options.holdLookup) { f.entered.resolve(); await f.release.promise; }
      return Response.json(rows);
    }
    if (url.hostname === "oauth2.googleapis.com" || url.hostname === "login.microsoftonline.com") {
      f.events.push("oauth");
      if (options.holdOAuth) { f.entered.resolve(); await f.release.promise; }
      return Response.json({ access_token: "fictional-oauth" });
    }
    if (url.pathname.endsWith("/native_push_outbox_delivery_recheck_bound")) {
      f.events.push("bound");
      assert.deepEqual(args, { p_outbox_id: id(160), p_claim_token: f.token, p_device_id: id(52),
        p_device_fingerprint: fingerprint(descriptor) }, "RPC must bind the exact cached bytes, never raw token");
      if (options.rpcError) return new Response("unavailable", { status: 503 });
      if (options.rpcThrow) throw Error("fictional private error");
      const status = options.status ?? (args.p_device_fingerprint !== fingerprint(f.live) ? "device_changed"
        : !f.live.enabled || f.live.revoked_at ? "device_inactive" : "deliver");
      return Response.json(status);
    }
    // Old unbound policy is deliberately realistic: it cannot see a descriptor change.
    if (url.pathname.endsWith("/native_push_outbox_delivery_recheck")) {
      assert.deepEqual(args, { p_outbox_id: id(160), p_claim_token: f.token });
      return Response.json(options.status ?? "deliver");
    }
    if (url.hostname === "fcm.googleapis.com" || url.hostname.endsWith(".notify.windows.com")) {
      f.events.push("provider"); f.providers.push({ url, init }); options.onProvider?.(f);
      if (options.permanent) return provider === "fcm"
        ? Response.json({ error: { status: "NOT_FOUND", details: [{
          "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } }, { status: 404 })
        : new Response(null, { status: 410 });
      return Response.json({ name: "fictional-accepted" });
    }
    if (url.pathname === "/rest/v1/notifications_native_push_outbox") {
      assert.equal(url.searchParams.get("claim_token"), `eq.${f.token}`, "completion must retain exact lease");
      return Response.json([{ id: id(160) }]);
    }
    assert.fail(`unexpected fixture path ${url.pathname}`);
  };
  return f;
}
const run = async () => (await handler(new Request("https://fixture.invalid/dispatch", {
  method: "POST", headers: { "x-kub-push-token": "fictional-dispatch" }, body: "{}" }))).json();

test("native literal Unicode v1 framing and typed nulls agree with independent SQL oracle", async () => {
  configure(); const snapshot = snapshotNativePushDescriptor(f.cached);
  assert.equal(await nativePushDescriptorFingerprint(snapshot), "v1:0918c37f7151f42f6571fb37e7b3ee787c9b9003267e346fae506e3f4cfec1bb");
  const nullable = snapshotNativePushDescriptor({ ...f.cached, app_version: null, session_id: null });
  assert.equal(await nativePushDescriptorFingerprint(nullable), "v1:ff065d0189973bff826ee35a0a23332bf2552e547fb355c829a0834fec8e9520");
  assert.notEqual(await nativePushDescriptorFingerprint({ ...nullable, app_version: "" }), await nativePushDescriptorFingerprint(nullable));
  f.cached.token = "replacement"; assert.notEqual(snapshot.token, f.cached.token); assert.equal(Object.isFrozen(snapshot), true);
});
for (const patch of [{ user_id: undefined }, { platform: undefined }, { provider: "unknown" }, { session_id: undefined },
  { session_id: "bad" }, { app_version: undefined }, { token: "" }]) test(`missing/malformed native descriptor ${Object.keys(patch)} refuses before sending`, async () => {
  configure("fcm", { cached: patch }); assert.equal((await run()).native.sent, 0); assert.equal(f.providers.length, 0);
});

for (const provider of ["fcm", "wns"]) {
  for (const hold of ["holdLookup", "holdOAuth"]) test(`${provider} ${hold} A-to-B descriptor change sends zero`, async () => {
    configure(provider, { [hold]: true }); const pending = run(); await f.entered.promise;
    f.live.token += "-B"; f.release.resolve(); const result = await pending;
    assert.equal(f.providers.length, 0, "descriptor replacement must not reach the old provider");
    assert.equal(result.native.sent, 0);
    assert.equal(f.requests.some(r => r.url.pathname.endsWith("/native_push_outbox_delivery_recheck_bound")), true);
  });
  test(`${provider} matching descriptor sends after bound check and exact ACK`, async () => {
    configure(provider); const result = await run(); assert.equal(result.native.sent, 1);
    assert.deepEqual(f.events, ["oauth", "bound", "provider"]);
    assert.equal(f.providers.length, 1);
    if (provider === "fcm") assert.equal(JSON.parse(f.providers[0].init.body).message.token, f.cached.token);
    else assert.equal(f.providers[0].url.href, f.cached.token);
  });
  test(`${provider} stale disabled cache cannot terminalize a currently active target`, async () => {
    configure(provider, { cached: { enabled: false, revoked_at: "2026-01-01T00:00:00Z" } });
    assert.equal((await run()).native.sent, 1, "fresh current SQL authority must win cached inactivity");
  });
  for (const options of [{ status: "claim_lost" }, { status: "device_changed" }, { status: "device_inactive" },
    { status: "not_eligible" }, { status: "read" }, { status: "unknown" }, { status: { status: "deliver" } },
    { rpcError: true }, { rpcThrow: true }]) test(`${provider} failclosed ${JSON.stringify(options)}`, async () => {
    configure(provider, options); assert.equal((await run()).native.sent, 0); assert.equal(f.providers.length, 0);
    assert.equal(f.requests.filter(r => r.url.pathname.endsWith("/native_push_outbox_delivery_recheck")).length, 0,
      "missing/unknown bound RPC must never fall back");
  });
  test(`${provider} late permanent failure cannot retire a replacement descriptor`, async () => {
    configure(provider, { permanent: true, onProvider: state => { state.live.session_id = id(31); } }); await run();
    assert.equal(f.live.enabled, true, "exact descriptor CAS must preserve a replacement session");
    assert.equal(f.patches.length, 1);
  });
  test(`${provider} unchanged permanent failure retires exactly sent owner/descriptor`, async () => {
    configure(provider, { permanent: true }); await run(); assert.equal(f.live.enabled, false);
    assert.deepEqual([...f.patches[0].url.searchParams.keys()].sort(),
      ["id", "user_id", "platform", "provider", "token", "app_version", "session_id"].sort());
  });
}

for (const [label, edit] of [
  ["old RPC fallback", text => text.replace("/rpc/native_push_outbox_delivery_recheck_bound", "/rpc/native_push_outbox_delivery_recheck")
    .replace(',\n        p_device_id: deviceId, p_device_fingerprint: deviceFingerprint', '')],
  ["cached inactive veto", text => text.replace("if (!descriptor) {\n      await markNativeOutbox", "if (!descriptor || device?.enabled !== true) {\n      await markNativeOutbox")],
  ["retirement session binding", text => text.replace('nativePushRetirementUrl(supabaseUrl, device)', 'new URL("/rest/v1/user_push_devices?id=eq." + device.id, supabaseUrl)')],
]) test(`compiled native omission killed: ${label}`, async () => {
  const edited = edit(source); assert.notEqual(edited, source, "one loaded production anchor required");
  let js = stripTypeScriptTypes(edited).replace('"npm:web-push@3.6.7"',
    '"data:text/javascript,export default globalThis.__nativeBindingWeb"');
  js = js.replace(/"(\.\/[^"\n]+\.ts)"/g, (_match, path) => JSON.stringify(new URL(path, sourceUrl).href));
  const saved = handler;
  try {
    await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    if (label === "old RPC fallback") {
      configure("fcm", { holdOAuth: true }); const pending = run(); await f.entered.promise;
      f.live.token += "-B"; f.release.resolve(); await pending;
      assert.throws(() => assert.equal(f.providers.length, 0, "literal old descriptor denial"), { code: "ERR_ASSERTION" });
    } else if (label === "cached inactive veto") {
      configure("fcm", { cached: { enabled: false } });
      assert.notEqual((await run()).native.sent, 1, "literal fresh active authority control");
    } else {
      configure("fcm", { permanent: true, onProvider: state => { state.live.session_id = id(31); } }); await run();
      assert.throws(() => assert.equal(f.live.enabled, true, "literal replacement preservation"), { code: "ERR_ASSERTION" });
    }
  } finally { handler = saved; }
});

for (const [label, needle, replacement, nullable, expected] of [
  ["UTF8 byte count", "bytes.byteLength", "value.length", false, "v1:0918c37f7151f42f6571fb37e7b3ee787c9b9003267e346fae506e3f4cfec1bb"],
  ["nullable type", 'encoder.encode("-1:")', 'encoder.encode("0:")', true, "v1:ff065d0189973bff826ee35a0a23332bf2552e547fb355c829a0834fec8e9520"],
  ["session field", "descriptor.app_version, descriptor.session_id]", "descriptor.app_version]", false, "v1:0918c37f7151f42f6571fb37e7b3ee787c9b9003267e346fae506e3f4cfec1bb"],
]) test(`actual compiled native hash omission breaks literal ${label}`, async () => {
  const helper = readFileSync(new URL("./native-push-descriptor.ts", sourceUrl), "utf8");
  assert.ok(helper.includes(needle));
  const js = stripTypeScriptTypes(helper.replace(needle, replacement));
  const mutant = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  configure(); const descriptor = snapshotNativePushDescriptor({ ...f.cached, ...(nullable ? { app_version: null, session_id: null } : {}) });
  const hash = await mutant.nativePushDescriptorFingerprint(descriptor);
  assert.throws(() => assert.equal(hash, expected, "literal native framing oracle"), { code: "ERR_ASSERTION" });
});
