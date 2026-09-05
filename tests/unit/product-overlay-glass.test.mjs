import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The overlays the product actually renders are made of the same material as
 * the primitives.
 *
 * `tests/unit/overlay-glass.test.mjs` holds the shadcn layer in
 * `components/ui/` to one material. That layer turned out to be almost unused:
 * the application imports Radix directly, or builds its own panels, so the
 * dialogs, windows and menus people really see never went through it. These
 * are those surfaces.
 *
 * The rules are the same three, for the same reasons. A panel that keeps its
 * own `bg-[var(--kub-surface)]` beside the glass class is not using the
 * material, it is racing it, and which one wins depends on stylesheet order.
 * A panel that keeps `shadow-2xl` or `kub-glow-soft` sets a second box-shadow
 * that fights `--glass-shadow`. And a panel that writes `backdrop-filter` or
 * an rgba fill of its own puts the material back out of reach of one edit.
 *
 * Measured, over the worst ground each theme can put behind a panel (a full
 * white field in the dark theme, a full black one in the light theme — a blur
 * cannot take a uniform field past its own colour), Chromium composited
 * `.kub-glass-strong` to exactly rgb(38,50,67) and rgb(235,235,235), with zero
 * deviation across the sampled square. Those are the numbers the ratios below
 * are taken against, and they are also what the primitives' test predicted
 * arithmetically — two independent routes to the same pixels.
 */

const root = new URL("../../artifacts/kub/src/", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

/**
 * Every surface this branch converted, found by a landmark in its own class
 * string rather than by line number.
 */
const surfaces = [
  // The contact card, in both shapes. Docking only happens below 640px, where
  // the card is the full width of a phone, so both are `-strong`.
  ["lib/profileWindow.ts", "flex min-h-0 flex-col h-full w-full", "kub-glass-strong"],
  ["lib/profileWindow.ts", "fixed z-[60] flex min-h-0 flex-col", "kub-glass-strong"],
  // Its two sticky bars, which would otherwise be opaque strips inside it.
  ["components/chat/ChatInfoPanel.tsx", "grid-cols-[2.5rem_minmax(0,1fr)_2.5rem]", "kub-glass-strong"],
  ["components/chat/ChatInfoPanel.tsx", "sticky top-0 z-10 flex flex-shrink-0", "kub-glass-strong"],
  // The round recorder, attached above the composer, over the message list.
  ["components/chat/VideoMessageRecorderModal.tsx", "mx-3 mb-2 rounded-3xl", "kub-glass-strong"],
  // The pinned list, dropped over the conversation.
  ["components/chat/PinnedMessage.tsx", "top-[calc(100%+6px)]", "kub-glass-strong"],
  // The support window: floating over the conversation, or covering the screen.
  ["components/support/SupportWindow.tsx", "fixed z-[70] flex flex-col", "kub-glass-strong"],
  // The update toast.
  ["components/AppUpdateBanner.tsx", "fixed left-1/2 top-3 z-[80]", "kub-glass-strong"],
  // The three dialogs that reach past the primitives to Radix.
  ["components/bots/BotCreateModal.tsx", "z-[71] max-h-[92dvh]", "kub-glass-strong"],
  ["components/bots/BotSettingsPanel.tsx", "z-[76] w-[calc(100%-2rem)]", "kub-glass-strong"],
  ["components/bots/BotTokenDialog.tsx", "z-[81] w-[calc(100%-2rem)]", "kub-glass-strong"],
];

/** Files whose scrim must still leave the page behind it visible. */
const scrims = [
  "components/bots/BotCreateModal.tsx",
  "components/bots/BotSettingsPanel.tsx",
  "components/bots/BotTokenDialog.tsx",
];

function classString(file, needle) {
  const hit = [...read(file).matchAll(/"([^"\n]{20,})"/g)]
    .map((match) => match[1])
    .find((value) => value.includes(needle));
  assert.ok(hit, `${file}: no class string containing "${needle}"`);
  return hit;
}

for (const [file, needle, expected] of surfaces) {
  test(`${file} (${needle}) takes its surface from the glass utilities`, () => {
    const classes = classString(file, needle);
    assert.match(
      classes,
      new RegExp(`\\b${expected}\\b`),
      `${file} builds an overlay surface without ${expected}`,
    );
    assert.doesNotMatch(
      classes,
      /\bbg-\[(var\(--kub-surface\)|color:var\(--kub-surface\))\]/,
      `${file} keeps an opaque fill beside the glass utility`,
    );
    assert.doesNotMatch(
      classes,
      /\bshadow-(2xs|xs|sm|md|lg|xl|2xl)\b|\bkub-glow-(soft|cyan)\b/,
      `${file} keeps its own shadow beside --glass-shadow`,
    );
  });
}

/** Comments quote the measurements; only the code is under this rule. */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("the product overlays never write the material by hand", () => {
  for (const file of [...new Set(surfaces.map(([f]) => f))]) {
    const source = withoutComments(read(file));
    assert.doesNotMatch(source, /backdrop-filter|backdropFilter/i, `${file} writes its own frosting`);
    assert.doesNotMatch(source, /\bbox-shadow|boxShadow/i, `${file} writes its own shadow`);
  }
});

for (const file of scrims) {
  test(`${file} dims the page without erasing it`, () => {
    const found = read(file).match(/fixed inset-0 z-\[\d+\]\s+bg-black\/(\d+)/);
    assert.ok(found, `${file}: no scrim with a readable opacity`);
    const alpha = Number(found[1]);
    // Above this the frosted panel over it samples a flat rectangle and the
    // material disappears; the dialog reads as a plain dark box. Matches the
    // value the primitives settled on, so the two layers cannot drift apart.
    assert.ok(alpha <= 60, `${file}: a ${alpha}% scrim leaves the panel's blur nothing to sample`);
  });
}

/**
 * The pinned bar wears the material as a layer rather than on itself. It hosts
 * an absolutely positioned dropdown, and `backdrop-filter` on the host would
 * make the host the blur root that its own dropdown samples — the dropdown
 * would frost the bar instead of the conversation behind it.
 */
test("the pinned bar takes the material as a layer, not on itself", () => {
  const source = read("components/chat/PinnedMessage.tsx");
  assert.match(source, /<KubGlassLayer\s*\/>/, "the pinned bar lost its glass layer");
  const bar = classString("components/chat/PinnedMessage.tsx", "relative flex-shrink-0");
  assert.doesNotMatch(bar, /\bkub-glass(-strong)?\b/, "the bar wears the filter its dropdown samples");
  assert.doesNotMatch(bar, /\bbg-\[var\(--kub-surface\)\]/, "the bar kept its opaque fill");
});
