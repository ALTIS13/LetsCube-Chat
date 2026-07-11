import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationServerKeyMatches,
  browserSubscriptionRecord,
} from "../../artifacts/kub/src/lib/browserPushSubscription.ts";

const VAPID_PUBLIC = Buffer.from([
  4,
  ...Array.from({ length: 64 }, (_, index) => index + 1),
]).toString("base64url");

function subscriptionWithKey(applicationServerKey) {
  return {
    endpoint: "https://push.example.test/subscription",
    options: { applicationServerKey },
    toJSON() {
      return {
        endpoint: this.endpoint,
        keys: { p256dh: "p256dh", auth: "auth" },
      };
    },
  };
}

test("browser subscription reconciliation detects a matching VAPID key", () => {
  const bytes = Buffer.from(VAPID_PUBLIC, "base64url");
  const subscription = subscriptionWithKey(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );

  assert.equal(applicationServerKeyMatches(subscription, VAPID_PUBLIC), true);
});

test("browser subscription reconciliation rejects a stale VAPID key", () => {
  const subscription = subscriptionWithKey(Uint8Array.from([1, 2, 3]).buffer);

  assert.equal(applicationServerKeyMatches(subscription, VAPID_PUBLIC), false);
  assert.equal(
    applicationServerKeyMatches(subscriptionWithKey(null), VAPID_PUBLIC),
    null,
  );
});

test("browser subscription record refreshes server activity without exposing extra data", () => {
  const subscription = subscriptionWithKey(null);
  const record = browserSubscriptionRecord(
    subscription,
    "user-1",
    "iPhone",
    "iPhone",
  );

  assert.deepEqual(Object.keys(record).sort(), [
    "auth",
    "endpoint",
    "is_active",
    "last_seen_at",
    "p256dh",
    "platform",
    "updated_at",
    "user_agent",
    "user_id",
  ]);
  assert.equal(record.user_id, "user-1");
  assert.equal(record.is_active, true);
  assert.equal(record.endpoint, subscription.endpoint);
});
