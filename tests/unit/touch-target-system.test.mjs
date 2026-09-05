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


/**
 * D-047: the rule reaches the surfaces, not only the stylesheet.
 *
 * The 44px rule is opt-in — it applies to `.kub-button`, `.kub-icon-action`,
 * `.kub-field`, `.kub-switch` and a short list of native elements, and to
 * nothing else. Two surfaces were rebuilt after it was written and carried none
 * of those classes, so the rule reached nothing on either: measured at 390x844
 * with a coarse pointer, the profile card had 4 of its 4 controls under 44px
 * and the settings screen 24 of its 48.
 *
 * Every entry below is a class list read out of the component, so a control
 * that loses its opt-in fails here rather than on someone's phone.
 */
const OPTED_IN = [
  {
    file: "artifacts/kub/src/components/chat/ChatInfoPanel.tsx",
    what: "the card's action rows, which were 357x36",
    expect: [
      /const actionRowClass = cn\(\s*\n\s*"kub-button /,
      /const dangerActionRowClass = cn\(\s*\n\s*"kub-button /,
    ],
  },
  {
    file: "artifacts/kub/src/components/chat/ChatInfoPanel.tsx",
    what: "the card's title-bar controls, which were 36x36",
    expect: [
      /className="kub-icon-action h-9 w-9 [^"]*"\s*\n\s*aria-label="Назад"/,
      /className="kub-icon-action h-9 w-9 [^"]*"\s*\n\s*aria-label="Закрыть"/,
      /className="kub-icon-action h-9 w-9 [^"]*"\s*\n\s*aria-label="Редактировать"/,
      /className="kub-icon-action h-9 w-9 [^"]*"\s*\n\s*aria-label="Сохранить"/,
      // And the tracks they sit in size to what they hold: pinned at 2.5rem a
      // 44px control simply overflows a 40px column.
      /grid-cols-\[auto_minmax\(0,1fr\)_auto\]/,
    ],
  },
  {
    file: "artifacts/kub/src/components/kub/KubModal.tsx",
    what: "every dialog's close button, which was 28x28",
    expect: [/className="kub-icon-action kub-interactive flex-shrink-0 p-1\.5/],
  },
  {
    file: "artifacts/kub/src/components/sidebar/SettingsModal.tsx",
    what: "the avatar's camera badge, which was 28x28 and is the only way to change the picture on a phone",
    expect: [/"kub-icon-action absolute -bottom-0\.5 -right-0\.5 h-7 w-7/],
  },
  {
    file: "artifacts/kub/src/components/sidebar/SettingsModal.tsx",
    what: "the three theme radios, which were 36x32",
    expect: [/"kub-icon-action h-8 w-9 rounded-md/],
  },
  {
    file: "artifacts/kub/src/components/sidebar/SettingsModal.tsx",
    what: "the name, nickname and bio fields, which were 232x36",
    expect: [/"kub-field h-9 w-full min-w-0 rounded-lg/],
  },
  {
    file: "artifacts/kub/src/components/sidebar/AudioSettingsSection.tsx",
    what: "the three processing modes, which were 288x36",
    expect: [/"kub-button h-9 rounded-lg px-2 py-1\.5/],
  },
  {
    file: "artifacts/kub/src/components/sidebar/AudioSettingsSection.tsx",
    what: "the audio reset, which was 162x16 — the smallest target on the screen",
    expect: [/className="kub-button inline-flex items-center text-xs font-semibold/],
  },
  {
    file: "artifacts/kub/src/components/sidebar/AudioSettingsSection.tsx",
    what: "the volume sliders, which were 314x16",
    expect: [/className="kub-field w-full accent-\[var\(--kub-cyan\)\]"/],
  },
  {
    file: "artifacts/kub/src/components/settings/InfoHint.tsx",
    what: "the icon-only help trigger, which was 13x13",
    expect: [/: "kub-icon-action shrink-0 text-\[color:var\(--kub-muted\)\]/],
  },
  {
    file: "artifacts/kub/src/components/chat/ChatHeader.tsx",
    what: "the chat's back control, which was 36x36 and is the only way back to the list on a phone",
    expect: [/className="kub-icon-action md:hidden p-2 rounded-lg/],
  },
];

for (const site of OPTED_IN) {
  test(`${site.file.split("/").pop()} opts ${site.what} into the touch rule`, () => {
    const source = readFileSync(new URL(`../../${site.file}`, import.meta.url), "utf8");
    for (const pattern of site.expect) {
      assert.match(source, pattern, `${site.file}: ${site.what} lost its opt-in`);
    }
  });
}

/**
 * And the opt-in has to still be the declaration that wins.
 *
 * `index.css` now lives in `@layer components`, and Tailwind's utilities are a
 * later layer, so a `min-h-*` utility on the same element outranks
 * `.kub-button { min-height: 44px }` and the touch minimum silently never
 * applies. Measured: a mode button written `kub-button min-h-9` came out 36px
 * tall on a coarse pointer, exactly as if the class were absent. `h-9` is safe
 * — it sets `height`, and the used height is the larger of the two.
 *
 * This is the same trap as rule 10 of the material notes, pointing the other
 * way now that the layer exists, which is why it is asserted rather than
 * remembered.
 */
const TOUCH_CLASSES = /\b(kub-button|kub-icon-action|kub-field|kub-switch)\b/;

test("no control defeats its own touch class with a smaller min-height utility", () => {
  const files = [
    "artifacts/kub/src/components/chat/ChatInfoPanel.tsx",
    "artifacts/kub/src/components/chat/ChatHeader.tsx",
    "artifacts/kub/src/components/kub/KubModal.tsx",
    "artifacts/kub/src/components/kub/KubButton.tsx",
    "artifacts/kub/src/components/kub/KubHelpNotes.tsx",
    "artifacts/kub/src/components/settings/InfoHint.tsx",
    "artifacts/kub/src/components/sidebar/SettingsModal.tsx",
    "artifacts/kub/src/components/sidebar/AudioSettingsSection.tsx",
  ];
  let checked = 0;
  for (const file of files) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    for (const classes of source.match(/"[^"\n]*"/g) ?? []) {
      if (!TOUCH_CLASSES.test(classes)) continue;
      checked += 1;
      const min = classes.match(/\bmin-h-(\d+)\b/);
      assert.ok(
        !min || Number(min[1]) >= 11,
        `${file}: "min-h-${min?.[1]}" outranks the touch class beside it, so the 44px minimum never applies: ${classes}`,
      );
    }
  }
  assert.ok(checked >= 8, `expected to check a real set of class lists, checked ${checked}`);
});
