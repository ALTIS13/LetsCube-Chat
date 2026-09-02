import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * D-011: the accent colour must be legible as text in both themes.
 *
 * The values are read out of `index.css` rather than restated here, so a token
 * change is what this test measures. A copied palette would keep passing while
 * the product drifted, which is the failure mode this stage exists to catch.
 */

const css = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");

function themeBlock(name) {
  const match = css.match(new RegExp(`\\.${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `the ${name} theme block could not be found`);
  return match[1];
}

const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

function token(block, name) {
  // Indirection is followed to a colour, not one hop. A single hop left
  // `--kub-action-primary-background` as the literal string "var(--brand-blue)"
  // and the contrast came out NaN, which asserts nothing while looking failed.
  let current = name;
  for (let hop = 0; hop < 8; hop += 1) {
    const inBlock = block.match(new RegExp(`--${current}:\\s*([^;]+);`));
    const inRoot = rootBlock.match(new RegExp(`--${current}:\\s*([^;]+);`));
    const found = inBlock ?? inRoot;
    assert.ok(found, `--${current} could not be resolved`);
    const value = found[1].trim();
    const reference = value.match(/^var\(--([\w-]+)\)$/);
    if (!reference) {
      assert.match(value, /^#[0-9A-Fa-f]{3,8}$/, `--${current} resolved to "${value}", which is not a colour`);
      return value;
    }
    current = reference[1];
  }
  throw new Error(`--${name} did not resolve to a colour within 8 hops`);
}

function contrast(a, b) {
  const luminance = (hex) => {
    const full = hex.replace("#", "");
    const expanded = full.length === 3 ? full.split("").map((c) => c + c).join("") : full;
    const channel = (offset) => {
      const value = Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  };
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

for (const theme of ["light", "dark"]) {
  test(`the accent colour is legible as text in the ${theme} theme`, () => {
    const block = themeBlock(theme);
    const background = token(block, "kub-bg");
    const surface = token(block, "kub-surface");

    // Both accents, not just the blue. The pink is used for section eyebrows
    // and failed the same way; checking only the blue would have left it.
    for (const name of ["kub-cyan", "kub-pink"]) {
      const accent = token(block, name);
      for (const [label, against] of [["the page background", background], ["a surface", surface]]) {
        const ratio = contrast(accent, against);
        assert.ok(
          ratio >= 4.5,
          `${theme}: --${name} ${accent} on ${against} (${label}) measures ${ratio.toFixed(2)}:1, below 4.5:1`,
        );
      }
    }
  });

  test(`the primary button's own label is legible in the ${theme} theme`, () => {
    const block = themeBlock(theme);
    const foreground = token(block, "kub-action-primary-foreground");
    const background = token(block, "kub-action-primary-background");
    const ratio = contrast(foreground, background);
    assert.ok(
      ratio >= 4.5,
      `${theme}: label ${foreground} on ${background} measures ${ratio.toFixed(2)}:1, below 4.5:1`,
    );
  });

  test(`the hover shade stays distinguishable and legible in the ${theme} theme`, () => {
    const block = themeBlock(theme);
    const accent = token(block, "kub-cyan");
    const hover = token(block, "kub-cyan-hover");
    const background = token(block, "kub-bg");

    assert.notEqual(hover.toLowerCase(), accent.toLowerCase(), "hover must differ from the resting accent");
    const ratio = contrast(hover, background);
    assert.ok(ratio >= 4.5, `${theme}: hover ${hover} on ${background} measures ${ratio.toFixed(2)}:1, below 4.5:1`);
  });
}
