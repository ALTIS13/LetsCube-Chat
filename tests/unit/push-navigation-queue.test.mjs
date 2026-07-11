import assert from "node:assert/strict";
import test from "node:test";

import { createDeferredPushTargetHandler } from "../../artifacts/kub/src/lib/pushNavigationQueue.ts";

test("native push target waits for authenticated app state before opening", () => {
  let ready = false;
  const opened = [];
  const handler = createDeferredPushTargetHandler(
    (target) => opened.push(target),
    () => ready,
  );

  handler.handle("/?chat=chat-1&message=message-1");
  assert.deepEqual(opened, []);
  assert.equal(handler.hasPending(), true);

  ready = true;
  assert.equal(handler.flush(), true);
  assert.deepEqual(opened, ["/?chat=chat-1&message=message-1"]);
  assert.equal(handler.hasPending(), false);
});
