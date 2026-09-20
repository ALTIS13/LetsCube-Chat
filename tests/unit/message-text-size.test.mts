import assert from "node:assert/strict";
import test from "node:test";

import {
  clampMessageTextSize,
  isDefaultMessageTextSize,
  messageTextLineHeight,
  messageTextSizeSteps,
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

test("the summary says which one is the default, because that is the question somebody has", () => {
  assert.equal(messageTextSizeSummary(16), "16 px — по умолчанию");
  assert.equal(messageTextSizeSummary(20), "20 px");
  assert.equal(messageTextSizeSummary(13), "13 px");
});
