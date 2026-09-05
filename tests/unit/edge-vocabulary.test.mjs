import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A border belongs to what you aim at, not to what you look at.
 *
 * Before this, one blue line of one weight was drawn around the panel, around
 * the card inside the panel, around the field inside the card and around the
 * chip beside the field: 276 perimeters and 109 single sides, all from
 * `--kub-border-color`. When everything is outlined the outline stops being a
 * message, and nested boxes of equal weight are the thing that reads as dated.
 *
 * Three separate jobs were being done by one declaration, and they are split
 * here:
 *
 *  - the **edge** of a sheet, and of chrome pinned against a scroll area, which
 *    has to hold against arbitrary content passing under it — keeps
 *    `--kub-border-color`;
 *  - a **rule** between two blocks that share one surface and scroll together —
 *    takes `--kub-rule`, which is a third of the edge's weight;
 *  - a **nested box** inside a sheet — loses its perimeter and is separated by
 *    a step of material instead.
 *
 * Every number below is photographed, not computed from the tokens. The method
 * and the probes are in `output/board/probe-*.mjs`.
 *
 * The threshold for "the object still separates" is not invented: 23 is the
 * step by which a panel in the light theme stands off the page after the ground
 * was moved down (rule 8 of the material contract records 18/13/7 per channel).
 * That is the step this product already treats as enough to see a surface, so a
 * nested box that clears it is as visible as a panel is.
 */

const SRC = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const CSS = fileURLToPath(new URL("../../artifacts/kub/src/index.css", import.meta.url));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC).map((full) => ({
  rel: path.relative(SRC, full).split(path.sep).join("/"),
  full,
}));
const read = (f) => readFileSync(f.full, "utf8");

