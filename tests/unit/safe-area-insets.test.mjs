import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { atRuleTexts, parseRules, ruleBody, stripCssComments } from "./helpers/css.mjs";

/**
 * The installed iPhone app is drawn under its hardware, and every edge reads
 * how much of it the hardware takes — from one place.
 *
 * `index.html` asks for `viewport-fit=cover`: the page runs under the status
 * bar, the Dynamic Island and the home indicator, and `env(safe-area-inset-*)`
 * reports each of them. That trade only pays while every surface pinned to an
 * edge reads those numbers, so this file holds the single source they come
 * from.
 *
 * Four tokens on `:root` take `env()` once, and nothing else reads `env()`.
 * That is not tidiness. Playwright's WebKit reports every inset as 0px, so a
 * surface reading `env()` directly cannot be laid out around a notch in
 * Safari's engine at all; a custom property can be given a value there, and
 * `tests/e2e/ios-standalone-safe-area.spec.ts` does exactly that. A raw `env()`
 * is a surface that stand silently cannot see.
 *
 * It began as a narrower file. `pb-safe` was written on three surfaces that dock
 * to the bottom of a phone and declared nowhere, so it compiled to nothing and
 * all three sat on the home indicator (D-065). A missing utility fails silently
 * by construction — the class name is valid markup whether or not anything
 * declares it — which is why the declarations are asserted rather than read.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const cssSource = readFileSync(path.join(root, "artifacts/kub/src/index.css"), "utf8");
const css = stripCssComments(cssSource);
const html = readFileSync(path.join(root, "artifacts/kub/index.html"), "utf8");

const SIDES = ["top", "right", "bottom", "left"];

/**
 * The inset utilities the application declares for itself, and what each one
 * sets from which token. A name here is a promise that the class does
 * something; this test holds both ends of it.
 */
const CUSTOM_INSET_UTILITIES = new Map([
  ["pt-safe", [["padding-top", "top"]]],
  ["pb-safe", [["padding-bottom", "bottom"]]],
  [
    "px-safe",
    [
      ["padding-left", "left"],
      ["padding-right", "right"],
    ],
  ],
  ["p-safe-gap", SIDES.map((side) => [`padding-${side}`, side])],
]);

/** Whether a source file writes `name` as a class token, with or without a variant. */
function writesClass(text, name) {
  return text.split(/[\s"'`]+/).some((token) => token.split(":").pop() === name);
}

/**
 * Block comments and whole-line `//` comments blanked, offsets kept. Prose that
 * names a function is not a use of it. A trailing `//` is left alone, so a URL
 * inside a string is never cut in half.
 */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, (line) => line.replace(/[^\n]/g, " "));
}

/** Every `.ts`, `.tsx` and `.css` file under the web sources. */
function sourceFiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(tsx?|css)$/.test(entry)) found.push(full);
    }
  };
  walk(path.join(root, "artifacts/kub/src"));
  return found;
}

const sources = sourceFiles().map((file) => ({ file, text: readFileSync(file, "utf8") }));
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

test("the viewport asks for the whole screen", () => {
  const meta = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/);
  assert.ok(meta, "index.html has no viewport meta tag");
  const parts = meta[1].split(",").map((part) => part.trim());
  assert.ok(
    parts.includes("viewport-fit=cover"),
    `the viewport is "${meta[1]}". Without viewport-fit=cover iOS decides where an installed app is drawn and does not document the decision, and every inset below reads 0`,
  );
  assert.ok(parts.includes("width=device-width"), "the viewport lost width=device-width");
});

