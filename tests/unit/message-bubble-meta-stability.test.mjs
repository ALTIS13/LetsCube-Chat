import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../artifacts/kub/src/components/chat/MessageBubble.tsx", import.meta.url),
  "utf8",
);

test("message footer keeps anchored placement after measured inline overflow", () => {
  assert.match(source, /const inlineBlockedRef = useRef\(false\)/);
  assert.match(source, /inlineBlockedRef\.current = true;[\s\S]*setPlacement/);
  assert.match(source, /!inlineBlockedRef\.current/);
  assert.doesNotMatch(source, /blockedInlineSignatureRef/);
});

test("message time and private delivery icon reserve stable footer width", () => {
  assert.match(
    source,
    /min-w-\[2\.75rem\][^"\n]*tabular-nums[^"\n]*text-right/,
  );
  assert.match(
    source,
    /data-message-delivery-slot="true"[\s\S]*w-\[13px\]/,
  );
});

test("delivery state changes do not reset measured footer placement", () => {
  const measureKeyBlock = source.match(
    /const footerMeasureKey = \[([\s\S]*?)\]\.join\("\|"\);/,
  );
  assert.ok(measureKeyBlock);
  assert.doesNotMatch(measureKeyBlock[1], /deliveryState/);
  assert.doesNotMatch(measureKeyBlock[1], /message\.id/);
  assert.doesNotMatch(measureKeyBlock[1], /message\.created_at/);
});
