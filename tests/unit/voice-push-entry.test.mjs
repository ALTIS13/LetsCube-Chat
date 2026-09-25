import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

let handler;
let env = {};
let requests = [];
let vapid = 0;
let webSends = [];
let network;
globalThis.Deno = { env: { get: (key) => env[key] }, serve: (fn) => { handler = fn; } };
globalThis.__edgeWebpush = { setVapidDetails() { vapid++; }, async sendNotification(...args) { webSends.push(args); } };
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "npm:web-push@3.6.7") return {
    url: "data:text/javascript,export default globalThis.__edgeWebpush", shortCircuit: true,
  };
  return next(specifier, context);
} });
await import("../../supabase/functions/send-push-notifications/index.ts");
hook.deregister();
const nativeFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = nativeFetch; delete globalThis.Deno; delete globalThis.__edgeWebpush; });
test.beforeEach(() => {
  env = { KUB_PUSH_DISPATCH_TOKEN: "fixture-dispatch", SUPABASE_URL: "https://fixture.invalid", SUPABASE_SECRET_KEY: "fixture-backend" };
  requests = []; vapid = 0; webSends = [];
  network = async (url) => {
    if (url.pathname === "/rest/v1/rpc/push_outbox_claim" || url.pathname === "/rest/v1/rpc/native_push_outbox_claim") return Response.json([]);
    throw new Error("unexpected offline request");
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)); requests.push({ url, ...init }); return network(url, init);
  };
});
function request(body = { scope: "voice" }, headers = { "x-kub-push-token": "fixture-dispatch" }) {
  return new Request("https://fixture.invalid/functions/v1/send-push-notifications", {
    method: "POST", headers, body: JSON.stringify(body),
  });
}
function fcmCredentials() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  Object.assign(env, { FCM_PROJECT_ID: "fixture-project", FCM_CLIENT_EMAIL: "fixture@example.invalid", FCM_PRIVATE_KEY: privateKey });
}

test("actual voice HTTP route rejects missing dispatch secret even when disabled (RED entry)", async () => {
  delete env.KUB_PUSH_DISPATCH_TOKEN;
  const response = await handler(request());
  assert.equal(response.status, 401); assert.deepEqual(await response.json(), { ok: false, error: "unauthorized" });
  assert.equal(requests.length, 0); assert.equal(vapid, 0);
});

test("actual disabled voice route needs no VAPID, SQL or provider (RED entry)", async () => {
  const response = await handler(request());
  assert.equal(response.status, 200); assert.equal((await response.json()).status, "disabled");
  assert.equal(requests.length, 0); assert.equal(vapid, 0);
});

test("voice credentials fail closed; auth/gate are re-read on every HTTP request", async () => {
  env.VOICE_PUSH_DISPATCH_ENABLED = "1";
  const response = await handler(request());
  assert.equal((await response.json()).status, "credentials_pending");
  assert.equal(requests.length, 0);
  env.KUB_PUSH_DISPATCH_TOKEN = "rotated-fixture";
  assert.equal((await handler(request())).status, 401);
  env.VOICE_PUSH_DISPATCH_ENABLED = "0";
  const disabled = await handler(request({}, { authorization: "Bearer rotated-fixture" }));
  assert.equal(disabled.status, 500); // Generic still requires VAPID.
  assert.equal((await handler(request({ scope: "voice" }, { authorization: "Bearer rotated-fixture" }))).status, 200);
});

test("actual enabled voice path acquires bounded OAuth then only voice SQL, without VAPID", async () => {
  env.VOICE_PUSH_DISPATCH_ENABLED = "1"; fcmCredentials();
  network = async (url, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    if (url.href === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "synthetic-oauth" });
    assert.equal(url.pathname, "/rest/v1/rpc/voice_push_claim");
    const body = JSON.parse(init.body); assert.equal(body.p_limit, 4); assert.match(body.p_claim_id, /^[0-9a-f-]{36}$/);
    return Response.json([]);
  };
  const response = await handler(request({ scope: "voice", limit: 20 }));
  assert.equal(response.status, 200); assert.equal((await response.json()).status, "idle");
  assert.equal(requests.length, 2); assert.equal(vapid, 0);
});

