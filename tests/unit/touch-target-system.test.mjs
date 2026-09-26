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

/**
 * The one control in the capsule that is held rather than tapped.
 *
 * Push-to-talk is where the 32px strip stops being a defensible bargain: a
 * finger rests on it for a whole sentence, and sliding off it publishes
 * nothing while the person keeps speaking. The floor is given as hit area
 * only -- `inset-block: -6px` on an empty pseudo-element over a 32px control
 * is 44 -- because raising the control itself would push the capsule's row
 * and take the room's name below what is left of it at 390.
 *
 * Both halves again, and here the negative one is the point of the design:
 * growing the painted control is precisely the change not made.
 */
test("the held control reaches the target without the paint moving", () => {
  const coarse = coarseRule(".kub-hold-target::after");
  assert.match(coarse, /inset-block:\s*-6px/, "the area a finger gets is not 32 + 6 + 6");
  assert.match(coarse, /content:\s*""/, "a pseudo-element without `content` is never generated");
  assert.match(coarse, /position:\s*absolute/, "in flow it would take space and move the row");
});

test("the held control is 32px on a pointer device, and carries no paint anywhere", () => {
  assert.equal(
    pointerRules(".kub-hold-target::after").length,
    0,
    "the hit area leaked out of the coarse-pointer query onto every device",
  );
  const coarse = coarseRule(".kub-hold-target::after");
  // An invisible target: anything that draws would put a 44px slab behind a
  // 32px pill, which is the layout change this rule exists to avoid.
  for (const property of ["background", "border", "box-shadow", "outline"]) {
    assert.doesNotMatch(
      coarse,
      new RegExp(`\\b${property}`),
      `the hit area paints \`${property}\`, so it is no longer only a hit area`,
    );
  }
});

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
    // The settings screen's markup moved to `components/settings/SettingsScreen.tsx`
    // when D-160 gave it a second form: the list column's panel from `md` and
    // the dialog below it render the same rows from there, so this is where the
    // opt-ins have to be. `SettingsModal.tsx` is now the dialog wrapper alone.
    file: "artifacts/kub/src/components/settings/SettingsScreen.tsx",
    what: "the avatar's camera badge, which was 28x28 and is the only way to change the picture on a phone",
    expect: [/"kub-icon-action absolute -bottom-0\.5 -right-0\.5 h-7 w-7/],
  },
  {
    // The settings screen's markup moved to `components/settings/SettingsScreen.tsx`
    // when D-160 gave it a second form: the list column's panel from `md` and
    // the dialog below it render the same rows from there, so this is where the
    // opt-ins have to be. `SettingsModal.tsx` is now the dialog wrapper alone.
    file: "artifacts/kub/src/components/settings/SettingsScreen.tsx",
    what: "the three theme radios, which were 36x32",
    expect: [/"kub-icon-action h-8 w-9 rounded-md/],
  },
  {
    // The settings screen's markup moved to `components/settings/SettingsScreen.tsx`
    // when D-160 gave it a second form: the list column's panel from `md` and
    // the dialog below it render the same rows from there, so this is where the
    // opt-ins have to be. `SettingsModal.tsx` is now the dialog wrapper alone.
    file: "artifacts/kub/src/components/settings/SettingsScreen.tsx",
    what: "the name, nickname and bio fields, which were 232x36",
    expect: [/"kub-field h-9 w-full min-w-0 rounded-lg/],
  },
  {
    file: "artifacts/kub/src/components/sidebar/AudioSettingsSection.tsx",
    // The three stacked pills became segments of one track on 2026-09-14, and
    // the opt-in moved with them. `min-h-11` rather than the `h-9` that was
    // here: measured at 1440, where the settings column gives a segment 87px
    // and «Без обработки» needs 98.9, the label wraps and a fixed height
    // clipped the second line. 11 is 44px, the same number `.kub-button` asks
    // of a coarse pointer, so this `min-h-*` agrees with the class it outranks
    // rather than defeating it — which is what the test below allows at >= 11.
    what: "the three processing modes, which were 288x36",
    expect: [/"kub-button min-h-11 min-w-0 flex-1 rounded-md px-2 py-1\.5/],
  },
  {
    file: "artifacts/kub/src/components/sidebar/AudioSettingsSection.tsx",
    // It was a text link and is a row now, so the 44px is the row's own
    // `min-h-11` and holds on a pointer as well as on a finger — a stronger
    // answer to D-047 than the coarse-pointer bargain it used to rely on. The
    // class stays beside it so this file keeps one language for "a target".
    what: "the audio reset, which was 162x16 — the smallest target on the screen",
    expect: [/"kub-button grid w-full min-w-0 grid-cols-\[1\.125rem_minmax\(0,1fr\)\] items-center gap-3 px-3 py-2 min-h-11/],
  },
  {
    file: "artifacts/kub/src/components/sidebar/AudioSettingsSection.tsx",
    // `kub-range` beside `kub-field` since 2026-09-18, when the voice-activity
    // threshold joined the two gain sliders in this panel. The touch opt-in is
    // unchanged — `kub-field` is still what carries the 44px for a control
    // whose whole area is the target — and what was added is the empty half of
    // the track: `accent-color` alone leaves it to the browser, which in the
    // dark theme returned a pure neutral grey on a navy panel. Three sliders in
    // one panel drawn two different ways was the alternative.
    what: "the volume sliders, which were 314x16",
    expect: [/className="kub-field kub-range w-full"/],
  },
  {
    file: "artifacts/kub/src/components/chat/VoiceCallCapsule.tsx",
    // The only control in this file that opts in, and deliberately so: the
    // other three are taps on a strip of chrome and keep the 32px the design
    // chose for them. `relative` is load-bearing beside it -- an absolutely
    // positioned pseudo-element with no positioned ancestor resolves against
    // the viewport, and the hit area would land somewhere else entirely.
    what: "hold-to-talk, which was a 32px target for a press held through a sentence",
    expect: [/"kub-hold-target group\/capsule relative h-8 shrink-0 select-none touch-none rounded-full px-2\.5"/],
  },
  {
    file: "artifacts/kub/src/components/chat/VoiceCallBar.tsx",
    // The same mechanism in the other surface. In the chat-list column
    // `.kub-voice-call-bar__extra` carries `overflow: hidden` so the controls
    // can collapse as the column narrows, which clips this area with them --
    // correct, and not where the floor is owed: the phone's band is not in
    // that column.
    what: "hold-to-talk in the bar, which was the same 32px",
    expect: [/"kub-hold-target kub-voice-call-bar__extra group\/capsule relative h-8 shrink-0 select-none touch-none rounded-full"/],
  },
  {
    file: "artifacts/kub/src/components/settings/InfoHint.tsx",
    what: "the icon-only help trigger, which was 13x13",
    expect: [/: "kub-icon-action shrink-0 text-\[color:var\(--kub-muted\)\]/],
  },
  {
    file: "artifacts/kub/src/components/chat/ChatHeader.tsx",
    what: "the chat's back control, which was 36x36 and is the only way back to the list on a phone",
    // The iOS rule shares a layer with other components, so h-11 and the
    // minimum-width utility need literal 48px floors after utilities win.
    expect: [/"(?=[^"\n]*\bkub-icon-action\b)(?=[^"\n]*\bkub-ios-chat-back\b)(?=[^"\n]*\bmin-h-12\b)(?=[^"\n]*\bmin-w-12\b)[^"\n]*"/],
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
    // The screen's own rows, and the surface that renders them — the list
    // column's body from D-160 until D-285, an overlay over the application
    // since.
    "artifacts/kub/src/components/settings/SettingsScreen.tsx",
    "artifacts/kub/src/components/settings/SettingsOverlay.tsx",
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
