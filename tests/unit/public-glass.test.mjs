import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The public pages are made of the same material as the rest of the product.
 *
 * `tests/unit/overlay-glass.test.mjs` holds this line for `components/ui` and
 * `tests/unit/shell-glass.test.mjs` for the signed-in shell. This file holds it
 * for the surfaces a visitor meets *before* there is an account: the home page,
 * the downloads page, the support form and its guest chat, the privacy policy
 * and the Bot API documentation. They are the first thing anyone sees, so a
 * surface left behind here is the most visible kind of partial conversion.
 *
 * Everything asserted here was measured off rendered pixels rather than
 * reasoned from tokens: a `backdrop-filter`'s output exists only in the
 * composited frame, and the numbers quoted in the comments come from
 * photographing it at 1440x900 and 390x844 in both themes.
 */

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

/** Comments carry the measurements; only the code is under these rules. */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** The class string of one surface, found by a landmark that is not the glass class. */
function classString(file, needle) {
  const hit = [...read(file).matchAll(/"([^"\n]{12,})"/g)]
    .map((match) => match[1])
    .find((value) => value.includes(needle));
  assert.ok(hit, `${file}: no class string containing "${needle}"`);
  return hit;
}

/**
 * The surfaces content sits on, and that open nothing `fixed`, so they wear the
 * material on the element itself.
 *
 * The chrome first. Measured in the dark theme, the header composites to
 * rgb(16,40,70) over a page of rgb(5,11,23) — a step of 1.326 — where the fill
 * it replaced was a hand-rolled `--kub-surface/95` under a `backdrop-blur`.
 *
 * Then the cards. These pages carry very little content, which is exactly where
 * a translucent surface has something to pick up: the ambient is visible around
 * every one of them, and each card measured 1.213–1.215 above the page in the
 * dark theme and 1.126 in the light one.
 */
const panels = [
  ["pages/public/PublicPageShell.tsx", "sticky top-0 z-30", "kub-glass"],
  ["pages/public/PublicPageShell.tsx", "border-t border-[color:var(--kub-border-color)]", "kub-glass"],
  ["components/public/ReleaseChangelog.tsx", "rounded-2xl border border-[color:var(--kub-border-color)] p-5", "kub-glass"],
  ["pages/public/DownloadPage.tsx", "mt-4 rounded-2xl", "kub-glass"],
  ["pages/public/PrivacyPage.tsx", "mt-7 grid divide-y", "kub-glass"],
  ["pages/public/BotDocsPage.tsx", "mt-6 grid divide-y", "kub-glass"],
  ["pages/public/BotDocsPage.tsx", "mt-5 flex gap-3", "kub-glass"],
  ["pages/public/BotDocsPage.tsx", "border-t-2 border-[color:var(--kub-cyan)]", "kub-glass"],
];

