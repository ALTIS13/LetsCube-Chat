import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../../supabase/functions/send-push-notifications/index.ts", import.meta.url),
  "utf8",
);

function directWebPushDeliver(dependencies) {
  const parsed = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
  const functionNode = parsed.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "deliver",
  );
  assert.ok(functionNode, "direct Web Push delivery function must exist");
  const compiled = ts.transpileModule(functionNode.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn deliver;`)(
    ...Object.values(dependencies),
  );
}

test("Web and native push use atomic unread claims with token-bound acknowledgements", () => {
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /\/rest\/v1\/rpc\/push_outbox_claim/);
  assert.match(source, /\/rest\/v1\/rpc\/native_push_outbox_claim/);
  assert.match(source, /p_claim_token/);
  assert.match(source, /claim_token/);
  assert.match(source, /claimed_until/);
  assert.match(source, /markNativeOutbox\(supabaseUrl, secretKey, claimToken,/);
  assert.doesNotMatch(source, /notifications!inner\(read_at\)/);
});

test("Web Push uses eligibility after topic preparation", async () => {
  assert.match(source, /\/rest\/v1\/rpc\/push_outbox_delivery_recheck/);
  assert.match(source, /p_outbox_id/);

  for (const [lateStatus, expected, expectedCalls] of [
    ["read", "pruned", 0],
    ["foreground", "deferred", 0],
    ["deliver", "sent", 1],
  ]) {
    let status = "deliver";
    let providerCalls = 0;
    const dependencies = {
      recheckWebPushDelivery: async () => ({ ok: true, status }),
      createWebPushTopic: async () => {
        await Promise.resolve();
        status = lateStatus;
        return "topic";
      },
      safePayload: (payload) => payload,
      webpush: { sendNotification: async () => { providerCalls += 1; } },
      buildDeclarativeWebPushPayload: () => ({}),
      getWebPushUrgency: () => "normal",
      markOutbox: async () => undefined,
    };
    const deliver = directWebPushDeliver(dependencies);

    const outcome = await deliver(
      "https://example.invalid", "synthetic", "claim", { id: "outbox", payload: { tag: "message", kind: "message" } },
      { id: "subscription", endpoint: "https://example.invalid/push", p256dh: "synthetic", auth: "synthetic" },
      undefined,
    );
    assert.equal(outcome, expected, `${lateStatus} delivery outcome`);
    assert.equal(providerCalls, expectedCalls, `${lateStatus} provider delivery count`);
  }
});

test("Web Push releases the claim for retry when topic preparation fails", async () => {
  let providerCalls = 0;
  let retryPatch;
  const deliver = directWebPushDeliver({
    createWebPushTopic: async () => { throw new Error("digest_failed"); },
    safePayload: (payload) => payload,
    recheckWebPushDelivery: async () => ({ ok: true, status: "deliver" }),
    webpush: { sendNotification: async () => { providerCalls += 1; } },
    buildDeclarativeWebPushPayload: () => ({}),
    getWebPushUrgency: () => "normal",
    readWebPushErrorReason: () => null,
    isPermanentWebPushSubscriptionError: () => false,
    markOutbox: async (_url, _key, _claim, _id, patch) => { retryPatch = patch; },
  });

  const outcome = await deliver(
    "https://example.invalid", "synthetic", "claim", { id: "outbox", attempt_count: 1, payload: { tag: "message" } },
    { id: "subscription", endpoint: "https://example.invalid/push", p256dh: "synthetic", auth: "synthetic" },
    undefined,
  );
  assert.equal(outcome, "failed");
  assert.equal(providerCalls, 0);
  assert.equal(retryPatch?.attempt_count, 2);
  assert.equal(retryPatch?.claim_token, null);
  assert.equal(retryPatch?.claimed_until, null);
});
