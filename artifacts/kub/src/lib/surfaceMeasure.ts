/**
 * How wide a full surface may draw its controls, and how little of its own
 * name it may give away.
 *
 * ## Why this module exists beside `settingsSurface.ts` rather than inside it
 *
 * D-285 took the settings out of the chat list's body and gave them a window
 * of their own, and the owner asked for the same treatment elsewhere the same
 * day: «такой же подход как к настройкам по возможности к остальным местам
 * примени, страница ботов, админка и т.д», with one condition — «обязательно
 * проверь что все функции корректно помещаются и отображаются удобно для
 * пользователя на маленьком и большом разрешении».
 *
 * **The first thing the audit found is that his defect is not there.** The bots
 * page, the administration and «Задачи» are full routes at `100vw`; none of
 * them is anybody's column and none of them inherits a width decided for
 * something else. What D-285 cost the settings — 58px of «Максим Орлов»
 * scrolled out of a 66px field — cannot happen to them by that mechanism.
 *
 * What the audit did find is the *opposite* failure at the wide end and a
 * worse one at the narrow end, and both are D-285's own lessons applied the
 * other way round. Measured on the checked-in fixtures, both themes, at four
 * viewports:
 *
 *   | surface | viewport | what | number |
 *   | ------- | -------- | ---- | ------ |
 *   | bot settings pane | 1440 | «Название» field | **980px** holding 48px of content |
 *   | bot settings pane | 1920 | the same field | **1460px** holding 48px |
 *   | «Мои боты» header | 390 | its own title | a **6px** box; 63px of «Мои боты» hidden |
 *   | «Мои боты» header | 360 | the page | 8px past the right edge of the window |
 *
 * So the numbers below are two decisions, not one, and neither is the
 * settings' own.
 */

/**
 * The widest a column of form controls may be drawn, whatever pane holds it.
 *
 * **696 is Discord's, adopted unchanged** — SHIPPED, build 615980,
 * `.panel__6131a { max-width: 696px; min-width: 300px; margin-inline: auto }`,
 * recorded in `docs/operations/reference-clients.md`.
 *
 * **It is deliberately not the settings' 560, and the difference is a measured
 * property of the rows rather than a taste.** `SETTINGS_CONTENT_MEASURE` is
 * 560 because the settings row is `[icon][label … value][control]` with the
 * label and the value pushed to opposite ends, so its gap is `rowWidth − 231`
 * and D-160's «< 360» puts the ceiling at 591. `settingsSurface.ts` holds that
 * argument. **The bot settings panel has no such row**: the audit's stranding
 * probe — every `justify-between` flex row in the pane, at 1440 — found none
 * at all. Nothing here strands, so nothing here forces 560, and copying it
 * would be taking a number without its reason.
 */
export const SURFACE_FORM_MEASURE = 696;

/**
 * The padding the pane already draws around that column (`sm:p-6`).
 *
 * Named rather than inlined because the cap below is built from it, and a cap
 * that disagrees with the padding it contains moves the content by exactly
 * this much without anything saying so.
 */
export const SURFACE_FORM_GUTTER = 24;

/**
 * The cap, applied to the **padded** box rather than to the content.
 *
 * This is the part that is easy to get wrong and expensive when it is.
 * `bot-settings-container-queries.spec.ts` is D-222's tier 2, and it asserts
 * container widths as literals — `expect(await sectionWidth(page)).toBe(652)`
 * at a 700pt window, `368` at 768, and the same 652 again at 1052, which is
 * the pair that proves the layout follows its container and not the window.
 * Capping the **content** at 696 would have made the 700pt window's section
 * 648 instead of 652 and turned that instrument red for no reason of the
 * reader's.
 *
 * Capping the padded box at `696 + 2 × 24 = 744` binds only where the pane is
 * already wider than 744 — which, with the 352px list beside it, is a window
 * above 1096. Every width D-222 measures is below that and is untouched to the
 * pixel: 700 → 652, 768 → 368, 1052 → 652, and every phone project → the whole
 * pane. At 1440 the 1088px pane becomes 744 and the content is exactly
 * Discord's 696; at 1920 the 1568px pane becomes the same 744.
 */
export const SURFACE_FORM_BOX = SURFACE_FORM_MEASURE + 2 * SURFACE_FORM_GUTTER;

/** Whether the cap changes anything for a pane of this width. */
export function surfaceFormCapBinds(paneWidth: number): boolean {
  return Number.isFinite(paneWidth) && paneWidth > SURFACE_FORM_BOX;
}

/** What the content column comes out at inside a pane of this width. */
export function surfaceFormContentWidth(paneWidth: number): number {
  if (!Number.isFinite(paneWidth) || paneWidth <= 0) return SURFACE_FORM_MEASURE;
  return Math.max(0, Math.min(paneWidth, SURFACE_FORM_BOX) - 2 * SURFACE_FORM_GUTTER);
}

/**
 * What the narrow end got instead of a constant, and why.
 *
 * «Мои боты» at 390 drew its own title in a **6px box** with 63px of it
 * scrolled out, and at 360 the row ran 8px past the window. The mechanism is
 * `KubHeader`: the title is `flex-1 min-w-0` beside a `flex-shrink-0` trailing
 * group, so it is the only box in the row that can give, and it gave 91% of
 * itself to a «Документация» link and a «Создать бота» button.
 *
 * A `HEADER_TITLE_FLOOR` of 96 lived here and is deliberately gone.
 * **Mutating it to 0 left the suite green**: once the page drew those two
 * controls as icons below `sm`, the title had 168px of a 360pt row and the
 * floor could not bind at any width the product ships. Keeping it would have
 * been a second clamp on a value already decided elsewhere — the exact shape
 * that let a mutation pass on the settings surface a day earlier.
 *
 * The rule survives as a contract rather than as a number:
 * `page-surface-fit.spec.ts` asserts that no control of a page header is drawn
 * outside it and that the title's own text is not cut, on both pages that use
 * `KubHeader`. Restoring either label turns it red.
 */
