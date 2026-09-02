import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A filled button's label must be readable on its own fill, at rest and on
 * hover.
 *
 * The destructive button was white on `--kub-danger`, which in the dark theme
 * is `#EF4444` — measured on the live invites screen, 3.76:1. It could not be
 * fixed by darkening `--kub-danger`, because that same token is the dot on a
 * badge and the rail on a notice, where a light red is what clears 3:1 against
 * a dark surface. One value cannot be both, so the fill became its own token.
 *
 * The pairs are read out of the stylesheet rather than listed here, so a new
 * filled action is covered the moment it declares its tokens. The hover value
 * is checked too: the variant used to reach hover with `brightness-110`, which
 * lightens the fill and walks straight back into the failure.
 */

const css = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");
const button = readFileSync(
  new URL("../../artifacts/kub/src/components/kub/KubButton.tsx", import.meta.url),
  "utf8",
);

function themeBlock(name) {
  const match = css.match(new RegExp(`\\.${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `the ${name} theme block is missing`);
  return match[1];
}

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
    if (!reference) {
      assert.match(value, /^#[0-9A-Fa-f]{3,8}$/, `--${current} resolved to "${value}"`);
      return value;
    }
    current = reference[1];
  }
  throw new Error(`--${name} did not resolve to a colour`);
}

function luminance(hex) {
  const full = hex.replace("#", "");
  const expanded = full.length === 3 ? full.split("").map((c) => c + c).join("") : full;
  const channel = (offset) => {
    const value = Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Every filled action the stylesheet declares, by its token family name. */
function actions() {
  const names = [
    ...new Set(
      [...css.matchAll(/--kub-action-([a-z]+)-background:/g)].map((match) => match[1]),
    ),
  ];
  assert.ok(names.length >= 2, `expected several filled actions, found ${names.join(", ")}`);
  return names;
}

for (const theme of ["dark", "light"]) {
  test(`every filled action is readable at rest in the ${theme} theme`, () => {
    const block = themeBlock(theme);
    for (const action of actions()) {
      const foreground = token(block, `kub-action-${action}-foreground`);
      const background = token(block, `kub-action-${action}-background`);
      const ratio = contrast(foreground, background);
      assert.ok(
        ratio >= 4.5,
        `${theme}: ${action} label ${foreground} on ${background} measures ${ratio.toFixed(2)}:1`,
      );
    }
  });

  test(`every filled action stays readable on hover in the ${theme} theme`, () => {
    const block = themeBlock(theme);
    for (const action of actions()) {
      const foreground = token(block, `kub-action-${action}-foreground`);
      const hover = token(block, `kub-action-${action}-hover`);
      const ratio = contrast(foreground, hover);
      assert.ok(
        ratio >= 4.5,
        `${theme}: ${action} label ${foreground} on hover ${hover} measures ${ratio.toFixed(2)}:1`,
      );
    }
  });
}

test("the destructive fill is not the danger tone", () => {
  assert.doesNotMatch(
    button,
    /bg-\[var\(--kub-danger\)\]/,
    "the tone is tuned to be visible as a dot on a dark surface, which makes it too light to carry white text",
  );
  assert.match(button, /bg-\[var\(--kub-action-danger-background\)\]/);
});

test("hover is a declared colour, not a filter over the fill", () => {
  assert.doesNotMatch(
    button,
    /hover:brightness-\d+/,
    "brightening a fill that only just passes walks straight back into the failure",
  );
});
