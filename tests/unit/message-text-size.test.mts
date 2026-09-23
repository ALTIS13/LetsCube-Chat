import assert from "node:assert/strict";
import test from "node:test";

import {
  clampMessageTextSize,
  composerMaxHeight,
  composerRestHeight,
  isDefaultMessageTextSize,
  messageTextLineHeight,
  messageTextSizeSteps,
  messageTextSizePercent,
  messageTextSizeSummary,
} from "../../artifacts/kub/src/lib/messageTextSize.ts";

/**
 * D-287. The default moves from 14 to 16 because the measurement said the size
 * was the whole defect — Inter's x-height relative to its em is within 1% of
 * Roboto's, so the face the tester suspected changes nothing — and the reader
 * gets a say because one default cannot answer daylight.
 *
 * Every number here is a literal. An assertion written against the constant it
 * means to pin moves with it and stays green through the change it exists to
 * catch.
 */

test("the default is 16, which is what Telegram renders and what our own composer already used", () => {
  assert.equal(clampMessageTextSize(undefined), 16);
  assert.equal(clampMessageTextSize(null), 16);
  assert.equal(clampMessageTextSize(""), 16);
  assert.equal(clampMessageTextSize("совсем не число"), 16);
  assert.equal(clampMessageTextSize(Number.NaN), 16);
  assert.equal(isDefaultMessageTextSize(16), true);
  assert.equal(isDefaultMessageTextSize(14), false);
});

test("the range is 13 to 22, and anything outside it lands on the nearest end", () => {
  assert.equal(clampMessageTextSize(13), 13);
  assert.equal(clampMessageTextSize(22), 22);
  assert.equal(clampMessageTextSize(12), 13);
  assert.equal(clampMessageTextSize(0), 13);
  assert.equal(clampMessageTextSize(-40), 13);
  assert.equal(clampMessageTextSize(23), 22);
  assert.equal(clampMessageTextSize(30), 22);
  assert.equal(clampMessageTextSize(9999), 22);
});

test("a stored value is read as a whole pixel, whatever shape it arrived in", () => {
  assert.equal(clampMessageTextSize("18"), 18);
  assert.equal(clampMessageTextSize("18.4"), 18);
  assert.equal(clampMessageTextSize(18.6), 19);
  assert.equal(clampMessageTextSize(" 20 "), 20);
});

test("the leading follows the size at the ratio the bubbles already used", () => {
  // leading-relaxed is 1.625, which at the old 14px gave the 22.75 that was measured.
  assert.equal(messageTextLineHeight(14), 22.75);
  assert.equal(messageTextLineHeight(16), 26);
  assert.equal(messageTextLineHeight(22), 35.75);
  assert.equal(messageTextLineHeight(13), 21.13);
});

test("the control offers every whole pixel in the range and nothing outside it", () => {
  const steps = messageTextSizeSteps();
  assert.equal(steps.length, 10);
  assert.equal(steps[0], 13);
  assert.equal(steps[steps.length - 1], 22);
  // The size the tester asked for — 125% of the new default — is reachable.
  assert.ok(steps.includes(20));
  assert.ok(!steps.includes(12));
  assert.ok(!steps.includes(23));
});

test("the control describes each persisted pixel step relative to the 16 px default", () => {
  assert.equal(messageTextSizePercent(13), 81);
  assert.equal(messageTextSizePercent(16), 100);
  assert.equal(messageTextSizePercent(20), 125);
  assert.equal(messageTextSizePercent(22), 138);
  assert.equal(messageTextSizeSummary(16), "100% — по умолчанию");
  assert.equal(messageTextSizeSummary(20), "125%");
  assert.equal(messageTextSizeSummary(13), "81%");
});


// ── D-289: the composer reads the same number ────────────────────────────

test("the composer grows to six lines and no further, at every size", () => {
  // Six is Telegram Android's, measured on the device on 2026-09-20: its field
  // saturates at 387 device px = 51 of padding + 6 × 56 of line.
  //
  // Every number below is a literal, and they are the arithmetic of six lines
  // plus 20px of padding at a 1.625 leading. An assertion written as
  // `line * MAX_COMPOSER_LINES + PADDING` would move with the constant it
  // exists to pin and stay green through the change that breaks the product.
  assert.equal(composerMaxHeight(13), 147);
  assert.equal(composerMaxHeight(14), 157);
  assert.equal(composerMaxHeight(15), 167);
  assert.equal(composerMaxHeight(16), 176);
  assert.equal(composerMaxHeight(18), 196);
  assert.equal(composerMaxHeight(20), 215);
  assert.equal(composerMaxHeight(22), 235);
});

test("the ceiling is a count of lines, so enlarging the text never shortens the field", () => {
  // The defect a fixed ceiling has: 140px was five lines at 16 and three and a
  // half at 22, so the reader who could not read the text was handed a smaller
  // field for asking. Every step must give MORE room than the one below it.
  const steps = messageTextSizeSteps();
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(
      composerMaxHeight(steps[i]) > composerMaxHeight(steps[i - 1]),
      `${steps[i]}px must give a taller field than ${steps[i - 1]}px`,
    );
  }
  // And the count itself holds: six lines fit inside the ceiling at both ends
  // of the range, and a seventh does not.
  for (const size of [13, 16, 22]) {
    const line = messageTextLineHeight(size);
    assert.ok(line * 6 + 20 <= composerMaxHeight(size), `six lines must fit at ${size}px`);
    assert.ok(line * 7 + 20 > composerMaxHeight(size), `a seventh must not fit at ${size}px`);
  }
});

test("the composer at rest is one line and its padding", () => {
  assert.equal(composerRestHeight(13), 42);
  assert.equal(composerRestHeight(16), 46);
  assert.equal(composerRestHeight(22), 56);
  // 46 rather than the 44 the old `leading-6` gave, which is what the recording
  // row now follows so that starting a recording moves nothing.
  assert.notEqual(composerRestHeight(16), 44);
});

test("an unusable stored size gives the composer the default's heights, not a broken one", () => {
  // The field is sized from the same clamp the body is, so storage — which
  // other software can write to — cannot produce a field of NaN pixels.
  for (const bad of [undefined, null, "", "огромный", Number.NaN]) {
    assert.equal(composerMaxHeight(bad as unknown as number), 176);
    assert.equal(composerRestHeight(bad as unknown as number), 46);
  }
  // Out of range is clamped to the ends rather than honoured.
  assert.equal(composerMaxHeight(400), 235);
  assert.equal(composerMaxHeight(1), 147);
});
