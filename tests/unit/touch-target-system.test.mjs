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

const css = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");

function coarseBlocks() {
  const blocks = css.match(/@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\n\}/g) ?? [];
  assert.ok(blocks.length > 0, "no coarse-pointer block was found");
  return blocks.join("\n");
}

test("icon-only actions keep a dense size on a pointer device", () => {
  const rule = css.match(/\.kub-icon-action\s*\{([\s\S]*?)\n\}/);
  assert.ok(rule, ".kub-icon-action is not defined");
  assert.match(rule[1], /min-width:\s*32px/, "the resting size is the design's, not an inflated one");
  assert.match(rule[1], /min-height:\s*32px/);
});

test("icon-only actions reach the touch target on a coarse pointer", () => {
  const coarse = coarseBlocks();
  assert.match(coarse, /\.kub-icon-action\s*\{[\s\S]*?min-width:\s*44px/);
  assert.match(coarse, /\.kub-icon-action\s*\{[\s\S]*?min-height:\s*44px/);
});

test("buttons keep the same bargain, and only on a coarse pointer", () => {
  assert.match(coarseBlocks(), /\.kub-button\s*\{[\s\S]*?min-height:\s*44px/);
  const withoutCoarse = css.replace(/@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\n\}/g, "");
  assert.doesNotMatch(
    withoutCoarse,
    /\.kub-button\s*\{[\s\S]*?min-height:\s*44px/,
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
    selector: 'input\\[type="checkbox"\\],\\s*\\n\\s*input\\[type="radio"\\]',
    property: "min-width",
    value: "24px",
  },
  {
    name: "the row a tick box sits in",
    selector: 'label:has\\(input\\[type="checkbox"\\]\\),\\s*\\n\\s*label:has\\(input\\[type="radio"\\]\\)',
    property: "min-height",
    value: "44px",
  },
];

for (const { name, selector, property, value } of nativeControls) {
  test(`${name} reach the touch target on a coarse pointer`, () => {
    assert.match(
      coarseBlocks(),
      new RegExp(`${selector}\\s*\\{[\\s\\S]*?${property}:\\s*${value}`),
      `${name}: no coarse-pointer ${property} of ${value} was found`,
    );
  });

  test(`${name} keep the design's size on a pointer device`, () => {
    const withoutCoarse = css.replace(/@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\n\}/g, "");
    assert.doesNotMatch(
      withoutCoarse,
      new RegExp(`${selector}\\s*\\{[\\s\\S]*?${property}:\\s*${value}`),
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