test("the four insets are declared once, on :root, from env()", () => {
  for (const side of SIDES) {
    const token = `--kub-safe-${side}`;
    const declarations = [...css.matchAll(new RegExp(`${token}\\s*:\\s*([^;]+);`, "g"))];
    assert.equal(
      declarations.length,
      1,
      `${token} is declared ${declarations.length} times; it has one source or the surfaces disagree`,
    );
    assert.equal(
      declarations[0][1].trim(),
      `env(safe-area-inset-${side}, 0px)`,
      `${token} is "${declarations[0][1].trim()}" rather than the device's own inset with a 0px fallback`,
    );
  }

  const holders = parseRules(cssSource).filter((rule) => /--kub-safe-top\s*:/.test(rule.body));
  assert.equal(holders.length, 1, "the tokens are split across rules");
  assert.deepEqual(holders[0].selectors, [":root"], "the tokens moved off :root");
  assert.equal(holders[0].at.length, 0, "the tokens sit under a condition, so some screens would have none");
  assert.equal(holders[0].layer, null, "the tokens went into a layer; they belong with the unlayered root tokens");
});

test("nothing reads env(safe-area-inset-*) except those four declarations", () => {
  const offenders = [];
  for (const { file, text } of sources) {
    const code = file.endsWith(".css") ? stripCssComments(text) : withoutComments(text);
    const count = (code.match(/env\(\s*safe-area-inset-/g) ?? []).length;
    const allowed = file.endsWith(path.join("src", "index.css")) ? SIDES.length : 0;
    if (count !== allowed) offenders.push(`${path.relative(root, file)}: ${count}, expected ${allowed}`);
  }
  if (/env\(\s*safe-area-inset-/.test(html.replace(/<!--[\s\S]*?-->/g, ""))) {
    offenders.push("artifacts/kub/index.html");
  }
  assert.deepEqual(
    offenders,
    [],
    "raw env(safe-area-inset-*) outside the token declarations. Read var(--kub-safe-*) instead — " +
      `a surface reading env() is one the WebKit stand cannot lay out around a notch:\n${offenders.join("\n")}`,
  );
});

test("every inset utility the markup writes is declared once, and reads the tokens", () => {
  const declared = [...css.matchAll(/@utility\s+([a-z0-9-]*safe[a-z0-9-]*)\s*\{/g)].map((match) => match[1]);
  assert.deepEqual(
    [...declared].sort(),
    [...CUSTOM_INSET_UTILITIES.keys()].sort(),
    "index.css declares an inset utility this test does not know about, or stopped declaring one it does",
  );

  for (const [name, settings] of CUSTOM_INSET_UTILITIES) {
    const users = sources
      .filter(({ file, text }) => !file.endsWith(".css") && writesClass(text, name))
      .map(({ file }) => path.relative(root, file));
    assert.ok(
      users.length > 0,
      `no component writes \`${name}\` any more — drop it from this list rather than keeping a utility nothing asks for`,
    );

    // Read through the helper rather than a regex, so the declaration is
    // delimited by its own braces and a rule further down cannot satisfy it.
    const bodies = atRuleTexts(cssSource, new RegExp(`^@utility ${name}$`));
    assert.equal(
      bodies.length,
      1,
      `\`${name}\` is written in ${users.join(", ")} and index.css declares \`@utility ${name}\` ${bodies.length} times — at zero it compiles to nothing and the class is silently inert`,
    );
    for (const [property, side] of settings) {
      const value = bodies[0].match(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`))?.[1];
      assert.ok(value, `\`@utility ${name}\` does not set ${property}; it declares: ${bodies[0].trim()}`);
      assert.ok(
        value.includes(`var(--kub-safe-${side})`),
        `\`@utility ${name}\` sets ${property} to "${value.trim()}", which does not read --kub-safe-${side}`,
      );
      assert.ok(!value.includes("env("), `\`@utility ${name}\` reads env() directly`);
    }
  }
});

test("the bottom tab bar adds the home-indicator inset to its height", () => {
  const nav = read("artifacts/kub/src/components/layout/BottomNav.tsx");

  assert.ok(writesClass(nav, "pb-safe"), "the tab bar stopped asking for the bottom inset at all");

  // Tailwind boxes are border-box, so a flat `height: 56px` beside `pb-safe`
  // takes the inset out of the tabs instead of adding it underneath: on a 34px
  // indicator that leaves six labels and their icons 22px of row.
  const height = /height:\s*"([^"]+)"/.exec(nav);
  assert.ok(height, "the tab bar no longer sets an explicit height — re-read this test before deleting it");
  assert.ok(
    height[1].includes("var(--kub-safe-bottom)"),
    `the tab bar's height is "${height[1]}", so its safe-area padding comes out of the row rather than being added below it`,
  );
});

test("the composer takes the larger of the keyboard and the home indicator, never their sum", () => {
  // An open keyboard covers the home indicator. Summing the two left a strip
  // of the inset's height between the composer and the keys. The capture page
  // is held to the same expression because the scroll contracts are measured
  // there, and a page that pads differently measures a different product.
  for (const file of [
    "artifacts/kub/src/components/chat/ChatWindow.tsx",
    "artifacts/kub/src/pages/public/PublicPreviewCapturePage.tsx",
  ]) {
    const source = withoutComments(read(file));
    const dock = source.match(/data-testid="chat-composer-dock"[\s\S]*?style=\{\{\s*paddingBottom:\s*"([^"]+)"/);
    assert.ok(dock, `${file}: the composer dock no longer pads its own bottom`);
    assert.equal(
      dock[1].replace(/\s+/g, ""),
      "max(var(--kub-keyboard-inset,0px),var(--kub-safe-bottom))",
      `${file}: the composer dock pads "${dock[1]}"`,
    );
  }
});

test("the full-screen sheet and the docked panels pad the insets out of themselves", () => {
  const modal = withoutComments(read("artifacts/kub/src/components/kub/KubModal.tsx"));
  assert.match(
    modal,
    /"h-full max-h-screen rounded-none border-0 pt-safe pb-safe [^"]*sm:pt-0 sm:pb-0"/,
    "the phone-sized modal sheet no longer clears both the status bar and the home indicator",
  );

  const profile = withoutComments(read("artifacts/kub/src/lib/profileWindow.ts"));
  assert.match(
    profile,
    /"kub-glass-strong absolute inset-0 z-\[60\] flex min-h-0 flex-col pt-safe pb-safe"/,
    "the docked contact card no longer clears both the status bar and the home indicator",
  );

  // Docked is the shape at the top of a phone. The title-bar padding used to be
  // applied to the floating shape instead, which left the docked window's close
  // button under the Dynamic Island.
  const support = withoutComments(read("artifacts/kub/src/components/support/SupportWindow.tsx"));
  assert.match(
    support,
    /style=\{docked \? \{ paddingTop: "max\(0\.5rem, var\(--kub-safe-top\)\)" \} : undefined\}/,
    "the support window's title bar takes the status bar inset in the wrong shape",
  );

  // Both of the docked window's bottoms: the new-request form, which is what
  // someone with no tickets opens straight into, and the reply footer. The
  // form was found on the home indicator by the signed-in stand.
  const bottoms = support.match(/docked\s*\?\s*\{\s*paddingBottom:\s*"max\([^"]*var\(--kub-safe-bottom\)\)"\s*\}/g) ?? [];
  assert.equal(
    bottoms.length,
    2,
    `the docked support window pads the home indicator out of ${bottoms.length} of its two bottoms, the new-request form and the reply footer`,
  );
});

test("the auth shell pads from the tokens", () => {
  const body = ruleBody(cssSource, ".kub-auth-shell");
  const padding = body.match(/padding-block\s*:\s*([^;]+);/)?.[1];
  assert.ok(padding, ".kub-auth-shell no longer pads its block axis");
  assert.ok(padding.includes("var(--kub-safe-top)"), `.kub-auth-shell pads "${padding}" at the top`);
  assert.ok(padding.includes("var(--kub-safe-bottom)"), `.kub-auth-shell pads "${padding}" at the bottom`);
});
