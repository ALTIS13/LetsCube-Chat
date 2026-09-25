import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";

let handler;
let env = {};
let requests = [];
let providerCalls = [];
let recheckStatus = "deliver";
let claimToken;
const rowId = "20000000-0000-4000-8000-000000000001";
const deviceId = "30000000-0000-4000-8000-000000000001";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

globalThis.Deno = { env: { get: (key) => env[key] }, serve: (callback) => { handler = callback; } };
globalThis.__nativeRecheckWebpush = { setVapidDetails() {}, async sendNotification() { throw new Error("unexpected web push"); } };
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "npm:web-push@3.6.7") {
      return { url: "data:text/javascript,export default globalThis.__nativeRecheckWebpush", shortCircuit: true };
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
  delete globalThis.__nativeRecheckWebpush;
});

function request() {
  return new Request("https://fixture.invalid/functions/v1/send-push-notifications", {
    method: "POST",
    headers: { "x-kub-push-token": "fixture-dispatch" },
    body: JSON.stringify({ limit: 1 }),
  });
}

function configure(provider) {
  env = {
    KUB_PUSH_DISPATCH_TOKEN: "fixture-dispatch",
    SUPABASE_URL: "https://fixture.invalid",
    SUPABASE_SECRET_KEY: "fixture-backend",
    VAPID_PUBLIC_KEY: "fixture-public",
    VAPID_PRIVATE_KEY: "fixture-private",
  };
  if (provider === "fcm") {
    Object.assign(env, {
      FCM_PROJECT_ID: "fixture-project",
      FCM_CLIENT_EMAIL: "fixture@example.invalid",
      FCM_PRIVATE_KEY: privateKey,
    });
  } else {
    Object.assign(env, {
      WNS_TENANT_ID: "fixture-tenant",
      WNS_CLIENT_ID: "fixture-client",
      WNS_CLIENT_SECRET: "fixture-secret",
    });
  }
  requests = [];
  providerCalls = [];
  recheckStatus = "deliver";
  claimToken = undefined;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname === "/rest/v1/rpc/push_outbox_claim") return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/native_push_outbox_claim") {
      claimToken = JSON.parse(init.body).p_claim_token;
      return Response.json([{ id: rowId, device_id: deviceId, payload: { kind: "message", title: "Fixture", body: "Photo" }, attempt_count: 0 }]);
    }
    if (url.pathname === "/rest/v1/user_push_devices") {
      return Response.json([{
        id: deviceId,
        token: provider === "fcm" ? "synthetic-registration" : "https://db5.notify.windows.com/?fixture=1",
        provider,
        enabled: true,
        revoked_at: null,
        app_version: "0.1.8",
      }]);
    }
    if (url.hostname === "oauth2.googleapis.com" || url.hostname === "login.microsoftonline.com") {
      return Response.json({ access_token: "synthetic-oauth" });
    }
    if (url.pathname === "/rest/v1/rpc/native_push_outbox_delivery_recheck") {
      assert.deepEqual(JSON.parse(init.body), { p_outbox_id: rowId, p_claim_token: claimToken });
      assert.equal(providerCalls.length, 0, "the RPC must precede the provider call");
      if (recheckStatus === "network_error") throw new Error("synthetic RPC network failure");
      return recheckStatus === "rpc_error"
        ? new Response("unavailable", { status: 503 })
        : Response.json(recheckStatus);
    }
    if (url.hostname === "fcm.googleapis.com" || url.hostname.endsWith(".notify.windows.com")) {
      providerCalls.push(url);
      return Response.json({ name: "synthetic-accepted" });
    }
    if (url.pathname === "/rest/v1/notifications_native_push_outbox") {
      assert.equal(init.method, "PATCH");
      assert.equal(url.searchParams.get("claim_token"), `eq.${claimToken}`);
      return Response.json([{ id: rowId }]);
    }
    throw new Error(`unexpected offline request to ${url.hostname}${url.pathname}`);
  };
}

for (const provider of ["fcm", "wns"]) {
  for (const status of ["read", "device_inactive", "claim_lost", "rpc_error", "network_error", "unexpected"]) {
    test(`${provider} never reaches the provider after native recheck ${status}`, async () => {
      configure(provider);
      recheckStatus = status;
      const response = await handler(request());
      const result = await response.json();
      assert.equal(response.status, 200);
      assert.equal(result.native.sent, 0);
      assert.equal(result.native.pruned, status === "read" || status === "device_inactive" || status === "claim_lost" ? 1 : 0);
      assert.equal(result.native.failed, status === "rpc_error" || status === "network_error" || status === "unexpected" ? 1 : 0);
      assert.equal(providerCalls.length, 0);
      assert.equal(requests.filter((entry) => entry.url.pathname === "/rest/v1/rpc/native_push_outbox_delivery_recheck").length, 1);
      assert.equal(requests.filter((entry) => entry.url.pathname === "/rest/v1/notifications_native_push_outbox").length, 0);
    });
  }

  test(`${provider} sends and acknowledges only after native recheck permits delivery`, async () => {
    configure(provider);
    const response = await handler(request());
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.native.sent, 1);
    assert.equal(providerCalls.length, 1);
    const recheck = requests.findIndex((entry) => entry.url.pathname === "/rest/v1/rpc/native_push_outbox_delivery_recheck");
    const providerRequest = requests.findIndex((entry) => providerCalls.includes(entry.url));
    assert.ok(recheck >= 0 && recheck < providerRequest);
    assert.equal(requests.filter((entry) => entry.url.pathname === "/rest/v1/notifications_native_push_outbox").length, 1);
  });
}
