import assert from "node:assert/strict";
import test from "node:test";

import { inlineImageSource } from "../../artifacts/kub/src/lib/mediaInlineLoad.ts";

test("a ready preview is automatic even when its original is large", () => {
  assert.equal(inlineImageSource("preview.webp", "original.jpg", { size_bytes: 8_000_000 }), "preview.webp");
});

test("small stored photos load automatically but a known large original waits for a tap", () => {
  assert.equal(inlineImageSource(null, "small.jpg", { size_bytes: 400_000 }), "small.jpg");
  assert.equal(inlineImageSource(null, "edge.jpg", { size_bytes: 1_048_576 }), "edge.jpg");
  assert.equal(inlineImageSource(null, "large.jpg", { size_bytes: 1_048_577 }), null);
});

test("old rows with no recorded size preserve their existing inline photo", () => {
  assert.equal(inlineImageSource(null, "legacy.jpg", null), "legacy.jpg");
  assert.equal(inlineImageSource(null, "legacy.jpg", { size_bytes: "unknown" }), "legacy.jpg");
});
