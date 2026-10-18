import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

let handler;
let requests = [];
let providerCalls = [];
let events = [];
let claimToken;
let recheckStatus = "deliver";
let providerFailure;
let beforeProviderFailure;
const rowId = "20000000-0000-4000-8000-000000000001";
const subscriptionId = "30000000-0000-4000-8000-000000000001";
const userId = "40000000-0000-4000-8000-000000000001";
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fingerprint(descriptor) {
  const fields = [descriptor.id.toLowerCase(), descriptor.user_id.toLowerCase(), descriptor.endpoint, descriptor.p256dh, descriptor.auth];
  return "v1:" + createHash("sha256").update(Buffer.concat(fields.flatMap(value => {
    const bytes = Buffer.from(value, "utf8"); return [Buffer.from(`${bytes.length}:`), bytes];
  }))).digest("hex");
}
const env = {
  KUB_PUSH_DISPATCH_TOKEN: "fixture-dispatch",
  SUPABASE_URL: "https://fixture.invalid",
  SUPABASE_SECRET_KEY: "fixture-backend",
  VAPID_PUBLIC_KEY: "fixture-public",
  VAPID_PRIVATE_KEY: "fixture-private",
};
globalThis.Deno = { env: { get: (key) => env[key] }, serve: (callback) => { handler = callback; } };
globalThis.__webRecheckWebpush = {
  setVapidDetails() {},
  async sendNotification(...args) {
    events.push("provider"); providerCalls.push(args);
    if (providerFailure) { beforeProviderFailure?.(); throw providerFailure; }
  },
};
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "npm:web-push@3.6.7") {
      return { url: "data:text/javascript,export default globalThis.__webRecheckWebpush", shortCircuit: true };
    }
    return next(specifier, context);
  },
});
await import("../../supabase/functions/send-push-notifications/index.ts");
hook.deregister();
const originalFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.Deno;
  delete globalThis.__webRecheckWebpush;
});

function request() {
  return new Request("https://fixture.invalid/functions/v1/send-push-notifications", {
    method: "POST", headers: { "x-kub-push-token": "fixture-dispatch" },
    body: JSON.stringify({ limit: 1 }),
  });
}

function configure(status, options = {}) {
  requests = [];
  providerCalls = [];
  events = [];
  claimToken = undefined;
  recheckStatus = status;
  providerFailure = undefined;
  beforeProviderFailure = undefined;
  const entered = deferred(), release = deferred();
  const live = { id: subscriptionId, user_id: userId, endpoint: "https://provider.invalid/push",
    p256dh: "fixture", auth: "fixture", is_active: true, ...options.subscription };
  const lookupId = options.rowSubscriptionId ?? live.id;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname === "/rest/v1/rpc/push_outbox_claim") {
      claimToken = JSON.parse(init.body).p_claim_token;
      return Response.json([{ id: rowId, subscription_id: lookupId,
        payload: { kind: "message", title: "Fixture", body: "Photo", ...options.payload }, attempt_count: 0 }]);
    }
    if (url.pathname === "/rest/v1/push_subscriptions") {
      if (init.method === "PATCH") {
        const matches = ["id", "user_id", "endpoint", "p256dh", "auth"].every(key =>
          url.searchParams.get(key) === `eq.${live[key]}`);
        if (matches || url.searchParams.size === 1) live.is_active = false;
        return Response.json(matches ? [{id:live.id}] : []);
      }
      const columns = url.searchParams.get("select").split(",");
      const snapshot = Object.fromEntries(Object.entries(live).filter(([key]) => columns.includes(key)));
      const response = Response.json(options.missing ? [] : [snapshot]); entered.resolve();
      if (options.holdSubscriptions) await release.promise;
      return response;
    }
    if (["/rest/v1/rpc/push_outbox_delivery_recheck", "/rest/v1/rpc/push_outbox_delivery_recheck_bound"].includes(url.pathname)) {
      events.push("recheck");
      const args = JSON.parse(init.body);
      if (url.pathname.endsWith("_bound")) {
        assert.deepEqual(Object.keys(args).sort(), ["p_claim_token", "p_outbox_id", "p_subscription_fingerprint", "p_subscription_id"]);
        assert.equal(args.p_outbox_id, rowId); assert.equal(args.p_claim_token, claimToken);
        assert.equal(args.p_subscription_id, lookupId.toLowerCase());
        if (options.boundMissing) return new Response("missing", { status: 404 });
        if (args.p_subscription_fingerprint !== fingerprint(live)) return Response.json("subscription_changed");
      } else {
        // Only the old-ABI omission control may reach this branch.
        assert.deepEqual(args, { p_outbox_id: rowId, p_claim_token: claimToken });
      }
      assert.equal(providerCalls.length, 0, "the recheck must precede the provider send");
      if (recheckStatus === "network_error") throw new Error("synthetic RPC network failure");
      if (recheckStatus === "malformed_json") return new Response("{");
      return recheckStatus === "rpc_error" ? new Response("unavailable", { status: 503 })
        : Response.json(recheckStatus === "deliver" && !live.is_active ? "subscription_inactive" : recheckStatus);
    }
    if (url.pathname === "/rest/v1/rpc/native_push_outbox_claim") return Response.json([]);
    if (url.pathname === "/rest/v1/notifications_push_outbox") {
      assert.equal(init.method, "PATCH");
      assert.equal(url.searchParams.get("claim_token"), `eq.${claimToken}`);
      return Response.json([{ id: rowId }]);
    }
    throw new Error(`unexpected offline request to ${url.hostname}${url.pathname}`);
  };
  return { entered, release, live };
}