test("disabled generic HTTP response and ownership remain unchanged", async () => {
  env.VAPID_PUBLIC_KEY = "fixture-public"; env.VAPID_PRIVATE_KEY = "fixture-private";
  const response = await handler(request({ limit: 5 }));
  assert.deepEqual(await response.json(), { ok: true, sent: 0, failed: 0, pruned: 0, limit: 5,
    native: { sent: 0, failed: 0, pruned: 0, pending: 0, status: "idle" } });
  assert.equal(vapid, 1); assert.equal(requests.length, 2);
  assert.ok(requests.every((r) => !r.url.pathname.includes("voice")));
});

test("enabled generic drain isolates voice OAuth failure and returns aggregate-only voice status", async () => {
  Object.assign(env, { VAPID_PUBLIC_KEY: "fixture-public", VAPID_PRIVATE_KEY: "fixture-private", VOICE_PUSH_DISPATCH_ENABLED: "1" });
  fcmCredentials();
  const generic = network;
  network = async (url, init) => url.hostname === "oauth2.googleapis.com"
    ? new Response("fixture confidential provider body", { status: 503 }) : generic(url, init);
  const response = await handler(request({ limit: 5 })); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.ok, true); assert.equal(body.native.status, "idle");
  assert.equal(body.voice.status, "provider_auth_failed");
  assert.doesNotMatch(JSON.stringify(body), /confidential|fixture-backend|fixture-dispatch/);
  assert.equal(requests.filter((r) => r.url.pathname.includes("voice_push")).length, 0);
});

test("generic web delivery and acknowledgement finish before an isolated voice failure", async () => {
  Object.assign(env, { VAPID_PUBLIC_KEY: "fixture-public", VAPID_PRIVATE_KEY: "fixture-private", VOICE_PUSH_DISPATCH_ENABLED: "1" });
  fcmCredentials(); let acknowledged = false;
  network = async (url, init) => {
    if (url.pathname === "/rest/v1/rpc/push_outbox_claim") return Response.json([{ id: "fictional-outbox",
      subscription_id: "fictional-subscription", payload: { title: "Fixture", body: "Message", sender_kind: "user",
        sender_id: "fixture-user" }, attempt_count: 0 }]);
    if (url.pathname === "/rest/v1/rpc/native_push_outbox_claim") {
      assert.equal(acknowledged, true, "native rows must be claimed after the Web Push drain");
      return Response.json([]);
    }
    if (url.pathname === "/rest/v1/push_subscriptions") return Response.json([{ id: "fictional-subscription",
      endpoint: "https://fixture.invalid/webpush", p256dh: "fictional", auth: "fictional", is_active: true }]);
    if (url.pathname === "/rest/v1/rpc/push_outbox_delivery_recheck") {
      assert.deepEqual(JSON.parse(init.body), {
        p_outbox_id: "fictional-outbox",
        p_claim_token: JSON.parse(requests[0].body).p_claim_token,
      });
      assert.equal(webSends.length, 0);
      return Response.json("deliver");
    }
    if (init.method === "PATCH") {
      assert.equal(url.pathname, "/rest/v1/notifications_push_outbox");
      assert.ok(JSON.parse(init.body).sent_at); acknowledged = true;
      return new Response(null, { status: 204 });
    }
    assert.equal(url.hostname, "oauth2.googleapis.com");
    assert.equal(acknowledged, true); assert.equal(webSends.length, 1);
    return new Response("private provider failure", { status: 503 });
  };
  const response = await handler(request({ limit: 1 })); const body = await response.json();
  assert.equal(body.sent, 1); assert.equal(body.failed, 0); assert.equal(body.voice.status, "provider_auth_failed");
  const webPayload = JSON.parse(webSends[0][1]);
  assert.equal(webPayload.senderKind, "");
  assert.equal(webPayload.title, "LETSCUBE");
  assert.equal(webPayload.body, "Новое уведомление");
  assert.doesNotMatch(webSends[0][1], /Fixture|Message|fixture-user/);
  assert.doesNotMatch(JSON.stringify(body), /private provider/);
});

