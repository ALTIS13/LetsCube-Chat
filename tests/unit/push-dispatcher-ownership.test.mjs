import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeLegacyWebPushFailure,
  shouldStartLegacyPushDispatcher,
} from "../../artifacts/api-server/src/workers/pushDispatcherConfig.ts";

test("legacy API push dispatcher is disabled unless explicitly opted in", () => {
  assert.equal(shouldStartLegacyPushDispatcher(undefined), false);
  assert.equal(shouldStartLegacyPushDispatcher("0"), false);
  assert.equal(shouldStartLegacyPushDispatcher("false"), false);
  assert.equal(shouldStartLegacyPushDispatcher("1"), true);
});
test("legacy push failure logging drops endpoint and keeps only a safe reason", () => {
  const failure = sanitizeLegacyWebPushFailure({
    statusCode: 403,
    body: JSON.stringify({ reason: "BadJwtToken" }),
    endpoint: "https://web.push.apple.com/private-subscription-path",
    message: "Received unexpected response code",
  });

  assert.deepEqual(failure, { status: 403, reason: "BadJwtToken" });
  assert.equal(JSON.stringify(failure).includes("push.apple.com"), false);
});