async function descriptorChanged() {
  const f = configure("deliver", { holdSubscriptions: true });
  const pending = handler(request());
  await f.entered.promise;
  f.live.endpoint = "https://provider.invalid/B"; f.live.p256dh = "key-B"; f.live.auth = "auth-B";
  f.release.resolve(); await pending;
  assert.equal(providerCalls.length, 0, "same-id same-owner descriptor replacement must refuse stale provider bytes");
}
test("actual Single Web Edge refuses held descriptor A after live same-id owner changes to B", () => descriptorChanged());

test("single Web preview selector uses the checked subscription and notification, never payload credentials", async () => {
  const notificationId = "71000000-0000-4000-8000-000000000002";
  configure("deliver", { payload: { notificationId,
    web_preview: { subscription_id: userId, grant_secret: "fictional-forged-grant" } } });
  await handler(request());
  assert.equal(providerCalls.length, 1);
  const sent = JSON.parse(providerCalls[0][1]);
  assert.deepEqual(sent.web_preview, { preview_v: 1, subscription_id: subscriptionId, notification_id: notificationId });
  assert.equal(sent.body, "Новое уведомление");
  assert.doesNotMatch(JSON.stringify(sent), /fictional-forged-grant/);
});

test("Single Web permanent failure only retires the exact descriptor that failed", async () => {
  const f = configure("deliver");
  const original = {...f.live};
  providerFailure = {statusCode:410};
  await handler(request());
  assert.equal(f.live.is_active, false, "matching permanent failure retires its subscription");
  const patch = requests.find(entry => entry.url.pathname === "/rest/v1/push_subscriptions" && entry.init.method === "PATCH");
  for (const key of ["id", "user_id", "endpoint", "p256dh", "auth"])
    assert.equal(patch.url.searchParams.get(key), `eq.${original[key]}`, `retirement binds ${key}`);
});

async function replacementRetirement() {
  const f = configure("deliver");
  providerFailure = {statusCode:410};
  beforeProviderFailure = () => {
    f.live.endpoint = "https://provider.invalid/replacement";
    f.live.p256dh = "replacement-key"; f.live.auth = "replacement-auth";
  };
  await handler(request());
  assert.equal(providerCalls.length, 1);
  assert.equal(f.live.is_active, true, "old provider failure must not retire the replacement subscription");
}
test("Single Web old provider failure cannot retire a replacement descriptor", () => replacementRetirement());