for (const [file, needle, expected] of panels) {
  test(`${file} (${needle}) is made of ${expected}`, () => {
    const classes = classString(file, needle);
    // `kub-glass-strong` contains `kub-glass`, so the weaker one is matched on
    // a word boundary that a `-strong` suffix breaks.
    assert.match(
      classes,
      expected === "kub-glass" ? /\bkub-glass(?!-strong)\b/ : /\bkub-glass-strong\b/,
      `${file} does not take its surface from ${expected}`,
    );
    assert.doesNotMatch(
      classes,
      /\bbg-\[(?:color:)?var\(--kub-(surface|chat-bg|bg)/,
      `${file} keeps an opaque fill beside the glass utility`,
    );
    assert.doesNotMatch(
      classes,
      /\bshadow-(2xs|xs|sm|md|lg|xl|2xl)\b/,
      `${file} keeps its own drop shadow beside --glass-shadow`,
    );
    assert.doesNotMatch(
      classes,
      /\bkub-glow-(soft|cyan|pink)\b/,
      `${file} keeps a glow beside --glass-shadow; both set box-shadow and only one survives`,
    );
    assert.doesNotMatch(
      classes,
      /\bbackdrop-blur\b/,
      `${file} frosts by hand instead of through the utility`,
    );
  });
}

/**
 * The precondition for any of the above mattering.
 *
 * `--kub-ambient` is painted once, on `body`. The public shell is a single
 * full-height element, and while it carried an opaque `--kub-bg` the header,
 * the footer and every card on five pages were blurring one flat colour and
 * getting that same colour back. Each of them looked perfectly correct on its
 * own; the defect is only visible in what is *behind* them.
 */
test("pages/public/PublicPageShell.tsx lets the page ambient through", () => {
  const classes = classString("pages/public/PublicPageShell.tsx", "h-dvh overflow-x-hidden overflow-y-auto");
  assert.doesNotMatch(
    classes,
    /\bbg-\[(?:color:)?var\(--kub-(bg|chat-bg|surface)/,
    "the public shell paints over --kub-ambient, so every panel above it blurs a flat colour",
  );
});

/**
 * On the downloads surface the material carries a claim, so what it is gated on
 * matters as much as that it is there.
 *
 * Windows and Android are downloadable; macOS and iOS are shown as
 * «В разработке» and must not be given a download, a store, a date or a
 * certification. The card says the same thing in depth: a platform with a
 * published catalog is a sheet of the material lifted off the page — measured
 * at rgb(13,33,57) against a page of rgb(5,11,23) — while one still in
 * development lies flat on that page at rgb(4,10,23), a ratio of 1.005, inside
 * the same outline.
 *
 * That is a distance, not a fault. No --kub-danger, no dimming: the status text
 * on the unbuilt card measures 8.14:1, slightly *better* than the 6.68:1 on the
 * released one, so nothing about it reads as a refusal.
 *
 * The gate is `catalogPublished`, which is a fixed input per platform. Keyed on
 * `state` instead, the card would change substance while the catalog was being
 * checked and again if a fetch failed, so a released platform would flicker
 * into looking unreleased on a slow connection.
 */
test("components/public/PlatformShowcase.tsx makes only a released platform out of the material", () => {
  const source = withoutComments(read("components/public/PlatformShowcase.tsx"));
  assert.match(
    source,
    /platform\.catalogPublished\s*&&\s*"kub-glass"/,
    "the platform card is not gated on a published catalog, so either every platform reads as " +
      "released or none of them does",
  );
  const surfaces = source.split("kub-glass").length - 1;
  assert.equal(
    surfaces,
    1,
    `expected exactly one glass surface in the card, found ${surfaces} — a second, ungated one ` +
      "would put an unreleased platform back on the released material",
  );
  assert.doesNotMatch(
    source,
    /kub-danger/,
    "an unbuilt platform is tinted as a failure; «В разработке» is a state, not an error",
  );
});

/**
 * The code blocks on the Bot API page are wells, not cards.
 *
 * There are eight of them down one long scrolling document. Eight
 * `backdrop-filter`s is eight layers the compositor recombines per frame, and
 * what they would reveal is the page that is already directly behind them. Code
 * is recessed anyway, so --kub-inset — the token for what a well is cut into —
 * is both the cheaper and the truer answer, and the title strip takes the veil
 * over that same fill as the lip of the well: measured, the lip sits 1.162
 * above the well in the dark theme and 1.139 in the light one.
 */
test("pages/public/BotDocsPage.tsx cuts its code blocks in rather than raising them", () => {
  const classes = classString("pages/public/BotDocsPage.tsx", "min-w-0 overflow-hidden rounded-md");
  assert.match(classes, /\bbg-\[var\(--kub-inset\)\]/, "the code block is not a well");
  assert.doesNotMatch(
    classes,
    /\bkub-glass(-strong)?\b/,
    "the code block frosts itself; this page renders eight of them on one scrolling document",
  );
});

/**
 * The guest support chat is deliberately NOT glass, for the same reason the
 * message bubbles in the application are not.
 *
 * The panel around the conversation is the material; a bubble that samples what
 * is behind it costs a blur per bubble on every scrolled frame, and the thing
 * behind it is that panel. The bubbles take the veil instead, which composites
 * over whatever the panel turned out to be: measured, an incoming bubble sits
 * 1.261 above the panel in the dark theme and 1.154 in the light one, carrying
 * --kub-text at 11.98:1 and 15.96:1 and the sender label at 5.29:1 and 4.92:1.
 *
 * The conversation area itself carries no fill at all. It used to paint
 * `--kub-bg` at 45% across the middle of the panel, which covered the frosting
 * everywhere except the header and composer strips.
 */
test("pages/public/GuestSupportChat.tsx raises its bubbles without frosting them", () => {
  const source = withoutComments(read("pages/public/GuestSupportChat.tsx"));
  assert.doesNotMatch(
    source,
    /\bkub-glass(-strong)?\b/,
    "the guest chat pays for a blur per bubble to reveal the panel right behind it",
  );
  const veiled = source.split("kub-raise").length - 1;
  assert.equal(
    veiled,
    2,
    `expected the incoming and system bubbles on the veil, found ${veiled}`,
  );
  assert.match(
    source,
    /bg-\[var\(--kub-inset\)\]/,
    "the composer field is not cut into the panel holding it",
  );
});

/**
 * Nothing in the public zone is left on the tokens the material replaced.
 *
 * This is the assertion that catches a partial conversion, which is the failure
 * that actually happens: one surface left on --kub-surface beside eleven that
 * moved is invisible in a screenshot of the other eleven.
 *
 * --kub-surface-2 is banned here for a different reason from --kub-surface. It
 * still reads as a well — the support form's old fields composited to
 * rgb(11,33,58) inside a panel at rgb(16,44,75), which is a step of 1.148 — but
 * the token now also stands for a RAISED thing, and one value cannot mean both
 * "above" and "below" once the surfaces around it move. Fields take
 * --kub-inset, which only ever means below (1.282 in the same measurement).
 *
 * `pages/public/PublicPreviewCapturePage.tsx` is deliberately absent: it is the
 * DEV-only capture harness, `shell-glass.test.mjs` already holds its shell
 * transparent, and its error branch paints a flat --kub-bg on purpose so a
 * failure message is readable without a product behind it.
 */
const publicZone = [
  "pages/public/PublicPageShell.tsx",
  "pages/public/PublicHomePage.tsx",
  "pages/public/DownloadPage.tsx",
  "pages/public/PrivacyPage.tsx",
  "pages/public/SupportPage.tsx",
  "pages/public/SupportRequestForm.tsx",
  "pages/public/GuestSupportChat.tsx",
  "pages/public/BotDocsPage.tsx",
  "components/public/PlatformShowcase.tsx",
  "components/public/ReleaseChangelog.tsx",
  "components/public/ReleaseDownloadAction.tsx",
];

for (const file of publicZone) {
  test(`${file} keeps the public surfaces on the material`, () => {
    const source = withoutComments(read(file));
    assert.doesNotMatch(
      source,
      /bg-\[(?:color:)?var\(--kub-(?:surface|surface-2|surface-3|bg|chat-bg)\)\]/,
      `${file} still fills a surface from a token the material replaced`,
    );
    // The same three rules the shell is held to, for the same reason: a surface
    // written by hand drifts from the one beside it the moment either changes.
    assert.doesNotMatch(source, /backdrop-filter\s*:|backdropFilter\s*:/, `${file} writes its own frosting`);
    assert.doesNotMatch(source, /\bbackdrop-blur\b/, `${file} frosts by hand instead of through the utility`);
    // `color-mix(in srgb, var(--token) …)` stays allowed: that is a token being
    // shaded, not a colour invented in a component. No `\b` in front, because
    // Tailwind arbitrary values write their spaces as underscores and `_` is a
    // word character — `shadow-[0_2px_4px_rgba(0,0,0,.4)]` is how a literal
    // colour actually gets smuggled in.
    assert.doesNotMatch(source, /rgba?\(/, `${file} writes its own fill`);
    assert.doesNotMatch(source, /box-shadow\s*:|boxShadow\s*:/, `${file} writes its own shadow`);
  });
}

/**
 * `.kub-raise-hover` is a plain class in index.css, not a utility Tailwind knows
 * how to compose, so a variant written in front of it — `sm:`, `md:`,
 * `group-hover:` — matches no rule and emits no CSS. Nothing warns: the build
 * passes, the class sits in the markup, and the hover is simply gone at that
 * breakpoint.
 *
 * The retry control is the only pressable state among the outlined ones on a
 * platform card, and the card under it is glass for a released platform and
 * bare page for one still in development. No single elevation colour is a step
 * against both, which is what the veil is for.
 */
test("components/public/ReleaseDownloadAction.tsx finds its hover with the veil", () => {
  const source = withoutComments(read("components/public/ReleaseDownloadAction.tsx"));
  const found = source.split("kub-raise-hover").length - 1;
  assert.equal(found, 1, `expected 1 hover on the veil, found ${found}`);
  assert.doesNotMatch(
    source,
    /hover:bg-\[var\(--kub-(raised|surface-2|surface-3)\)\]/,
    "a hover is still painted with a fixed elevation colour, which goes flush the moment the " +
      "surface under it moves",
  );
  assert.doesNotMatch(
    source,
    /[A-Za-z0-9_-]:kub-raise-hover/,
    "a veil class carries a variant prefix, which Tailwind emits no rule for — the hover is " +
      "absent at that breakpoint and nothing reports it",
  );
});
