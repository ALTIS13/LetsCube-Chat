import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { atRuleTexts, parseRules, stripCssComments } from "./helpers/css.mjs";

/**
 * The top of the window belongs to the window, and every surface pinned to that
 * edge knows how much of it.
 *
 * Until 2026-09-12 the messenger held its panes clear of the Windows app's own
 * minimise/maximise/close by putting a 44px bar above them — `AppTopBar`. The
 * owner had that bar removed: it pushed the folder rail below the window's top
 * edge, which Telegram Desktop's never is, and it drew the LETSCUBE wordmark a
 * second time beside the cube in the chat list's top row.
 *
 * What the bar did for the buttons still has to be done. `DesktopWindowChrome`
 * is an **overlay**, not a band — it takes no height from the page — so the page
 * has to keep its own controls out of its way. `--kub-window-caption` is that
 * height, and `pt-window-top` is how a surface reserves it together with the
 * phone's own status-bar inset.
 *
 * Three failures this file exists to catch, each of which really happens:
 *
 *  1. **The two heights drift.** The strip is drawn from a Tailwind class and
 *     the reservation from a custom property. Nothing connects them, and a
 *     taller strip puts the page's controls back under the buttons — D-112,
 *     which the owner reported with a screenshot of «Задачи».
 *  2. **The utility is never declared.** A missing `@utility` compiles to
 *     nothing and the class sits in the markup being valid and inert; `pb-safe`
 *     did exactly this on three surfaces and all three sat on the home
 *     indicator (D-065).
 *  3. **The attribute is never set.** The reservation is behind
 *     `:root[data-desktop-shell="windows"]`. If nothing writes that attribute
 *     the selector never matches, the caption stays `0px`, and the whole
 *     mechanism is silently absent on the one shell that needs it.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const cssSource = read("artifacts/kub/src/index.css");
const css = stripCssComments(cssSource);

const SRC = path.join(root, "artifacts/kub/src");
const CAPTION = "--kub-window-caption";
const UTILITY = "pt-window-top";

/**
 * Block comments and whole-line `//` comments blanked.
 *
 * Rule 9 of the material contract, in both directions: a parser that reads
 * prose as code will find a token in a sentence *about* it, and — the half that
 * bites here — the notes explaining why the bar was removed name `AppTopBar`
 * and `app-top-bar` on purpose. A scan for the bar's remains has to read the
 * code and not the explanation of it.
 */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, (line) => line.replace(/[^\n]/g, " "))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (block) => block.replace(/[^\n]/g, " "));
}

function sourceFiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|css)$/.test(entry)) found.push(full);
    }
  };
  walk(SRC);
  return found;
}

const sources = sourceFiles().map((file) => ({
  rel: path.relative(root, file).split(path.sep).join("/"),
  text: readFileSync(file, "utf8"),
}));

