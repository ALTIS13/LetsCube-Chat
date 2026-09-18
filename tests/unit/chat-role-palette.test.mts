import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHAT_ROLE_COLOURS,
  CHAT_ROLE_COLOUR_KEYS,
  chatRoleColourLabel,
  chatRoleColourValue,
  chatRoleColourVariable,
  isChatRoleColour,
  readChatRoleColour,
} from "../../artifacts/kub/src/lib/chatRolePalette.ts";

/**
 * The per-group role palette must be readable as a WORD on every surface a
 * role tag can sit on, in both themes, and its entries must be tellable apart.
 *
 * This is D-214 turned into a contract. That defect measured the global
 * catalogue's free hex colours — owner `#F5B50A` at 1.83 / 1.63 / 1.50 in the
 * light theme, manager `#4DCD5E` at 2.06 / 1.83 / 1.69 — against a 3:1 floor
 * for a non-text mark, and found the cause in the numbers: the hexes were the
 * dark palette's own values, reused in a theme nobody had measured them in.
 * `20260918120000_chat_roles_and_member_tags.sql` therefore stores a palette
 * KEY rather than a hex, and the palette lives here, where it can be measured.
 *
 * Held to 4.5:1 and not 3:1 on purpose. The mechanic is Discord's, where the
 * colour is on the member's NAME. A token chosen for a dot cannot be moved
 * onto a word afterwards — `--kub-online` had to be split into
 * `--kub-online-text` for precisely that — so the harder threshold is checked
 * first, before a surface exists to be rewritten.
 *
 * The luminance and contrast arithmetic below is copied from
 * `tests/unit/status-badge-contrast.test.mjs` rather than reinvented, and the
 * ΔE*ab conversion shares the same channel linearisation, so there is exactly
 * one piece of colour arithmetic in this file and it is the one the rest of
 * the suite already uses.
 */

const css = readFileSync(new URL("../../artifacts/kub/src/index.css", import.meta.url), "utf8");

/**
 * Comments are stripped once, up front. A comment in this file may legitimately
 * quote a token name, and a commented-out declaration must not read as a live
 * one: without this, deleting a token by commenting it out would leave both the
 * enumeration and the value lookup green while the page painted nothing.
 */
