import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * The inline notice must be readable, and the pattern it replaces must not
 * come back.
 *
 * The hand-rolled version painted the sentence in the tone over a tint of the
 * same tone. Measured on the live staff area that came out at 3.74:1 for a
 * warning and 3.98:1 for a success figure, both under the 4.5:1 a sentence
 * needs. The audit found 76 instances of the pairing across the product.
 *
 * `KubNotice` applies the rule already settled for `KubBadge`: the sentence
 * takes the interface text colour, and the tone moves to the rail and the
 * border, where 3:1 applies. Both halves are asserted, because a test that only
 * checked the text colour would pass equally well on a notice that had lost its
 * tone entirely — and a tone nobody can see is not a fix, it is a deletion.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const css = readFileSync(join(root, "artifacts/kub/src/index.css"), "utf8");
const notice = readFileSync(join(root, "artifacts/kub/src/components/kub/KubNotice.tsx"), "utf8");

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

/** Read the tones out of the component, so a new one is covered automatically. */
function tones() {
  const union = notice.match(/type Tone = ([^;]+);/);
  assert.ok(union, "the Tone union could not be found");
  const names = union[1].match(/"([a-z]+)"/g)?.map((entry) => entry.replaceAll('"', "")) ?? [];
  assert.ok(names.length >= 3, `expected a real tone set, found ${names.length}`);
  return names;
}

/** The token each tone paints its rail with, taken from the component's own map. */
function railToken(tone) {
  const map = notice.match(/const railClass: Record<Tone, string> = \{([\s\S]*?)\n\};/);
  assert.ok(map, "the rail map could not be found");
  const entry = map[1].match(new RegExp(`${tone}:\\s*"bg-\\[var\\(--([\\w-]+)\\)\\]"`));
  assert.ok(entry, `tone ${tone} has no rail colour`);
  return entry[1];
}

// A notice sits on the panel surfaces; the tint is 8% and does not move a
// surface far enough to matter, which is measured below rather than assumed.
const SURFACES = ["kub-surface", "kub-surface-2", "kub-surface-3"];

for (const theme of ["dark", "light"]) {
  test(`the notice sentence is readable on every surface in the ${theme} theme`, () => {
    const block = themeBlock(theme);
    const text = token(block, "kub-text");
    for (const surface of SURFACES) {
      const background = token(block, surface);
      const ratio = contrast(text, background);
      assert.ok(
        ratio >= 4.5,
        `${theme}: the sentence ${text} on --${surface} ${background} measures ${ratio.toFixed(2)}:1`,
      );
    }
  });

  test(`every notice tone is visible as a rail in the ${theme} theme`, () => {
    const block = themeBlock(theme);
    for (const tone of tones()) {
      const value = token(block, railToken(tone));
      for (const surface of SURFACES) {
        const background = token(block, surface);
        const ratio = contrast(value, background);
        // The rail is non-text interface, held to 3:1.
        assert.ok(
          ratio >= 3,
          `${theme}: ${tone} rail ${value} on --${surface} ${background} measures ${ratio.toFixed(2)}:1`,
        );
      }
    }
  });
}

test("the sentence is not painted in the tone", () => {
  assert.match(
    notice,
    /text-\[color:var\(--kub-text\)\]/,
    "the sentence must take the interface text colour",
  );
  const bodyColours = notice.match(/text-\[color:var\(--kub-(cyan|pink|online|danger|warn)\)\]/g);
  assert.equal(
    bodyColours,
    null,
    `painting the sentence in the tone is the pairing that measured 3.74:1: ${bodyColours}`,
  );
});

test("the tone survives as a rail, so a notice still reads as a warning", () => {
  assert.match(notice, /railClass\[tone\]/, "the rail must be rendered");
  assert.match(notice, /absolute inset-y-0 left-0 w-1/, "the rail must run the full height");
  for (const tone of tones()) {
    railToken(tone);
  }
});

test("the wash stays a wash and never sits behind text of its own hue", () => {
  const tints = notice.match(/bg-\[color-mix\(in_srgb,var\(--kub-[\w-]+\)_(\d+)%/g) ?? [];
  assert.ok(tints.length > 0, "the tones should still tint their notice");
  for (const tint of tints) {
    const percent = Number(tint.match(/_(\d+)%/)[1]);
    assert.ok(percent <= 10, `a ${percent}% tint is a background, not a wash: ${tint}`);
  }
});

/**
 * The staff area is the batch that was migrated. Scanning it keeps the old
 * pattern from creeping back into the screens that were just cleaned, without
 * pretending the whole product is converted yet — the client surfaces are a
 * separate batch and are deliberately not asserted here.
 */
function tsxFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...tsxFiles(path));
    else if (entry.endsWith(".tsx")) found.push(path);
  }
  return found;
}

const FAILING_PAIRING =
  /bg-\[color-mix\(in_srgb,var\(--kub-([a-z]+)\)_\d+%,transparent\)\][^"]*text-\[color:var\(--kub-\1\)\]/;

/**
 * A fixed square box is an icon chip, not a sentence, and an icon is non-text
 * interface held to 3:1 rather than 4.5:1. Measured, the one such chip in the
 * staff area runs 3.74:1 to 4.71:1 across the three surfaces in both themes, so
 * it passes on its own terms — and the live audit, which applies the right
 * threshold per element, did not flag it either.
 *
 * The whole class list is tested rather than the matched fragment: the size
 * classes sit before the colours, so an earlier version of this check looked
 * only at the fragment, never saw `h-7 w-7`, and excluded nothing.
 */
function isIconChip(classes) {
  return /\bh-\d+ w-\d+\b/.test(classes);
}

test("no staff screen paints a sentence in the tone it tints behind it", () => {
  const offenders = [];
  let scanned = 0;
  for (const path of tsxFiles(join(root, "artifacts/kub/src/pages/admin"))) {
    const source = readFileSync(path, "utf8");
    // Every quoted class list, whether in a className or in a variant string.
    for (const [, classes] of source.matchAll(/"([^"\n]*\bbg-\[color-mix[^"\n]*)"/g)) {
      scanned += 1;
      const found = classes.match(FAILING_PAIRING);
      if (!found || isIconChip(classes)) continue;
      offenders.push(`${path.slice(root.length)} (${found[1]})`);
    }
  }
  assert.ok(scanned > 0, "no tinted class list was scanned; the scan is not reaching the source");
  assert.deepEqual(offenders, [], "use KubNotice instead of hand-rolling the failing pairing");
});
