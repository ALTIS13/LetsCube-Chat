import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../artifacts/kub/src/components/chat/MessageBubble.tsx", import.meta.url),
  "utf8",
);

const format = readFileSync(new URL("../../artifacts/kub/src/lib/format.ts", import.meta.url), "utf8");

const stylesheet = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");

/**
 * The two theme blocks of `index.css`, as token maps.
 *
 * The dark palette is declared first and the light one second, so the second
 * definition of any token belongs to light. Only literal hex values are read;
 * a token defined as an alias is skipped rather than half-resolved, and the
 * caller asserts on what it found.
 */
function themePalettes() {
  const dark = new Map();
  const light = new Map();
  let surfaceSeen = 0;
  for (const line of stylesheet.split("\n")) {
    const match = /^\s*(--kub-[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;/.exec(line);
    if (!match) continue;
    if (match[1] === "--kub-surface") surfaceSeen += 1;
    (surfaceSeen <= 1 ? dark : light).set(match[1], match[2]);
  }
  return { dark, light };
}

const channels = (hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));

/** `color-mix(in srgb, a p%, b)` — the sRGB average the browser computes. */
const mixChannels = (a, b, portion) =>
  channels(a).map((value, index) => value * portion + channels(b)[index] * (1 - portion));

function relativeLuminance(rgb) {
  const linear = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a, b) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

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

test("the meta's place is decided by the measurement alone, not by the line count", () => {
  // D-008. Whether the time fits beside the last words is a measurement, and
  // `canInline` already answers it for the *last* rendered line however many
  // there are. A `lineRects.length <= 1` condition used to sit on top of that
  // result and refuse every wrapped message, so a bubble whose last line ended
  // well short of the edge still grew a row holding nothing but a timestamp.
  //
  // The geometric proof of this lives in `tests/e2e/message-meta-placement.spec.ts`,
  // which is the better test — it measures pixels rather than reading source.
  // It is also gated behind the DEV capture route and skips itself whenever
  // `VITE_PUBLIC_PREVIEW_FIXTURE=1` is absent from the dev server, which is the
  // usual case. Measured: against a server without that flag all four of its
  // tests skip and report success. This scan is what keeps the contract
  // enforced in the default `node --test` gate that always runs.
  const branch = source.match(/const maxContentWidth = getMaxContentWidth\([\s\S]{0,900}?const next: MetaPlacement/);
  assert.ok(branch, "the non-compound placement branch could not be found");
  assert.doesNotMatch(
    branch[0],
    /lineRects\.length/,
    "the number of lines must not gate the placement — that is the D-008 defect returning",
  );
});

test("the read count looks like something you can press", () => {
  // D-004. The count is a `<button>` that opens the receipt list, but it was
  // drawn as bare text right after the timestamp: a sighted reader saw `3/3`
  // and had no reason to think it did anything. Its accessible name was already
  // correct, so the affordance existed for assistive technology and for nobody
  // else.
  //
  // The properties are asserted rather than the class string, because the row
  // composes its classes and pinning a literal has already failed this file
  // once on a change that kept everything the class exists to protect.
  const button = source.match(/showGroupReadIndicator && \([\s\S]*?<\/button>/);
  assert.ok(button, "the group read receipt button could not be found");

  // A filled chip is what separates it from the muted text beside it. Spelled
  // as a token, never a literal colour: D-006 and D-007 were both a reference
  // to a token that did not exist, which resolves to nothing and renders as
  // plain text again — exactly the defect this is meant to fix.
  // Anchored to a class boundary so a `hover:` or `focus-visible:` variant
  // cannot satisfy it. Written without that boundary this assertion stayed
  // green with the resting background deleted, because `hover:bg-[…]` matched
  // it — the affordance would have been gone for everyone not already pointing
  // at it, which is precisely the reader D-004 is about.
  assert.match(
    button[0],
    /[\s"']bg-\[var\(--kub-[a-z0-9-]+\)\]/,
    "the count needs a filled background at rest, from a theme token, to read as pressable",
  );
  assert.match(
    button[0],
    /focus-visible:outline/,
    "and a focus ring, or it is unreachable as a control by keyboard",
  );
  // The accessible name is the part that was already right. Losing it while
  // adding the visible affordance would trade one audience for another.
  assert.match(button[0], /aria-label=/, "the accessible name must survive the visual change");
  // The chip sits inside the footer whose width the D-008 measurement reads, so
  // its digits must not change advance between `3/3` and `12/12`.
  assert.match(
    button[0],
    /tabular-nums/,
    "tabular figures keep the chip from resizing the measured footer as counts change",
  );
});

test("the read count is visible against the bubble it actually sits on", () => {
  // The teeth of D-004, and the assertion the first fix needed and did not have.
  //
  // That fix put the count in a chip and was signed off from the previews —
  // but the previews contain no own group message, so the chip was never in
  // them. On screen it measured 1.07:1 in dark and 1.11:1 in light against the
  // bubble behind it: present in the markup, invisible to a reader, and the
  // count still read as bare text. A class-name check passed the whole time.
  //
  // So this computes the contrast instead of looking for a class. The surface
  // is not a guess: `getGroupReadReceiptInfo` returns null unless the message
  // is the reader's own, so the chip is always on the tinted own bubble.
  const { dark, light } = themePalettes();

  const button = source.match(/showGroupReadIndicator && \([\s\S]*?<\/button>/);
  assert.ok(button, "the group read receipt button could not be found");
  const boundary = button[0].match(/border-\[color:var\((--kub-[a-z0-9-]+)\)\]/);
  assert.ok(boundary, "the chip needs a border token to be distinguishable from the bubble");

  // Read the own-bubble recipe from the component rather than restating it, so
  // a change to the bubble's tint is caught here instead of quietly lowering
  // the contrast this test believes it is protecting.
  const ownBubble = source.match(
    /bg-\[color-mix\(in_srgb,var\((--kub-[a-z0-9-]+)\)_(\d+)%,var\((--kub-[a-z0-9-]+)\)\)\]/,
  );
  assert.ok(ownBubble, "the own-message bubble background recipe could not be read");

  for (const [themeName, palette] of [["dark", dark], ["light", light]]) {
    const tint = palette.get(ownBubble[1]);
    const base = palette.get(ownBubble[3]);
    const edge = palette.get(boundary[1]);
    assert.ok(tint && base && edge, `${themeName}: a token used by the chip or bubble has no hex value`);

    const behind = mixChannels(tint, base, Number(ownBubble[2]) / 100);
    const ratio = contrastRatio(channels(edge), behind);
    // 3:1 is what WCAG 1.4.11 asks of the boundary of a control. Below it the
    // chip stops being an affordance and becomes decoration nobody can see.
    assert.ok(
      ratio >= 3,
      `${themeName}: the chip's edge is ${ratio.toFixed(2)}:1 against the own bubble, so it is not visible as a control`,
    );
  }
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
