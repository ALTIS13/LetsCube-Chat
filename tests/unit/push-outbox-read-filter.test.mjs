import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../supabase/functions/send-push-notifications/index.ts", import.meta.url),
  "utf8",
);

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

test("Web Push rechecks read and foreground state immediately before provider delivery", () => {
  assert.match(source, /\/rest\/v1\/rpc\/push_outbox_delivery_recheck/);
  assert.match(source, /p_outbox_id/);
  assert.match(source, /deliveryStatus\s*===\s*"foreground"/);
  assert.match(source, /deliveryStatus\s*===\s*"read"/);
  assert.ok(
    source.indexOf("push_outbox_delivery_recheck") < source.indexOf("webpush.sendNotification"),
    "eligibility must be rechecked before the provider receives the payload",
  );
});
