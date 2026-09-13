import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseAdvancedSearchQuery,
  SEARCH_SYNTAX_HINT_EXAMPLES,
  SEARCH_SYNTAX_HINT_ID,
  SEARCH_SYNTAX_HINT_TEXT,
  shouldOfferSearchSyntaxHint,
} from "../../artifacts/kub/src/lib/searchQuery.ts";
import {
  RECORDER_MODE_HINT_ID,
  RECORDER_MODE_HINT_TEXT,
  shouldOfferRecorderModeHint,
  type RecorderModeHintInput,
} from "../../artifacts/kub/src/lib/recordingGesture.ts";

/**
 * The casual hints, and the two things about them that can rot silently.
 *
 * `tests/unit/hints.test.mts` holds the store — offer, withdraw, dismiss, the
 * budget. Nothing there knows what any particular hint says or where it hangs,
 * which is right for that module and leaves two failures uncovered:
 *
 *  - **A hint that teaches syntax the parser refuses.** The search hint names
 *    `from:@anna`, `has:image`, `after:2026-09-01`. If the grammar moves and
 *    the sentence does not, the product ships a control that confidently
 *    explains something that does not work — strictly worse than staying
 *    quiet. So every example is run through the real parser here, and the
 *    sentence is required to be built from the same list it is checked against.
 *  - **A hint that outlives the control it points at.** `useHint` charges the
 *    budget for as long as the store says the hint is *visible*, and the store
 *    is never told whether the anchor is still mounted. Both surfaces therefore
 *    have to gate `enabled` on their own control being on screen, and both
 *    gates are asserted below because neither is visible in a screenshot.
 *
 * The device gates carry a third job worth naming. The owner's rule is one hint
 * on screen at a time, and the store does **not** enforce it — `getSnapshot`
 * returns every eligible offer. What keeps these two apart is structural: the
 * composer hint is offered only below `md`, where `MainLayout` shows a single
 * pane, and the sidebar hint is withdrawn when its column is hidden behind an
 * open chat. Change either gate and the guarantee is gone with no other alarm,
 * so the gates are pinned here as contracts rather than as preferences.
 */

const SRC = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const SEARCH_SURFACE = `${SRC}components/search/SidebarSearchResults.tsx`;
const COMPOSER = `${SRC}components/chat/MessageInput.tsx`;
const PLATE = `${SRC}components/kub/KubHint.tsx`;
const SHEET = `${SRC}index.css`;

const read = (file: string) => readFileSync(file, "utf8");

/**
 * Rule 9 of the material contract. Both files explain in prose what they wire
 * up — «a popover anchored here», «`shouldOfferRecorderModeHint` holds the
 * conditions» — and a checker reading prose as code would pass on a comment
 * while the wiring was gone. Writing down the reason must not be the thing that
 * keeps the test green.
 */
const blankComments = (text: string) =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// ── the checkers, as pure functions so a mutation can be run through them ────

/** A surface that reads the shared store rather than growing a second one. */
function usesSharedHint(text: string, idName: string) {
  const body = blankComments(text);
  return {
    hook: new RegExp(`useHint\\(\\s*${idName}`).test(body),
    imported: /from "@\/hooks\/useHint"/.test(body),
    plate: /<KubHint\b/.test(body),
  };
}

/** Nothing may reach past the store to the browser's storage on its own. */
function touchesHintStorageDirectly(text: string): boolean {
  return /letscube:hints/.test(blankComments(text));
}

/** The sidebar's hint is withdrawn while its column is hidden behind a chat. */
function sidebarPaneGate(text: string) {
  const body = blankComments(text);
  return {
    computed: /const paneOnScreen = !\(isPhone && Boolean\(selectedChatId\)\)/.test(body),
    applied: /enabled:\s*paneOnScreen\s*&&\s*shouldOfferSearchSyntaxHint\(parsed\)/.test(body),
  };
}

/**
 * Every input the composer hands the predicate, by name.
 *
 * Both spellings, because the call uses both: most conditions are written
 * `name: value` and `recording` is passed as ES shorthand. A checker that knew
 * only about the colon reported the shorthand one as missing, which is a
 * checker that would have to be silenced rather than believed.
 */
function composerHintInputs(text: string): string[] {
  const body = blankComments(text);
  const call = body.match(/shouldOfferRecorderModeHint\(\{([\s\S]*?)\}\)/);
  if (!call) return [];
  return [...call[1].matchAll(/^\s*(\w+)\s*[:,]/gm)].map((match) => match[1]).sort();
}

// ── the search hint: the copy cannot outrun the grammar ─────────────────────

