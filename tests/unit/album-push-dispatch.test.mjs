import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
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
    prepare: async (claim, preflightPayload) => {
      calls.push(["prepare", claim.id, preflightPayload]);
      return { binding: { targetId: claim.subscription_id ?? claim.device_id, fingerprint: "v1:" + "a".repeat(64) },
        send: freshPayload => deps.send(claim, freshPayload) };
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
    ["prepare", row.id, payload],
    ["recheck", row.id, token],
    ["send", row.id, payload],
    ["ack", row.id, token, "sent", null],
  ]);
});

test("album prepared binding is required and the final port gets the exact target/hash", async () => {
  const { deps } = fixture(); let reads = 0;
  deps.recheck = async (_id, _token, binding) => {
    if (++reads === 1) assert.equal(binding, undefined);
    else assert.deepEqual(binding, { targetId: row.subscription_id, fingerprint: "v1:" + "a".repeat(64) });
    return { status: "deliver", payload };
  };
  assert.equal((await drainAlbumPush(deps, 1)).sent, 1); assert.equal(reads, 2);
});
for (const binding of [undefined, null, { targetId: row.subscription_id, fingerprint: "bad" },
  { targetId: "30000000-0000-4000-8000-000000000099", fingerprint: "v1:" + "a".repeat(64) }]) {
  test(`invalid prepared binding ${JSON.stringify(binding)} never invokes provider`, async () => {
    const { deps, calls } = fixture({ prepare: async () => ({ binding, send: async () => { assert.fail("provider must not run"); } }) });
    const result = await drainAlbumPush(deps, 1); assert.equal(result.sent, 0);
    assert.deepEqual(calls.at(-1), ["ack", row.id, token, "release", "invalid_binding"]);
  });
}
test("final target_changed is a released lease, not suppression or a second ACK", async () => {
  const { deps, calls } = fixture(); let reads = 0;
  deps.recheck = async () => ++reads === 1 ? { status: "deliver", payload } : { status: "target_changed", payload: null };
  const result = await drainAlbumPush(deps, 1);
  assert.deepEqual([result.sent, result.pruned, result.deferred], [0, 0, 1]);
  assert.equal(calls.some(([name]) => name === "send" || name === "ack"), false);
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

for (const status of ["read", "target_inactive", "foreground", "not_eligible", "claim_lost"]) {
  test(`final ${status} after preparation never sends or overwrites RPC settlement`, async () => {
    const { deps, calls } = fixture(); let reads = 0;
    deps.recheck = async () => ++reads === 1 ? { status: "deliver", payload } : { status, payload: null };
    const result = await drainAlbumPush(deps, 1);
    assert.equal(reads, 2); assert.equal(result.sent, 0);
    assert.equal(calls.some(([name]) => name === "send" || name === "ack"), false);
    assert.equal(result.deferred, status === "foreground" ? 1 : 0);
  });
}
for (const value of [null, [], { status: "unexpected" }, { status: "deliver", payload: null }, "throw"]) {
  test(`invalid final recheck ${JSON.stringify(value)} fails closed with exact release`, async () => {
    const { deps, calls } = fixture(); let reads = 0;
    deps.recheck = async () => {
      if (++reads === 1) return { status: "deliver", payload };
      if (value === "throw") throw Error("Fixture private content");
      return value;
    };
    const result = await drainAlbumPush(deps, 1);
    assert.equal(result.failed, 1); assert.equal(calls.some(([name]) => name === "send"), false);
    assert.deepEqual(calls.at(-1), ["ack", row.id, token, "release", "invalid_recheck"]);
  });
}
for (const patch of [{ body: "Fixture private content" }, { messageId: "bad" }, { notificationId: null },
  { url: "/other" }, { tag: "other" }, { chatId: "40000000-0000-4000-8000-000000000099",
    url: "/?chat=40000000-0000-4000-8000-000000000099&message=50000000-0000-4000-8000-000000000001" }]) {
  test(`invalid final payload ${JSON.stringify(patch)} cannot reach provider`, async () => {
    const { deps, calls } = fixture(); let reads = 0;
    deps.recheck = async () => ({ status: "deliver", payload: ++reads === 1 ? payload : { ...payload, ...patch } });
    const result = await drainAlbumPush(deps, 1);
    assert.equal(result.failed, 1); assert.equal(calls.some(([name]) => name === "send"), false);
    assert.deepEqual(calls.at(-1), ["ack", row.id, token, "release", "invalid_payload"]);
  });
}
test("prepare exception is a sanitized bounded retry without a provider attempt", async () => {
  const { deps, calls } = fixture({ prepare: async () => { throw Error("Fixture private content"); } });
  const result = await drainAlbumPush(deps, 1);
  assert.equal(result.retry, 1); assert.equal(calls.some(([name]) => name === "send"), false);
  assert.deepEqual(calls.at(-1), ["ack", row.id, token, "retry", "prepare_error"]);
});
test("failed final release ACK is uncertain, not a provider retry", async () => {
  const { deps, calls } = fixture({ ack: async () => false }); let reads = 0;
  deps.recheck = async () => ++reads === 1 ? { status: "deliver", payload } : null;
  const result = await drainAlbumPush(deps, 1);
  assert.equal(result.uncertain, 1); assert.equal(result.retry, 0);
  assert.equal(calls.some(([name]) => name === "send"), false);
});

async function unpreparedSent(drain = drainAlbumPush) {
  const { deps, calls } = fixture({ prepare: async () => ({ outcome: "sent" }) });
  const result = await drain(deps, 1);
  assert.equal(result.sent, 0, "unprepared sent must never acknowledge provider acceptance");
  assert.equal(calls.some(([name]) => name === "send"), false);
  assert.equal(calls.filter(([name]) => name === "recheck").length, 1);
  assert.deepEqual(calls.at(-1), ["ack", row.id, token, "release", "invalid_prepare_outcome"]);
}
test("unprepared sent releases as invalid_prepare_outcome without claiming provider acceptance", () => unpreparedSent());

for (const outcome of ["retry", "release"]) {
  test(`prepare failure ${outcome} retains its exact bounded ACK`, async () => {
    const { deps, calls } = fixture({ prepare: async () => ({ outcome, error: "prepare_failed" }) });
    const result = await drainAlbumPush(deps, 1);
    assert.equal(result.sent, 0); assert.equal(calls.some(([name]) => name === "send"), false);
    assert.deepEqual(calls.at(-1), ["ack", row.id, token, outcome, "prepare_failed"]);
  });
}

test("compiled omission of prepare failure guard restores false sent ACK and is rejected", async () => {
  const source = readFileSync(new URL("../../supabase/functions/send-push-notifications/album-dispatch.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const needle = 'outcome = { outcome: "release", error: "invalid_prepare_outcome" };';
  assert.equal(source.split(needle).length - 1, 1);
  const js = stripTypeScriptTypes(source.replace(needle, "outcome = prepared as AlbumSendResult;"));
  const { drainAlbumPush: mutated } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  await assert.rejects(unpreparedSent(mutated), error => {
    assert.equal(error.code, "ERR_ASSERTION", "compile/setup failure cannot kill a mutant");
    assert.equal(error.message.split("\n")[0], "unprepared sent must never acknowledge provider acceptance");
    return true;
  });
});