for (const [status, expectedPruned, expectedFailed] of [
  ["foreground", 0, 0],
  ["read", 1, 0],
  ["rpc_error", 0, 1],
]) {
  test(`generic Web Push does not reach the provider after ${status}`, async () => {
    Object.assign(env, { VAPID_PUBLIC_KEY: "fixture-public", VAPID_PRIVATE_KEY: "fixture-private" });
    network = async (url) => {
      if (url.pathname === "/rest/v1/rpc/push_outbox_claim") return Response.json([{
        id: "fictional-outbox",
        subscription_id: "fictional-subscription",
        payload: { title: "Fixture", body: "Message" },
        attempt_count: 0,
      }]);
      if (url.pathname === "/rest/v1/rpc/native_push_outbox_claim") return Response.json([]);
      if (url.pathname === "/rest/v1/push_subscriptions") return Response.json([{
        id: "fictional-subscription",
        endpoint: "https://fixture.invalid/webpush",
        p256dh: "fictional",
        auth: "fictional",
        is_active: true,
      }]);
      if (url.pathname === "/rest/v1/rpc/push_outbox_delivery_recheck") {
        return status === "rpc_error"
          ? new Response("unavailable", { status: 503 })
          : Response.json(status);
      }
      throw new Error(`unexpected offline request to ${url.pathname}`);
    };

    const response = await handler(request({ limit: 1 }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.sent, 0);
    assert.equal(body.pruned, expectedPruned);
    assert.equal(body.failed, expectedFailed);
    assert.equal(webSends.length, 0);
  });
}

test("native cron claims an unread row and acknowledges only its own FCM lease", async () => {
  Object.assign(env, { VAPID_PUBLIC_KEY: "fixture-public", VAPID_PRIVATE_KEY: "fixture-private" });
  fcmCredentials();
  const rowId = "20000000-0000-4000-8000-000000000001";
  const deviceId = "30000000-0000-4000-8000-000000000001";
  let nativeClaimToken;
  network = async (url, init) => {
    if (url.pathname === "/rest/v1/rpc/push_outbox_claim") return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/native_push_outbox_claim") {
      const body = JSON.parse(init.body);
      nativeClaimToken = body.p_claim_token;
      assert.match(nativeClaimToken, /^[0-9a-f-]{36}$/);
      return Response.json([{ id: rowId, device_id: deviceId, payload: { title: "Fixture", body: "Message" }, attempt_count: 0 }]);
    }
    if (url.pathname === "/rest/v1/user_push_devices") return Response.json([
      { id: deviceId, token: "synthetic-registration", provider: "fcm", enabled: true, app_version: "0.1.8" },
    ]);
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "synthetic-oauth" });
    if (url.pathname === "/rest/v1/rpc/native_push_outbox_delivery_recheck") {
      assert.deepEqual(JSON.parse(init.body), { p_outbox_id: rowId, p_claim_token: nativeClaimToken });
      return Response.json("deliver");
    }
    if (url.hostname === "fcm.googleapis.com") return Response.json({ name: "fixture-message" });
    if (url.pathname === "/rest/v1/notifications_native_push_outbox") {
      assert.equal(init.method, "PATCH");
      assert.equal(url.searchParams.get("id"), `eq.${rowId}`);
      assert.equal(url.searchParams.get("claim_token"), `eq.${nativeClaimToken}`);
      assert.equal(url.searchParams.get("select"), "id");
      assert.equal(init.headers.prefer, "return=representation");
      const patch = JSON.parse(init.body);
      assert.ok(patch.sent_at);
      assert.equal(patch.claim_token, null);
      assert.equal(patch.claimed_until, null);
      return Response.json([{ id: rowId }]);
    }
    throw new Error(`unexpected offline request to ${url.hostname}`);
  };
  const response = await handler(request({ limit: 1 }));
  const body = await response.json();
  assert.equal(body.native.sent, 1);
  assert.equal(body.native.failed, 0);
  assert.ok(requests.findIndex((item) => item.url.pathname === "/rest/v1/rpc/native_push_outbox_delivery_recheck") <
    requests.findIndex((item) => item.url.hostname === "fcm.googleapis.com"));
  assert.equal(requests.filter((item) => item.url.hostname === "fcm.googleapis.com").length, 1);
});

