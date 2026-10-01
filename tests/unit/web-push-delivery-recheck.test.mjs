import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

let handler;
let requests = [];
let providerCalls = [];
let claimToken;
let recheckStatus = "deliver";
const rowId = "20000000-0000-4000-8000-000000000001";
const subscriptionId = "30000000-0000-4000-8000-000000000001";
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
  async sendNotification(...args) { providerCalls.push(args); },
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

function configure(status) {
  requests = [];
  providerCalls = [];
  claimToken = undefined;
  recheckStatus = status;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname === "/rest/v1/rpc/push_outbox_claim") {
      claimToken = JSON.parse(init.body).p_claim_token;
      return Response.json([{ id: rowId, subscription_id: subscriptionId, payload: { kind: "message", title: "Fixture", body: "Photo" }, attempt_count: 0 }]);
    }
    if (url.pathname === "/rest/v1/push_subscriptions") {
      return Response.json([{ id: subscriptionId, endpoint: "https://provider.invalid/push", p256dh: "fixture", auth: "fixture", is_active: true }]);
    }
    if (url.pathname === "/rest/v1/rpc/push_outbox_delivery_recheck") {
      assert.deepEqual(JSON.parse(init.body), { p_outbox_id: rowId, p_claim_token: claimToken });
      assert.equal(providerCalls.length, 0, "the recheck must precede the provider send");
      if (recheckStatus === "network_error") throw new Error("synthetic RPC network failure");
      return recheckStatus === "rpc_error" ? new Response("unavailable", { status: 503 }) : Response.json(recheckStatus);
    }
    if (url.pathname === "/rest/v1/rpc/native_push_outbox_claim") return Response.json([]);
    if (url.pathname === "/rest/v1/notifications_push_outbox") {
      assert.equal(init.method, "PATCH");
      assert.equal(url.searchParams.get("claim_token"), `eq.${claimToken}`);
      return Response.json([{ id: rowId }]);
    }
    throw new Error(`unexpected offline request to ${url.hostname}${url.pathname}`);
  };
}

function assertTerminal(result) {
  assert.deepEqual([result.sent, result.pruned, result.failed], [0, 1, 0]);
  assert.equal(result.native.pending, 0);
  assert.equal(providerCalls.length, 0);
  assert.equal(requests.filter((entry) => entry.url.pathname === "/rest/v1/notifications_push_outbox").length, 0);
}

for (const status of ["read", "subscription_inactive", "claim_lost", "not_eligible", "foreground", "rpc_error", "network_error", "unexpected"]) {
  test(`web actual dispatcher handles predelivery ${status} without a provider send`, async () => {
    configure(status);
    if (status === "network_error") {
      await assert.rejects(handler(request()), /synthetic RPC network failure/);
      assert.equal(providerCalls.length, 0);
      return;
    }
    const response = await handler(request());
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.sent, 0);
    assert.equal(providerCalls.length, 0);
    assert.equal(result.native.pending, 0);
    assert.equal(requests.filter((entry) => entry.url.pathname === "/rest/v1/rpc/push_outbox_delivery_recheck").length, 1);
    if (["read", "subscription_inactive", "claim_lost", "not_eligible"].includes(status)) assertTerminal(result);
    else assert.deepEqual([result.pruned, result.failed], status === "foreground" ? [0, 0] : [0, 1]);
  });
}

test("web positive control sends and acknowledges only after actual recheck", async () => {
  configure("deliver");
  const result = await (await handler(request())).json();
  assert.deepEqual([result.sent, result.pruned, result.failed], [1, 0, 0]);
  assert.equal(providerCalls.length, 1);
  assert.equal(requests.filter((entry) => entry.url.pathname === "/rest/v1/notifications_push_outbox").length, 1);
});

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
