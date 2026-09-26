import assert from "node:assert/strict";
import test from "node:test";
import { drainAlbumPush } from "../../supabase/functions/send-push-notifications/album-dispatch.ts";

const token = "10000000-0000-4000-8000-000000000001";
const row = {
  id: "20000000-0000-4000-8000-000000000001",
  subscription_id: "30000000-0000-4000-8000-000000000001",
  device_id: null,
  attempt_count: 0,
};
const payload = {
  kind: "message",
  chatId: "40000000-0000-4000-8000-000000000001",
  messageId: "50000000-0000-4000-8000-000000000001",
  notificationId: "60000000-0000-4000-8000-000000000001",
  url: "/?chat=40000000-0000-4000-8000-000000000001&message=50000000-0000-4000-8000-000000000001",
  title: "LETSCUBE",
  body: "Новое сообщение",
};

function fixture(overrides = {}) {
  const calls = [];
  const deps = {
    uuid: () => token,
    claim: async (limit, claimToken) => {
      calls.push(["claim", limit, claimToken]);
      return [row];
    },
    recheck: async (id, claimToken) => {
      calls.push(["recheck", id, claimToken]);
      return { status: "deliver", payload };
    },
    send: async (claim, freshPayload) => {
      calls.push(["send", claim.id, freshPayload]);
      return { outcome: "sent" };
    },
    ack: async (id, claimToken, outcome, error) => {
      calls.push(["ack", id, claimToken, outcome, error]);
      return true;
    },
    ...overrides,
  };
  return { deps, calls };
}

test("album dispatch uses a freshly rechecked exact-message route and token-bound ack", async () => {
  const { deps, calls } = fixture();
  const result = await drainAlbumPush(deps, 50);
  assert.equal(result.sent, 1);
  assert.equal(result.claimed, 1);
  assert.deepEqual(calls, [
    ["claim", 10, token],
    ["recheck", row.id, token],
    ["send", row.id, payload],
    ["ack", row.id, token, "sent", null],
  ]);
});

test("an unknown recheck status never reaches the provider", async () => {
  const { deps, calls } = fixture({
    recheck: async () => ({ status: "unexpected", payload }),
  });
  const result = await drainAlbumPush(deps, 1);
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  assert.equal(calls.some(([name]) => name === "send"), false);
  assert.deepEqual(calls.at(-1), ["ack", row.id, token, "release", "invalid_recheck"]);
});

test("read or rebound targets never send or acknowledge twice", async () => {
  for (const status of ["read", "target_inactive", "foreground", "not_eligible", "claim_lost"]) {
    const { deps, calls } = fixture({ recheck: async () => ({ status, payload: null }) });
    const result = await drainAlbumPush(deps, 1);
    assert.equal(result.sent, 0, status);
    assert.equal(calls.some(([name]) => name === "send"), false, status);
    assert.equal(calls.some(([name]) => name === "ack"), false, status);
  }
});

test("provider acceptance without an ack is uncertain, not a confirmed send", async () => {
  const { deps } = fixture({ ack: async () => false });
  const result = await drainAlbumPush(deps, 1);
  assert.equal(result.sent, 0);
  assert.equal(result.uncertain, 1);
});

test("a provider exception releases the row through bounded retry", async () => {
  const { deps, calls } = fixture({ send: async () => { throw new Error("synthetic provider outage"); } });
  const result = await drainAlbumPush(deps, 1);
  assert.equal(result.retry, 1);
  assert.deepEqual(calls.at(-1), ["ack", row.id, token, "retry", "provider_error"]);
});
