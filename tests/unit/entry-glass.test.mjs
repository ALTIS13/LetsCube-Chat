import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The surfaces a person meets outside the messenger shell are made of the same
 * material as the shell.
 *
 * `shell-glass` holds the frame, `overlay-glass` the shadcn primitives and
 * `product-overlay-glass` the dialogs the product builds itself. This file
 * holds the rest: the two auth screens, the search palette and its shared
 * parts, the support window's insides, the Windows update gate, the ban screen
 * and the two standalone banners.
 *
 * Four things are asserted, and each of them was a real defect in this zone
 * before the pass:
 *
 *  1. A surface that covers content it is not part of wears
 *     `kub-glass-strong`, and carries neither an opaque fill nor a shadow of
 *     its own beside it.
 *  2. Nothing writes the material by hand. The iframe banner set
 *     `backdrop-blur-sm` behind an opaque fill — a blur over a flat colour
 *     returns that colour, so the frosting was inert and the material was out
 *     of reach of one edit. The Windows gate did the same with `backdrop-blur-md`.
 *  3. Fields, wells and read-back blocks take `--kub-inset`. `--kub-surface-2`
 *     used to sit one step above the chrome around it; the chrome is
 *     translucent now and composites past it, so those boxes had stopped
 *     reading as recesses at all.
 *  4. Anything that must be found against a surface that can move takes the
 *     veil, never a fixed elevation colour — and never with a variant prefix
 *     in front of it, which is not a class Tailwind emits.
 *
 * Measured in composited pixels at 1440x900, both themes, over the
 * application's own ground. Every word on every converted surface clears
 * 4.5:1; the tightest are the search chip and the support title bar at 4.88:1
 * and 4.87:1 dark, and the register card's --kub-pink label at 5.27:1 dark and
 * 4.84:1 light.
 */

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

/** Comments quote the measurements; only the code is under these rules. */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * The class string containing `needle`, and a refusal rather than a guess when
 * the landmark is not unique — an ambiguous anchor cannot judge a mutation.
 */
function classString(file, needle) {
  const hits = [...withoutComments(read(file)).matchAll(/"([^"\n]{10,})"/g)]
    .map((match) => match[1])
    .filter((value) => value.includes(needle));
  assert.ok(hits.length > 0, `${file}: no class string containing "${needle}"`);
  assert.equal(hits.length, 1, `${file}: "${needle}" matches ${hits.length} class strings`);
  return hits[0];
}

/** Everything that covers content it is not part of. [file, landmark] */
const covers = [
  // The mini-profile, dropped over the result list in both the palette and the
  // sidebar column.
  ["components/search/SearchShared.tsx", "absolute inset-0 z-10 flex flex-col"],
  // The cover over the captcha while the resend timer runs.
  ["components/auth/RegisterForm.tsx", "pointer-events-none absolute inset-0 flex items-center"],
  // The Windows critical-update card, over the whole shell.
  ["components/desktop/DesktopUpdatePill.tsx", "w-full max-w-md rounded-2xl border border-[color:var(--kub-pink)]"],
  // The ban screen's card, over the lattice the same component paints.
  ["components/BannedScreen.tsx", "relative w-full max-w-md rounded-2xl p-8"],
  // The two banners pinned over the top of the application.
  ["components/IframeAuthBanner.tsx", "fixed top-0 inset-x-0"],
  ["components/AppUpdateBanner.tsx", "fixed left-1/2 top-3 z-[80]"],
  // The support window, floating over the conversation or covering the screen.
  ["components/support/SupportWindow.tsx", "fixed z-[70] flex flex-col"],
];

for (const [file, needle] of covers) {
  test(`${file} (${needle}) covers with the material, not with a fill`, () => {
    const classes = classString(file, needle);
    assert.match(classes, /\bkub-glass-strong\b/, `${file} covers content without kub-glass-strong`);
    assert.doesNotMatch(
      classes,
      /\bbg-\[(var\(--kub-surface(-[23])?\)|color:var\(--kub-surface(-[23])?\))\]/,
      `${file} keeps an opaque fill beside the glass utility`,
    );
    assert.doesNotMatch(
      classes,
      /\bshadow-(2xs|xs|sm|md|lg|xl|2xl)\b|\bkub-glow-(soft|cyan|pink)\b/,
      `${file} keeps its own shadow beside --glass-shadow`,
    );
  });
}