function assertTerminal(result) {
  assert.deepEqual([result.sent, result.pruned, result.failed], [0, 1, 0]);
  assert.equal(result.native.pending, 0);
  assert.equal(providerCalls.length, 0);
  assert.equal(requests.filter((entry) => entry.url.pathname === "/rest/v1/notifications_push_outbox").length, 0);
}

for (const status of ["read", "subscription_inactive", "subscription_changed", "claim_lost", "not_eligible", "foreground", "rpc_error", "network_error", "malformed_json", "unexpected", null, { status: "deliver" }, ["deliver"]]) {
  test(`web actual dispatcher handles predelivery ${status} without a provider send`, async () => {
    configure(status);
    if (status === "network_error" || status === "malformed_json") {
      await assert.rejects(handler(request()), status === "network_error" ? /synthetic RPC network failure/ : SyntaxError);
      assert.equal(providerCalls.length, 0);
      return;
    }
    const response = await handler(request());
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.sent, 0);
    assert.equal(providerCalls.length, 0);
    assert.equal(result.native.pending, 0);
    assert.equal(requests.filter((entry) => entry.url.pathname === "/rest/v1/rpc/push_outbox_delivery_recheck_bound").length, 1);
    assert.equal(requests.filter((entry) => entry.url.pathname === "/rest/v1/rpc/push_outbox_delivery_recheck").length, 0);
    if (["read", "subscription_inactive", "subscription_changed", "claim_lost", "not_eligible"].includes(status)) assertTerminal(result);
    else assert.deepEqual([result.pruned, result.failed], status === "foreground" ? [0, 0] : [0, 1]);
  });
}

test("web positive control sends and acknowledges only after actual recheck", async () => {
  configure("deliver");
  const result = await (await handler(request())).json();
  assert.deepEqual([result.sent, result.pruned, result.failed], [1, 0, 0]);
  assert.equal(providerCalls.length, 1);
  assert.equal(requests.find(entry => entry.url.pathname === "/rest/v1/push_subscriptions").url.searchParams.get("select"), "id,user_id,endpoint,p256dh,auth,is_active,web_push_protocol");
  assert.deepEqual(events, ["recheck", "provider"]);
  assert.equal(requests.filter(entry => entry.url.pathname === "/rest/v1/rpc/push_outbox_delivery_recheck").length, 0);
  assert.equal(requests.filter((entry) => entry.url.pathname === "/rest/v1/notifications_push_outbox").length, 1);
});

test("Single Web only requests declarative mutation for an acknowledged compatible worker", async () => {
  env.WEB_PUSH_APP_ORIGIN = "https://app.letscube.ru";
  try {
    for (const protocol of [undefined, 0, 1, 2, "1"]) {
      configure("deliver", { subscription: { web_push_protocol: protocol } });
      await handler(request());
      assert.equal(providerCalls.length, 1);
      const sent = JSON.parse(providerCalls[0][1]);
      assert.equal(sent.mutable, protocol === 1);
    }
  } finally {
    delete env.WEB_PUSH_APP_ORIGIN;
  }
});

test("missing bound RPC fails closed, never falls back to old ABI or settles unverified row", async () => {
  configure("deliver", { boundMissing: true });
  const result = await (await handler(request())).json();
  assert.deepEqual([result.sent, result.failed], [0, 1]);
  assert.equal(providerCalls.length, 0);
  assert.equal(requests.filter(entry => entry.url.pathname === "/rest/v1/rpc/push_outbox_delivery_recheck").length, 0);
  assert.equal(requests.filter(entry => entry.init.method === "PATCH").length, 0);
});