/** Every quoted string in a source file, which is where class lists live. */
const strings = (text) => [...text.matchAll(/(["'`])([^"'`\n]*?)\1/g)].map((m) => m[2]);
const blankComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const EDGE_COLOUR = "border-[color:var(--kub-border-color)]";
const RULE_COLOUR = "border-[color:var(--kub-rule)]";
const SIDE = /^(?:[a-z-]+:)*border-[trblxy](?:-\d+)?$/;
const WIDTH = /^(?:[a-z-]+:)*border(?:-[0248])?$/;

// ── the checkers, as pure functions so a mutation can be run through them ────

/**
 * Chrome pinned against a scroll area, or the material itself. The test for it
 * is mechanical rather than a matter of taste, and where it is wrong it is
 * wrong towards leaving the heavier line alone.
 */
const CHROME = /\b(sticky|fixed|shrink-0|flex-shrink-0)\b/;
const GLASS = /\bkub-glass(-strong)?\b/;

/**
 * Chrome that says so in the markup around it rather than in its own class
 * list — a header whose scroll area is its sibling, a composer docked under a
 * message list. Each was read in the source before being written down here, so
 * an exception has to be argued rather than added.
 */
const EDGE_BY_HAND = [
  ["components/chat/ChatHeader.tsx", "h-[var(--kub-control-row-height)] items-center gap-1 border-b"],
  ["components/sidebar/SettingsModal.tsx", "kub-grid-subtle"],
  ["components/sidebar/SettingsModal.tsx", "kub-settings-panel border-t"],
  ["pages/public/GuestSupportChat.tsx", "px-4 py-4 sm:px-6"],
  ["pages/public/GuestSupportChat.tsx", "p-3 sm:p-4"],
  ["components/search/GlobalSearchPalette.tsx", "border-b"],
  ["components/search/SearchShared.tsx", "border-b"],
  ["components/search/SidebarSearchResults.tsx", "border-b"],
  ["pages/admin/AdminLayout.tsx", "h-14 border-b"],
  ["pages/admin/support/SupportQueue.tsx", "flex min-h-0 min-w-0 flex-col border-b"],
  ["pages/admin/support/SupportTicketDetails.tsx", "min-h-0 overflow-y-auto border-t"],
];

/** A single-side line still drawn in the sheet-edge colour on something that is
 *  not an edge — which is the defect this stage closed. */
function ruleWearingTheEdgeColour(rel, text) {
  return strings(text).filter((s) => {
    if (!s.includes(EDGE_COLOUR)) return false;
    const toks = s.trim().split(/\s+/);
    if (!toks.some((t) => SIDE.test(t))) return false;
    if (toks.some((t) => WIDTH.test(t))) return false; // a perimeter, not a side
    if (CHROME.test(s) || GLASS.test(s)) return false;
    return !EDGE_BY_HAND.some(([f, needle]) => rel === f && s.includes(needle));
  });
}

/** Perimeters still drawn in the sheet-edge colour, of any kind. */
function perimeters(text) {
  return strings(text).filter((s) => {
    if (!s.includes(EDGE_COLOUR)) return false;
    const toks = s.trim().split(/\s+/);
    return toks.some((t) => WIDTH.test(t)) && !toks.some((t) => SIDE.test(t));
  });
}

/**
 * A colour for a border with no width to colour, checked over the ELEMENT
 * rather than the string.
 *
 * A class list is very often one branch of a ternary inside `cn()`, with the
 * width sitting in the base string beside it — so a per-string check reports
 * two dozen boxes that are drawing their border perfectly well. From the
 * colour, this walks back to the element's opening `<` and forward to the `>`
 * that closes it at brace depth zero, and asks whether a width appears
 * anywhere in between.
 */
/**
 * Any border colour, not only the two this stage moved. The orphan actually
 * created here was `hover:border-[color:var(--kub-cyan)]/40` left behind on a
 * card whose width had just been removed — a narrower pattern would have
 * watched the tokens being edited and missed the one that broke.
 * `border-[1.5px]` and friends are widths written in the arbitrary syntax and
 * are excluded by requiring a non-numeric first character.
 */
const COLOUR_TOKEN = /(?:[a-z-]+:)?border-(?:[trblxy]-)?\[(?:color:)?[a-z#][^\]]*\](?:\/\d+)?/g;

/**
 * Components that draw a border from their own class rather than from a
 * utility, so a `className` handing one a colour and no width is correct.
 * `.kub-panel` sets `border: 1px solid var(--kub-border-color)` in index.css.
 */
const BORDER_FROM_COMPONENT = new Set(["KubPanel"]);

/**
 * Every `className` expression in a file, with the tag it sits on.
 *
 * Scoped to `className` rather than to any string that looks like a class list,
 * because a colour also lives in module-level lookup tables — `KubNotice`'s
 * four tones, `KubBadge`'s six — whose width is written once at the call site.
 * Those are correct and are not this check's business. Both orphans this stage
 * actually produced were a colour and a width in one `className`, with the
 * width taken away.
 */
function classNameExpressions(text) {
  const out = [];
  for (const m of text.matchAll(/className=/g)) {
    let i = m.index + "className=".length;
    let value = "";
    if (text[i] === '"' || text[i] === "'" || text[i] === "`") {
      const quote = text[i];
      const end = text.indexOf(quote, i + 1);
      if (end < 0) continue;
      value = text.slice(i + 1, end);
    } else if (text[i] === "{") {
      let depth = 0;
      for (let j = i; j < text.length && j < i + 6000; j += 1) {
        if (text[j] === "{") depth += 1;
        else if (text[j] === "}") { depth -= 1; if (depth === 0) { value = text.slice(i + 1, j); break; } }
      }
    }
    if (!value) continue;
    let tag = "?";
    for (let j = m.index; j > 0 && j > m.index - 4000; j -= 1) {
      if (text[j] === "<" && /[A-Za-z]/.test(text[j + 1] ?? "")) {
        tag = (text.slice(j).match(/^<([A-Za-z][\w.]*)/) ?? [, "?"])[1];
        break;
      }
    }
    out.push({ tag, value });
  }
  return out;
}

function colourWithoutWidth(text) {
  const out = [];
  for (const { tag, value } of classNameExpressions(text)) {
    if (BORDER_FROM_COMPONENT.has(tag)) continue;
    const colours = [...value.matchAll(COLOUR_TOKEN)].map((m) => m[0]);
    if (!colours.length) continue;
    const hasWidth = value.split(/[\s"'`,{}()]+/).some((t) => WIDTH.test(t) || SIDE.test(t));
    if (!hasWidth) out.push(`${colours[0]} in <${tag}>`);
  }
  return out;
}

// ── the guarantees ──────────────────────────────────────────────────────────

/**
 * `kub-pulse` was a 2s box-shadow loop, `infinite`, on the presence dot of every
 * chat-list row — a frame's work per row, for as long as the list was open,
 * around a fact that does not change while it is shown.
 */
test("nothing pulses around a fact that does not change", () => {
  const css = blankComments(readFileSync(CSS, "utf8"));
  assert.equal(/kub-pulse/.test(css), false, "the pulse keyframes or class came back to index.css");
  const offenders = FILES.filter((f) => /kub-pulse/.test(blankComments(read(f)))).map((f) => f.rel);
  assert.deepEqual(offenders, [], "a presence dot is animating again");
});

test("the rule tone exists in both themes and is not the edge colour", () => {
  const css = readFileSync(CSS, "utf8");
  for (const [theme, expected] of [
    [".dark", "rgba(255, 255, 255, 0.075)"],
    [".light", "rgba(23, 51, 82, 0.10)"],
  ]) {
    const block = css.slice(css.indexOf(`\n${theme} {`));
    const declared = block.slice(0, block.indexOf("\n}")).match(/--kub-rule:\s*([^;]+);/);
    assert.ok(declared, `${theme} declares no --kub-rule`);
    assert.equal(declared[1].trim(), expected, `${theme}'s rule tone moved without a measurement`);
  }
  // The whole point is that the two differ. Pointing one at the other would
  // satisfy every other assertion here while restoring the defect.
  assert.doesNotMatch(css, /--kub-rule:\s*var\(--(kub-)?border-color\)/);
  assert.doesNotMatch(css, /--kub-rule:\s*var\(--brand-border\)/);
});

test("a line between things does not wear the weight of a sheet's edge", () => {
  const offenders = FILES.map((f) => ({ rel: f.rel, hits: ruleWearingTheEdgeColour(f.rel, read(f)) }))
    .filter((f) => f.hits.length);

  assert.deepEqual(
    offenders.map((f) => `${f.rel}: ${f.hits[0].slice(0, 70)}`),
    [],
    "a divider inside a sheet is drawn in --kub-border-color; the edge is the heavier of the two and a rule that matches it reads as a second edge",
  );
});

/**
 * A ratchet, not a target. 273 perimeters stood in the sheet-edge colour before
 * this stage and 204 stand now; the 69 that went were each measured, and the
 * ones that stayed each have a reason — a target, a covering surface, a media
 * frame, a dashed placeholder, a well the dark theme cannot separate without
 * it, or a variant whose whole name is `outline`. What must not happen is the
 * number climbing back.
 */
test("the perimeter count only ever shrinks", () => {
  const total = FILES.reduce((n, f) => n + perimeters(read(f)).length, 0);
  assert.ok(total <= 204, `perimeters on the sheet-edge colour grew to ${total}; the ceiling is 204`);
});

/**
 * Removing a border and leaving the colour behind is the failure mode of doing
 * this in bulk: the declaration survives, draws nothing, and looks deliberate.
 * It happened twice here and was caught by this check, not by eye.
 */
test("no border colour is left without a border to colour", () => {
  const offenders = FILES.map((f) => ({ rel: f.rel, hits: colourWithoutWidth(read(f)) })).filter((f) => f.hits.length);
  assert.deepEqual(
    offenders.map((f) => `${f.rel}: ${f.hits[0].slice(0, 70)}`),
    [],
    "a border colour with no width draws nothing",
  );
});

/**
 * Presence is one size wherever it appears.
 *
 * It used to be a 12px box with `border-2`, which is an 8px disc once the
 * border is taken off both sides — the same picture the admin activity list
 * drew with a plain 8px dot, said a second way. It is now a disc and a ring,
 * so the size in the markup is the size on the screen.
 */
test("a presence dot is one size, and its ring is a ring", () => {
  const dots = [
    ["components/sidebar/ChatListItem.tsx", 1],
    ["components/ui/ChatAvatar.tsx", 2],
  ];
  for (const [rel, count] of dots) {
    const source = blankComments(read(FILES.find((f) => f.rel === rel)));
    const found = source.split("h-2 w-2 rounded-full").length - 1;
    assert.equal(found, count, `${rel}: expected ${count} presence dot(s) at one size, found ${found}`);
    assert.doesNotMatch(source, /w-3 h-3 rounded-full border-2/, `${rel} draws presence as a 12px box again`);
  }
});

/**
 * The refusals, recorded so they are not quietly undone.
 *
 * A box filled from `--kub-inset` is a well: it already has a step, and it goes
 * down. In the dark theme that step measures 18-20 against the panel holding
 * it, under the 23 this stage requires — so the border there is load-bearing
 * and stays. In the light theme the same wells measure 36-44 and would have
 * been fine; one value cannot be right in both, and the dark theme decides it.
 */
test("a well keeps the border that is carrying it in the dark theme", () => {
  const wells = [
    ["components/security/HumanVerificationCaptcha.tsx", "min-h-[65px] overflow-hidden"],
    ["components/BannedScreen.tsx", "rounded-xl p-4 text-left text-sm"],
    ["components/bots/BotTokenDialog.tsx", "mt-5 rounded-md"],
    ["components/auth/RegisterForm.tsx", "break-all rounded-xl"],
  ];
  for (const [rel, needle] of wells) {
    const line = strings(read(FILES.find((f) => f.rel === rel))).find((s) => s.includes(needle));
    assert.ok(line, `${rel}: ${needle} is gone; the anchor has to be updated with the markup`);
    assert.ok(line.includes(EDGE_COLOUR), `${rel}: the well at "${needle}" lost the border that separates it in the dark theme`);
    assert.match(line, /bg-\[var\(--kub-inset\)\]/, `${rel}: the well at "${needle}" lost its fill`);
  }
});

/**
 * Two boxes that measured well enough to convert and were converted back,
 * because measurement was the wrong question for them: both are aimed at.
 * The task row says so with `role="button"` and says three of its states —
 * hover, selected, deleted — in the border colour.
 */
test("what is aimed at keeps its edge, whatever it measured", () => {
  const row = read(FILES.find((f) => f.rel === "pages/tasks/TaskListRow.tsx"));
  assert.ok(row.includes(EDGE_COLOUR), "the task row lost the border its hover, selection and deleted states colour");
  const segment = read(FILES.find((f) => f.rel === "components/sidebar/AudioSettingsSection.tsx"));
  const inactive = strings(segment).find((s) => s.includes("kub-raise-hover") && s.includes("var(--kub-muted)"));
  assert.ok(inactive?.includes(EDGE_COLOUR), "the inactive segment lost its edge");
  assert.equal(
    /(^|\s)kub-raise(\s|$)/.test(inactive ?? ""),
    false,
    "a resting step equal to the hover step is a hover that has stopped existing",
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

test("the rule guarantee fails when a divider takes the edge colour back", () => {
  const file = FILES.find((f) => f.rel === "components/settings/StorageSection.tsx");
  const text = read(file);
  assert.equal(ruleWearingTheEdgeColour(file.rel, text).length, 0);
  const broken = mutate(
    text,
    `"border-t ${RULE_COLOUR} px-4 py-3 text-right"`,
    `"border-t ${EDGE_COLOUR} px-4 py-3 text-right"`,
  );
  assert.equal(ruleWearingTheEdgeColour(file.rel, broken).length, 1);
});

test("the rule guarantee does not fire on chrome, which keeps the edge", () => {
  const file = FILES.find((f) => f.rel === "components/layout/AppTopBar.tsx");
  const text = read(file);
  assert.equal(ruleWearingTheEdgeColour(file.rel, text).length, 0);
  // The same line without the marker that makes it chrome is a rule again, and
  // is then reported: the exemption is the class list, not the file.
  const broken = text.replace(/kub-glass relative hidden h-\[var\(--kub-app-topbar-height\)\] shrink-0/, "relative hidden");
  assert.notEqual(broken, text, "the AppTopBar anchor moved");
  assert.equal(ruleWearingTheEdgeColour(file.rel, broken).length, 1);
});

/**
 * The exact defect this stage produced, replayed: the card's perimeter was
 * removed and its hover colour was left behind, colouring a border that no
 * longer existed.
 */
test("the orphan guarantee fails when a colour is left over a removed width", () => {
  const file = FILES.find((f) => f.rel === "components/kub/KubCard.tsx");
  const text = read(file);
  assert.equal(colourWithoutWidth(text).length, 0);
  const broken = mutate(
    text,
    '"rounded-xl p-4 transition-colors kub-raise",',
    '"rounded-xl p-4 transition-colors kub-raise",\n          "hover:border-[color:var(--kub-cyan)]/40",',
  );
  assert.equal(colourWithoutWidth(broken).length, 1);
});

test("the pulse guarantee fails when the animation comes back", () => {
  const file = FILES.find((f) => f.rel === "components/sidebar/ChatListItem.tsx");
  const text = read(file);
  assert.equal(/kub-pulse/.test(blankComments(text)), false);
  const broken = mutate(
    text,
    `"absolute bottom-0 right-0 h-2 w-2 rounded-full bg-[var(--kub-online)]"`,
    `"absolute bottom-0 right-0 h-2 w-2 rounded-full bg-[var(--kub-online)] kub-pulse"`,
  );
  assert.equal(/kub-pulse/.test(blankComments(broken)), true);
});
