import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../artifacts/kub/src/components/chat/MessageBubble.tsx", import.meta.url),
  "utf8",
);

const format = readFileSync(new URL("../../artifacts/kub/src/lib/format.ts", import.meta.url), "utf8");

test("the inline placement cannot oscillate", () => {
  // This used to assert a one-shot latch (`inlineBlockedRef`) that flipped a
  // message to its own meta row and never let it back. The latch is gone,
  // because the thing it guarded is gone: the meta no longer flows after the
  // last word, so it can no longer fail to sit on it.
  //
  // Stability is now structural, and that is what is asserted. The spacer that
  // reserves room for the meta sits OUTSIDE the measured span, so adding it can
  // only shorten the last line and therefore only increase the room the
  // decision sees. A message that chose inline cannot measure its way back out.
  assert.doesNotMatch(source, /inlineBlockedRef/, "the removed latch must not come back by accident");
  assert.match(
    source,
    /data-message-footer-reserve/,
    "the reserved spacer is what keeps the last line clear of the meta",
  );
  const contentSpan = source.match(/<span ref={textContentRef}[\s\S]{0,400}?<\/span>/);
  assert.ok(contentSpan, "the measured text span could not be found");
  assert.doesNotMatch(
    contentSpan[0],
    /data-message-footer-reserve/,
    "the spacer must sit outside the measured span, or adding it would feed back into the measurement",
  );
});

test("the meta is pinned to the bubble's edge rather than flowing after the text", () => {
  // The reported defect: a wrapped bubble takes its width from its longest
  // line, so a time that flowed after a short last line sat in the middle of
  // the bubble — 348px from the right edge of a 560px bubble, measured.
  const footer = source.match(/data-message-footer="true"[\s\S]{0,320}?\/>|data-message-footer="true"[\s\S]{0,320}?>/g);
  assert.ok(footer && footer.length > 0, "the message footer could not be found");
  assert.ok(
    footer.some((entry) => /absolute[\s\S]*right-0/.test(entry)),
    "the inline meta must be positioned at the bubble's right edge",
  );
});

test("the fit test asks about the width the bubble may reach", () => {
  // Asking how much room is left to the RIGHT of the last line answers nothing
  // for an own message: that bubble is pinned to the right edge and grows
  // leftwards, so the space to its right is always zero. Measured, that sent a
  // 150px message with a 29px timestamp — inside a 536px allowance — onto its
  // own row.
  assert.match(source, /function getMaxContentWidth/, "the max-width helper is missing");
  // The property, not the expression. An earlier version pinned the literal
  // comparison and went red when the branch was restructured to add the
  // plausibility guard below — reporting a regression in a contract that had
  // not moved.
  assert.match(
    source,
    /const maxContentWidth = getMaxContentWidth\(/,
    "the non-compound branch must ask for the allowed width",
  );
  assert.match(
    source,
    /lastLine\.width \+ footerRect\.width \+ gap <= maxContentWidth/,
    "and compare the last line and the meta against it",
  );
  // And it must refuse to answer on a width that cannot be real. A bubble
  // mounting inside a prepended page is measured while its row still reports
  // zero width, and answering then cost 706px of list height a frame later.
  assert.match(
    source,
    /if \(maxContentWidth < \d+\) return;/,
    "an implausible width must produce no decision at all",
  );
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
