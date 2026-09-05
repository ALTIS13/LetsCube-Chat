import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/**
 * The overlay layer is made of one material, and the material is defined in one
 * place.
 *
 * `.kub-glass` / `.kub-glass-strong` in index.css carry the fill, the frosting
 * and the shadow. A primitive that keeps its own `bg-popover` or `shadow-lg`
 * beside them is not using the material — it is competing with it, and which
 * one wins depends on stylesheet order rather than on a decision. So the
 * surface classes and the glass class are asserted to be mutually exclusive.
 *
 * The contrast numbers are not taken on trust either. `--glass-fill-strong` is
 * composited over the worst ground a panel can land on — a flat white field in
 * the dark theme, a flat black one in the light theme, since a blur cannot make
 * a uniform field brighter or darker than itself — and the result must still
 * carry both `--foreground` and `--muted-foreground` at 4.5:1. The arithmetic
 * here was checked against the compositor: it predicts rgb(38,50,67) for the
 * dark theme and rgb(235,235,235) for the light one, and Chromium's own pixels
 * on those panels measured exactly that.
 */

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const uiDir = new URL("components/ui/", root);
import { atRuleTexts } from "./helpers/css.mjs";

const css = readFileSync(new URL("index.css", root), "utf8");
const read = (file) => readFileSync(new URL(file, uiDir), "utf8");

/** The surface-bearing class string of each overlay, found by a landmark. */
const surfaces = [
  ["dialog.tsx", "translate-y-[-50%]"],
  ["alert-dialog.tsx", "translate-y-[-50%]"],
  ["dropdown-menu.tsx", "min-w-[8rem] overflow-hidden"],
  ["dropdown-menu.tsx", "radix-dropdown-menu-content-available-height"],
  ["context-menu.tsx", "min-w-[8rem] overflow-hidden"],
  ["context-menu.tsx", "radix-context-menu-content-available-height"],
  ["popover.tsx", "radix-popover-content-transform-origin"],
  ["hover-card.tsx", "radix-hover-card-content-transform-origin"],
  ["tooltip.tsx", "radix-tooltip-content-transform-origin"],
  ["select.tsx", "radix-select-content-available-height"],
  ["menubar.tsx", "h-9 items-center space-x-1"],
  ["menubar.tsx", "radix-menubar-content-transform-origin"],
  ["navigation-menu.tsx", "origin-top-center"],
  ["sheet.tsx", "fixed z-50 gap-4"],
  ["drawer.tsx", "rounded-t-[10px]"],
  ["toast.tsx", "border kub-glass-strong text-foreground"],
];

/** Every modal scrim: a dimmer that must still leave the page visible. */
const scrims = ["dialog.tsx", "alert-dialog.tsx", "sheet.tsx", "drawer.tsx"];

function classString(file, needle) {
  const hit = [...read(file).matchAll(/"([^"\n]{20,})"/g)]
    .map((match) => match[1])
    .find((value) => value.includes(needle));
  assert.ok(hit, `${file}: no class string containing "${needle}"`);
  return hit;
}

for (const [file, needle] of surfaces) {
  test(`${file} (${needle}) takes its surface from the glass utilities`, () => {
    const classes = classString(file, needle);
    assert.match(
      classes,
      /\bkub-glass(-strong)?\b/,
      `${file} builds an overlay surface without the glass utility`,
    );
    assert.doesNotMatch(
      classes,
      /\bbg-(popover|background|card)\b/,
      `${file} keeps an opaque fill beside the glass utility`,
    );
    assert.doesNotMatch(
      classes,
      /\bshadow(-(2xs|xs|sm|md|lg|xl|2xl))?\b(?!-)/,
      `${file} keeps its own shadow beside --glass-shadow`,
    );
  });
}

