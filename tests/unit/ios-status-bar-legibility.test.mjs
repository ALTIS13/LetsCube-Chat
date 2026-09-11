import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseRules } from "./helpers/css.mjs";

/**
 * The installed iPhone app's status bar stays readable in the light theme.
 *
 * `black-translucent` draws the status bar over the page. With
 * `viewport-fit=cover` the page is under it, and in the light theme the
 * header's glass is nearly white: photographed, the clock and the battery
 * vanished into it. The meta tag cannot follow the theme — iOS reads it once,
 * when the app is added to the home screen — so the page paints a band over
 * exactly the strip the glyphs sit in.
 *
 * Three things are held here, each because it is the one that breaks quietly:
 * the premise (the status bar is drawn over the page), the gate (installed app
 * only, never Android, whose light-theme icons are dark), and the band's
 * colour. The glyphs' colour is iOS's to choose — the documentation for this
 * style says white, and screenshots from the owner's iPhone show dark glyphs
 * over the light theme — so the band is opaque and has to carry either.
 */

const html = readFileSync(new URL("../../artifacts/kub/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");

const SELECTOR = "html.light[data-ios-standalone] body::before";

const channel = (value) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

test("the premise: the status bar is the translucent one, drawn over the page", () => {
  const style = html.match(/<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="([^"]+)"/);
  assert.ok(style, "index.html no longer sets the status bar style");
  assert.equal(
    style[1],
    "black-translucent",
    "the status bar style changed; the light-theme band exists only because this one draws the status bar over the page — re-decide the band rather than leaving it",
  );
});

test("the band is gated on the installed app, and the gate is set from navigator.standalone", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const gate = scripts.find((source) => source.includes("data-ios-standalone"));
  assert.ok(gate, "nothing in index.html marks the installed app, so the band never applies");
  assert.match(
    gate,
    /if\s*\(\s*navigator\.standalone\s*===\s*true\s*\)\s*\{\s*document\.documentElement\.setAttribute\("data-ios-standalone",\s*""\);\s*\}/,
    "the installed-app marker is no longer set exactly when navigator.standalone is true",
  );
});

test("the band covers exactly the status bar, takes no taps, and sits above everything", () => {
  const rules = parseRules(css).filter((rule) => rule.selectors.includes(SELECTOR));
  assert.equal(rules.length, 1, `${SELECTOR} is declared ${rules.length} times`);
  const [rule] = rules;
  assert.equal(rule.at.length, 0, "the band went under a condition");
  const declared = (property) => rule.body.match(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`))?.[1]?.trim();
  assert.equal(declared("content"), '""');
  assert.equal(declared("position"), "fixed");
  assert.equal(declared("top"), "0");
  assert.equal(declared("height"), "var(--kub-safe-top)", "the band is not the status bar's own height");
  assert.equal(declared("pointer-events"), "none", "the band would swallow taps on the chrome under it");
  assert.ok(Number(declared("z-index")) >= 2147483647, "a dialog could paint over the band and put its header under the glyphs");
});

test("the band is opaque, and white and dark glyphs both clear 4.5:1 on it", () => {
  const rule = parseRules(css).find((candidate) => candidate.selectors.includes(SELECTOR));
  assert.ok(rule);
  // Opaque, so what scrolls under the header cannot change what the glyphs
  // stand on. A translucent veil would have to be measured against the worst
  // ground it can hold, and the one this replaced turned the band grey.
  const fill = rule.body.match(/background-color\s*:\s*#([0-9a-f]{6})\s*;/i);
  assert.ok(fill, "the band's colour is not an opaque #rrggbb — a translucent band changes with whatever is under it");
  assert.equal(rule.body.match(/background-image\s*:/), null, "the band grew an image, which the arithmetic below cannot see");
  const colour = [0, 2, 4].map((index) => parseInt(fill[1].slice(index, index + 2), 16));

  // Which colour iOS gives the glyphs is not the page's to decide, so the band
  // has to carry both: 4.5:1 for white and for black. Both are possible only
  // for a relative luminance between 0.175 and 0.1833.
  const ground = luminance(colour);
  const white = (1 + 0.05) / (ground + 0.05);
  const dark = (ground + 0.05) / (0 + 0.05);
  assert.ok(
    white >= 4.5,
    `white status-bar glyphs measure ${white.toFixed(2)}:1 on #${fill[1]} — the clock is text, and text needs 4.5:1`,
  );
  assert.ok(
    dark >= 4.5,
    `dark status-bar glyphs measure ${dark.toFixed(2)}:1 on #${fill[1]} — the clock is text, and text needs 4.5:1`,
  );
});
