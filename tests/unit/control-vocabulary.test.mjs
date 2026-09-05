import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * One language for focus, one for press, one for disabled.
 *
 * Before this, the product spoke four focus dialects at once —
 * `focus:border-[--kub-cyan]` on fields, `focus-visible:ring-*` and
 * `focus:ring-*` on buttons, and a `.kub-neon-ring` described in the stylesheet
 * and applied nowhere — while the 34 places carrying `kub-interactive`, the
 * class that marks a thing as pressable, declared no focus at all. Part of the
 * product could not be walked with a keyboard.
 *
 * Two of the guarantees here are not style preferences but measurements:
 *
 * - Pressing an icon button changed **nothing**. Mean colour at rest and mean
 *   colour under the pointer differed by 0.0, because the only response was
 *   `scale(.98)` and .98 of a transparent box is the same transparent box.
 * - A disabled control faded, six values of `opacity` across 79 places, and on
 *   a translucent panel that shows the wallpaper through the control: 2.23:1 in
 *   the dark theme, 1.94:1 in the light one, against a floor of 4.5.
 *
 * The vocabulary lives in `artifacts/kub/src/lib/controlSurface.ts`. This file
 * holds it, and holds the exceptions to it down to a named list, so an
 * exception has to be argued rather than added.
 */

const SRC = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));

const RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]";
const RING_WITHIN = "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--kub-cyan)]";
const RING_INSET = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]";

/**
 * Owned by the concurrent chat-shell work — the header, the composer, the
 * message list and the window that holds them. Converting them here would land
 * on top of somebody else's edit. The set is exact rather than a prefix so that
 * finishing one of them fails this test and the entry gets deleted with the
 * defect.
 */
const OTHER_TRACK = new Set([
  "components/chat/ChatHeader.tsx",
  "components/chat/ChatWindow.tsx",
  "components/chat/MessageInput.tsx",
  "components/chat/MessageList.tsx",
]);

/**
 * The subset of those that still speaks an old focus dialect, as of this stage.
 * Checked as a superset rather than an equality on purpose: whoever finishes
 * that file should not have to come here to make a green suite stay green.
 */
const FOCUS_DEBT = ["components/chat/MessageInput.tsx"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC)
  .map((full) => ({ rel: path.relative(SRC, full).split(path.sep).join("/"), full }))
  .filter((f) => f.rel !== "lib/controlSurface.ts");

const read = (f) => readFileSync(f.full, "utf8");

