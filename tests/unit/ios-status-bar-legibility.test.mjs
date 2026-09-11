import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseRules } from "./helpers/css.mjs";

/**
 * The installed iPhone app's status bar stays readable in the light theme.
 *
 * `black-translucent` draws the status bar over the page with white glyphs,
 * whatever the page is. With `viewport-fit=cover` the page is under it, and in
 * the light theme the header's glass is nearly white: photographed, the clock
 * and the battery vanished into it. The meta tag cannot follow the theme — iOS
 * reads it once, when the app is added to the home screen — so the page lays a
 * veil over exactly the band the glyphs sit in.
 *
 * Three things are held here, each because it is the one that breaks quietly:
 * the premise (the status bar really is the white one), the gate (installed
 * app only, never Android, whose light-theme icons are dark), and the density
 * of the veil, worked out against the worst thing the band can hold.
 */

const html = readFileSync(new URL("../../artifacts/kub/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");

const SELECTOR = "html.light[data-ios-standalone] body::before";

const channel = (value) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

test("the premise: the status bar is the translucent one with white glyphs", () => {
  const style = html.match(/<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="([^"]+)"/);
  assert.ok(style, "index.html no longer sets the status bar style");
  assert.equal(
    style[1],
    "black-translucent",
    "the status bar style changed; the light-theme veil exists only because this one draws white glyphs over the page — re-decide the veil rather than leaving it",
  );
});

test("the veil is gated on the installed app, and the gate is set from navigator.standalone", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const gate = scripts.find((source) => source.includes("data-ios-standalone"));
  assert.ok(gate, "nothing in index.html marks the installed app, so the veil never applies");
  assert.match(
    gate,
    /if\s*\(\s*navigator\.standalone\s*===\s*true\s*\)\s*\{\s*document\.documentElement\.setAttribute\("data-ios-standalone",\s*""\);\s*\}/,
    "the installed-app marker is no longer set exactly when navigator.standalone is true",
  );
});

test("the veil covers exactly the status bar's band, takes no taps, and sits above everything", () => {
  const rules = parseRules(css).filter((rule) => rule.selectors.includes(SELECTOR));
  assert.equal(rules.length, 1, `${SELECTOR} is declared ${rules.length} times`);
  const [rule] = rules;
  assert.equal(rule.at.length, 0, "the veil went under a condition");
  const declared = (property) => rule.body.match(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`))?.[1]?.trim();
  assert.equal(declared("content"), '""');
  assert.equal(declared("position"), "fixed");
  assert.equal(declared("top"), "0");
  assert.equal(declared("height"), "var(--kub-safe-top)", "the veil is not the status bar's own height");
  assert.equal(declared("pointer-events"), "none", "the veil would swallow taps on the chrome under it");
  assert.ok(Number(declared("z-index")) >= 2147483647, "a dialog could paint over the veil and put its header under white glyphs");
});

test("white glyphs clear 4.5:1 over the worst ground the band can hold", () => {
  const rule = parseRules(css).find((candidate) => candidate.selectors.includes(SELECTOR));
  assert.ok(rule);
  const fill = rule.body.match(/background-color\s*:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
  assert.ok(fill, "the veil's colour is not an rgba() this test can measure");
  const [r, g, b, alpha] = fill.slice(1).map(Number);

  // The lightest thing that can be under the status bar in the light theme is
  // a white field — a panel's glass composites to just below white, and a
  // photograph scrolled behind the header can be white. A veil cannot make a
  // uniform field lighter than itself, so white is the bound.
  const ground = [255, 255, 255].map((value, index) => Math.round(alpha * [r, g, b][index] + (1 - alpha) * value));
  const ratio = (1 + 0.05) / (luminance(ground) + 0.05);
  assert.ok(
    ratio >= 4.5,
    `white status-bar glyphs measure ${ratio.toFixed(2)}:1 over rgb(${ground}) — the clock is text, and text needs 4.5:1`,
  );
});
