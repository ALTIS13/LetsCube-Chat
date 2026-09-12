import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EDGE_ARROW_CLASS,
  edgeScrollStep,
  edgesAt,
  wheelScrollDelta,
} from "../../artifacts/kub/src/hooks/useEdgeScroll.ts";

/**
 * A row that scrolls sideways has to say so, and there is one mechanism for it.
 *
 * D-156: the search type-filter row put nine pills in a 360px column behind
 * `overflow-x-auto no-scrollbar` — no bar, no fade, no arrow. A reader saw
 * «Все, Люди, Боты, Чаты, Со…» and the remaining four types did not exist as
 * far as the interface was concerned; with a mouse and no horizontal wheel
 * there was nothing to grab at all. `FolderTabs` had solved exactly this in
 * this product long before, so the fix was to lift its mechanism into
 * `useEdgeScroll` and have both rows wear it.
 *
 * Two different things are held here, and the second is the one that rots:
 *
 *  - the **arithmetic**, imported and run, because a step or an edge threshold
 *    is a number and a number can simply be asserted;
 *  - the **absence of a second copy**. A row that reimplements the listener,
 *    the observer and the step next door would pass every visual check on the
 *    day it was written and drift from the other row forever after. So the two
 *    consumers are required to be consumers: the mechanism's own signatures
 *    must appear in the hook and nowhere else.
 *
 * `FolderTabs` is shipped and stable, so the arrow's class strings are pinned
 * to the exact strings it used to write inline. This file is one half of
 * «FolderTabs is unchanged»; the other is `tests/e2e/desktop-shell.spec.ts`,
 * which drives the rail and the strip.
 */

const SRC = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const HOOK = `${SRC}hooks/useEdgeScroll.ts`;
const FOLDER_TABS = `${SRC}components/sidebar/FolderTabs.tsx`;
const SEARCH = `${SRC}components/search/SearchShared.tsx`;

const read = (file) => readFileSync(file, "utf8");

/**
 * Rule 9 of the material contract. The comments in all three files describe the
 * mechanism in prose — «a scroll listener», «a `ResizeObserver`» — and a checker
 * that read prose as code would report the shared hook as a second copy of
 * itself. Writing down the reason would then be the thing that broke the test.
 */
const blankComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

// ── the checkers, as pure functions so a mutation can be run through them ────

/**
 * The mechanism's fingerprints. Each is a line you cannot write the behaviour
 * without: the listener that keeps the edges current, the observer that catches
 * a resize, the arithmetic of "how much room is left", the step, and the
 * programmatic scroll an arrow performs.
 */