/** Every file this pass touched, including the ones with no covering surface. */
const zone = [
  "components/auth/LoginForm.tsx",
  "components/auth/RegisterForm.tsx",
  "components/search/GlobalSearchPalette.tsx",
  "components/search/SearchShared.tsx",
  "components/search/SidebarSearchResults.tsx",
  "components/security/HumanVerificationCaptcha.tsx",
  "components/support/SupportWindow.tsx",
  "components/desktop/DesktopUpdatePill.tsx",
  "components/BannedScreen.tsx",
  "components/AppUpdateBanner.tsx",
  "components/IframeAuthBanner.tsx",
];

test("no surface in this zone writes the material by hand", () => {
  for (const file of zone) {
    const source = withoutComments(read(file));
    assert.doesNotMatch(source, /backdrop-filter|backdropFilter/i, `${file} writes its own frosting`);
    assert.doesNotMatch(source, /\bbackdrop-blur(-|\b)/, `${file} writes its own frosting as a utility`);
    assert.doesNotMatch(source, /\bbox-shadow(?!:\s*0_0_0)|boxShadow/i, `${file} writes its own shadow`);
  }
});

test("no surface in this zone paints an opaque chrome fill any more", () => {
  for (const file of zone) {
    const source = withoutComments(read(file));
    assert.doesNotMatch(
      source,
      /\bbg-\[(var\(--kub-surface(-[23])?\)|color:var\(--kub-surface(-[23])?\))\]/,
      `${file} still fills a surface from --kub-surface*`,
    );
    // `bg-[var(--kub-surface-2)]/50` and friends: the same token with an alpha.
    assert.doesNotMatch(
      source,
      /--kub-surface(-[23])?\)\]\/\d/,
      `${file} still fills a surface from --kub-surface* at an alpha`,
    );
  }
});

/**
 * A hover has to be found against a ground that moves, so it takes the veil.
 * `sm:kub-raise-hover` is not a class Tailwind emits: a variant prefix would
 * make the hover silently absent at that breakpoint and the build would say
 * nothing.
 */
test("every hover in this zone is the veil, unprefixed", () => {
  for (const file of zone) {
    const source = withoutComments(read(file));
    assert.doesNotMatch(
      source,
      /hover:bg-\[var\(--kub-(surface|surface-2|surface-3|raised)\)\]/,
      `${file} hovers to a fixed elevation colour`,
    );
    assert.doesNotMatch(source, /\b[a-z0-9-]+:kub-raise(-hover)?\b/, `${file} puts a variant in front of the veil`);
  }
});

/** Fields, wells and read-back blocks are cut in, not raised. */
const wells = [
  ["components/search/GlobalSearchPalette.tsx", "flex h-11 items-center gap-2 rounded-xl", "the palette's search field"],
  ["components/auth/LoginForm.tsx", "px-3 py-2 border-b", "the login card's title band"],
  ["components/auth/RegisterForm.tsx", "break-all rounded-xl", "the register card's read-back address"],
  ["components/security/HumanVerificationCaptcha.tsx", "min-h-[65px] overflow-hidden", "the captcha plate"],
  ["components/search/SearchShared.tsx", "flex h-8 w-8 shrink-0 items-center", "the result row's icon plate"],
  ["components/BannedScreen.tsx", "rounded-xl p-4 text-left text-sm", "the ban screen's detail block"],
];

for (const [file, needle, what] of wells) {
  test(`${what} is cut into its surface with --kub-inset`, () => {
    assert.match(classString(file, needle), /\bbg-\[var\(--kub-inset\)\]/, `${what} lost --kub-inset`);
  });
}