test("every example the search hint names is syntax the parser actually accepts", () => {
  assert.ok(SEARCH_SYNTAX_HINT_EXAMPLES.length > 0, "the hint names no examples at all");

  for (const example of SEARCH_SYNTAX_HINT_EXAMPLES) {
    const key = example.slice(0, example.indexOf(":"));
    const parsed = parseAdvancedSearchQuery(`${example} смета`, "all");

    assert.equal(
      parsed.chips.length,
      1,
      `«${example}» produced no filter chip, so the hint teaches syntax the parser ignores`,
    );
    assert.equal(parsed.chips[0].key, key, `«${example}» did not parse as a ${key} filter`);
    assert.equal(parsed.hasAdvancedFilters, true, `«${example}» is not treated as an advanced filter`);
    assert.equal(
      parsed.query,
      "смета",
      `«${example}» was left in the text to be searched for rather than taken out as a filter`,
    );
  }
});

/**
 * The sentence is built from the list, so this is really a check that it still
 * is. A hand-edited sentence that drops an example, or renames one, would carry
 * words the test above never sees.
 */
test("the search hint's sentence names every example it is built from", () => {
  for (const example of SEARCH_SYNTAX_HINT_EXAMPLES) {
    assert.ok(
      SEARCH_SYNTAX_HINT_TEXT.includes(example),
      `the sentence does not contain «${example}», so the copy and the checked list have parted company`,
    );
  }
});

/**
 * The example handle is latin because `normalizeUsername` strips everything
 * outside `[A-Za-z0-9_.]`. A Cyrillic handle here would be an instruction to
 * type something that can never match an account.
 */
test("the search hint's example handle is one a username could actually be", () => {
  const from = SEARCH_SYNTAX_HINT_EXAMPLES.find((example) => example.startsWith("from:"));
  assert.ok(from, "the hint no longer shows a sender example");
  assert.match(
    from.slice("from:".length),
    /^@[A-Za-z0-9_.]+$/,
    "the example handle contains characters a username cannot hold",
  );
});

test("the search hint is offered while a query is typed and withdrawn once it is used", () => {
  const parse = (raw: string) => parseAdvancedSearchQuery(raw, "all");

  assert.equal(shouldOfferSearchSyntaxHint(parse("")), false, "an empty field is nobody searching");
  assert.equal(shouldOfferSearchSyntaxHint(parse("   ")), false, "whitespace is not a query");
  assert.equal(shouldOfferSearchSyntaxHint(parse("смета")), true, "a typed query is where the hint belongs");

  // A chip is proof the person already knows the grammar.
  assert.equal(shouldOfferSearchSyntaxHint(parse("from:@anna смета")), false);
  assert.equal(shouldOfferSearchSyntaxHint(parse("has:image")), false);
  assert.equal(shouldOfferSearchSyntaxHint(parse("after:2026-09-01 смета")), false);
});

// ── the composer hint: every condition is load-bearing ──────────────────────

/** A composer the hint belongs on, which each case then spoils in one way. */
const offering: RecorderModeHintInput = {
  mode: "voice",
  recording: false,
  feedbackVisible: false,
  coarsePointer: true,
  phoneWidth: true,
  buttonOnScreen: true,
  overlayOpen: false,
};

test("the composer hint is offered on a resting phone composer in voice mode", () => {
  assert.equal(shouldOfferRecorderModeHint(offering), true);
});

test("each condition on the composer hint is load-bearing", () => {
  const spoiled: Array<[string, Partial<RecorderModeHintInput>]> = [
    ["a mouse, where the sentence's gesture is false", { coarsePointer: false }],
    ["a second pane beside it, where it could share a screen", { phoneWidth: false }],
    ["send in the slot, so the button it points at is gone", { buttonOnScreen: false }],
    ["a recording under way, when the button is not a switch", { recording: true }],
    ["the composer's own plate already up", { feedbackVisible: true }],
    ["a sheet open over the composer, where the plate would take its taps", { overlayOpen: true }],
    ["video already chosen, which is proof it was found", { mode: "video" }],
  ];

  for (const [why, change] of spoiled) {
    assert.equal(
      shouldOfferRecorderModeHint({ ...offering, ...change }),
      false,
      `the hint was still offered with ${why}`,
    );
  }
});

/**
 * The sentence describes the touch gesture, and the predicate refuses a fine
 * pointer. If one ever moves without the other the product shows a mouse user a
 * sentence about tapping, which is the copy lying rather than merely missing.
 */
test("the composer hint's sentence and its pointer gate agree with each other", () => {
  assert.match(RECORDER_MODE_HINT_TEXT, /нажмите/i, "the sentence no longer describes a press");
  assert.equal(shouldOfferRecorderModeHint({ ...offering, coarsePointer: false }), false);
});

// ── the ids are storage keys ────────────────────────────────────────────────