/** Whether a file writes `name` as a class token, with or without a variant. */
function writesClass(text, name) {
  return text.split(/[\s"'`]+/).some((token) => token.split(":").pop() === name);
}

/** A CSS length in rem, from `rem` or `px` at the browser's 16px root. */
function toRem(value) {
  const text = String(value).trim();
  const number = Number.parseFloat(text);
  assert.ok(Number.isFinite(number), `"${text}" is not a length`);
  if (text.endsWith("rem")) return number;
  if (text.endsWith("px")) return number / 16;
  assert.equal(number, 0, `"${text}" is in a unit this test cannot compare`);
  return 0;
}

/** The one declaration of `CAPTION` in each of the two rules that set it. */
function captionRules(text = cssSource) {
  const holders = parseRules(text).filter((rule) => new RegExp(`${CAPTION}\\s*:`).test(rule.body));
  return holders.map((rule) => ({
    selectors: rule.selectors,
    layer: rule.layer,
    at: rule.at,
    value: rule.body.match(new RegExp(`${CAPTION}\\s*:\\s*([^;]+);`))[1].trim(),
  }));
}

/** The height of the strip `DesktopWindowChrome` actually draws, in rem. */
function stripHeightRem(text = read("artifacts/kub/src/components/layout/DesktopWindowChrome.tsx")) {
  const classes = withoutComments(text).match(/className="(fixed inset-x-0 top-0[^"]*)"/);
  assert.ok(classes, "the window chrome's root class list moved; find the strip before changing this test");
  const height = classes[1].split(/\s+/).find((token) => /^h-(\d+(\.\d+)?|\[.+\])$/.test(token));
  assert.ok(height, `the window chrome's strip sets no height: "${classes[1]}"`);
  const arbitrary = height.match(/^h-\[(.+)\]$/);
  if (arbitrary) return toRem(arbitrary[1]);
  // Tailwind's numeric scale is `--spacing` per step, declared on :root.
  const spacing = css.match(/--spacing:\s*([^;]+);/);
  assert.ok(spacing, "index.css declares no --spacing, so a numeric h-* cannot be resolved");
  return toRem(spacing[1]) * Number(height.slice("h-".length));
}

// ── the token ───────────────────────────────────────────────────────────────

test("the caption is zero everywhere and the strip's height on the Windows shell", () => {
  const rules = captionRules();
  assert.equal(
    rules.length,
    2,
    `${CAPTION} is declared ${rules.length} times; it is a default and one shell's override, and nothing else`,
  );

  const [base, windows] = rules;
  assert.deepEqual(base.selectors, [":root"], `${CAPTION}'s default is not on :root`);
  assert.equal(base.value, "0px", `${CAPTION} defaults to "${base.value}" rather than 0px`);
  assert.equal(base.at.length, 0, `${CAPTION}'s default sits under a condition, so some screens would have none`);
  assert.equal(base.layer, null, `${CAPTION}'s default went into a layer; it belongs with the root tokens`);

  assert.deepEqual(
    windows.selectors,
    [':root[data-desktop-shell="windows"]'],
    `the override is on ${windows.selectors.join(", ")} rather than the Windows shell's attribute`,
  );
  assert.equal(windows.at.length, 0, "the Windows override sits under a condition");
  assert.ok(toRem(windows.value) > 0, `the Windows override is "${windows.value}", which reserves nothing`);
});

test("the reservation is exactly the strip the window chrome draws", () => {
  const [, windows] = captionRules();
  assert.equal(
    toRem(windows.value),
    stripHeightRem(),
    `${CAPTION} is ${windows.value} and DesktopWindowChrome's strip is ${stripHeightRem()}rem tall. ` +
      "A strip taller than the reservation puts the page's controls back under the window buttons, which is D-112",
  );
});

// ── the utility ─────────────────────────────────────────────────────────────

test("pt-window-top is declared once and sums the two things that take the top edge", () => {
  const bodies = atRuleTexts(cssSource, new RegExp(`^@utility ${UTILITY}$`));
  const users = sources.filter(({ rel, text }) => !rel.endsWith(".css") && writesClass(text, UTILITY));
  assert.ok(users.length > 0, `nothing writes \`${UTILITY}\`; drop it rather than keeping a utility nobody asks for`);
  assert.equal(
    bodies.length,
    1,
    `\`${UTILITY}\` is written in ${users.map((f) => f.rel).join(", ")} and index.css declares it ${bodies.length} ` +
      "times — at zero it compiles to nothing and the class is silently inert, which is D-065",
  );

  const padding = bodies[0].match(/(?:^|[;\s])padding-top\s*:\s*([^;]+);/);
  assert.ok(padding, `\`@utility ${UTILITY}\` sets no padding-top; it declares: ${bodies[0].trim()}`);
  const value = padding[1];
  assert.ok(value.includes("var(--kub-safe-top)"), `\`${UTILITY}\` pads "${value}", which forgets the hardware's inset`);
  assert.ok(value.includes(`var(${CAPTION})`), `\`${UTILITY}\` pads "${value}", which forgets the window's own frame`);
  // A sum, not a max(): the two are stacked rather than alternative, and on a
  // screen with neither this is the 0px the surfaces had before.
  assert.doesNotMatch(value, /\bmax\s*\(/, `\`${UTILITY}\` takes the larger of the two rather than both`);
  assert.doesNotMatch(value, /env\(/, `\`${UTILITY}\` reads env() directly instead of the tokens`);
});

/**
 * The surfaces that are the top of the window, named individually.
 *
 * A repository-wide sweep would go quiet the moment one was renamed, and each
 * of these is here for a reason a reviewer can check: the chat list's header
 * and the folder rail are the two halves of the left column's first row, the
 * chat header and the selection bar are the chat pane's first row in its two
 * states, and the side list is pinned to the same edge as a layer.
 */
const WINDOW_TOP = [
  "components/sidebar/SidebarHeader.tsx",
  "components/sidebar/FolderRail.tsx",
  "components/chat/ChatHeader.tsx",
  "components/chat/ChatSelectionBar.tsx",
  "components/sidebar/SideMenuLayer.tsx",
];

for (const relative of WINDOW_TOP) {
  test(`${relative} reserves the whole top edge, not only the hardware's part of it`, () => {
    const text = withoutComments(read(`artifacts/kub/src/${relative}`));
    assert.ok(writesClass(text, UTILITY), `${relative} no longer writes \`${UTILITY}\``);
    // `pt-safe` beside it would be the old half-reservation: correct on a
    // phone, and under the window buttons on the Windows app.
    assert.equal(
      writesClass(text, "pt-safe"),
      false,
      `${relative} still pads only the hardware's inset; on the Windows shell that leaves it under the window buttons`,
    );
  });
}

// ── the attribute the whole thing hangs on ──────────────────────────────────

test("the Windows shell is marked on the document before the first render", () => {
  const selector = captionRules()[1].selectors[0];
  const attribute = selector.match(/\[([a-z-]+)="([a-z]+)"\]/);
  assert.ok(attribute, `the override's selector ${selector} is not an attribute this test can follow`);
  const [, name, value] = attribute;

  const platform = withoutComments(read("artifacts/kub/src/lib/platform/desktop.ts"));
  assert.ok(
    platform.includes(`"${name}"`),
    `nothing in lib/platform/desktop.ts writes ${name}, so the CSS selector can never match`,
  );
  assert.ok(platform.includes(`"${value}"`), `the attribute is never set to "${value}"`);
  assert.match(
    platform,
    /export function applyDesktopShellAttribute\(\)/,
    "the applier was renamed; main.tsx and this test both name it",
  );

  const main = withoutComments(read("artifacts/kub/src/main.tsx"));
  assert.match(
    main,
    /applyDesktopShellAttribute\(\);/,
    "main.tsx does not apply the shell attribute, so the reservation is absent for the whole session",
  );
  // Before `createRoot(...).render`, not from an effect: an effect runs after
  // the first paint, and one frame of the chat header's capsules under the
  // window buttons is the defect the reservation exists to prevent.
  assert.ok(
    main.indexOf("applyDesktopShellAttribute();") < main.indexOf("createRoot("),
    "the shell attribute is applied after the first render is scheduled",
  );
});

// ── the bar really is gone ──────────────────────────────────────────────────

test("no application top bar survives anywhere in the client", () => {
  const offenders = [];
  for (const { rel, text } of sources) {
    const code = rel.endsWith(".css") ? stripCssComments(text) : withoutComments(text);
    for (const needle of ["AppTopBar", "app-top-bar", "--kub-app-topbar-height", "authenticated-shell-brand"]) {
      if (code.includes(needle)) offenders.push(`${rel}: ${needle}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "the application's top bar, or something still reading it, came back. It was removed on 2026-09-12 " +
      "because it pushed the folder rail below the window's top edge and drew the LETSCUBE mark twice",
  );
});

test("the window chrome is drawn on every surface, the messenger included", () => {
  const app = withoutComments(read("artifacts/kub/src/App.tsx"));
  assert.match(app, /<DesktopWindowChrome\s*\/>/, "App.tsx no longer renders the window chrome");
  assert.doesNotMatch(
    app,
    /<DesktopWindowChrome[^/>]*\bsuppressed\b/,
    "a surface suppresses the window chrome again. It was suppressed at `/` while the messenger drew a title " +
      "bar of its own; with that bar gone, suppressing it leaves the window unmovable there (D-016)",
  );
});

// ── mutation: each guarantee is proved by breaking it ───────────────────────

/**
 * One substitution, proved applied by the hash rather than by looking for the
 * anchor afterwards — an insertion leaves the anchor in place and would report
 * success either way (rule 9).
 */
function mutate(text, anchor, replacement) {
  const occurrences = text.split(anchor).length - 1;
  assert.equal(occurrences, 1, `anchor is not unique (${occurrences}x): ${anchor.slice(0, 60)}`);
  const before = createHash("sha256").update(text).digest("hex");
  const mutated = text.replace(anchor, replacement);
  assert.notEqual(createHash("sha256").update(mutated).digest("hex"), before, "the substitution changed nothing");
  return mutated;
}

test("the drift guarantee fails when the strip grows past the reservation", () => {
  const file = "artifacts/kub/src/components/layout/DesktopWindowChrome.tsx";
  const text = read(file);
  assert.equal(stripHeightRem(text), toRem(captionRules()[1].value));
  const broken = mutate(text, "z-50 flex h-8 select-none", "z-50 flex h-12 select-none");
  assert.notEqual(
    stripHeightRem(broken),
    toRem(captionRules()[1].value),
    "a 3rem strip over a 2rem reservation was not noticed",
  );
});

test("the reservation guarantee fails when a surface goes back to the hardware's inset alone", () => {
  const text = read("artifacts/kub/src/components/chat/ChatHeader.tsx");
  const code = withoutComments(text);
  assert.equal(writesClass(code, UTILITY), true);
  assert.equal(writesClass(code, "pt-safe"), false);
  const broken = withoutComments(
    mutate(text, 'className="relative flex flex-shrink-0 flex-col pt-window-top"', 'className="relative flex flex-shrink-0 flex-col pt-safe md:pt-0"'),
  );
  assert.equal(writesClass(broken, UTILITY), false);
  assert.equal(writesClass(broken, "pt-safe"), true);
});

test("the caption guarantee fails when the Windows override is dropped", () => {
  const broken = mutate(cssSource, ':root[data-desktop-shell="windows"] {\n  --kub-window-caption: 2rem;\n}', "");
  assert.equal(captionRules(broken).length, 1, "the override was removed and the token still reports two rules");
});
