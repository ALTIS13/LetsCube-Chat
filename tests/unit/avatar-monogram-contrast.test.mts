import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { avatarInkFor } from "../../artifacts/kub/src/lib/avatarInk.ts";

/**
 * D-012: every generated avatar background must carry readable ink.
 *
 * The monogram was `text-white` on a pastel palette. All ten colours failed the
 * 4.5:1 requirement and the worst measured 1.19:1 — an invisible letter, not a
 * dim one — while all ten pass with dark ink, because the palette was chosen
 * for dark text.
 *
 * The palette is read out of the component rather than copied here, so adding a
 * colour to it puts that colour under this test automatically. A copy would
 * pass forever while the product drifted.
 */

const source = readFileSync(
  new URL("../../artifacts/kub/src/components/ui/ChatAvatar.tsx", import.meta.url),
  "utf8",
);

function palette(): string[] {
  const block = source.match(/const colors = \[([\s\S]*?)\];/);
  assert.ok(block, "the avatar palette could not be found in the component");
  const colours = block[1].match(/#[0-9A-Fa-f]{3,6}/g) ?? [];
  assert.ok(colours.length >= 5, `expected a real palette, found ${colours.length} colours`);
  return colours;
}

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const full = hex.replace("#", "");
    const expanded = full.length === 3 ? full.split("").map((c) => c + c).join("") : full;
    const channel = (offset: number) => {
      const value = Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("every avatar palette colour gets ink that meets 4.5:1", () => {
  for (const background of palette()) {
    const ink = avatarInkFor(background);
    const ratio = contrast(ink, background);
    assert.ok(
      ratio >= 4.5,
      `${background} with ink ${ink} measures ${ratio.toFixed(2)}:1, below the 4.5:1 minimum`,
    );
  }
});

test("the chosen ink is the better of the two, not merely an adequate one", () => {
  for (const background of palette()) {
    const chosen = avatarInkFor(background);
    const other = chosen === "#FFFFFF" ? "#0B1220" : "#FFFFFF";
    assert.ok(
      contrast(chosen, background) >= contrast(other, background),
      `${background} chose ${chosen} at ${contrast(chosen, background).toFixed(2)}:1 over ${other} at ${contrast(other, background).toFixed(2)}:1`,
    );
  }
});

test("a dark background still gets light ink", () => {
  // The palette is pastel today, so without this the function could hardcode
  // dark ink and every test above would still pass.
  assert.equal(avatarInkFor("#0B1220"), "#FFFFFF");
  assert.equal(avatarInkFor("#1a1a1a"), "#FFFFFF");
});

test("the monogram no longer hardcodes white ink", () => {
  // D-044: this used to look for one exact class ordering, and a third
  // component wrote the same classes in a different order - `flex items-center
  // justify-center rounded-full font-medium text-white` - so the scan never saw
  // it. `MessageActorAvatar` kept white ink on all ten pastel colours for as
  // long as this file was green. The anchor is now the palette call itself,
  // which is what every monogram has to make, in any order.
  const sites = source.match(/const bgColor = getAvatarColor\([^)]*\)/g) ?? [];
  assert.ok(sites.length >= 3, `expected every monogram to read the palette, found ${sites.length}`);
  // Read through one name, so a fourth component cannot reach the palette by a
  // route this file does not count.
  const calls = (source.match(/getAvatarColor\(/g) ?? []).length - 1; // minus its own declaration
  assert.equal(calls, sites.length, `${calls} calls to the palette but ${sites.length} of them named bgColor`);

  const inked = source.match(/color: avatarInkFor\(bgColor\)/g) ?? [];
  assert.equal(
    inked.length,
    sites.length,
    `${sites.length} components read the palette but only ${inked.length} take their ink from it`,
  );

  assert.doesNotMatch(
    source,
    /\btext-white\b/,
    "a monogram forces white ink again, which no colour in this palette can carry",
  );
});
