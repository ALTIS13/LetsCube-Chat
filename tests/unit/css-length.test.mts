import assert from "node:assert/strict";
import test from "node:test";

import { resolveCssLength } from "../../artifacts/kub/src/lib/cssLength.ts";

/**
 * D-032: the message bubble's declared cap arrives as a *computed* expression.
 *
 * `getComputedStyle(stack).maxWidth` on a message stack returns
 * `min(1238.4px, 560px, max(256px, 100% - 104px))` — every unit already
 * absolute, the custom property already substituted, and only the percentage
 * left standing. The measurement that decides where a timestamp sits needs a
 * number out of that, and `parseFloat` gives it 1238.4 for that string and 100
 * for a plain `100%`. A hundred pixels.
 *
 * These cases are the ones the product actually produces, plus the ones that
 * must refuse to answer rather than answer wrongly.
 */

test("the real computed caps of a message stack resolve to the design ceiling", () => {
  // `regular`, desktop: 86vw at 1440 is 1238.4px, the design cap is 560px, and
  // the third term is the row minus the action lane. The row is shrink-to-fit
  // around this very bubble, so that term is asked for as unbounded and drops
  // out, leaving the fixed ceiling.
  assert.equal(
    resolveCssLength("min(1238.4px, 560px, max(256px, 100% - 104px))", Number.POSITIVE_INFINITY),
    560,
  );
  // `short`/`media` carry a wider design cap.
  assert.equal(
    resolveCssLength("min(936px, 680px, max(256px, 100% - 104px))", Number.POSITIVE_INFINITY),
    680,
  );
  // Mobile: the lane is 0px there and 86vw is the binding term.
  assert.equal(
    resolveCssLength("min(335.4px, 560px, max(256px, 100% + 0px))", Number.POSITIVE_INFINITY),
    335.4,
  );
  // A narrow window where the viewport term wins over the px cap.
  assert.equal(
    resolveCssLength("min(409.6px, 580px, max(256px, 100% - 104px))", Number.POSITIVE_INFINITY),
    409.6,
  );
});

test("a percentage is resolved against the basis it is given", () => {
  assert.equal(resolveCssLength("100%", 640), 640);
  assert.equal(resolveCssLength("calc(100% - 104px)", 640), 536);
  assert.equal(resolveCssLength("max(256px, 100% - 104px)", 300), 256);
  assert.equal(resolveCssLength("max(256px, 100% - 104px)", 800), 696);
});

test("a cap that is only a percentage of a shrink-to-fit box resolves to nothing", () => {
  // `max-width: 100%` on the bubble describes the width it HAS, not the width
  // it may reach. Asked as unbounded it must come back as nothing at all, so
  // the caller keeps the answer it had rather than clamping to a fake ceiling.
  assert.equal(resolveCssLength("100%", Number.POSITIVE_INFINITY), null);
  assert.equal(resolveCssLength("calc(100% - 104px)", Number.POSITIVE_INFINITY), null);
  assert.equal(resolveCssLength("max(256px, 100% - 104px)", Number.POSITIVE_INFINITY), null);
});

test("percentages are refused outright when no basis is available", () => {
  assert.equal(resolveCssLength("100%", null), null);
  assert.equal(resolveCssLength("min(560px, 100%)", null), null);
});

test("min, max and clamp pick the value CSS picks", () => {
  assert.equal(resolveCssLength("min(10px, 4px, 7px)"), 4);
  assert.equal(resolveCssLength("max(10px, 4px, 7px)"), 10);
  assert.equal(resolveCssLength("clamp(10px, 4px, 20px)"), 10);
  assert.equal(resolveCssLength("clamp(10px, 15px, 20px)"), 15);
  assert.equal(resolveCssLength("clamp(10px, 40px, 20px)"), 20);
});

test("arithmetic follows precedence and nesting", () => {
  assert.equal(resolveCssLength("calc(10px + 4px * 3)"), 22);
  assert.equal(resolveCssLength("calc((10px + 4px) * 3)"), 42);
  assert.equal(resolveCssLength("calc(100px / 4)"), 25);
  assert.equal(resolveCssLength("calc(20px - 5px - 3px)"), 12);
  assert.equal(resolveCssLength("min(calc(10px + 5px), max(4px, 8px))"), 8);
});

test("a value that is not a resolved pixel length answers nothing rather than a number", () => {
  // The failure this replaces: `parseFloat("100%")` is 100, and `parseFloat` on
  // any of these returns a plausible number for a string that means something
  // else entirely.
  assert.equal(resolveCssLength("none"), null);
  assert.equal(resolveCssLength("auto"), null);
  assert.equal(resolveCssLength(""), null);
  assert.equal(resolveCssLength("   "), null);
  assert.equal(resolveCssLength("16rem"), null, "an unresolved relative unit is not a computed length");
  assert.equal(resolveCssLength("86vw"), null);
  assert.equal(resolveCssLength("560"), 560, "a bare number is what calc() multiplies by");
  assert.equal(resolveCssLength("min(560px, )"), null);
  assert.equal(resolveCssLength("min(560px"), null);
  assert.equal(resolveCssLength("560px 480px"), null);
  assert.equal(resolveCssLength("calc(560px / 0)"), null);
  assert.equal(resolveCssLength("fit-content(560px)"), null);
});

test("a decimal cap is not rounded away", () => {
  assert.equal(resolveCssLength("335.4px"), 335.4);
  assert.equal(resolveCssLength("min(1238.4px, 560.5px)"), 560.5);
});
