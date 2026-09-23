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
 * - **22 rather than 30**, because of what it does to the composer. That
 *   reason has since been made structural rather than fixed — see below — but
 *   the number stands: 22 is 137% of the new default and 157% of the old one,
 *   comfortably past the «125%» the tester asked for, which lands on 20.
 *
 * Whoever widens it should look at `composerMaxHeight` at the new top of the
 * range before doing so.
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

/** A familiar scale for the control; stored values remain whole pixels. */
export function messageTextSizePercent(sizePx: number): number {
  return Math.round((clampMessageTextSize(sizePx) / MESSAGE_TEXT_SIZE_DEFAULT_PX) * 100);
}

/** The current percentage and whether it is the shipped default. */
export function messageTextSizeSummary(sizePx: number): string {
  const percent = `${messageTextSizePercent(sizePx)}%`;
  return isDefaultMessageTextSize(sizePx) ? `${percent} — по умолчанию` : percent;
}

// ── the composer, which now reads the same number (D-289) ────────────────

/**
 * What the reader types is the size of what they read.
 *
 * D-289. D-287 moved the body to 16 and left the composer at
 * `text-base sm:text-sm`, so from 640px up the field was **14 while the body
 * was 16** — the phone's old asymmetry inverted onto the desktop — and at
 * every non-default slider position the two disagreed by however far the
 * reader had moved it. A person who enlarges the text because they cannot read
 * it cannot read what they are typing either.
 *
 * **This is ours, not Telegram's, and saying so is the point.** Telegram's
 * «Размер текста сообщений» slider governs the message body **only** — measured
 * on the device on 2026-09-20 by dragging it to 30 and reading the composer
 * back: its resting height (107 device px) and its line step (56) came out
 * byte-identical to the same measurements at 16, while the settings screen's
 * own synthetic preview grew visibly. An earlier note in the register said the
 * slider «governs both»; it does not. What is true is that at Telegram's
 * default the two agree at 16dp, and binding ours is how we get that agreement
 * at every setting rather than only at one. CLAUDE.md §7 permits bettering the
 * reference where the difference is written down instead of claimed as
 * adoption, and this is the writing down.
 */

/** `py-2.5` on the field: 10px above the first line and 10px below the last. */
export const COMPOSER_VERTICAL_PADDING_PX = 20;

/**
 * How many lines the field grows to before it scrolls.
 *
 * **Six, which is Telegram Android's**, measured on the device on 2026-09-20:
 * its composer saturates at 387 device px, and 387 = 51px of padding + 6 × 56px
 * of line. Ours held five — the old fixed 140px ceiling over a 24px leading.
 *
 * The number of lines is the thing worth fixing, and a **pixel** ceiling cannot
 * fix it: 140px is five lines at 16px and three and a half at 22px, so the
 * reader who enlarged the text because they could not read it would be handed
 * a shorter field for their trouble. Six lines at every size is the whole
 * reason this is expressed as a count.
 */
export const MAX_COMPOSER_LINES = 6;

/**
 * The composer at rest, in pixels: one line and its padding.
 *
 * The recording row is held to the same number. It carries no text and could
 * have stayed at its old fixed 44px, but then starting a recording would jerk
 * the conversation by the difference — 2px at the default and 12px at the top
 * of the range.
 */
export function composerRestHeight(sizePx: number): number {
  return Math.ceil(messageTextLineHeight(clampMessageTextSize(sizePx)) + COMPOSER_VERTICAL_PADDING_PX);
}

/**
 * The composer's ceiling, in pixels: six lines and the padding.
 *
 * Rounded up, so the sixth line is never clipped by a fraction of a pixel —
 * the rule `attachSheet.ts` keeps about its own measured height.
 */
export function composerMaxHeight(sizePx: number): number {
  const line = messageTextLineHeight(clampMessageTextSize(sizePx));
  return Math.ceil(line * MAX_COMPOSER_LINES + COMPOSER_VERTICAL_PADDING_PX);
}

/** Every size the control offers, smallest first. */
export function messageTextSizeSteps(): number[] {
  const steps: number[] = [];
  for (let size = MESSAGE_TEXT_SIZE_MIN_PX; size <= MESSAGE_TEXT_SIZE_MAX_PX; size += 1) steps.push(size);
  return steps;
}
