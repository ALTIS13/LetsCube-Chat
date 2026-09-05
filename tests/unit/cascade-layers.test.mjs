import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { parseRules, ruleBody } from "./helpers/css.mjs";

/**
 * Where the application's own classes sit in the cascade.
 *
 * Unlayered CSS beats everything inside a layer, whatever the specificity and
 * whatever the source order, and Tailwind's utilities live in
 * `@layer utilities`. While `.kub-panel`, `.kub-glass`, `.kub-glow-*` and the
 * rest sat outside every layer, a utility on an element carrying one of them —
 * touching a property the class also set — was silently dead. That cost two
 * measured defects: a raise utility's `transition` shorthand replaced the
 * transition of everything it was applied to, and a task card's selected state
 * (fill, ring and border colour, all written as utilities) never reached a
 * pixel — selected and unselected composited to the same rgb(16,39,67), a ratio
 * of 1.000.
 *
 * They are now in `@layer components`, below utilities. This file holds that,
 * and the two things it depends on.
 */

const css = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");

/**
 * The rules that stay outside every layer on purpose.
 *
 * These define custom properties and nothing else. No Tailwind utility declares
 * `--kub-*` or `--tg-*`, so there is no cascade to lose: their position cannot
 * be contested, and putting them in a layer would only make the file read as
 * though the theme were a component.
 */
const TOKEN_BLOCKS = new Set([".dark", ".light", ".light .bots-management-surface"]);

/**
 * The element half of the touch-target floor, deliberately unlayered.
 *
 * A class is opt-in: whoever writes `kub-field` on a box can also write the
 * height they want, and a utility that disagrees should win. These rules are the
 * opposite — they exist so that a control nobody tagged is still reachable by a
 * finger, which only works while nothing silently outranks them. Measured before
 * the decision: no `min-h-*` utility is applied to a select, checkbox or radio
 * anywhere in `artifacts/kub/src`.
 */
const TOUCH_FLOOR = new Set([
  "select",
  'input[type="checkbox"]',
  'input[type="radio"]',
  'label:has(input[type="checkbox"])',
  'label:has(input[type="radio"])',
]);

const rules = parseRules(css);

/**
 * A rule that styles something the product names for itself, rather than a bare
 * element or one of Tailwind's own helpers. The `elevate` family in
 * `@layer utilities` is Tailwind-shaped and stays there.
 */
const carriesAppClass = (rule) =>
  rule.selectors.some((selector) =>
    /\.(kub-|desktop-update-|release-status-|public-|chat-bg|msg-appear|msg-selected|typing-dot|vrec-bar|unread-separator|pinned-bar|context-menu|no-scrollbar|transition-bg)/.test(
      selector,
    ),
  );

test("every rule of the application's own classes is inside @layer components", () => {
  const stray = rules
    .filter(carriesAppClass)
    .filter((rule) => rule.layer !== "components")
    .filter((rule) => !rule.selectors.every((selector) => TOKEN_BLOCKS.has(selector)));

  assert.deepEqual(
    stray.map((rule) => `line ${rule.line}: ${rule.selectors.join(", ")} -> ${rule.layer ?? "UNLAYERED"}`),
    [],
    "unlayered CSS beats every Tailwind utility it shares a property with, whatever the markup says",
  );
  // The guard is worth nothing if the class list stopped matching anything.
  assert.ok(
    rules.filter(carriesAppClass).length > 50,
    "the application's classes stopped being recognised, so this test checks nothing",
  );
});

test("the theme blocks stay unlayered, because nothing contests them", () => {
  for (const selector of TOKEN_BLOCKS) {
    const hits = rules.filter((rule) => rule.selectors.includes(selector));
    assert.ok(hits.length > 0, `${selector} is gone`);
    for (const rule of hits) {
      const declarations = rule.body.replace(/--[\w-]+:[^;]*;/g, "").trim();
      assert.equal(
        declarations,
        "",
        `${selector} declares something other than custom properties, so it belongs in a layer`,
      );
    }
  }
});

test("the touch-target floor for untagged native controls stays out of the layer", () => {
  for (const selector of TOUCH_FLOOR) {
    const hits = rules.filter((rule) => rule.selectors.includes(selector));
    assert.ok(hits.length > 0, `${selector} has no touch-target rule at all`);
    for (const rule of hits) {
      assert.equal(
        rule.layer,
        null,
        `${selector} moved into @layer ${rule.layer}; a min-h-* utility can now remove the floor from a control nobody tagged`,
      );
    }
  }
});

