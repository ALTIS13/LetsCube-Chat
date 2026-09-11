import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ruleBody } from "./helpers/css.mjs";

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

/**
 * Every surface the product paints a coloured word on with these two tokens.
 *
 * The reader's own bubble left this list on 2026-09-11. It is royal blue since
 * the chat screen took option C, and nothing inside it paints with the theme's
 * accent or red any more: `.kub-message-own` hands it words of its own, which
 * the tests further down hold.
 */
const SURFACES = [
  "kub-bg",
  "kub-surface",
  "kub-surface-2",
  "kub-surface-3",
  "kub-message-in",
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
 * The reader's own bubble carries words of its own.
 *
 * Royal blue since the owner chose option C for the chat screen on 2026-09-11.
 * `.kub-message-own` hands everything inside the bubble a white word, a meta
 * line at .86 white, a rose warning for a failed send, and a darker step of the
 * blue for every well. The bubble is opaque, so these pairs are exact
 * arithmetic, and they are read from the rule and the tokens, so moving either
 * moves the number.
 *
 * The grounds are the bubble itself, the well whole — the read-receipt chip —
 * and the well at every translucent strength `MessageBubble` lays it at, read
 * from the component: a reply preview, a reaction chip.
 */
const ownRule = ruleBody(css, ".kub-message-own");
const bubbleSource = readFileSync(new URL("components/chat/MessageBubble.tsx", root), "utf8");

function mappedInOwnBubble(block, name) {
  const found = ownRule.match(new RegExp(`--${name}:\\s*var\\(--([\\w-]+)\\)`));
  assert.ok(found, `.kub-message-own no longer hands --${name} a token`);
  return token(block, found[1]);
}

/** A colour, possibly translucent, laid over an opaque ground given as rgb. */
function over(colour, ground) {
  const [r, g, b, a = 1] = rgbOf(colour);
  return [r * a + ground[0] * (1 - a), g * a + ground[1] * (1 - a), b * a + ground[2] * (1 - a)];
}

for (const theme of ["dark", "light"]) {
  test(`the words inside the reader's own bubble are legible in the ${theme} theme`, () => {
    const block = themeBlock(theme);
    const bubble = rgbOf(token(block, "kub-message-out")).slice(0, 3);
    const well = rgbOf(token(block, "kub-message-out-well")).slice(0, 3);
    const strengths = [...bubbleSource.matchAll(/var\(--kub-surface-2\)_(\d+)%,transparent/g)].map((m) => Number(m[1]));
    assert.ok(strengths.length >= 2, "the bubble's translucent wells could not be read from the component");
    const grounds = [
      ["the bubble", bubble],
      ["a well", well],
      ...strengths.map((percent) => [`a well at ${percent}%`, [0, 1, 2].map((i) => (well[i] * percent + bubble[i] * (100 - percent)) / 100)]),
    ];

    for (const word of ["kub-text", "kub-muted", "kub-accent-text", "kub-danger-text"]) {
      const colour = mappedInOwnBubble(block, word);
      for (const [where, ground] of grounds) {
        const ratio = contrast(over(colour, ground), ground);
        assert.ok(ratio >= 4.5, `--${word} inside the own bubble (${colour}) on ${where} measures ${ratio.toFixed(2)}:1, under 4.5:1`);
      }
    }
    // Every well is that one blue. A surface token left to the theme is
    // near-white in the light theme, where the white words over it vanished.
    for (const surface of ["kub-surface-2", "kub-surface-3", "kub-inset"]) {
      assert.equal(mappedInOwnBubble(block, surface), token(block, "kub-message-out-well"), `--${surface} inside the own bubble is not its well`);
    }
    // The numbers that made the words its own: the theme's accent and red on
    // the blue. The day either passes, the rule can be revisited — photograph
    // the bubble before believing it.
    for (const word of ["kub-accent-text", "kub-danger-text"]) {
      const ratio = contrast(rgbOf(token(block, word)), bubble);
      assert.ok(ratio < 4.5, `the theme's --${word} now measures ${ratio.toFixed(2)}:1 on the own bubble`);
    }
  });
}

/**
 * The chat screen's own grey and accent.
 *
 * `.kub-chat-screen` hands the chat pane these as --kub-muted and
 * --kub-accent-text, because a blue bubble scrolling under the translucent
 * capsules took the product's pair under the floor. Held here against the flat
 * grounds they sit on: the conversation's ground, an incoming bubble, and a
 * covering panel over the worst field. The wallpaper's pattern and pools move
 * the ground under a word, which only a photograph measures;
 * scripts/render-chat-chrome-frames.mjs does.
 */
const chatScreenRule = ruleBody(css, ".kub-chat-screen");

for (const theme of ["dark", "light"]) {
  test(`the chat screen's grey and accent are legible in the ${theme} theme`, () => {
    const block = themeBlock(theme);
    for (const [word, chatToken] of [
      ["kub-muted", "kub-chat-muted"],
      ["kub-accent-text", "kub-chat-accent-text"],
    ]) {
      assert.match(chatScreenRule, new RegExp(`--${word}:\\s*var\\(--${chatToken}\\)`), `.kub-chat-screen no longer hands the pane --${chatToken}`);
      const colour = rgbOf(token(block, chatToken));
      for (const [where, ground] of [
        ["the conversation's ground", rgbOf(token(block, "kub-chat-ground"))],
        ["an incoming bubble", rgbOf(token(block, "kub-message-in"))],
        ["a covering panel over the worst field", composite(token(block, "glass-fill-strong"), WORST_FIELD[theme])],
      ]) {
        const ratio = contrast(colour, ground);
        assert.ok(ratio >= 4.5, `--${chatToken} on ${where} measures ${ratio.toFixed(2)}:1, under 4.5:1`);
      }
    }
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
  {
    file: "components/support/SupportWindow.tsx",
    what: "the timestamp on a support bubble, where the muted grey has no guaranteed ground",
    // The size is matched as a size, not as a literal. What this row guards is
    // the ink: the grey has no guaranteed ground here, so the timestamp is
    // written in `--kub-text`. A contrast ratio does not depend on the type
    // size, and the WCAG threshold does not move between 10px and 12px — both
    // are small text at 4.5:1 — so pinning the exact literal only bought a
    // false failure the day the bottom of the scale was raised. Pinning the
    // colour is the contract; pinning the pixel was an accident.
    expect: /mt-0\.5 text-right text-\[\d+px\] text-\[color:var\(--kub-text\)\]/,
  },
];

for (const site of SITES) {
  test(`${site.file} carries the right colour for ${site.what}`, () => {
    const source = readFileSync(new URL(site.file, root), "utf8");
    assert.match(source, site.expect);
  });
}


/**
 * Why the support window's timestamp is not the muted grey every other
 * timestamp uses.
 *
 * A chat bubble is opaque, so its meta line sits on a token value and the grey
 * is guaranteed there — measured, 5.91:1 in the dark theme and 4.80:1 in the
 * light one on `--kub-message-out`. The support window's bubbles are
 * translucent inside a panel that floats over whatever the messenger happens to
 * be showing, so their ground is whatever is behind the window. Photographed at
 * 10px on the fill the product paints, the grey measured 4.44:1 and 4.30:1; on
 * the worst ground this window can reach, 3.98:1 and 3.86:1.
 *
 * The timestamp has since moved to 12px with the rest of the bottom step, and
 * none of those numbers moves with it: a contrast ratio is a property of two
 * colours, and 12px is still small text, so the threshold is still 4.5:1. The
 * decision stands on the same measurement.
 *
 * Every fill that would have rescued the grey was measured too, and each failed
 * for its own reason: the veil the support bubble already uses is 4.31:1 on the
 * same worst ground, and `--kub-message-out` passes but composites to within
 * 1.01 of the window in the dark theme, which is a bubble nobody can see. So it
 * is the ink that changed.
 *
 * This asserts the number that made the decision, not the decision, so lifting
 * the panel's opacity — or moving the grey — is what breaks it.
 */

/**
 * The support window's own bubble, which is the one place a timestamp has no
 * guaranteed ground.
 *
 * A chat bubble is opaque, so its meta line sits on a token value and the muted
 * grey is safe there — 5.91:1 in the dark theme and 4.80:1 in the light one on
 * `--kub-message-out`. The support window's bubbles are a wash over a panel
 * that floats above whatever the messenger happens to be showing, so their
 * ground is whatever is behind the window. Photographed at 10px on the fill the
 * product paints, the grey measured 4.44:1 and 4.30:1; the arithmetic below,
 * against the worst ground the window can reach, agrees with the picture. The
 * timestamp is 12px now, which moves neither number nor the 4.5:1 threshold it
 * is judged against.
 *
 * Every fill that would have rescued the grey was measured too, and each failed
 * for its own reason: the veil the support bubble already uses is 4.31:1 on the
 * same worst ground, and `--kub-message-out` passes but composites to within
 * 1.01 of the window in the dark theme, which is a bubble nobody can see. So it
 * is the ink that changed, and the assertion is the number that decided it.
 */
const supportSource = readFileSync(new URL("components/support/SupportWindow.tsx", root), "utf8");

/** `color-mix(in srgb, X p%, over)` — the form the bubble is written in. */
function mixOver(colour, percent, over) {
  const c = rgbOf(colour);
  return [0, 1, 2].map((i) => Math.round((c[i] * percent + over[i] * (100 - percent)) / 100));
}

/** The person's own support bubble, on the worst ground its window can reach. */
function ownBubbleGround(theme) {
  const block = themeBlock(theme);
  const panel = composite(token(block, "glass-fill-strong"), WORST_FIELD[theme]);
  // Read from the component: a change to the wash has to move this number, not
  // leave a stale constant passing.
  const wash = supportSource.match(/var\(--kub-cyan\)_(\d+)%,transparent/);
  assert.ok(wash, "the own support bubble's fill could not be read from the component");
  return mixOver(token(block, "kub-cyan"), Number(wash[1]), panel);
}

for (const theme of ["dark", "light"]) {
  test(`the muted grey cannot carry the support timestamp in the ${theme} theme`, () => {
    const ground = ownBubbleGround(theme);
    const ratio = contrast(rgbOf(token(themeBlock(theme), "kub-muted")), ground);
    assert.ok(
      ratio < 4.5,
      `--kub-muted now measures ${ratio.toFixed(2)}:1 on rgb(${ground}). If that is real ` +
        `the timestamp can go back to it, but photograph the bubble before believing it.`,
    );
  });

  test(`the ink the support timestamp uses instead does carry it in the ${theme} theme`, () => {
    const ground = ownBubbleGround(theme);
    const ratio = contrast(rgbOf(token(themeBlock(theme), "kub-text")), ground);
    assert.ok(
      ratio >= 4.5,
      `--kub-text measures ${ratio.toFixed(2)}:1 on rgb(${ground}), under the 4.5:1 a word needs`,
    );
  });
}