async function reactivated() {
  const f = configure("deliver", { subscription: { is_active: false }, holdSubscriptions: true });
  const pending = handler(request()); await f.entered.promise;
  f.live.is_active = true; f.release.resolve();
  const result = await (await pending).json();
  assert.equal(providerCalls.length, 1, "fresh server deliver must override stale cached inactive flag");
  assert.deepEqual([result.sent, result.pruned], [1, 0]);
  const patch = requests.find(entry => entry.init.method === "PATCH");
  assert.equal(JSON.parse(patch.init.body).suppressed_at, undefined);
}
test("Single Web Edge accepts current RPC allow after cached inactive snapshot", () => reactivated());
test("Single Web Edge still refuses current live inactive state", async () => {
  configure("deliver", { subscription: { is_active: false } });
  assertTerminal(await (await handler(request())).json());
});

for (const options of [
  { missing: true }, { subscription: { user_id: undefined } }, { subscription: { user_id: "bad" } },
  { subscription: { id: "bad" } }, { subscription: { endpoint: null } },
  { subscription: { p256dh: "" } }, { subscription: { auth: 42 } },
  { subscription: { id: "50000000-0000-4000-8000-000000000001" }, rowSubscriptionId: subscriptionId },
]) {
  test(`invalid cached descriptor refuses without provider, recheck or suppression: ${JSON.stringify(options)}`, async () => {
    configure("deliver", options);
    const result = await (await handler(request())).json();
    assert.equal(result.sent, 0); assert.equal(providerCalls.length, 0);
    assert.equal(events.includes("recheck"), false);
    assert.equal(requests.filter(entry => entry.init.method === "PATCH").length, 0);
  });
}