const source = css.replace(/\/\*[\s\S]*?\*\//g, "");

const rootBlock = source.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

function themeBlock(name: string): string {
  const match = source.match(new RegExp(`\\.${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `the ${name} theme block is missing`);
  return match[1];
}

function token(block: string, name: string): string {
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

/** Channel linearisation, shared by the WCAG luminance and the Lab conversion. */
function linear(hex: string, offset: number): number {
  const full = hex.replace("#", "");
  const expanded = full.length === 3 ? full.split("").map((c) => c + c).join("") : full;
  const value = Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * linear(hex, 0) + 0.7152 * linear(hex, 2) + 0.0722 * linear(hex, 4);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * CIELAB under D65, from the same linear channels as above.
 *
 * ΔE*ab (CIE76) is the metric for «are these two the same colour». It is not
 * the most accurate of the ΔE family, but it is the simplest that accounts for
 * hue, chroma and lightness at once, and its scale is published: ~2.3 is the
 * just-noticeable difference, and ~10 is roughly where two swatches stop
 * sharing a colour name. Anything based on raw sRGB distance would have let
 * `#7C5F0E` and `#A5450D` — the light theme's amber and orange, and the pair
 * most at risk in this palette — pass or fail on which channel happened to
 * move, rather than on whether a person can tell them apart.
 */
function lab(hex: string): [number, number, number] {
  const r = linear(hex, 0);
  const g = linear(hex, 2);
  const b = linear(hex, 4);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(a: string, b: string): number {
  const [la, aa, ba] = lab(a);
  const [lb, ab, bb] = lab(b);
  return Math.hypot(la - lb, aa - ab, ba - bb);
}

/** Every surface a role tag can be laid on. The chip on a card sits on the last. */
const SURFACES = ["kub-surface", "kub-surface-2", "kub-surface-3"] as const;

const THEMES = ["dark", "light"] as const;

/**
 * A word, not a mark. D-214's own floor was 3:1 and even that was missed by
 * more than half; this is the threshold that lets a role's NAME take its
 * colour, which is the mechanic the palette exists for.
 */
const TEXT_CONTRAST_FLOOR = 4.5;

/**
 * Two entries may not be this close.
 *
 * ΔE*ab 20 is roughly twice the distance at which two swatches stop sharing a
 * colour name, and eight times the just-noticeable difference. It is set above
 * «technically different» because the thing being told apart is a short word in
 * a member list, often only a few characters wide, seen next to another one —
 * not two large fields side by side. Measured on 2026-09-18 the palette's
 * closest pairs are `blue`/`violet` at 28.0 in the dark theme and
 * `slate`/`teal` at 24.1 in the light one, so the floor leaves room for a ninth
 * hue without being loose enough to wave through a near-duplicate.
 */
const DISTINCTNESS_FLOOR = 20;

/** The shape `chat_roles.colour` is constrained to. Quoted, not built. */
const COLOUR_KEY_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;

/** The `--kub-role-*` tokens actually declared in a theme block. */
function declaredRoleTokens(block: string): string[] {
  return [...block.matchAll(/--kub-role-([a-z0-9_]+)\s*:/g)].map((match) => match[1]);
}

for (const theme of THEMES) {
  test(`every role colour is readable as a word on every surface in the ${theme} theme`, () => {
    const block = themeBlock(theme);
    for (const { key, label } of CHAT_ROLE_COLOURS) {
      const value = token(block, chatRoleColourVariable(key).slice(2));
      for (const surface of SURFACES) {
        const background = token(block, surface);
        const ratio = contrast(value, background);
        assert.ok(
          ratio >= TEXT_CONTRAST_FLOOR,
          `${theme}: role colour "${key}" («${label}») ${value} on --${surface} ${background} ` +
            `measures ${ratio.toFixed(2)}:1, below the ${TEXT_CONTRAST_FLOOR}:1 a role's name needs. ` +
            `D-214 is what this looks like when nobody checks: #F5B50A measured 1.50:1 here. ` +
            `Move the value along its own hue until it clears; do not lower the floor.`,
        );
      }
    }
  });

  test(`no two role colours read as the same colour in the ${theme} theme`, () => {
    const block = themeBlock(theme);
    const values = CHAT_ROLE_COLOURS.map(({ key, label }) => ({
      key,
      label,
      value: token(block, chatRoleColourVariable(key).slice(2)),
    }));
    for (let i = 0; i < values.length; i += 1) {
      for (let j = i + 1; j < values.length; j += 1) {
        const a = values[i];
        const b = values[j];
        const distance = deltaE(a.value, b.value);
        assert.ok(
          distance >= DISTINCTNESS_FLOOR,
          `${theme}: "${a.key}" («${a.label}») ${a.value} and "${b.key}" («${b.label}») ${b.value} ` +
            `are ΔE*ab ${distance.toFixed(1)} apart, under the ${DISTINCTNESS_FLOOR} two role tags ` +
            `need to be told apart in a member list. One of them has to move hue, not just lightness.`,
        );
      }
    }
  });

  test(`every palette key has its own token inside the ${theme} theme block`, () => {
    const block = themeBlock(theme);
    for (const key of CHAT_ROLE_COLOUR_KEYS) {
      // Substring, not a built pattern: the declaration is looked for literally.
      assert.ok(
        block.includes(`--kub-role-${key}:`),
        `${theme}: the palette offers "${key}" but --kub-role-${key} is not declared in the ` +
          `.${theme} block of index.css. It would resolve to nothing and the role would lose ` +
          `its colour silently, for every group that picked it.`,
      );
    }
  });

  test(`every --kub-role token in the ${theme} theme block is a key somebody can pick`, () => {
    const declared = declaredRoleTokens(themeBlock(theme));
    for (const name of declared) {
      assert.ok(
        isChatRoleColour(name),
        `${theme}: --kub-role-${name} is declared in index.css but "${name}" is not in ` +
          `CHAT_ROLE_COLOURS, so it is a colour no group can choose. Add the key with its ` +
          `Russian label, or delete the token.`,
      );
    }
    assert.equal(
      declared.length,
      CHAT_ROLE_COLOUR_KEYS.length,
      `${theme}: ${declared.length} --kub-role tokens against ${CHAT_ROLE_COLOUR_KEYS.length} ` +
        `palette keys. Declared: ${declared.join(", ")}. Keys: ${CHAT_ROLE_COLOUR_KEYS.join(", ")}.`,
    );
  });
}

test("every key is a value the database would accept", () => {
  for (const key of CHAT_ROLE_COLOUR_KEYS) {
    assert.match(
      key,
      COLOUR_KEY_PATTERN,
      `"${key}" does not match ^[a-z][a-z0-9_]{1,31}$, so the constraint ` +
        `chat_roles_colour_palette_key would reject the insert and the colour could never be ` +
        `stored against a role.`,
    );
  }
});

test("the palette is a set, in a stable order, with a Russian label each", () => {
  assert.ok(
    CHAT_ROLE_COLOUR_KEYS.length >= 6 && CHAT_ROLE_COLOUR_KEYS.length <= 8,
    `the palette holds ${CHAT_ROLE_COLOUR_KEYS.length} entries; it is meant to be a short, ` +
      `pickable list rather than a colour wheel`,
  );
  assert.equal(
    new Set(CHAT_ROLE_COLOUR_KEYS).size,
    CHAT_ROLE_COLOUR_KEYS.length,
    `duplicate keys: ${CHAT_ROLE_COLOUR_KEYS.join(", ")}`,
  );
  const labels = CHAT_ROLE_COLOURS.map((entry) => entry.label);
  assert.equal(new Set(labels).size, labels.length, `duplicate labels: ${labels.join(", ")}`);
  for (const { key, label } of CHAT_ROLE_COLOURS) {
    assert.match(
      label,
      /[А-Яа-яЁё]/,
      `"${key}" is labelled "${label}", which carries no Cyrillic. The picker is Russian; an ` +
        `English label here ships untranslated and nothing else would catch it.`,
    );
  }
});

test("an unrecognised colour reads as null, which is what renders plain", () => {
  for (const key of CHAT_ROLE_COLOUR_KEYS) {
    assert.equal(readChatRoleColour(key), key);
  }
  // The migration's principle 5: the constraint bounds the shape of a key, not
  // its membership, so a row may hold a key this palette no longer has.
  for (const rejected of [
    "purple",
    "chat_owner",
    "Blue",
    " blue",
    "blue ",
    "#75ACEB",
    "",
    null,
    undefined,
    7,
    ["blue"],
    { key: "blue" },
  ]) {
    assert.equal(
      readChatRoleColour(rejected),
      null,
      `${JSON.stringify(rejected)} must read as null. Repairing it would hide whatever wrote it, ` +
        `and defaulting would paint a role in a colour its owner never picked.`,
    );
    assert.equal(isChatRoleColour(rejected), false);
  }
});

test("the variable name the module hands out is the one the stylesheet declares", () => {
  // Checked behaviourally rather than by scanning the module for the prefix: a
  // source scan would stay green for a function that returned a name nothing
  // declares, which is the failure this is here to catch.
  const blocks = THEMES.map((theme) => ({ theme, block: themeBlock(theme) }));
  for (const { key, label } of CHAT_ROLE_COLOURS) {
    const variable = chatRoleColourVariable(key);
    assert.equal(chatRoleColourValue(key), `var(${variable})`);
    assert.equal(chatRoleColourLabel(key), label);
    for (const { theme, block } of blocks) {
      assert.ok(
        block.includes(`${variable}:`),
        `chatRoleColourVariable("${key}") returns "${variable}", which is not declared in the ` +
          `.${theme} block. A component styling with it would paint nothing and never error.`,
      );
    }
  }
});
