import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";

let handler;
let env = {};
let requests = [];
let webCalls = [];
let fcmCalls = [];
let provider = "web";
let claimToken;
const rowId = "20000000-0000-4000-8000-000000000001";
const subscriptionId = "30000000-0000-4000-8000-000000000001";
const deviceId = "30000000-0000-4000-8000-000000000002";
const chatId = "40000000-0000-4000-8000-000000000001";
const messageId = "50000000-0000-4000-8000-000000000001";
const notificationId = "60000000-0000-4000-8000-000000000001";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

globalThis.Deno = { env: { get: (key) => env[key] }, serve: (callback) => { handler = callback; } };
globalThis.__albumWebpush = {
  setVapidDetails() {},
  async sendNotification(_subscription, payload) {
    webCalls.push(JSON.parse(payload));
  },
};
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "npm:web-push@3.6.7") {
      return { url: "data:text/javascript,export default globalThis.__albumWebpush", shortCircuit: true };
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
  delete globalThis.__albumWebpush;
});

function configure(nextProvider) {
  provider = nextProvider;
  requests = [];
  webCalls = [];
  fcmCalls = [];
  env = {
    KUB_PUSH_DISPATCH_TOKEN: "fixture-dispatch",
    SUPABASE_URL: "https://fixture.invalid",
    SUPABASE_SECRET_KEY: "fixture-backend",
    VAPID_PUBLIC_KEY: "fixture-public",
    VAPID_PRIVATE_KEY: "fixture-private",
    ALBUM_PUSH_DISPATCH_ENABLED: "1",
    FCM_PROJECT_ID: "fixture-project",
    FCM_CLIENT_EMAIL: "fixture@example.invalid",
    FCM_PRIVATE_KEY: privateKey,
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname, init });
    if (url.pathname === "/rest/v1/rpc/push_outbox_claim") return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/native_push_outbox_claim") return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/album_push_claim") {
      claimToken = JSON.parse(init.body).p_claim_token;
      return Response.json([{
        id: rowId, subscription_id: provider === "web" ? subscriptionId : null,
        device_id: provider === "fcm" ? deviceId : null, attempt_count: 0,
      }]);
    }
    if (url.pathname === "/rest/v1/push_subscriptions") {
      return Response.json([{ id: subscriptionId, endpoint: "https://push.invalid/test", p256dh: "fixture-key", auth: "fixture-auth", is_active: true }]);
    }
    if (url.pathname === "/rest/v1/user_push_devices") {
      return Response.json([{ id: deviceId, token: "fixture-registration", provider: "fcm", enabled: true, revoked_at: null, app_version: "0.1.8" }]);
    }
    if (url.pathname === "/rest/v1/rpc/album_push_recheck") {
      assert.deepEqual(JSON.parse(init.body), { p_outbox_id: rowId, p_claim_token: claimToken });
      assert.equal(webCalls.length + fcmCalls.length, 0);
      return Response.json([{ status: "deliver", payload: {
        kind: "message", title: "LETSCUBE", body: "Новое сообщение",
        chatId, messageId, notificationId,
        url: `/?chat=${chatId}&message=${messageId}`, tag: `message:chat:${chatId}`,
      } }]);
    }
    if (url.pathname === "/rest/v1/rpc/album_push_ack") {
      assert.deepEqual(JSON.parse(init.body), {
        p_outbox_id: rowId, p_claim_token: claimToken,
        p_outcome: "sent", p_error: null,
      });
      assert.equal(webCalls.length + fcmCalls.length, 1);
      return Response.json(true);
    }
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "fixture-oauth" });
    if (url.hostname === "fcm.googleapis.com") {
      fcmCalls.push(JSON.parse(init.body));
      return Response.json({ name: "fixture-accepted" });
    }
    throw new Error(`unexpected fixture request to ${url.pathname}`);
  };
}

for (const channel of ["web", "fcm"]) {
  test(`album Edge sends one neutral ${channel} card after recheck`, async () => {
    configure(channel);
    const response = await handler(new Request("https://fixture.invalid/functions/v1/send-push-notifications", {
      method: "POST", headers: { "x-kub-push-token": "fixture-dispatch" }, body: "{}",
    }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.album.sent, 1);
    assert.equal(webCalls.length + fcmCalls.length, 1);
    const push = channel === "web" ? webCalls[0] : fcmCalls[0];
    assert.equal(JSON.stringify(push).includes(messageId), true);
    assert.equal(JSON.stringify(push).includes("Fixture private content"), false);
    assert.ok(requests.findIndex((entry) => entry.path === "/rest/v1/rpc/album_push_recheck") <
      requests.findIndex((entry) => entry.path === "/rest/v1/rpc/album_push_ack"));
  });
}
