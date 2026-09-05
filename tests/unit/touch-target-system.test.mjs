import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The touch-target bargain, applied consistently.
 *
 * The size scale is a design choice and stays exactly as it looks on a pointer
 * device; a coarse pointer — a finger — gets the 44px it needs. That was settled
 * for buttons in D-015. The staff area's icon-only actions and search fields
 * needed the same treatment: padding alone left 28-32px targets, and a 20px
 * input floated inside a 40px box with a dead zone above and below it.
 *
 * Both halves are asserted, for the same reason as D-015: a test that only
 * checked the touch half would pass equally well if the whole scale had been
 * inflated, which is the change deliberately not made.
 */

import { parseRules } from "./helpers/css.mjs";

const css = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");

const COARSE = /^@media \(pointer: coarse\)$/;

/**
 * Rules are read one at a time, by selector, rather than pattern-matched
 * against a slab of text.
 *
 * Two reasons, and both were live defects. The class half of the touch-target
 * rule now sits in `@layer components` and the element half outside it, so
 * "from `@media (pointer: coarse) {` to the next brace at the start of a line"
 * ran past the block and out through the layer — the negative assertions were
 * being made against a sheet with most of the classes deleted. And
 * `/\.kub-button\s*\{[\s\S]*?min-height:\s*44px/` never had to find the value
 * inside `.kub-button`'s own body: dropping the button's floor to 40px left it
 * green, because the match simply ran on into `.kub-icon-action`, four rules
 * later, which does declare 44px. Proven by mutation both ways.
 */
const rulesFor = (selector) => parseRules(css).filter((rule) => rule.selectors.includes(selector));
const isCoarse = (rule) => rule.at.some((prelude) => COARSE.test(prelude));

/** The one coarse-pointer rule for `selector`; refuses if it is not exactly one. */
function coarseRule(selector) {
  const hits = rulesFor(selector).filter(isCoarse);
  assert.equal(hits.length, 1, `${selector} has ${hits.length} coarse-pointer rules, not 1`);
  return hits[0].body;
}

/** Every rule for `selector` that applies whatever the pointer is. */
const pointerRules = (selector) => rulesFor(selector).filter((rule) => !isCoarse(rule));

/** `selector` may not carry `property: value` outside the coarse-pointer query. */
function onlyOnCoarse(selector, property, value, message) {
  for (const body of pointerRules(selector).map((rule) => rule.body)) {
    assert.doesNotMatch(body, new RegExp(`${property}:\\s*${value}`), message);
  }
}

test("icon-only actions keep a dense size on a pointer device", () => {
  const [rule, ...rest] = pointerRules(".kub-icon-action").map((entry) => entry.body);
  assert.equal(rest.length, 0, ".kub-icon-action has more than one unconditional rule");
  assert.match(rule, /min-width:\s*32px/, "the resting size is the design's, not an inflated one");
  assert.match(rule, /min-height:\s*32px/);
});

test("icon-only actions reach the touch target on a coarse pointer", () => {
  const coarse = coarseRule(".kub-icon-action");
  assert.match(coarse, /min-width:\s*44px/);
  assert.match(coarse, /min-height:\s*44px/);
});

test("buttons keep the same bargain, and only on a coarse pointer", () => {
  assert.match(coarseRule(".kub-button"), /min-height:\s*44px/);
  onlyOnCoarse(
    ".kub-button",
    "min-height",
    "44px",
    "raising the resting height for every pointer is the change that was not made",
  );
});

/**
 * Native controls are covered by element rather than by an opt-in class, so a
 * select or a tick box added tomorrow is correct without anyone remembering to
 * tag it. Measured before the rule: selects came out 40px tall, and a 16px tick
 * box inside a `flex items-center` label made a 20px-tall row.
 *
 * Each is asserted in both directions for the reason D-015 established: a test
 * that only checked the coarse half would pass equally well if the whole scale
 * had been inflated for every pointer, which is the change deliberately not
 * made.
 */
const nativeControls = [
  { name: "select", selector: "select", property: "min-height", value: "44px" },
  {
    name: "tick and radio boxes",
    selector: 'input[type="checkbox"]',
    property: "min-width",
    value: "24px",
  },
  {
    name: "the row a tick box sits in",
    selector: 'label:has(input[type="checkbox"])',
    property: "min-height",
    value: "44px",
  },
  // The switch track is 24px by design and stays that way; the control around
  // it is what a finger aims at. Measured before the split, the switch was a
  // 44x24 target on the invites screen.
  { name: "the switch", selector: ".kub-switch", property: "min-height", value: "44px" },
];

for (const { name, selector, property, value } of nativeControls) {
  test(`${name} reach the touch target on a coarse pointer`, () => {
    assert.match(
      coarseRule(selector),
      new RegExp(`${property}:\\s*${value}`),
      `${name}: no coarse-pointer ${property} of ${value} was found`,
    );
  });

  test(`${name} keep the design's size on a pointer device`, () => {
    onlyOnCoarse(
      selector,
      property,
      value,
      `${name}: growing the control for every pointer is the change that was not made`,
    );
  });
}

const staffSearches = [
  "artifacts/kub/src/pages/admin/UsersTab.tsx",
  "artifacts/kub/src/pages/admin/AuditTab.tsx",
];

test("every field inside a styled box fills it, so the whole box is tappable", () => {
  // Located by what the field IS — an input stretched inside a styled box —
  // rather than by its placeholder text. An earlier version searched for the
  // word "Поиск" and missed a field labelled "Имя или @никнейм", reporting a
  // fix as absent when it was present.
  let checked = 0;
  for (const path of staffSearches) {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    const fields = source.match(/className="[^"]*\bflex-1 bg-transparent[^"]*"/g) ?? [];
    assert.ok(fields.length > 0, `${path}: no field stretched inside a styled box was found`);
    for (const classes of fields) {
      checked += 1;
      assert.match(
        classes,
        /\bh-full\b/,
        `${path}: a field sits at its intrinsic height inside its box, leaving a dead zone above and below: ${classes}`,
      );
    }
  }
  assert.ok(checked >= 2, `expected to check at least two fields, checked ${checked}`);
});

test("the switch keeps its track separate from its target", () => {
  const source = readFileSync(
    new URL("../../artifacts/kub/src/components/kub/KubSwitch.tsx", import.meta.url),
    "utf8",
  );
  // The button carries the class that grows; the track keeps the fixed size.
  // Were they the same element again, the coarse rule would stretch the track
  // into a 44px pill instead of giving the switch a bigger target.
  assert.match(source, /kub-switch/, "the control must carry the target class");
  assert.doesNotMatch(
    source,
    /kub-switch[^"]*\bh-6 w-11\b/,
    "the track's fixed size must not sit on the element the coarse rule grows",
  );
  assert.match(source, /"flex h-6 w-11 items-center/, "the track keeps its designed size");
});

test("the staff search box is itself a touch target", () => {
  for (const path of staffSearches) {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /rounded-xl px-3 h-10 bg-\[var\(--kub-surface-2\)\]/,
      `${path}: a 40px search box is under the target even once the input fills it`,
    );
  }
});
