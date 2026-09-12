import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { clearTypeSyntax, parseAdvancedSearchQuery } from "../../artifacts/kub/src/lib/searchQuery.ts";

/**
 * The type filters are a control again.
 *
 * `SEARCH_FILTERS` — nine selectable result types — sat in `SearchShared.tsx`
 * with **no consumer at all** after `GlobalSearchPalette` was deleted on
 * 2026-09-12. The list was still exported, still typed, still correct, and
 * nothing rendered it: the only way left to narrow results by type was to type
 * `type:message` into the query by hand, which nothing in the interface offers
 * or explains. The owner asked for search that separates the kinds of result
 * *and* filters them; the separating was done by the section headings and the
 * filtering had quietly stopped existing.
 *
 * What is pinned here is the wiring, because the wiring is what rotted. A row
 * of pills that renders but is seeded from a constant would look exactly right
 * in a screenshot and filter nothing, which is the shape of the defect this
 * file exists to catch.
 */

const SRC = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const SHARED = `${SRC}components/search/SearchShared.tsx`;
const SURFACE = `${SRC}components/search/SidebarSearchResults.tsx`;

const read = (file) => readFileSync(file, "utf8");

/**
 * Rule 9 of the material contract, and it bites here specifically: the comment
 * above `SearchTypeFilters` explains why `text-white` on the accent is refused
 * and why a resting veil beside a hover veil is a hover that has stopped
 * existing. A checker that read prose as markup would report both as defects,
 * and writing the reason down would be the thing that broke the test.
 */
const blankComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every quoted string in a source file, which is where class lists live. */
const strings = (text) => [...text.matchAll(/(["'`])([^"'`\n]*?)\1/g)].map((m) => m[2]);

// ── the checkers, as pure functions so a mutation can be run through them ────

/**
 * References to the list that are not its own declaration. This is the defect
 * stated directly: the count was zero.
 */
function consumersOfSearchFilters(text) {
  const body = blankComments(text);
  return [...body.matchAll(/SEARCH_FILTERS/g)].filter((match) => {
    const line = body.slice(body.lastIndexOf("\n", match.index) + 1, body.indexOf("\n", match.index));
    return !/export const SEARCH_FILTERS/.test(line);
  });
}

/** The surface seeds the parse from state rather than from a literal. */
function seedsParseFromState(text) {
  const call = blankComments(text).match(/parseSearchTypeSyntax\(([^)]*)\)/);
  if (!call) return null;
  const second = call[1].split(",")[1]?.trim();
  return second ?? null;
}

/** The surface renders the row at all. */
function rendersTypeFilters(text) {
  return /<SearchTypeFilters\b/.test(blankComments(text));
}

/**
 * A resting veil on something that also veils on hover. Rule 5: a hover step
 * equal to the resting step measured 1.002 — the hover had stopped existing.
 */
function restingVeilWithHoverVeil(text) {
  return strings(blankComments(text)).filter(
    (s) => /(^|\s)kub-raise(\s|$)/.test(s) && s.includes("kub-raise-hover"),
  );
}

/** White on the accent: 3.55:1, where this product has a measured pair. */
function whiteOnAccent(text) {
  return strings(blankComments(text)).filter(
    (s) => /\btext-white\b/.test(s) && /bg-\[(?:color:)?var\(--kub-cyan\)\]/.test(s),
  );
}

// ── the pure half: how the two ways of choosing a type resolve ──────────────

test("a pill seeds the type, and a typed token overrides it", () => {
  // No token: the selection is what filters.
  assert.equal(parseAdvancedSearchQuery("смета", "message").filters.type, "message");
  assert.equal(parseAdvancedSearchQuery("смета", "all").filters.type, "all");

  // A token in the text wins, whatever the pill says. It is the half a person
  // can see — it renders a removable chip — so the alternative would be a chip
  // claiming a filter that is not applied.
  assert.equal(parseAdvancedSearchQuery("type:chat смета", "message").filters.type, "chat");
  assert.equal(parseAdvancedSearchQuery("type:chat смета", "all").filters.type, "chat");
});

test("clearing the type syntax takes every type token out and leaves the rest", () => {
  const parsed = parseAdvancedSearchQuery("type:chat from:@anna has:image смета", "all");
  const stripped = clearTypeSyntax(parsed);

  assert.equal(stripped.includes("type:chat"), false, "the type token survived the strip");
  assert.equal(stripped.includes("from:@anna"), true, "an unrelated chip was taken with it");
  assert.equal(stripped.includes("has:image"), true, "an unrelated chip was taken with it");
  assert.equal(stripped.includes("смета"), true, "the query itself was taken with it");

  // And the stripped query really does stop filtering by the old type: it is
  // the selection that decides once the token is gone.
  assert.equal(parseAdvancedSearchQuery(stripped, "task").filters.type, "task");
});

test("clearing is a no-op when there is no type token to clear", () => {
  const parsed = parseAdvancedSearchQuery("from:@anna смета", "user");
  assert.equal(clearTypeSyntax(parsed), parsed.raw);
});

/**
 * More than one token, which is where an offset-based removal goes wrong if it
 * runs forwards: every range after the first would then index text that had
 * already moved.
 */
test("clearing survives more than one type token", () => {
  const parsed = parseAdvancedSearchQuery("type:chat смета type:task", "all");
  const stripped = clearTypeSyntax(parsed);
  assert.equal(/type:/.test(stripped), false, `a type token survived: ${stripped}`);
  assert.equal(stripped.includes("смета"), true);
});

// ── the wiring half ─────────────────────────────────────────────────────────

test("the filter list has a consumer", () => {
  const found = consumersOfSearchFilters(read(SHARED));
  assert.ok(
    found.length > 0,
    "SEARCH_FILTERS is exported and nothing renders it; that is the defect, and the only way to filter by type is then to type the syntax by hand",
  );
});

test("the sidebar search surface renders the row", () => {
  assert.equal(rendersTypeFilters(read(SURFACE)), true, "the type filter row is not mounted on the search surface");
});

test("the row is wired to the parse rather than decorating it", () => {
  const second = seedsParseFromState(read(SURFACE));
  assert.ok(second, "parseSearchTypeSyntax is not called on the search surface at all");
  assert.notEqual(
    second,
    '"all"',
    "the parse is seeded from a literal, so a pill can be pressed and change nothing — the row would look right and filter nothing",
  );
  assert.equal(second, "selectedType", "the parse should be seeded from the selected type");
});

test("the pills speak the product's measured colour and elevation", () => {
  const shared = read(SHARED);
  assert.deepEqual(whiteOnAccent(shared), [], "white on --kub-cyan is 3.55:1; the measured pair is --kub-bg");
  assert.deepEqual(
    restingVeilWithHoverVeil(shared),
    [],
    "a resting kub-raise beside kub-raise-hover is rule 5's 1.002: the hover stops existing",
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

test("the consumer guarantee fails when the row stops reading the list", () => {
  const text = read(SHARED);
  assert.ok(consumersOfSearchFilters(text).length > 0);
  const broken = mutate(text, "{SEARCH_FILTERS.map((filter) => {", "{[].map((filter) => {");
  assert.equal(
    consumersOfSearchFilters(broken).length,
    0,
    "the checker did not notice the list losing its only consumer",
  );
});

test("the mounting guarantee fails when the row is taken off the surface", () => {
  const text = read(SURFACE);
  assert.equal(rendersTypeFilters(text), true);
  const broken = mutate(
    text,
    "<SearchTypeFilters active={parsed.filters.type}",
    "<SearchFilterChipsPlaceholder active={parsed.filters.type}",
  );
  assert.equal(rendersTypeFilters(broken), false);
});

/**
 * The exact regression this file is for: the row still renders, the pills still
 * highlight, and the parse is seeded from a constant — so pressing one filters
 * nothing. This is what the code said before the row existed.
 */
test("the wiring guarantee fails when the parse is seeded from a literal again", () => {
  const text = read(SURFACE);
  assert.equal(seedsParseFromState(text), "selectedType");
  const broken = mutate(
    text,
    "parseSearchTypeSyntax(trimmedQuery, selectedType)",
    'parseSearchTypeSyntax(trimmedQuery, "all")',
  );
  assert.equal(seedsParseFromState(broken), '"all"');
});

test("the colour guarantee fails when white goes back on the accent", () => {
  const text = read(SHARED);
  assert.equal(whiteOnAccent(text).length, 0);
  const broken = mutate(
    text,
    "? `bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] ${PRESS_FILLED}`",
    "? `bg-[var(--kub-cyan)] text-white ${PRESS_FILLED}`",
  );
  assert.equal(whiteOnAccent(broken).length, 1);
});

test("the elevation guarantee fails when a resting veil takes a hover veil beside it", () => {
  const text = read(SHARED);
  assert.equal(restingVeilWithHoverVeil(text).length, 0);
  const broken = mutate(
    text,
    ": `kub-raise text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)] ${PRESS_SINK_RAISED}`",
    ": `kub-raise kub-raise-hover text-[color:var(--kub-muted)] ${PRESS_SINK_RAISED}`",
  );
  assert.equal(restingVeilWithHoverVeil(broken).length, 1);
});