test("the two hints are told apart by stable ids", () => {
  assert.equal(SEARCH_SYNTAX_HINT_ID, "search-syntax");
  assert.equal(RECORDER_MODE_HINT_ID, "recorder-mode");
  assert.notEqual(SEARCH_SYNTAX_HINT_ID, RECORDER_MODE_HINT_ID);
});

// ── the wiring, which is the half that rots ─────────────────────────────────

test("the sidebar search surface hangs its hint off the shared store", () => {
  assert.deepEqual(usesSharedHint(read(SEARCH_SURFACE), "SEARCH_SYNTAX_HINT_ID"), {
    hook: true,
    imported: true,
    plate: true,
  });
});

test("the composer hangs its hint off the shared store", () => {
  assert.deepEqual(usesSharedHint(read(COMPOSER), "RECORDER_MODE_HINT_ID"), {
    hook: true,
    imported: true,
    plate: true,
  });
});

test("neither surface reaches past the store to the browser's own storage", () => {
  assert.equal(touchesHintStorageDirectly(read(SEARCH_SURFACE)), false);
  assert.equal(touchesHintStorageDirectly(read(COMPOSER)), false);
});

/**
 * The gate that keeps a plate from being portalled over an open conversation.
 * `MainLayout` hides the sidebar with `isMobileChatOpen ? "hidden" : "flex"`
 * rather than unmounting it, so this surface stays mounted with its query and
 * radix would happily anchor to a `display: none` box — which is exactly what
 * put the administration hint over the chat list on 2026-09-12.
 */
test("the sidebar hint is withdrawn while its column is hidden behind a chat", () => {
  assert.deepEqual(sidebarPaneGate(read(SEARCH_SURFACE)), { computed: true, applied: true });
});

/**
 * Every input the predicate needs, handed over by name. A caller that quietly
 * stops passing one gets `undefined`, which is falsy — so `coarsePointer` or
 * `phoneWidth` going missing would not throw and would not show on screen
 * either; the hint would simply never appear again.
 */
test("the composer hands the predicate every condition it judges", () => {
  assert.deepEqual(composerHintInputs(read(COMPOSER)), [
    "buttonOnScreen",
    "coarsePointer",
    "feedbackVisible",
    "mode",
    "overlayOpen",
    "phoneWidth",
    "recording",
  ]);
});

// ── mutation: each guarantee is proved by breaking it ───────────────────────

/**
 * Apply one substitution to a copy of a file's text and prove it applied by the
 * hash rather than by looking for the anchor afterwards — an insertion leaves
 * the anchor in place and would report success either way. A non-unique anchor
 * is refused rather than guessed at.
 */
function mutate(text: string, anchor: string, replacement: string): string {
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

test("the wiring guarantee fails when a surface stops offering its hint", () => {
  const text = read(SEARCH_SURFACE);
  assert.equal(usesSharedHint(text, "SEARCH_SYNTAX_HINT_ID").hook, true);
  const broken = mutate(text, "useHint(SEARCH_SYNTAX_HINT_ID", "useHint(SOME_OTHER_ID");
  assert.equal(
    usesSharedHint(broken, "SEARCH_SYNTAX_HINT_ID").hook,
    false,
    "the checker did not notice the hint losing its id",
  );
});

test("the wiring guarantee fails when the plate is taken off the surface", () => {
  const text = read(SEARCH_SURFACE);
  assert.equal(usesSharedHint(text, "SEARCH_SYNTAX_HINT_ID").plate, true);
  const broken = mutate(text, "<KubHint", "<KubHintDisabled");
  assert.equal(usesSharedHint(broken, "SEARCH_SYNTAX_HINT_ID").plate, false);
});

/** The defect stated directly: the plate portalled over a hidden column. */
test("the pane guarantee fails when the sidebar hint stops asking whether it is on screen", () => {
  const text = read(SEARCH_SURFACE);
  assert.deepEqual(sidebarPaneGate(text), { computed: true, applied: true });
  const broken = mutate(
    text,
    "enabled: paneOnScreen && shouldOfferSearchSyntaxHint(parsed),",
    "enabled: shouldOfferSearchSyntaxHint(parsed),",
  );
  assert.equal(
    sidebarPaneGate(broken).applied,
    false,
    "the checker did not notice the hint losing its pane gate",
  );
});

test("the input guarantee fails when the composer stops passing a condition", () => {
  const text = read(COMPOSER);
  assert.ok(composerHintInputs(text).includes("phoneWidth"));
  const broken = mutate(text, "      phoneWidth: isPhoneWidth,\n", "");
  assert.equal(
    composerHintInputs(broken).includes("phoneWidth"),
    false,
    "the checker did not notice the width gate going missing from the call",
  );
});

/**
 * The plate must not take the pointer, and its close button must take it back.
 *
 * This was live on production. A signed-in run at 390 as a staff account could
 * not open a chat at all: Playwright named the culprit itself —
 * «<span …>Управление сообществом живёт здесь…</span> from
 * <div data-radix-popper-content-wrapper=. . .> subtree intercepts pointer
 * events» — and retried the click twenty-odd times before timing out. The
 * content refuses to close on an outside interaction (deliberately: a hint is
 * budget-governed, not dismissed by a stray tap), so without
 * `pointer-events-none` Radix's dismissable layer simply keeps every tap that
 * lands on its rectangle.
 *
 * The owner's own words for what a hint may not be: «не такое которое
 * перехватывает всё управление». Covering a control is allowed — he said so,
 * and Telegram's own hints do it. Intercepting is not.
 */
function plateRefusesPointer(text: string): boolean {
  return /"pointer-events-none[^"]*"/.test(blankComments(text));
}