for (const provider of ["accepted", "unregistered", "mismatched-sender"]) {
  test(`actual voice HTTP ${provider} path uses prepare/send/CAS, never a generic device PATCH`, async () => {
    env.VOICE_PUSH_DISPATCH_ENABLED = "1"; fcmCredentials();
    const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    let claimId; let completed = false;
    network = async (url, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "synthetic-oauth" });
      assert.equal(init.method, "POST");
      const body = JSON.parse(init.body);
      if (url.pathname === "/rest/v1/rpc/voice_push_claim") {
        claimId = body.p_claim_id;
        return Response.json([{ event_id: id(1), push_device_id: id(2), claim_id: claimId }]);
      }
      if (url.pathname === "/rest/v1/rpc/voice_push_prepare") {
        assert.deepEqual(body, { p_event_id: id(1), p_push_device_id: id(2), p_claim_id: claimId });
        const now = Date.now();
        return Response.json([{ event_id: id(1), push_device_id: id(2), claim_id: claimId,
          protocol_version: 1, event: "ring", chat_id: id(3), channel_id: id(4), caller_id: id(5),
          recipient_id: id(6), recipient_session_id: id(7), ring_started_at: new Date(now - 1000).toISOString(),
          expires_at: new Date(now + 44000).toISOString(), claimed_until: new Date(now + 14000).toISOString(),
          token: "synthetic-registration", token_hash: "b".repeat(64), private_extra: "not-for-payload" }]);
      }
      if (url.hostname === "fcm.googleapis.com") {
        assert.equal(url.pathname, "/v1/projects/fixture-project/messages:send");
        assert.equal(init.headers.authorization, "Bearer synthetic-oauth");
        assert.equal(body.message.token, "synthetic-registration");
        assert.equal(body.message.data.protocol_version, "1");
        assert.equal(body.message.android.priority, "HIGH");
        assert.ok(Number.parseInt(body.message.android.ttl) <= 44);
        assert.equal("notification" in body.message, false);
        assert.doesNotMatch(JSON.stringify(body), /private_extra|not-for-payload|token_hash/);
        return provider === "accepted" ? Response.json({ name: "private-provider-reference" })
          : Response.json({ error: { details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
            errorCode: provider === "unregistered" ? "UNREGISTERED" : "SENDER_ID_MISMATCH" }] } },
          { status: provider === "unregistered" ? 404 : 403 });
      }
      assert.equal(url.pathname, "/rest/v1/rpc/voice_push_complete");
      assert.deepEqual(body, { p_event_id: id(1), p_push_device_id: id(2), p_claim_id: claimId,
        p_result: provider === "accepted" ? "accepted" : provider === "unregistered" ? "invalid_token" : "retry",
        p_retry_after_ms: null, p_token_hash: "b".repeat(64) });
      completed = true;
      return Response.json(provider !== "unregistered"); // Simulate rebind winning its SQL CAS.
    };
    const response = await handler(request({ scope: "voice", limit: 1 })); const body = await response.json();
    assert.equal(response.status, 200); assert.equal(completed, true); assert.equal(vapid, 0);
    assert.equal(requests.length, 5);
    assert.equal(body.claimed, 1); assert.equal(body.accepted, provider === "accepted" ? 1 : 0);
    assert.equal(body.stale, provider === "unregistered" ? 1 : 0); assert.equal(body.invalid_token, 0);
    assert.equal(body.retry, provider === "mismatched-sender" ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(body), /synthetic|private|registration|20000000/);
  });
}

test("enabled generic cron cannot bypass missing voice authorization", async () => {
  delete env.KUB_PUSH_DISPATCH_TOKEN;
  Object.assign(env, { VAPID_PUBLIC_KEY: "fixture-public", VAPID_PRIVATE_KEY: "fixture-private", VOICE_PUSH_DISPATCH_ENABLED: "1" });
  const response = await handler(request({ limit: 5 }, {})); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.voice.status, "unauthorized");
  assert.equal(requests.length, 2); assert.ok(requests.every((r) => !r.url.pathname.includes("voice")));
});

test("mutation: removing actual voice-route authentication breaks missing-secret HTTP rejection", async () => {
  const url = new URL("../../supabase/functions/send-push-notifications/index.ts", import.meta.url);
  const source = readFileSync(url, "utf8");
  const needle = 'if (!isVoiceRequestAuthorized(request, dispatchToken)) return json({ ok: false, error: "unauthorized" }, 401);';
  assert.equal(source.split(needle).length - 1, 1);
  let js = stripTypeScriptTypes(source.replace(needle, ""));
  js = js.replace('"npm:web-push@3.6.7"', '"data:text/javascript,export default globalThis.__edgeWebpush"');
  js = js.replace(/"(\.\/[^"\n]+\.ts)"/g, (_match, path) => JSON.stringify(new URL(path, url).href));
  const original = handler;
  try {
    await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    delete env.KUB_PUSH_DISPATCH_TOKEN;
    const response = await handler(request());
    assert.throws(() => assert.equal(response.status, 401), { code: "ERR_ASSERTION" });
  } finally { handler = original; }
});
