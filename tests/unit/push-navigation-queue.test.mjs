import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createDeferredPushTargetHandler } from "../../artifacts/kub/src/lib/pushNavigationQueue.ts";

test("a push target waits for authenticated app state before opening", () => {
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

test("the browser service-worker click uses the authenticated target queue", async () => {
  const source = await readFile(
    new URL("../../artifacts/kub/src/hooks/usePush.ts", import.meta.url),
    "utf8",
  );
  const browserListener = source.match(
    /const onMsg = \(e: MessageEvent\) => \{([\s\S]*?)navigator\.serviceWorker\.addEventListener\("message", onMsg\);/,
  )?.[1];

  assert.ok(
    browserListener,
    "the browser service-worker message listener is missing",
  );
  assert.match(
    browserListener,
    /deferredPushTargetRef\.current\?\.handle\(e\.data\.url\)/,
    "a notification click received while auth is restoring must be queued instead of opened as an anonymous user",
  );
  assert.doesNotMatch(
    browserListener,
    /openPushTargetInApp\(e\.data\.url\)/,
    "the browser listener still bypasses the authenticated target queue",
  );
  assert.match(
    source,
    /if \(!currentUserId\) return;\s*deferredPushTargetRef\.current\?\.flush\(\);/,
    "restoring the authenticated user must flush queued browser and native notification clicks",
  );
  assert.match(
    source,
    /chatAddressPath\(chatId, messageId\)/,
    "the flushed target must keep the message id in the canonical conversation address",
  );
});
