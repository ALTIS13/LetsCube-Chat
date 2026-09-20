/**
 * How large the text of a message is, and the reader's own say in it.
 *
 * D-287, from the tester of 2026-09-20, who said it four times: «реально
 * что-то читать тут у меня глаза начинают болеть», «какая-то пытка для глаз»,
 * and outdoors in the light theme he could not read it at all. He suspected
 * the face as much as the size — «либо сам формат шрифта такой» — and the
 * measurement settled which.
 *
 * ## Why 16, and why a setting as well
 *
 * Measured on his own device against Telegram's default (section 16 of
 * `docs/operations/reference-clients.md`): Telegram's message text renders an
 * x-height of 23 device px and ours 20, which is 87%. But relative to its own
 * em, Inter's x-height is 0.544 against Roboto's 0.548 — **within 1%**. So the
 * face he suspected is exonerated, contrast is ours to keep (13.92:1 against
 * their 13.19:1 in dark), weight is 400 on both sides, and the entire
 * difference was the nominal size: 14px against Telegram's 16dp.
 *
 * So the default moves to **16**, which closes the whole gap and has a second
 * effect worth having: the composer is already `text-base` on a phone, so
 * until now what somebody typed was larger than what they then read.
 *
 * And a setting, because one default cannot answer «слепой» outdoors in
 * daylight — that is an accessibility defect rather than a taste
 * disagreement, and item 21's «(6) text size» is the same request from a
 * different person a wave earlier. The owner settled both: «шрифт 16 думаю
 * будет хорошо, ползунок также штука полезная».
 *
 * ## The range, and why it is not Telegram's
 *
 * Telegram's slider is **12 to 30**. Ours is **13 to 22**, deliberately
 * narrower at both ends:
 *
 * - **13 rather than 12**, because below that our own `--text-xs` (13px) would
 *   be larger than the message body, and a time stamp that outgrows the
 *   sentence it belongs to is a worse defect than a dense list.
 * - **22 rather than 30**, because our composer stops growing at a fixed
 *   140px. At 30px that ceiling is under four lines and the field starts
 *   scrolling almost at once, which is complaint (e) of the same report made
 *   worse by the fix for (a). 22 is 137% of the new default and 157% of the
 *   old one — comfortably past the «125%» he asked for, which lands on 20.
 *
 * Whoever widens it should move `MAX_COMPOSER_HEIGHT_PX` in the same commit.
 *
 * The leading ratio is Tailwind's `leading-relaxed`, 1.625, which is what the
 * bubbles used when they were `text-sm leading-relaxed`; keeping the ratio is
 * what makes the size a single number rather than two.
 */

/** Where the reader's choice is kept. Local to the device, like the theme. */
export const MESSAGE_TEXT_SIZE_STORAGE_KEY = "letscube:message-text-size";

export const MESSAGE_TEXT_SIZE_DEFAULT_PX = 16;
export const MESSAGE_TEXT_SIZE_MIN_PX = 13;
export const MESSAGE_TEXT_SIZE_MAX_PX = 22;

/** `leading-relaxed`, the ratio the bubbles already used. */
export const MESSAGE_TEXT_LINE_HEIGHT_RATIO = 1.625;

/** The custom properties the conversation reads. */
export const MESSAGE_TEXT_SIZE_VAR = "--kub-message-text-size";
export const MESSAGE_TEXT_LEADING_VAR = "--kub-message-line-height";

/**
 * Whatever was stored, read back as a size this product will render.
 *
 * Anything unusable — absent, a word, a fraction, out of range — becomes the
 * default or the nearest end rather than a broken layout. Storage is a place
 * other software can write to, so this never trusts what it finds there.
 */
export function clampMessageTextSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return MESSAGE_TEXT_SIZE_DEFAULT_PX;
  const rounded = Math.round(n);
  if (rounded < MESSAGE_TEXT_SIZE_MIN_PX) return MESSAGE_TEXT_SIZE_MIN_PX;
  if (rounded > MESSAGE_TEXT_SIZE_MAX_PX) return MESSAGE_TEXT_SIZE_MAX_PX;
  return rounded;
}

/** The leading that goes with a size, rounded to the hundredth of a pixel. */
export function messageTextLineHeight(sizePx: number): number {
  return Math.round(sizePx * MESSAGE_TEXT_LINE_HEIGHT_RATIO * 100) / 100;
}

/** Whether a size is the one the product ships with. */
export function isDefaultMessageTextSize(sizePx: number): boolean {
  return sizePx === MESSAGE_TEXT_SIZE_DEFAULT_PX;
}

/** «16 px — как обычно» / «20 px». What the settings row shows. */
export function messageTextSizeSummary(sizePx: number): string {
  return isDefaultMessageTextSize(sizePx) ? `${sizePx} px — по умолчанию` : `${sizePx} px`;
}

/** Every size the control offers, smallest first. */
export function messageTextSizeSteps(): number[] {
  const steps: number[] = [];
  for (let size = MESSAGE_TEXT_SIZE_MIN_PX; size <= MESSAGE_TEXT_SIZE_MAX_PX; size += 1) steps.push(size);
  return steps;
}