/** Comments explain the measurements; only the code is under this rule. */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("the overlay layer never writes the material by hand", () => {
  for (const file of readdirSync(uiDir).filter((name) => name.endsWith(".tsx"))) {
    const source = withoutComments(read(file));
    if (!/\bkub-glass(-strong)?\b/.test(source)) continue;
    assert.doesNotMatch(source, /backdrop-filter|backdropFilter/i, `${file} writes its own frosting`);
    assert.doesNotMatch(source, /\brgba?\(/, `${file} writes its own fill`);
    assert.doesNotMatch(source, /box-shadow|boxShadow/i, `${file} writes its own shadow`);
  }
});

for (const file of scrims) {
  test(`${file} dims the page without erasing it`, () => {
    const found = read(file).match(/fixed inset-0 z-50\s+bg-black\/(\d+)/);
    assert.ok(found, `${file}: no scrim with a readable opacity`);
    const alpha = Number(found[1]);
    // Above this the frosted panel over it samples a flat rectangle and the
    // material disappears; the dialog reads as a plain dark box.
    assert.ok(alpha <= 60, `${file}: a ${alpha}% scrim leaves the panel's blur nothing to sample`);
  });
}

const themeBlock = (name) => {
  const match = css.match(new RegExp(`\\.${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `the ${name} theme block is missing`);
  return match[1];
};

const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

function token(block, name) {
  let current = name;
  for (let hop = 0; hop < 8; hop += 1) {
    const found =
      block.match(new RegExp(`--${current}:\\s*([^;]+);`)) ??
      rootBlock.match(new RegExp(`--${current}:\\s*([^;]+);`));
    assert.ok(found, `--${current} could not be resolved`);
    const value = found[1].trim();
    const reference = value.match(/^var\(--([\w-]+)\)$/);
    if (!reference) return value;
    current = reference[1];
  }
  throw new Error(`--${name} did not resolve`);
}

function rgb(value) {
  const hex = value.match(/^#([0-9A-Fa-f]{3,8})$/)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16));
  }
  const parts = value.match(/[\d.]+/g);
  assert.ok(parts && parts.length >= 3, `"${value}" is not a colour`);
  return parts.slice(0, 3).map(Number);
}

const alphaOf = (value) => Number(value.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/)?.[1] ?? 1);

/** hsl() token, as the theme writes them: "212 68.12% 13.53%". */
function hslToRgb(value) {
  const [h, s, l] = value.match(/[\d.]+/g).map(Number);
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][Math.floor(h / 60) % 6];
  return [r, g, b].map((channel) => Math.round((channel + m) * 255));
}

const channel = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fill, alpha, ground) =>
  fill.map((c, i) => Math.round(alpha * c + (1 - alpha) * ground[i]));

for (const [theme, ground] of [["dark", [255, 255, 255]], ["light", [0, 0, 0]]]) {
  test(`${theme}: a strong overlay stays readable over the worst ground it can land on`, () => {
    const block = themeBlock(theme);
    const fill = token(block, "glass-fill-strong");
    const surface = over(rgb(fill), alphaOf(fill), ground);

    for (const name of ["foreground", "muted-foreground"]) {
      const text = hslToRgb(token(block, name));
      const ratio = contrast(text, surface);
      assert.ok(
        ratio >= 4.5,
        `--${name} measures ${ratio.toFixed(2)}:1 on rgb(${surface}) — the fill is what has to give`,
      );
    }
  });

  test(`${theme}: a browser that cannot frost still gets an opaque overlay`, () => {
    const fallbacks = atRuleTexts(css, /^@supports not \(backdrop-filter/);
    assert.ok(fallbacks.length > 0, "the no-backdrop-filter fallback is missing");
    const fallback = fallbacks.join("\n");
    const name = fallback.match(/\.kub-glass-strong\s*\{\s*background-color:\s*var\(--([\w-]+)\)/)?.[1];
    assert.ok(name, "the fallback gives .kub-glass-strong no fill");

    const surface = rgb(token(themeBlock(theme), name));
    assert.equal(alphaOf(token(themeBlock(theme), name)), 1, `--${name} is not opaque`);
    for (const text of ["foreground", "muted-foreground"]) {
      const ratio = contrast(hslToRgb(token(themeBlock(theme), text)), surface);
      assert.ok(ratio >= 4.5, `--${text} measures ${ratio.toFixed(2)}:1 on the fallback fill`);
    }
  });
}
