import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The status chip must be readable on every surface it sits on.
 *
 * It used to paint the label in the tone over an 18% tint of the same tone.
 * Measured across the three surfaces a badge appears on, that pairing ranged
 * from 3.17:1 to 5.55:1, and the audit caught "Активна" at 2.62:1.
 *
 * Removing the tint alone does not fix it, which is why this test checks both
 * halves: on `--kub-surface-3` the tone as a label still measures 4.05:1 for
 * cyan, 4.18:1 for pink and 3.82:1 for danger. The label therefore takes the
 * interface text colour and the tone moves to the dot and border, where 3:1
 * applies. Tokens and tones are read out of the source so a new tone or a
 * changed token is covered automatically.
 */

const css = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");
const badge = readFileSync(
  new URL("../../artifacts/kub/src/components/kub/KubBadge.tsx", import.meta.url),
  "utf8",
);

const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

function themeBlock(name) {
  const match = css.match(new RegExp(`\\.${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `the ${name} theme block is missing`);
  return match[1];
}

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

/** The tones the component actually declares, not a list copied here. */
function tones() {
  const block = badge.match(/type Tone = ([^;]+);/);
  assert.ok(block, "the Tone union could not be found");
  const names = block[1].match(/"([a-z]+)"/g)?.map((entry) => entry.replaceAll('"', "")) ?? [];
  assert.ok(names.length >= 4, `expected a real tone set, found ${names.length}`);
  return names;
}

const SURFACES = ["kub-surface", "kub-surface-2", "kub-surface-3"];

for (const theme of ["dark", "light"]) {
  test(`the status label is readable on every surface in the ${theme} theme`, () => {
    const block = themeBlock(theme);
    const label = token(block, "kub-text");
    for (const surface of SURFACES) {
      const background = token(block, surface);
      const ratio = contrast(label, background);
      assert.ok(
        ratio >= 4.5,
        `${theme}: the label ${label} on --${surface} ${background} measures ${ratio.toFixed(2)}:1`,
      );
    }
  });

  test(`every tone stays distinguishable as a dot in the ${theme} theme`, () => {
    const block = themeBlock(theme);
    for (const tone of tones()) {
      const value = token(block, tone === "muted" ? "kub-muted" : `kub-${tone}`);
      for (const surface of SURFACES) {
        const background = token(block, surface);
        const ratio = contrast(value, background);
        // A dot and a border are non-text interface, held to 3:1.
        assert.ok(
          ratio >= 3,
          `${theme}: tone ${tone} (${value}) on --${surface} ${background} measures ${ratio.toFixed(2)}:1, below 3:1`,
        );
      }
    }
  });
}

test("the label is not painted in the tone", () => {
  assert.match(
    badge,
    /text-\[color:var\(--kub-text\)\]/,
    "the label must take the interface text colour",
  );
  assert.doesNotMatch(
    badge,
    /text-\[color:var\(--kub-(cyan|pink|online|danger|warn|muted)\)\]/,
    "painting the label in the tone is the pairing that failed; it must not come back",
  );
});

test("the tinted background does not come back", () => {
  assert.doesNotMatch(
    badge,
    /bg-\[color-mix/,
    "a tint of the tone behind a label of the same tone is exactly what measured 2.62:1",
  );
});

test("a coloured tone carries a dot, so colour is never the only signal", () => {
  assert.match(
    badge,
    /dot \?\? tone !== "muted"/,
    "with a neutral label the dot is what carries the tone; it must be on by default",
  );
});
