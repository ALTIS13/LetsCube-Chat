import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../artifacts/kub/src/components/chat/MessageBubble.tsx", import.meta.url),
  "utf8",
);

const format = readFileSync(new URL("../../artifacts/kub/src/lib/format.ts", import.meta.url), "utf8");

test("message footer keeps anchored placement after measured inline overflow", () => {
  assert.match(source, /const inlineBlockedRef = useRef\(false\)/);
  assert.match(source, /inlineBlockedRef\.current = true;[\s\S]*setPlacement/);
  assert.match(source, /!inlineBlockedRef\.current/);
  assert.doesNotMatch(source, /blockedInlineSignatureRef/);
});

test("message time and private delivery icon reserve stable footer width", () => {
  // The contract is that the time occupies the same width in every bubble, so
  // the measured footer placement cannot flip between messages. This used to be
  // spelled as a 2.75rem minimum, which reserved ~16px of dead space and pushed
  // the meta onto its own line far more often than it had to. The width is
  // actually constant for two reasons, and both are asserted here instead of
  // that magic number: the formatter always emits five glyphs, and
  // `tabular-nums` gives every digit the same advance.
  // The class list is read from the whole element rather than from a literal
  // `className="..."`, because it is composed with `cn()` once the row needs a
  // conditional class. Pinning the literal form made this fail on a change
  // that kept every property it is supposed to protect.
  const timeElement = source.match(/<span\s+className={?[\s\S]{0,600}?formatFullTime\(/);
  assert.ok(timeElement, "the message time is not rendered through formatFullTime");
  assert.match(timeElement[0], /tabular-nums/, "the time must use tabular figures for a constant width");
  assert.match(timeElement[0], /\bshrink-0\b/, "the time may not be compressed by its neighbours");

  // Bounded to this function's own body: the same options appear in other
  // formatters, and an unbounded search happily matched one of those while
  // `formatFullTime` itself had been changed to an unpadded hour.
  const fullTime = format.match(/export function formatFullTime[\s\S]*?\n}/);
  assert.ok(fullTime, "formatFullTime is missing");
  assert.match(
    fullTime[0],
    /hour: "2-digit", minute: "2-digit"/,
    "formatFullTime must pad the hour so the glyph count is constant",
  );

  assert.match(source, /data-message-delivery-slot="true"[\s\S]*w-\[13px\]/);
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
