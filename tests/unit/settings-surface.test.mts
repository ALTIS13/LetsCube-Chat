import test from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS_CONTENT_MEASURE,
  SETTINGS_OVERLAY_GUTTER_X,
  SETTINGS_OVERLAY_GUTTER_Y,
  SETTINGS_OVERLAY_MAX_HEIGHT,
  SETTINGS_OVERLAY_MAX_WIDTH,
  SETTINGS_OVERLAY_MIN_VIEWPORT,
  SETTINGS_RAIL_MIN_PANEL,
  SETTINGS_RAIL_WIDTH,
  activeSettingsSection,
  settingsOverlayHeight,
  settingsOverlayWidth,
  settingsRailVisible,
} from "../../artifacts/kub/src/lib/settingsSurface.ts";

/**
 * D-285. The decisions behind the settings surface, reachable without a
 * bundler or a DOM — `settingsSurface.ts` imports nothing for this reason.
 *
 * The rendered geometry is `tests/e2e/settings-overlay-geometry.spec.ts`; what
 * is held here is the arithmetic the CSS mirrors and the two rules a layout
 * test cannot see: the unreadable-input cases, and the scroll-spy's end.
 */

test("the panel grows with the window and stops at the cap", () => {
  // D-160's first complaint was a constant that ignored the window. These are
  // the numbers that answer it, and they are the ones the CSS computes.
  assert.equal(settingsOverlayWidth(1440), SETTINGS_OVERLAY_MAX_WIDTH);
  assert.equal(settingsOverlayWidth(1920), SETTINGS_OVERLAY_MAX_WIDTH);
  assert.equal(settingsOverlayWidth(1024), 1024 - 2 * SETTINGS_OVERLAY_GUTTER_X);
  assert.equal(settingsOverlayWidth(900), 900 - 2 * SETTINGS_OVERLAY_GUTTER_X);
  // Exactly at the cap's crossing point: 1100 + 80.
  assert.equal(settingsOverlayWidth(1180), SETTINGS_OVERLAY_MAX_WIDTH);
  assert.equal(settingsOverlayWidth(1179), 1179 - 2 * SETTINGS_OVERLAY_GUTTER_X);
});

test("the dim is never squeezed out: a clickable band each side at every width it runs at", () => {
  // The owner's second door is a click beside the panel, so a panel that fills
  // its window has no door. Discord loses this below 1080 by going full-bleed;
  // ours keeps it down to the 768 switch, which is the deliberate difference.
  //
  // **The floor is a literal 48 and not `2 * SETTINGS_OVERLAY_GUTTER_X`, and
  // that is the point.** Written against the constant, this test passes when
  // the constant is mutated to 0 — it was, and it did: the assertion becomes
  // «at least -1 pixels», which every panel satisfies. A contract that reads
  // its own subject cannot fail. 24 points a side is what a pointer needs.
  for (const viewport of [768, 800, 1024, 1280, 1440, 1920, 3840]) {
    const width = settingsOverlayWidth(viewport);
    assert.ok(
      viewport - width >= 48,
      `at ${viewport} the panel is ${width} and leaves ${viewport - width}px of dim to click`,
    );
  }
});

test("the panel's height is the window's, capped", () => {
  assert.equal(settingsOverlayHeight(900), SETTINGS_OVERLAY_MAX_HEIGHT);
  assert.equal(settingsOverlayHeight(700), 700 - 2 * SETTINGS_OVERLAY_GUTTER_Y);
  assert.equal(settingsOverlayHeight(0), SETTINGS_OVERLAY_MAX_HEIGHT);
});

test("the rail is dropped only where it costs the content more than it is worth", () => {
  assert.equal(settingsRailVisible(SETTINGS_RAIL_MIN_PANEL), true);
  assert.equal(settingsRailVisible(SETTINGS_RAIL_MIN_PANEL - 1), false);
  assert.equal(settingsRailVisible(Number.NaN), false);
});

test("the measure stays inside the ceiling D-160's gap rule sets", () => {
  // **This is the rule that keeps D-160 fixed.** The label-to-value gap is
  // `rowWidth - 231` and `settings-column.spec.ts` requires it under 360, so
  // the content may not pass 591. Raise `SETTINGS_CONTENT_MEASURE` past that
  // and both this and the two e2e gap contracts go red.
  //
  // The cap itself is applied in CSS and measured off the rendered box by
  // `settings-overlay-geometry.spec.ts`; what is held here is the number.
  assert.ok(
    SETTINGS_CONTENT_MEASURE < 591,
    `the measure is ${SETTINGS_CONTENT_MEASURE}, past D-160's 591 ceiling`,
  );
  // And the rail plus the measure has to fit the panel it is folded out of.
  assert.ok(SETTINGS_RAIL_WIDTH + SETTINGS_CONTENT_MEASURE <= SETTINGS_RAIL_MIN_PANEL);
});

test("the rail marks the section being read, not the one that has just appeared", () => {
  const tops = [0, 300, 600, 900];
  const pane = 700;
  const scrollHeight = 1400;
  // The reading line is a fifth down the pane — 140 here — so a heading at 300
  // does not take the mark until it is nearly at the top.
  assert.equal(activeSettingsSection(tops, 0, pane, scrollHeight), 0);
  assert.equal(activeSettingsSection(tops, 159, pane, scrollHeight), 0);
  assert.equal(activeSettingsSection(tops, 160, pane, scrollHeight), 1);
  assert.equal(activeSettingsSection(tops, 460, pane, scrollHeight), 2);
});

test("the end of the scroll marks the last section, which no offset ever reaches", () => {
  // The last section is shorter than the pane, so its top never passes the
  // reading line and the rail would mark the one before it for ever. Remove
  // the end-of-scroll branch and this is the test that says so.
  const tops = [0, 300, 600, 1320];
  assert.equal(activeSettingsSection(tops, 700, 700, 1400), 3);
  // One pixel short of the end is not the end.
  assert.equal(activeSettingsSection(tops, 690, 700, 1400), 2);
  // And a screen with nothing to scroll is not at its end by accident.
  assert.equal(activeSettingsSection([0, 100], 0, 700, 700), 0);
});

test("no sections is not section zero", () => {
  assert.equal(activeSettingsSection([], 0, 700, 1400), -1);
  assert.equal(activeSettingsSection([0, 300], Number.NaN, 700, 1400), 0);
});