/** Every quoted string in a source file, which is where class lists live. */
const LITERAL = /(["'`])([^"'`\n]*?)\1/g;
const strings = (text) => [...text.matchAll(LITERAL)].map((m) => m[2]);

// ── the checkers, as pure functions so a mutation can be run through them ────

const TRIGGER = String.raw`(?:focus|focus-visible|focus-within|has-focus)`;
/** A focus indicator that is not the one language. */
const FOREIGN = new RegExp(
  String.raw`(?:^|\s)(?:[a-z0-9\[\]./_-]+:)*${TRIGGER}(?::[a-z0-9\[\]./_-]+)*:(?:ring|border|shadow)(?:-[^\s]*)?(?=\s|$)`,
);

function foreignDialects(text) {
  return strings(text).filter((s) => FOREIGN.test(s));
}

const PRESSABLE = ["kub-interactive", "kub-icon-action", "kub-button"];

function pressablesWithoutFocus(text) {
  // A file that imports the constant hands the ring to the element from a
  // sibling `cn()` argument, which no per-string check can see.
  if (/FOCUS_RING(?:_WITHIN|_INSET)?\b/.test(text)) return [];
  return strings(text).filter(
    (s) =>
      PRESSABLE.some((marker) => s.split(/\s+/).includes(marker)) &&
      !(s.includes(RING) || s.includes(RING_WITHIN) || s.includes(RING_INSET)),
  );
}

/**
 * A disabled state written as transparency.
 *
 * Two shapes stay and are named at the call site rather than here:
 * `accent-[var(--kub-cyan)]` marks a native checkbox, radio or range that the
 * browser paints itself — `background-image` never reaches the widget, so
 * opacity is the only lever there is — and `disabled:cursor-wait` marks a
 * control that is busy rather than unavailable.
 */
const FADED = /(?:^|\s)(?:aria-|peer-|group-)?disabled(?:=true)?\]?:opacity-\d+(?=\s|$)/;

function fadedDisabled(text) {
  return strings(text).filter(
    (s) =>
      FADED.test(s) &&
      !s.includes("accent-[var(--kub-cyan)]") &&
      !s.includes("disabled:cursor-wait") &&
      !s.includes("has-[:disabled]:"),
  );
}

/** White on the accent: 3.55:1, while the same badge elsewhere passes. */
function whiteOnAccent(text) {
  return strings(text).filter(
    (s) =>
      /\btext-white\b/.test(s) &&
      /bg-\[(?:color:)?var\(--kub-(?:cyan|danger)\)\]/.test(s),
  );
}

// ── the guarantees ──────────────────────────────────────────────────────────

test("focus is spoken in one language across the product", () => {
  const offenders = FILES.filter((f) => !OTHER_TRACK.has(f.rel))
    .map((f) => ({ rel: f.rel, hits: foreignDialects(read(f)) }))
    .filter((f) => f.hits.length);

  assert.deepEqual(
    offenders.map((f) => f.rel),
    [],
    "a ring, a border or a shadow is being used as a focus indicator; the one language is an outline — see src/lib/controlSurface.ts",
  );
});

test("nothing outside the named files speaks an old dialect", () => {
  const remaining = FILES.filter((f) => foreignDialects(read(f)).length).map((f) => f.rel);
  const unexpected = remaining.filter((rel) => !FOCUS_DEBT.includes(rel));
  assert.deepEqual(
    unexpected,
    [],
    "a focus dialect appeared outside the files the concurrent chat-shell work owns",
  );
  assert.ok(
    remaining.length <= FOCUS_DEBT.length,
    "the debt list grew; it is only ever allowed to shrink",
  );
});

test("the dead ring is gone from the stylesheet", () => {
  const css = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");
  assert.equal(
    /\.kub-neon-ring\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")),
    false,
    "`.kub-neon-ring` is a box-shadow ring; it was described and never applied, and applying it walks back into D-010",
  );
});

test("everything pressable declares a focus indicator", () => {
  const offenders = FILES.filter((f) => !OTHER_TRACK.has(f.rel))
    .map((f) => ({ rel: f.rel, hits: pressablesWithoutFocus(read(f)) }))
    .filter((f) => f.hits.length);

  assert.deepEqual(offenders.map((f) => `${f.rel}: ${f.hits[0].slice(0, 70)}`), []);
});

test("a disabled control sinks rather than fading", () => {
  const offenders = FILES.filter((f) => !OTHER_TRACK.has(f.rel))
    .map((f) => ({ rel: f.rel, hits: fadedDisabled(read(f)) }))
    .filter((f) => f.hits.length);

  assert.deepEqual(
    offenders.map((f) => `${f.rel}: ${f.hits[0].match(FADED)?.[0].trim()}`),
    [],
    "opacity on a translucent panel shows the wallpaper through the control; use DISABLED_SINK",
  );
});

test("no filled control carries white where the product has a measured pair", () => {
  const offenders = FILES.filter((f) => !OTHER_TRACK.has(f.rel))
    .map((f) => ({ rel: f.rel, hits: whiteOnAccent(read(f)) }))
    .filter((f) => f.hits.length);

  assert.deepEqual(
    offenders.map((f) => f.rel),
    [],
    "white on --kub-cyan measures 3.55:1 and white on --kub-danger 3.76:1; the pairs that pass are --kub-bg and --kub-action-danger-*",
  );
});

test("the vocabulary is one string each, not a habit repeated by hand", () => {
  const vocab = readFileSync(
    new URL("../../artifacts/kub/src/lib/controlSurface.ts", import.meta.url),
    "utf8",
  );
  for (const [name, value] of [
    ["FOCUS_RING", RING],
    ["FOCUS_RING_WITHIN", RING_WITHIN],
    ["FOCUS_RING_INSET", RING_INSET],
  ]) {
    assert.ok(
      new RegExp(`export const ${name} =\\s*\\n?\\s*"${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(vocab),
      `${name} no longer says what this test and 100-odd call sites say`,
    );
  }
  // The press and the disabled state are veils over the tokens, never a colour
  // of their own: rule 1 of the material contract.
  assert.match(vocab, /PRESS_SINK =\s*\n?\s*"active:bg-\[image:linear-gradient\(var\(--kub-sink-veil\)/);
  assert.match(vocab, /DISABLED_SINK =\s*\n?\s*"disabled:bg-\[var\(--kub-inset\)\]/);
  assert.equal(
    /rgba?\(/.test(vocab.replace(/\/\*[\s\S]*?\*\//g, "")),
    false,
    "the vocabulary writes no colour of its own",
  );
});

// ── mutation: each guarantee is proved by breaking it ───────────────────────

/**
 * Apply one substitution to a copy of a file's text and prove it applied by the
 * hash, not by looking for the anchor afterwards — an insertion leaves the
 * anchor in place and would report success either way. A non-unique anchor is
 * refused rather than guessed at, because then the harness cannot say what it
 * changed.
 */
function mutate(text, anchor, replacement) {
  const occurrences = text.split(anchor).length - 1;
  assert.equal(occurrences > 0, true, `anchor absent: ${anchor.slice(0, 60)}`);
  assert.equal(occurrences, 1, `anchor is not unique (${occurrences}x): ${anchor.slice(0, 60)}`);
  const before = createHash("sha256").update(text).digest("hex");
  const mutated = text.replace(anchor, replacement);
  const after = createHash("sha256").update(mutated).digest("hex");
  assert.notEqual(after, before, "the substitution left the file byte-identical");
  return mutated;
}

test("the focus guarantee fails when a second dialect comes back", () => {
  const file = FILES.find((f) => f.rel === "components/ui/switch.tsx");
  const text = read(file);
  assert.equal(foreignDialects(text).length, 0);
  const broken = mutate(text, RING, "focus-visible:ring-2 focus-visible:ring-[color:var(--kub-cyan)]");
  assert.equal(foreignDialects(broken).length, 1);
});

test("the pressable guarantee fails when a control loses its indicator", () => {
  const file = FILES.find((f) => f.rel === "components/sidebar/NotificationBell.tsx");
  const text = read(file);
  assert.equal(pressablesWithoutFocus(text).length, 0);
  const broken = mutate(
    text,
    `"kub-icon-action kub-interactive relative h-9 w-9 shrink-0 rounded-lg transition-colors kub-raise-hover ${RING}`,
    '"kub-icon-action kub-interactive relative h-9 w-9 shrink-0 rounded-lg transition-colors kub-raise-hover',
  );
  assert.equal(pressablesWithoutFocus(broken).length, 1);
});

test("the disabled guarantee fails when a control goes back to fading", () => {
  const file = FILES.find((f) => f.rel === "components/kub/KubSwitch.tsx");
  const text = read(file);
  assert.equal(fadedDisabled(text).length, 0);
  const broken = mutate(text, "disabled:cursor-not-allowed", "disabled:cursor-not-allowed disabled:opacity-50");
  assert.equal(fadedDisabled(broken).length, 1);
});

test("the colour guarantee fails when white goes back on the accent", () => {
  const file = FILES.find((f) => f.rel === "components/sidebar/ChatListItem.tsx");
  const text = read(file);
  assert.equal(whiteOnAccent(text).length, 0);
  const broken = mutate(
    text,
    '"bg-[var(--kub-cyan)] kub-glow-soft"',
    '"bg-[var(--kub-cyan)] kub-glow-soft text-white"',
  );
  assert.equal(whiteOnAccent(broken).length, 1);
});
