import assert from "node:assert/strict";
import test from "node:test";

import { subscribeDuringUserGesture } from "../../artifacts/kub/src/lib/browserPushSubscription.ts";

test("push subscription starts synchronously with the button gesture", async () => {
  const calls: string[] = [];
  const expected = { endpoint: "https://example.invalid/push" };
  const registration = {
    pushManager: {
      subscribe: () => {
        calls.push("subscribe");
        return Promise.resolve(expected);
      },
    },
  };
  const operation = subscribeDuringUserGesture(registration as never, new Uint8Array([1, 2, 3]));
  calls.push("after-click-handler");
  assert.deepEqual(calls, ["subscribe", "after-click-handler"]);
  assert.equal(await operation, expected);
});
