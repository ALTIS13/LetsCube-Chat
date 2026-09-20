/**
 * Where the settings screen is drawn, and how wide.
 *
 * ## The decision this module exists to hold
 *
 * D-160 took the settings out of an 896px centred dialog and made them the chat
 * list column's body. Its complaint was measured and correct: a constant 896
 * was 62.2% of a 1440 screen and 46.7% of a 1920 one, its rows were 822px wide
 * so «Статус «в сети»» stood 570px from the word «Виден» that is its value, and
 * it blurred an application nobody had asked to leave.
 *
 * D-285 is the bill for the container it chose. **The chat list is resized by
 * hand**, `CHAT_LIST_MIN_WIDTH` floors it at 260, and the settings inherited
 * that number — a decision the person made about how much room their
 * conversations get, applied to a screen that has nothing to do with them.
 * Measured on the fixture at 1440, with «Максим Орлов» in the name field:
 *
 *   | column | settings surface | share of 1440 | «Имя» input | of the name hidden |
 *   | ------ | ---------------- | ------------- | ----------- | ------------------ |
 *   |    260 |              260 |         18.1% |        66px |       **58px** |
 *   |    300 |              300 |         20.8% |       106px |           18px |
 *   |    360 |              360 |         25.0% |       166px |              0 |
 *   |    540 |              540 |         37.5% |       346px |              0 |
 *
 * At the floor a person cannot read their own name back. That is the owner's
 * «криво», and it is not cosmetic.
 *
 * ## Why an overlay is the answer and not a return to D-160's defect
 *
 * The owner asked for Discord's approach by name, and Discord's settings are a
 * surface over the application with a category column of their own. D-160's
 * three measurable harms are each answered on the numbers rather than avoided
 * by refusing to be an overlay:
 *
 *  - **a constant that ignores the window** → this one grows and shrinks with
 *    it, `min(MAX, viewport - 2 * GUTTER)`, so 1100 at 1440 and 944 at 1024;
 *  - **822px rows stranding a value 570px from its label** → the content keeps
 *    a `MEASURE` of 560 whatever the panel does, and the rail spends the rest
 *    of the width on something a reader can use. Measured on the same fixture,
 *    the label-to-value gap of the widest row is `rowWidth - 231`, so 560
 *    leaves **329** and `settings-column.spec.ts`'s «< 360» still holds. That
 *    contract is D-160's own and it is not being relaxed;
 *  - **248px below the fold at 1440** → four sections one click apart instead
 *    of 966px of scrolling.
 *
 * And the margin either side is no longer dead: it is the dismissal the owner
 * named — «либо по затемнению в любом месте сбоку от окна настроек» — so the
 * one thing D-160 counted as waste is now a control.
 *
 * Pure, importing nothing, so `node --test` reaches every branch without a
 * bundler, a DOM or `import.meta.env`.
 */

/**
 * Below this the shell is one pane and there is no column to have narrowed, so
 * the full-screen sheet `KubModal`'s `mobileSheet` already draws stays exactly
 * as it is. `MOBILE_BREAKPOINT` in `hooks/use-mobile.tsx` is the same number
 * and the same switch — `Sidebar` gates the two forms on `useIsMobile()`,
 * which is reactive where this constant is not, and this is the floor
 * `settingsOverlayWidth` clamps to.
 *
 * There was a `settingsSurfaceKind()` here and a `settingsContentWidth()`
 * below, both tested and **neither called by anything that renders**. A pure
 * function nothing reaches is a tested opinion, not a contract, so they are
 * gone: the switch is `useIsMobile()` and the content's cap is the CSS, which
 * `settings-overlay-geometry.spec.ts` measures off the rendered box.
 */
export const SETTINGS_OVERLAY_MIN_VIEWPORT = 768;

/**
 * The widest the panel may be on any screen.
 *
 * Chosen against D-160's own complaint rather than by eye: it counted 272px of
 * dead margin each side at 1440 and 512px at 1920. This leaves **170** and
 * **410**, so the surface the owner asked for is less marginal than the one
 * D-160 removed at every width, not more — and what margin is left is the dim
 * he asked to be able to click.
 *
 * The rest is arithmetic: the rail is 240, the measure 560, and 1100 leaves
 * 150px of padding each side of the content. Wider than this and the content
 * floats in the middle of a pane it cannot fill.
 *
 * **Discord's own cap is 1400** (SHIPPED, build 615980, `.modal_e44912
 * { max-width: 1400px }`), and the difference is not a disagreement: its
 * content column is 696 where ours is 560, and 1400 − 696 = 704 against our
 * 1100 − 560 = 540. The same shape, sized to the narrower column our rows
 * force. Copying 1400 would buy 140px more empty pane on each side.
 */
export const SETTINGS_OVERLAY_MAX_WIDTH = 1100;

/** The tallest. Beyond this the rail sits alone beside a short content column. */
export const SETTINGS_OVERLAY_MAX_HEIGHT = 780;

/**
 * What the panel leaves beside and above itself — the dim, which is a control.
 *
 * **40 is Discord's own, adopted rather than invented.** SHIPPED, build 615980:
 * `.modal_e44912` is
 * `width: calc(100% - var(--custom-viewport-padding) * 2)` with that padding
 * `var(--space-40)` — 40px — at and below a 1600px window, and
 * `calc(var(--space-40) + var(--custom-app-top-bar-height))` = 72 above it. We
 * take the 40 at every width: the second number exists to clear a title bar we
 * do not have.
 */
export const SETTINGS_OVERLAY_GUTTER_X = 40;
export const SETTINGS_OVERLAY_GUTTER_Y = 40;