const FINGERPRINTS = [
  ['a scroll listener', /addEventListener\(\s*"scroll"/],
  ['a ResizeObserver', /new ResizeObserver\(/],
  // Either spelling: the hook does this arithmetic on destructured numbers, and
  // a row growing its own copy would do it on the element — `el.scrollWidth -
  // el.clientWidth`, which is how `FolderTabs` itself wrote it before the lift.
  ['the room-left arithmetic', /scrollWidth\s*-\s*(?:\w+\.)?clientWidth/],
  ['the 120px step floor', /Math\.max\(\s*120/],
  ['a programmatic scroll', /scrollBy\(/],
];

function fingerprintsIn(text) {
  const body = blankComments(text);
  return FINGERPRINTS.filter(([, pattern]) => pattern.test(body)).map(([name]) => name);
}

/** A file that reads the shared mechanism rather than owning one. */
function consumesHook(text) {
  return /from "@\/hooks\/useEdgeScroll"/.test(blankComments(text)) && /useEdgeScroll[<(]/.test(blankComments(text));
}

/**
 * An arrow on each side, each gated on the side actually having somewhere to
 * go. Both halves matter: an ungated arrow is a control that does nothing at
 * the end of the row, and a gate with no arrow is the defect itself.
 */
function arrowsOn(text) {
  const body = blankComments(text);
  return {
    left: /\{canScrollLeft\s*&&/.test(body) && /arrowProps\(\s*"left"/.test(body),
    right: /\{canScrollRight\s*&&/.test(body) && /arrowProps\(\s*"right"/.test(body),
  };
}

/**
 * The opening tag of the element carrying the filter row's test id.
 *
 * The scrolling element is what a spec, a screenshot harness and a screen
 * reader are all pointed at. Adding a positioning wrapper around it is right;
 * letting the wrapper inherit the identity is not — the id would then name a
 * box that never scrolls, and every locator would still resolve.
 */
function filterRowScroller(text) {
  const body = blankComments(text);
  const at = body.indexOf('data-testid="search-type-filters"');
  if (at < 0) return null;
  return body.slice(body.lastIndexOf("<div", at), body.indexOf(">", at) + 1);
}

// ── the arithmetic ──────────────────────────────────────────────────────────

test("the step is a proportion of the row with a floor under it", () => {
  // The proportion, so one press means the same thing in a wide row and a
  // narrow one.
  assert.equal(edgeScrollStep(1000), 600);
  assert.equal(edgeScrollStep(500), 300);

  // The floor, so that in a column this narrow a press still clears a pill
  // instead of nudging. 200 * 0.6 = 120 is exactly where the two meet.
  assert.equal(edgeScrollStep(200), 120);
  assert.equal(edgeScrollStep(150), 120);
  assert.equal(edgeScrollStep(0), 120);
});

test("an edge is offered only where there is somewhere to go", () => {
  // A row that fits: neither arrow, whatever the reader does.
  assert.deepEqual(edgesAt({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }), {
    canScrollLeft: false,
    canScrollRight: false,
  });

  // At the start of a row that overflows: forward only.
  assert.deepEqual(edgesAt({ scrollLeft: 0, scrollWidth: 900, clientWidth: 360 }), {
    canScrollLeft: false,
    canScrollRight: true,
  });

  // In the middle: both.
  assert.deepEqual(edgesAt({ scrollLeft: 200, scrollWidth: 900, clientWidth: 360 }), {
    canScrollLeft: true,
    canScrollRight: true,
  });

  // At the end: back only.
  assert.deepEqual(edgesAt({ scrollLeft: 540, scrollWidth: 900, clientWidth: 360 }), {
    canScrollLeft: true,
    canScrollRight: false,
  });
});

/**
 * The 1px slack, which is not decoration. A scroller at its end can come to
 * rest a fraction of a pixel short of `scrollWidth - clientWidth` under a
 * fractional layout or a device pixel ratio that is not 1, and without the
 * slack an arrow stays lit on a row that cannot move — a control that answers
 * a press by doing nothing.
 */
test("a fractional resting place does not leave a dead arrow lit", () => {
  assert.equal(edgesAt({ scrollLeft: 539.6, scrollWidth: 900, clientWidth: 360 }).canScrollRight, false);
  assert.equal(edgesAt({ scrollLeft: 0.4, scrollWidth: 900, clientWidth: 360 }).canScrollLeft, false);
});

test("a vertical wheel scrolls the row, and a horizontal gesture is left alone", () => {
  // Most mice have no horizontal wheel, so without this the row cannot be
  // reached by wheel at all.
  assert.equal(wheelScrollDelta(0, 120), 120);
  assert.equal(wheelScrollDelta(0, -120), -120);

  // A trackpad reporting a real horizontal delta is already scrolling the row;
  // adding deltaY on top would fight the gesture.
  assert.equal(wheelScrollDelta(120, 10), 0);
  assert.equal(wheelScrollDelta(-120, 10), 0);

  // A diagonal gesture belongs to whichever axis dominates.
  assert.equal(wheelScrollDelta(10, 120), 120);
});

// ── one mechanism, two rows ─────────────────────────────────────────────────

test("the mechanism lives in the hook", () => {
  assert.deepEqual(
    fingerprintsIn(read(HOOK)),
    FINGERPRINTS.map(([name]) => name),
    "the shared hook no longer holds the whole mechanism",
  );
});

for (const [label, file] of [
  ["the folder strip", FOLDER_TABS],
  ["the search type-filter row", SEARCH],
]) {
  test(`${label} consumes the shared mechanism`, () => {
    assert.equal(consumesHook(read(file)), true, `${label} does not read useEdgeScroll`);
  });

  test(`${label} keeps no copy of the mechanism of its own`, () => {
    assert.deepEqual(
      fingerprintsIn(read(file)),
      [],
      `${label} reimplements part of the scroll mechanism beside the shared hook; two copies drift`,
    );
  });

  test(`${label} offers an arrow on each side, gated on that side`, () => {
    assert.deepEqual(arrowsOn(read(file)), { left: true, right: true });
  });
}

/**
 * The exact strings `FolderTabs` shipped, so lifting them into the hook cannot
 * have changed a pixel of it. The fade is the panel's own `--glass-fill` rather
 * than a colour chosen to match it, which is rule 1: read from the token it
 * cannot drift when the material changes.
 */
test("the arrow wears the strings the folder strip already shipped", () => {
  assert.equal(
    EDGE_ARROW_CLASS.left,
    "absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center px-1.5 text-[color:var(--kub-muted)] hover:text-[color:var(--kub-cyan)] transition-colors bg-gradient-to-r from-[var(--glass-fill)] from-60% to-transparent",
  );
  assert.equal(
    EDGE_ARROW_CLASS.right,
    "absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center px-1.5 text-[color:var(--kub-muted)] hover:text-[color:var(--kub-cyan)] transition-colors bg-gradient-to-l from-[var(--glass-fill)] from-60% to-transparent",
  );
});

/**
 * Rule 11: neither arrow draws a perimeter, and rule 5: neither rests on a
 * veil. They sit on a gradient of the panel's fill and answer the cursor by
 * changing the chevron's colour.
 */
test("the arrow adds no border and no resting veil", () => {
  for (const [side, classes] of Object.entries(EDGE_ARROW_CLASS)) {
    assert.doesNotMatch(classes, /\bborder(-|\b)/, `the ${side} arrow draws a perimeter`);
    assert.doesNotMatch(classes, /(^|\s)kub-raise(\s|$)/, `the ${side} arrow rests on a veil`);
  }
});

test("the filter row's identity stays on the element that scrolls", () => {
  const tag = filterRowScroller(read(SEARCH));
  assert.ok(tag, "nothing in the search surface carries the filter row's test id");
  assert.match(tag, /ref=\{scrollRef\}/, "the test id is on a box that does not scroll");
  assert.match(tag, /onWheel=\{handleWheel\}/, "the scrolling row takes no wheel");
  assert.match(tag, /overflow-x-auto/, "the row with the test id is not the scroller");
});

test("the search row's arrows are labelled for filters, not for folders", () => {
  const body = blankComments(read(SEARCH));
  assert.match(body, /arrowProps\("left", "Прокрутить фильтры влево"\)/);
  assert.match(body, /arrowProps\("right", "Прокрутить фильтры вправо"\)/);
});

// ── mutation: each guarantee is proved by breaking it ───────────────────────

/**
 * Apply one substitution to a copy of a file's text and prove it applied by the
 * hash rather than by looking for the anchor afterwards — an insertion leaves
 * the anchor in place and would report success either way. A non-unique anchor
 * is refused rather than guessed at.
 */
function mutate(text, anchor, replacement) {
  const occurrences = text.split(anchor).length - 1;
  assert.equal(occurrences > 0, true, `anchor absent: ${anchor.slice(0, 60)}`);
  assert.equal(occurrences, 1, `anchor is not unique (${occurrences}x): ${anchor.slice(0, 60)}`);
  const before = createHash("sha256").update(text).digest("hex");
  const mutated = text.replace(anchor, replacement);
  assert.notEqual(
    createHash("sha256").update(mutated).digest("hex"),
    before,
    "the substitution left the file byte-identical",
  );
  return mutated;
}

/** The defect exactly as it was filed: a clipped row with no arrow at its end. */
test("the arrow guarantee fails when the row goes back to clipping in silence", () => {
  const text = read(SEARCH);
  assert.deepEqual(arrowsOn(text), { left: true, right: true });

  const noRight = mutate(text, "{canScrollRight && (", "{false && (");
  assert.deepEqual(arrowsOn(noRight), { left: true, right: false });

  const noLeft = mutate(text, "{canScrollLeft && (", "{false && (");
  assert.deepEqual(arrowsOn(noLeft), { left: false, right: true });
});

/** The duplication the defect report refused: a second copy beside the hook. */
test("the single-mechanism guarantee fails when a row grows its own copy", () => {
  const text = read(SEARCH);
  assert.deepEqual(fingerprintsIn(text), []);
  const copied = mutate(
    text,
    "  const { scrollRef, canScrollLeft, canScrollRight, handleWheel, arrowProps } = useEdgeScroll<HTMLDivElement>({",
    [
      "  const ro = new ResizeObserver(() => undefined);",
      '  el.addEventListener("scroll", ro);',
      "  const max = el.scrollWidth - el.clientWidth;",
      "  el.scrollBy({ left: Math.max(120, el.clientWidth * 0.6) });",
      "  const { scrollRef, canScrollLeft, canScrollRight, handleWheel, arrowProps } = useEdgeScroll<HTMLDivElement>({",
    ].join("\n"),
  );
  assert.deepEqual(
    fingerprintsIn(copied).sort(),
    FINGERPRINTS.map(([name]) => name).sort(),
    "a row reimplementing the whole mechanism was not noticed",
  );
});

test("the consumer guarantee fails when a row stops reading the hook", () => {
  const text = read(FOLDER_TABS);
  assert.equal(consumesHook(text), true);
  const broken = mutate(text, 'import { useEdgeScroll } from "@/hooks/useEdgeScroll";', "");
  assert.equal(consumesHook(broken), false);
});

test("the identity guarantee fails when the test id moves off the scroller", () => {
  const text = read(SEARCH);
  assert.match(filterRowScroller(text), /ref=\{scrollRef\}/);
  // The wrapper takes the id and the scroller loses it, which is the shape that
  // keeps every locator resolving while pointing at a box that never moves.
  const moved = mutate(
    text,
    '    <div className={cn("relative flex items-center", compact ? "px-3 py-2" : "mt-2 pb-0.5")}>',
    '    <div data-testid="search-type-filters" className={cn("relative flex items-center", compact ? "px-3 py-2" : "mt-2 pb-0.5")}>',
  );
  assert.doesNotMatch(
    filterRowScroller(moved),
    /ref=\{scrollRef\}/,
    "the id was taken by a wrapper and the checker did not notice",
  );
});

/**
 * The arrows are a wide-screen affordance, and the gate belongs to the filter
 * row alone.
 *
 * At 390 the chevron is drawn over the pill text — «Соо⟩» at rest, «⟨оди» with
 * «Сообщения» chosen, in both themes. The arrow box is about 26px, so the
 * `from-60%` fade has no room to reach transparency, and `--glass-fill` is
 * translucent: over a filled pill it conceals nothing. A phone drags the row
 * instead, which is what Telegram offers there, so the arrows go.
 *
 * `FolderTabs` shipped with its arrows at every width. Curing this row by
 * changing that one would be a second fault, so the gate lives in the consumer
 * and this asserts, in both directions, that it stayed there.
 */
test("the filter row hides its arrows below md, and the folder strip does not", () => {
  const gates = (file) => (blankComments(read(file)).match(/hidden md:flex/g) ?? []).length;
  assert.equal(gates(SEARCH), 2, "both of the filter row's arrows should be hidden below md");
  assert.equal(
    gates(FOLDER_TABS),
    0,
    "the folder strip shipped its arrows at every width; the gate must not spread to it",
  );
});

test("the gate guarantee fails when an arrow goes back to showing on a phone", () => {
  const text = blankComments(read(SEARCH));
  assert.equal((text.match(/hidden md:flex/g) ?? []).length, 2);
  const broken = text.replace(/hidden md:flex/, "flex");
  assert.notEqual(broken, text, "the substitution did not apply");
  assert.equal(
    (broken.match(/hidden md:flex/g) ?? []).length,
    1,
    "the checker did not notice an arrow losing its gate",
  );
});