/**
 * `.kub-interactive` is the one class the move could not simply carry along.
 *
 * It declares no `transition-property` of its own — the property always comes
 * from a `transition-*` utility beside it — so inside the layer the utility's
 * `transition-duration: var(--tw-duration, var(--default-transition-duration))`
 * wins and replaces the motion token with Tailwind's 150ms and ease-in-out.
 * Measured on the built sheet before the move: 0.14s / cubic-bezier(.2,.8,.2,1),
 * collapsing to 0.001s under reduced motion; with the class layered and no
 * bridge, 0.15s / cubic-bezier(.4,0,.2,1) and no collapse at all.
 *
 * So the tokens are handed to the utility through the variables it already
 * reads. That is a coupling to two Tailwind internals, which is what the next
 * test is for.
 */
test("the shared interaction class hands its tokens to the utility that wins", () => {
  const rule = ruleBody(css, ".kub-interactive");
  assert.match(rule, /--tw-duration:\s*var\(--kub-motion-fast\);/, "the duration token is not bridged");
  assert.match(rule, /--tw-ease:\s*var\(--kub-ease-standard\);/, "the easing token is not bridged");
  // The longhands stay for an element that carries no `transition-*` utility.
  assert.match(rule, /transition-duration:\s*var\(--kub-motion-fast\);/);
  assert.match(rule, /transition-timing-function:\s*var\(--kub-ease-standard\);/);
});

/**
 * The installed Tailwind, compiled here rather than described from memory.
 *
 * Two facts the move rests on: `components` is declared before `utilities`, so
 * a class in `components` loses to a utility; and the transition utilities read
 * `--tw-duration` / `--tw-ease`, which is the only reason the bridge above
 * works. A Tailwind upgrade that renames either fails here instead of quietly
 * retiming every control in the product.
 */
async function compileTailwind(candidates) {
  // Resolved from the application's own package: `tailwindcss` is a dependency
  // of artifacts/kub, not of the repository root the tests run from.
  const require = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
  const entry = require.resolve("tailwindcss");
  const { compile } = (await import(pathToFileURL(entry).href)).default;
  const pkgDir = path.dirname(path.dirname(entry));
  const compiler = await compile('@import "tailwindcss";', {
    base: pkgDir,
    loadStylesheet: async (id, base) => {
      const file = id === "tailwindcss" ? path.join(pkgDir, "index.css") : path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: readFileSync(file, "utf8") };
    },
  });
  return compiler.build(candidates);
}

test("Tailwind still orders components below utilities", async () => {
  const out = await compileTailwind(["flex"]);
  const declaration = out.match(/@layer\s+([a-z, ]+);/)?.[1];
  assert.ok(declaration, "Tailwind emits no layer order at all");
  const order = declaration.split(",").map((name) => name.trim());
  assert.ok(order.includes("components"), "there is no components layer to move into");
  assert.ok(
    order.indexOf("components") < order.indexOf("utilities"),
    `components is not below utilities: ${order.join(" < ")}`,
  );
});

test("Tailwind's transition utilities still read the variables the bridge sets", async () => {
  const out = await compileTailwind(["transition-colors", "transition-all", "duration-200", "ease-out"]);
  for (const utility of ["transition-colors", "transition-all"]) {
    const body = out.match(new RegExp(`\\.${utility}\\s*\\{([^}]*)\\}`))?.[1];
    assert.ok(body, `${utility} was not generated`);
    assert.match(body, /transition-duration:\s*var\(--tw-duration/, `${utility} no longer reads --tw-duration`);
    assert.match(body, /transition-timing-function:\s*var\(--tw-ease/, `${utility} no longer reads --tw-ease`);
  }
  // And the explicit overrides still set those variables, so a `duration-*`
  // written beside `kub-interactive` beats the token — which is the whole point
  // of the move.
  assert.match(out.match(/\.duration-200\s*\{([^}]*)\}/)?.[1] ?? "", /--tw-duration:/);
  assert.match(out.match(/\.ease-out\s*\{([^}]*)\}/)?.[1] ?? "", /--tw-ease:/);
});
