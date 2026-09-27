import assert from "node:assert/strict";
import test from "node:test";

import { runCommittedStagedSendAttempt } from "../../artifacts/kub/src/lib/committedSend.ts";

// D-314. A pressed send outlives the chat it was pressed in, and nothing else:
// if the account changed under it, the row must not go out as the new one.

test("a committed send goes when the same account is still signed in", async () => {
  let calls = 0;
  const result = await runCommittedStagedSendAttempt(() => true, async () => {
    calls += 1;
    return { id: "row" };
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: "sent", value: { id: "row" } });
});

test("an account change stops the send before anything is written", async () => {
  let calls = 0;
  const result = await runCommittedStagedSendAttempt(() => false, async () => {
    calls += 1;
    return { id: "row" };
  });
  assert.equal(calls, 0, "a row went out as somebody who did not press the button");
  assert.deepEqual(result, { status: "stale" });
});

test("a refused or thrown send is a failure the reader can retry, not a silence", async () => {
  assert.deepEqual(await runCommittedStagedSendAttempt(() => true, async () => null), { status: "failed" });
  assert.deepEqual(await runCommittedStagedSendAttempt(() => true, async () => false), { status: "failed" });
  assert.deepEqual(
    await runCommittedStagedSendAttempt(() => true, async () => {
      throw new Error("network");
    }),
    { status: "failed" },
  );
});