/** The register card carries the same band twice; both take the same token. */
test("both of the register card's title bands are cut in", () => {
  const bands = withoutComments(read("components/auth/RegisterForm.tsx")).match(
    /px-3 py-2 border-b border-\[color:var\(--kub-border-color\)\] bg-\[var\(--kub-inset\)\]/g,
  );
  assert.equal(bands?.length, 2, "the register card's two title bands disagree about their fill");
});

/**
 * The four text fields inside the support window, found by their shared shape
 * rather than one by one, so adding a fifth that misses the token fails here.
 */
test("every field in the support window is cut into it", () => {
  const source = withoutComments(read("components/support/SupportWindow.tsx"));
  const fields = source.match(/rounded-lg border border-\[color:var\(--kub-border-color\)\] bg-\[[^\]]+\]/g) ?? [];
  assert.ok(fields.length >= 4, `expected the window's four fields, found ${fields.length}`);
  for (const field of fields) {
    assert.match(field, /bg-\[var\(--kub-inset\)\]/, `a support field is filled from ${field}`);
  }
});

/**
 * A state that tints has to mix into `transparent`. Mixing into a surface token
 * makes the result opaque and pins it to an elevation the panel around it has
 * already moved past.
 */
test("the tinted states composite over their surface instead of replacing it", () => {
  for (const file of ["components/search/SearchShared.tsx", "components/search/GlobalSearchPalette.tsx", "components/support/SupportWindow.tsx"]) {
    const source = withoutComments(read(file));
    for (const mix of source.match(/color-mix\(in_srgb,[^)]*\)_\d+%,[^)]*\)/g) ?? []) {
      assert.match(mix, /,\s*transparent\)/, `${file} mixes a state into a surface: ${mix}`);
    }
  }
});

/** The gate dims the shell behind it without erasing it. */
test("the Windows update gate leaves the shell behind it visible", () => {
  const found = read("components/desktop/DesktopUpdatePill.tsx").match(/fixed inset-0 z-\[\d+\][^"]*?\bbg-black\/(\d+)\b/);
  assert.ok(found, "the critical update gate has no scrim with a readable opacity");
  const alpha = Number(found[1]);
  // Above this the frosted card over it samples a flat rectangle and the
  // material disappears. Same value as the product's other dialogs, so the two
  // layers cannot drift apart.
  assert.ok(alpha <= 60, `a ${alpha}% scrim leaves the card's blur nothing to sample`);
});

/**
 * The ban screen is a full-screen state, and the lattice under its card is
 * painted by `kub-grid-bg`, which already sets --kub-bg as its own background
 * colour. A second copy of that fill on the same element is what the card would
 * otherwise be frosting.
 */
test("the ban screen does not paint the page colour twice", () => {
  const shell = classString("components/BannedScreen.tsx", "fixed inset-0 z-[100]");
  assert.match(shell, /\bkub-grid-bg\b/, "the ban screen lost its lattice");
  assert.doesNotMatch(shell, /\bbg-\[var\(--kub-bg\)\]/, "the ban screen paints --kub-bg over its own lattice");
});

/**
 * The error boundary is deliberately NOT made of the material, and this pins
 * the decision so a later pass does not quietly "finish the job".
 *
 * It is the insurance, and insurance must not need anything the failure it
 * covers could have taken out. It gains nothing from translucency — it replaces
 * the whole app subtree, so what is behind its card is the lattice the same
 * element paints. And `backdrop-filter` forces a compositing layer and a
 * viewport-sized backdrop snapshot, which is the wrong thing to ask for after
 * a renderer has just died of memory exhaustion or a lost GPU context. The
 * material's own `@supports not (backdrop-filter: ...)` fallback resolves to an
 * opaque surface, so this is that fallback chosen unconditionally rather than a
 * different design.
 */
test("the error boundary stays opaque on purpose", () => {
  const card = classString("components/AppErrorBoundary.tsx", "w-full max-w-md rounded-2xl border");
  assert.doesNotMatch(card, /\bkub-glass(-strong)?\b/, "the error boundary took the material it is meant to survive without");
  assert.match(card, /\bbg-\[var\(--kub-surface\)\]/, "the error boundary lost the opaque fill that is its whole point");
});