/**
 * The rail: the four section headings, and the search.
 *
 * **240 is Discord's, adopted unchanged** — SHIPPED, build 615980,
 * `.sidebar__409aa { flex: 0 0 240px }`, with the content pane
 * `flex: 1 1 auto` beside it. There is no reason of ours to differ, and
 * inventing a number beside a measured one is how «adopted» becomes a
 * relabelling.
 */
export const SETTINGS_RAIL_WIDTH = 240;

/**
 * The widest a block of settings rows may be drawn, whatever the panel is.
 *
 * **This is the number that keeps D-160 fixed.** The row is
 * `[icon][label … value][control]` with the label and value `justify-between`,
 * so the gap between them is the row's width less what the two words and the
 * grid cost — measured as `rowWidth - 231` across every row of the screen at
 * five widths. `settings-column.spec.ts` requires that gap under 360, which
 * puts the ceiling at 591; 560 takes it with 31px of headroom for a longer
 * value than the fixture's, and leaves 358px for the «Имя» input — more than
 * the 346 the 540 column gave, which is the width the whole name was legible
 * at.
 *
 * Widen this past 591 and the stranding D-160 recorded comes back. The test
 * that says so is the mutation this file is held by.
 *
 * **Discord's is 696** — SHIPPED, build 615980, `.panel__6131a { max-width:
 * 696px; min-width: 300px; margin-inline: auto; padding: 0 var(--space-16) }`.
 * We are 136 short of it and the reason is ours, not a guess at theirs: their
 * row does not put a label at one end of the line and its value at the other,
 * so width costs them nothing. Ours does, and 591 is where it starts costing.
 * Centred and with side padding is copied from them exactly.
 */
export const SETTINGS_CONTENT_MEASURE = 560;

/** A whole-pixel clamp, so a measured box and this answer compare exactly. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The panel's width at a given window width — the same arithmetic the CSS
 * does, so a spec can assert the rendered box against a number rather than
 * against a copy of the expression that produced it.
 */
export function settingsOverlayWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return SETTINGS_OVERLAY_MAX_WIDTH;
  return clamp(
    viewportWidth - 2 * SETTINGS_OVERLAY_GUTTER_X,
    // Never narrower than the viewport it must fit in. At the 768 switch this
    // is 672, which is still 2.6x the 260 the defect was reported at.
    Math.min(viewportWidth, SETTINGS_OVERLAY_MIN_VIEWPORT - 2 * SETTINGS_OVERLAY_GUTTER_X),
    SETTINGS_OVERLAY_MAX_WIDTH,
  );
}

export function settingsOverlayHeight(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return SETTINGS_OVERLAY_MAX_HEIGHT;
  return Math.min(viewportHeight - 2 * SETTINGS_OVERLAY_GUTTER_Y, SETTINGS_OVERLAY_MAX_HEIGHT);
}

/**
 * The panel below which the rail costs the content more than it is worth.
 *
 * 860 leaves 620 for the content pane, which is the measure plus padding either
 * side. Below it the rail folds into the content and the search moves to the
 * top of the pane. **Discord does not do this** — at narrow desktop widths it
 * keeps a 240px sidebar beside a column with `min-width: 300px` and clips,
 * because its one-column mode is gated on the user agent rather than the
 * viewport. We have no UA gate and would not want one.
 */
export const SETTINGS_RAIL_MIN_PANEL = 860;

export function settingsRailVisible(panelWidth: number): boolean {
  return Number.isFinite(panelWidth) && panelWidth >= SETTINGS_RAIL_MIN_PANEL;
}

/**
 * Which section the rail should mark as the one being read.
 *
 * `tops` is each section's offset inside the scroller, in the order they are
 * drawn. The answer is the last section whose top has passed the reading line —
 * a fifth of the way down the pane rather than its very top, because a section
 * heading that has just appeared at the bottom edge is not what is being read.
 *
 * **The bottom of the scroll is a special case and not a rounding error.** The
 * last section is usually shorter than the pane, so scrolling to the very end
 * never brings its top past the line and the rail would mark the one before it
 * for ever. Anything within two pixels of the end answers with the last
 * section, which is the only answer that can be right there. Two rather than
 * one because `scrollTop` is fractional on a scaled display and
 * `scrollHeight` is not.
 */
export function activeSettingsSection(
  tops: readonly number[],
  scrollTop: number,
  paneHeight: number,
  scrollHeight: number,
): number {
  if (tops.length === 0) return -1;
  if (!Number.isFinite(scrollTop)) return 0;
  /**
   * A screen that does not scroll has no section being read.
   *
   * Found by the unit test rather than by eye: with everything on screen at
   * once every heading is above the reading line, so the loop below marks the
   * **last** of them — the rail would point at «Приложение» on a screen where
   * «Профиль» is the thing in front of the person. The first is the only
   * honest answer when the question does not apply.
   */
  if (Number.isFinite(paneHeight) && Number.isFinite(scrollHeight) && scrollHeight <= paneHeight) {
    return 0;
  }
  if (
    Number.isFinite(paneHeight)
    && Number.isFinite(scrollHeight)
    && scrollHeight > paneHeight
    && scrollTop + paneHeight >= scrollHeight - 2
  ) {
    return tops.length - 1;
  }
  const line = scrollTop + (Number.isFinite(paneHeight) ? paneHeight / 5 : 0);
  let index = 0;
  for (let i = 0; i < tops.length; i += 1) {
    if (tops[i] <= line) index = i;
  }
  return index;
}
