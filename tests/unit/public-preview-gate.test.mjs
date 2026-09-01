import assert from "node:assert/strict";
import test from "node:test";

import { resolveCaptureGate } from "../../artifacts/kub/src/lib/publicPreviewFixture.ts";

// The capture surface renders a fabricated conversation with no authentication.
// It must exist only when a developer has asked for it in a development build.
test("the capture gate requires a development build and an explicit flag", () => {
  assert.equal(resolveCaptureGate({ DEV: true, VITE_PUBLIC_PREVIEW_FIXTURE: "1" }), true);

  assert.equal(resolveCaptureGate({ DEV: false, VITE_PUBLIC_PREVIEW_FIXTURE: "1" }), false);
  assert.equal(resolveCaptureGate({ DEV: true, VITE_PUBLIC_PREVIEW_FIXTURE: "0" }), false);
  assert.equal(resolveCaptureGate({ DEV: true }), false);
  assert.equal(resolveCaptureGate({}), false);
});

// A production bundle inlines `import.meta.env.DEV` as the boolean `false`, but
// an unset variable arrives as `undefined` and a shell can only ever supply
// strings. Neither may be coerced into enabling capture.
test("the capture gate never coerces a loose value into consent", () => {
  assert.equal(resolveCaptureGate({ DEV: "true", VITE_PUBLIC_PREVIEW_FIXTURE: "1" }), false);
  assert.equal(resolveCaptureGate({ DEV: 1, VITE_PUBLIC_PREVIEW_FIXTURE: "1" }), false);
  assert.equal(resolveCaptureGate({ DEV: undefined, VITE_PUBLIC_PREVIEW_FIXTURE: "1" }), false);
  assert.equal(resolveCaptureGate({ DEV: true, VITE_PUBLIC_PREVIEW_FIXTURE: 1 }), false);
  assert.equal(resolveCaptureGate({ DEV: true, VITE_PUBLIC_PREVIEW_FIXTURE: true }), false);
});