const goldenDescriptor = {
  id: "70000000-0000-4000-8000-000000000050", user_id: "70000000-0000-4000-8000-000000000001",
  endpoint: "https://provider.invalid/\u00e9/\u{1f9ca}?x=1#f", p256dh: "a\u{1f9ca}:bc", auth: "auth:\u00e9",
};
const descriptorUrl = new URL("../../supabase/functions/send-push-notifications/web-push-descriptor.ts", import.meta.url);
const descriptorSource = readFileSync(descriptorUrl, "utf8");
async function descriptorModule(text = descriptorSource) {
  return import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString("base64")}`);
}
async function fingerprintGolden(text = descriptorSource) {
  const module = await descriptorModule(text);
  const descriptor = module.snapshotWebPushDescriptor(goldenDescriptor);
  assert.ok(descriptor);
  assert.equal(await module.webPushDescriptorFingerprint(descriptor), "v1:31a3586636684d806e71ae039a72c602302f7be949c8a4de4b491d7e4cd16f29", "literal UTF8 framing golden");
}
test("WebCrypto helper independently matches literal Node/PG v1 golden", () => fingerprintGolden());
test("descriptor snapshot normalizes UUID only and retains immutable endpoint and key bytes", async () => {
  const { snapshotWebPushDescriptor, webPushDescriptorFingerprint } = await descriptorModule();
  const input = { ...goldenDescriptor, id: "AAAAAAAA-0000-4000-8000-000000000050", is_active: false };
  const snapshot = snapshotWebPushDescriptor(input);
  assert.equal(snapshot.id, "aaaaaaaa-0000-4000-8000-000000000050");
  assert.equal(Object.isFrozen(snapshot), true); assert.equal(Object.hasOwn(snapshot, "is_active"), false);
  input.endpoint = "https://provider.invalid/B"; input.auth = "changed";
  assert.equal(snapshot.endpoint, "https://provider.invalid/\u00e9/\u{1f9ca}?x=1#f");
  assert.equal(snapshot.auth, "auth:\u00e9");
  const active = snapshotWebPushDescriptor({ ...goldenDescriptor, is_active: true });
  const inactive = snapshotWebPushDescriptor({ ...goldenDescriptor, is_active: false });
  assert.equal(await webPushDescriptorFingerprint(active), await webPushDescriptorFingerprint(inactive));
});
for (const [label, needle, replacement] of [
  ["UTF16 length", "`${bytes.byteLength}:`", "`${value.length}:`"],
  ["omit auth", "descriptor.p256dh, descriptor.auth]", "descriptor.p256dh]"],
  ["swap owner and id", "[descriptor.id, descriptor.user_id,", "[descriptor.user_id, descriptor.id,"],
  ["omit length delimiter", "`${bytes.byteLength}:`", "`${bytes.byteLength}`"],
  ["hash algorithm", 'digest("SHA-256", framed)', 'digest("SHA-384", framed)'],
]) {
  test(`compiled WebCrypto helper mutation rejected: ${label}`, async () => {
    assert.equal(descriptorSource.split(needle).length - 1, 1);
    await assert.rejects(fingerprintGolden(descriptorSource.replace(needle, replacement)), error => {
      assert.equal(error.code, "ERR_ASSERTION", "compile/setup failure cannot kill a mutant");
      assert.equal(error.message.split("\n")[0], "literal UTF8 framing golden"); return true;
    });
  });
}
async function boundUnicode() {
  configure("deliver", { subscription: goldenDescriptor });
  await handler(request());
  assert.equal(providerCalls.length, 1, "matching Unicode descriptor must reach provider");
  const check = requests.find(entry => entry.url.pathname.endsWith("/push_outbox_delivery_recheck_bound"));
  assert.ok(check, "bound RPC must execute");
  const args = JSON.parse(check.init.body), [sent] = providerCalls;
  assert.equal(args.p_subscription_fingerprint, "v1:31a3586636684d806e71ae039a72c602302f7be949c8a4de4b491d7e4cd16f29", "literal UTF8 framing golden");
  assert.equal(args.p_subscription_fingerprint, fingerprint({ id: goldenDescriptor.id, user_id: goldenDescriptor.user_id,
    endpoint: sent[0].endpoint, p256dh: sent[0].keys.p256dh, auth: sent[0].keys.auth }), "provider bytes must match bound fingerprint");
  assert.equal(check.init.body.includes("provider.invalid"), false); assert.equal(check.init.body.includes("auth:"), false);
}
test("actual Single Web Edge WebCrypto golden binds exact provider bytes", () => boundUnicode());

async function preparedBeforeCheck() {
  const original = crypto.subtle.digest;
  try {
    crypto.subtle.digest = async function (...args) {
      assert.equal(events.includes("recheck"), false, "all async hashing must finish before final RPC");
      events.push("digest"); return original.apply(this, args);
    };
    configure("deliver", { payload: { tag: "fixture-topic" } });
    await handler(request());
    assert.deepEqual(events, ["digest", "digest", "recheck", "provider"], "topic and descriptor digests precede final RPC");
    assert.equal(typeof providerCalls[0][1], "string");
    assert.equal(JSON.parse(providerCalls[0][1]).title, "LETSCUBE");
    assert.equal(providerCalls[0][2].topic.length, 32);
  } finally { crypto.subtle.digest = original; }
}
test("topic, payload and WebCrypto fingerprint are prepared before the final RPC", () => preparedBeforeCheck());

async function withEdgeMutation(transform, scenario) {
  const url = new URL("../../supabase/functions/send-push-notifications/index.ts", import.meta.url);
  const source = readFileSync(url, "utf8");
  let js = stripTypeScriptTypes(transform(source));
  js = js.replace('"npm:web-push@3.6.7"', '"data:text/javascript,export default globalThis.__webRecheckWebpush"');
  js = js.replace(/"(\.\/[^"\n]+\.ts)"/g, (_match, path) => JSON.stringify(new URL(path, url).href));
  const original = handler;
  try {
    await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    await scenario();
  } finally { handler = original; }
}
function replaceOnce(text, needle, replacement) {
  assert.equal(text.split(needle).length - 1, 1, "one actual mutation anchor");
  return text.replace(needle, replacement);
}
function inSingleDelivery(text, transform) {
  const start=text.indexOf('async function deliver(');
  const end=text.indexOf('\nfunction safePayload(',start);
  assert.ok(start>=0 && end>start,'actual single delivery boundaries must exist');
  assert.equal(text.indexOf('async function deliver(',start+1),-1,'single delivery is unique');
  return text.slice(0,start)+transform(text.slice(start,end))+text.slice(end);
}
for (const [label, transform, scenario, message] of [
  ["old unbound ABI", text => replaceOnce(replaceOnce(text,
    '"/rest/v1/rpc/push_outbox_delivery_recheck_bound"', '"/rest/v1/rpc/push_outbox_delivery_recheck"'),
    '      p_subscription_id: subscriptionId,\n      p_subscription_fingerprint: subscriptionFingerprint,', ""),
    descriptorChanged, "same-id same-owner descriptor replacement must refuse stale provider bytes"],
  ["different provider endpoint", text => inSingleDelivery(text, body => replaceOnce(body, "endpoint: descriptor.endpoint,", 'endpoint: "https://provider.invalid/other",')),
    boundUnicode, "provider bytes must match bound fingerprint"],
  ["omit owner projection", text => replaceOnce(text, '"id,user_id,endpoint,p256dh,auth,is_active,web_push_protocol"', '"id,endpoint,p256dh,auth,is_active,web_push_protocol"'),
    boundUnicode, "matching Unicode descriptor must reach provider"],
  ["restore stale cached inactive veto", text => replaceOnce(text, 'if (!eligibility.ok) return "failed";\n\n  const deliveryStatus = eligibility.status;',
    'if (!eligibility.ok) return "failed";\n  if (subscription?.is_active === false) return "pruned";\n\n  const deliveryStatus = eligibility.status;'),
    reactivated, "fresh server deliver must override stale cached inactive flag"],
  ["retire by id alone", text => inSingleDelivery(text, body => replaceOnce(body,
    'for (const key of ["id", "user_id", "endpoint", "p256dh", "auth"] as const)',
    'for (const key of ["id"] as const)')),
    replacementRetirement, "old provider failure must not retire the replacement subscription"],
]) {
  test(`compiled Single Web Edge mutation rejected: ${label}`, async () => {
    await assert.rejects(withEdgeMutation(text => transform(text.replaceAll("\r\n", "\n")), scenario), error => {
      assert.equal(error.code, "ERR_ASSERTION", "compile/setup failure cannot kill a mutant");
      assert.equal(error.message.split("\n")[0], message); return true;
    });
  });
}

for (const [label, needle, replacement] of [
  ["parser", 'status !== "subscription_inactive" && status !== "not_eligible" && status !== "claim_lost"', 'status !== "subscription_inactive" && status !== "claim_lost"'],
  ["terminal branch", 'deliveryStatus === "not_eligible" ||', ""],
]) {
  test(`web omission mutant ${label} is killed by the actual dispatcher`, async () => {
    const url = new URL("../../supabase/functions/send-push-notifications/index.ts", import.meta.url);
    const source = readFileSync(url, "utf8");
    assert.equal(source.split(needle).length - 1, 1);
    let js = stripTypeScriptTypes(source.replace(needle, replacement));
    js = js.replace('"npm:web-push@3.6.7"', '"data:text/javascript,export default globalThis.__webRecheckWebpush"');
    js = js.replace(/"(\.\/[^"\n]+\.ts)"/g, (_match, path) => JSON.stringify(new URL(path, url).href));
    const original = handler;
    try {
      await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
      configure("not_eligible");
      const result = await (await handler(request())).json();
      assert.throws(() => assertTerminal(result), { code: "ERR_ASSERTION" });
      if (label === "parser") {
        assert.equal(providerCalls.length, 0);
        assert.deepEqual([result.pruned, result.failed], [0, 1]);
      } else {
        assert.equal(providerCalls.length, 1);
        assert.equal(result.sent, 1);
      }
    } finally { handler = original; }
  });
}
