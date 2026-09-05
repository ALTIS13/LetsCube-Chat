import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The two colours that carry words, held to the threshold words are held to.
 *
 * `--kub-danger` and `--kub-cyan` answer a 3:1 requirement as fills, borders and
 * icon shapes, and they meet it. Neither reaches 4.5:1 as a word on the surfaces
 * this product actually paints text on, so `--kub-danger-text` and
 * `--kub-accent-text` exist for the reading that lands on letters.
 *
 * Everything here is read out of `index.css`, including the composite: the worst
 * backdrop a floating panel can reach is `--glass-fill-strong` over a solid
 * field, and that value is computed from the token rather than restated. Lower
 * the panel's alpha and this test is what says the text stopped being legible.
 * A copied palette would keep passing while the product drifted.
 *
 * Cross-checked against rendered pixels in Chromium: the light composite matches
 * the arithmetic exactly, and the dark one renders slightly darker than the
 * arithmetic predicts, so this file is the conservative of the two.
 */

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const css = readFileSync(new URL("index.css", root), "utf8");
const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

function themeBlock(name) {
  const match = css.match(new RegExp(`\\.${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `the ${name} theme block could not be found`);
  return match[1];
}

/** Follows `var()` indirection to an actual colour, not one hop. */
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
  throw new Error(`--${name} did not resolve within 8 hops`);
}

function rgbOf(value) {
  const hex = value.match(/^#([0-9A-Fa-f]{3,8})$/);
  if (hex) {
    const full = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
  }
  const rgba = value.match(/^rgba?\(([^)]+)\)$/);
  assert.ok(rgba, `"${value}" is not a colour this test can read`);
  const parts = rgba[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

/** Source-over: what a translucent fill actually becomes on a given field. */
function composite(value, field) {
  const [r, g, b, a] = rgbOf(value);
  const [fr, fg, fb] = rgbOf(field);
  return [r * a + fr * (1 - a), g * a + fg * (1 - a), b * a + fb * (1 - a)].map(Math.round);
}

function luminance([r, g, b]) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * A blur cannot make a uniform field lighter or darker than itself, so a solid
 * white page under the dark theme — and a solid black one under the light theme
 * — really is the limit of what a panel can composite towards.
 */
const WORST_FIELD = { dark: "#FFFFFF", light: "#000000" };

/** Every surface the product paints a coloured word on. */
const SURFACES = [
  "kub-bg",
  "kub-surface",
  "kub-surface-2",
  "kub-surface-3",
  "kub-message-in",
  "kub-message-out",
];

for (const theme of ["dark", "light"]) {
  test(`the colours that carry words are legible in the ${theme} theme`, () => {
    const block = themeBlock(theme);

    for (const name of ["kub-danger-text", "kub-accent-text"]) {
      const colour = rgbOf(token(block, name));

      for (const surface of SURFACES) {
        const ratio = contrast(colour, rgbOf(token(block, surface)));
        assert.ok(
          ratio >= 4.5,
          `--${name} on --${surface} measures ${ratio.toFixed(2)}:1, under the 4.5:1 a word needs`,
        );
      }

      // The floating panels — menus, dialogs, toasts, the profile card — sample
      // whatever they cover, and what they cover can be a photograph.
      const panel = composite(token(block, "glass-fill-strong"), WORST_FIELD[theme]);
      const onPanel = contrast(colour, panel);
      assert.ok(
        onPanel >= 4.5,
        `--${name} on a floating panel over ${WORST_FIELD[theme]} composites to ` +
          `rgb(${panel}) and measures ${onPanel.toFixed(2)}:1, under 4.5:1`,
      );
    }

    // The pair has to stay a pair. Aliasing either text token back onto the
    // shape token is the exact regression these two exist to prevent, and it
    // would otherwise leave every assertion above passing on the same value.
    assert.notEqual(token(block, "kub-danger-text"), token(block, "kub-danger"));
    assert.notEqual(token(block, "kub-accent-text"), token(block, "kub-cyan"));
  });
}

/**
 * Where the rule is applied. Four sites, each a different way for the product to
 * say something in colour, so a revert of one class of them cannot hide behind
 * the others. Icons keep the shape tokens on purpose and are asserted too —
 * without that, "replace every occurrence" would pass this file.
 */
const SITES = [
  {
    file: "components/chat/ChatInfoPanel.tsx",
    what: "the destructive row — leaving a group, deleting a chat",
    expect: /dangerActionRowClass[\s\S]{0,400}text-\[color:var\(--kub-danger-text\)\]/,
  },
  {
    file: "components/kub/KubInput.tsx",
    what: "the error under a field",
    expect: /id=\{errorId\}[^\n]*text-\[color:var\(--kub-danger-text\)\]/,
  },
  {
    file: "lib/formatText.tsx",
    what: "links and mentions inside a message",
    expect: /const LINK_COLOR = "var\(--kub-accent-text\)"/,
  },
  {
    file: "lib/notificationPresentation.ts",
    what: "a notification's tone where it lands on a label",
    expect: /TONE_TEXT_COLOR[\s\S]{0,200}message: "var\(--kub-accent-text\)"[\s\S]{0,200}system: "var\(--kub-danger-text\)"/,
  },
  {
    file: "components/kub/KubIcon.tsx",
    what: "an icon tone, which is a shape and stays on the shape token",
    expect: /accent: "text-\[color:var\(--kub-cyan\)\]"[\s\S]{0,120}danger: "text-\[color:var\(--kub-danger\)\]"/,
  },
];

for (const site of SITES) {
  test(`${site.file} carries the right colour for ${site.what}`, () => {
    const source = readFileSync(new URL(site.file, root), "utf8");
    assert.match(source, site.expect);
  });
}