/** The one part of the plate that must still answer a press. */
function closeButtonTakesPointer(text: string): boolean {
  return /pointer-events-auto/.test(blankComments(text));
}

test("the hint plate lets the pointer through, and only its close button catches it", () => {
  const plate = read(PLATE);
  assert.equal(
    plateRefusesPointer(plate),
    true,
    "the plate no longer refuses the pointer. Defence in depth rather than the contract itself — the rule in index.css carries that — but deliberate, and not to be dropped in silence",
  );
  assert.equal(
    closeButtonTakesPointer(plate),
    true,
    "nothing on the plate can be pressed, so the hint cannot be dismissed by hand",
  );
});

/**
 * The mutation that matters, and a second one that is about the checker rather
 * than the component.
 *
 * The first is the defect returning. The second is the mistake made while
 * fixing it: a script verified this very change by counting occurrences of
 * the class name and counted its own explanatory comment as one of them, so
 * it reported failure over a file it had just written correctly. A checker
 * that reads prose as code is worth nothing here, and this proves it does not.
 */
test("the guarantee fails when the plate starts eating taps again", () => {
  const plate = read(PLATE);
  assert.equal(plateRefusesPointer(plate), true);
  const broken = plate.replace("pointer-events-none flex", "flex");
  assert.notEqual(broken, plate, "the substitution did not apply");
  assert.equal(plateRefusesPointer(broken), false);
});

test("a mention in a comment does not satisfy the guarantee", () => {
  const prose = [
    "// Without pointer-events-none this layer ate every tap.",
    "<div className={cn(`flex w-auto items-start`)} />",
  ].join("\n");
  assert.equal(plateRefusesPointer(prose), false);
});

/**
 * The half that actually carries the contract, and how that was settled.
 *
 * `pointer-events` is an inherited property. Radix's positioning wrapper is the
 * element that carries the content's dimensions, and the scoped rule in
 * `index.css` sets it to `none`; the plate inside inherits that whether or not
 * it carries the class of its own, and the close button takes the pointer back
 * for itself.
 *
 * Measured by mutation on 2026-09-13 against `tests/e2e/hint-pointer.spec.ts`:
 * neutering this rule turns that guard red, four times naming the wrapper as
 * intercepting the press; stripping the class from the component does not,
 * because the plate still computes `pointer-events: none` by inheritance. The
 * production failure covers the other direction — the class alone left the
 * wrapper intercepting. So this rule is necessary and, alone, sufficient.
 *
 * Pinned by substring rather than by pattern: this file has already been
 * fooled once by a checker that read prose as code.
 */
const WRAPPER_SELECTOR =
  '[data-radix-popper-content-wrapper]:has(> [data-testid="kub-hint"])';

function sheetLiftsThePointerOffTheWrapper(text: string): boolean {
  const at = text.indexOf(WRAPPER_SELECTOR);
  if (at < 0) return false;
  return text.slice(at, at + 110).includes('pointer-events: none;');
}

test("the stylesheet takes the pointer off the hint's popper wrapper", () => {
  assert.equal(
    sheetLiftsThePointerOffTheWrapper(read(SHEET)),
    true,
    "the wrapper keeps the pointer, so a tap on the hint's rectangle never reaches the control beneath — this is the half that was live in production",
  );
});

test("the wrapper guarantee fails when the rule stops lifting the pointer", () => {
  const sheet = read(SHEET);
  assert.equal(sheetLiftsThePointerOffTheWrapper(sheet), true);
  const at = sheet.indexOf(WRAPPER_SELECTOR);
  const broken =
    sheet.slice(0, at) + sheet.slice(at).replace('pointer-events: none;', 'pointer-events: auto;');
  assert.notEqual(broken, sheet, "the substitution did not apply");
  assert.equal(sheetLiftsThePointerOffTheWrapper(broken), false);
});
