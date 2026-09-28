/**
 * The decisions behind the top of a conversation (tracker item 70): one card
 * under the header holding the pinned message and the player, each a single
 * row, the way Telegram draws them. The owner put the two side by side on
 * 2026-09-28 — ours a card a third of a phone's screen tall, Telegram's two
 * lines — and asked for Telegram's.
 *
 * Kept free of React so `tests/unit/chat-top-card.test.mts` can pin them
 * without a browser. Everything here was read off Telegram Android's source
 * (DrKLO/Telegram, master, 2026-09-28): `FragmentContextView.java` for the
 * player, `ChatActivity.java` and `PinnedLineView.java` for the pinned bar,
 * `LocaleController.formatDateAudio` for the date. Where this differs from it
 * the reason is written beside the difference.
 */

/**
 * The stops a tap on the speed chip walks through. Telegram's `toggleSpeeds`;
 * the whole list, 0.5 included, is a long press away (`speedItems`).
 */
export const TOGGLE_SPEEDS: readonly number[] = [1, 1.5, 2];

/**
 * The speed one tap moves to: the next stop above the current one, and from
 * the last back to 1.
 *
 * One difference from Telegram, deliberate. Its arithmetic finds the first
 * stop at or above the speed less a tenth and then takes the stop after it,
 * which is exact for every stop and sends 0.5 — picked from the long-press
 * list — to 1.5, past 1. Here the next stop above is the next stop above.
 */
export function nextToggleSpeed(current: number): number {
  const rate = Number.isFinite(current) ? current : 1;
  return TOGGLE_SPEEDS.find((stop) => stop > rate + 0.05) ?? TOGGLE_SPEEDS[0];
}

/** «1X», «1.5X», «0.5X» — what Telegram's speed chip reads. */
export function speedLabel(rate: number): string {
  const value = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return `${Number(value.toFixed(2))}X`;
}

const LOCALE = "ru-RU";
const YEAR_MS = 31_536_000_000;

/**
 * When the message playing was sent, as the player's row writes it after the
 * sender: «в 18:20» today, «вчера в 18:20», «06 сент. в 18:20» within a year and
 * «06.09.25 в 18:20» before that. Telegram's `formatDateAudio(date, true)`;
 * the owner's screenshot reads «Никита Фермер 06 сент. в 18:20».
 *
 * Days are calendar days, as `formatMessageMoment` counts them: a message sent
 * at 23:50 is «вчера» at 00:10. Telegram compares days of the year, which
 * reads the last day of a year as not yesterday on the first of the next.
 */
export function playerMoment(sentAt: string | null | undefined, now: Date = new Date()): string | null {
  if (!sentAt) return null;
  const date = new Date(sentAt);
  if (Number.isNaN(date.getTime())) return null;
  const time = date.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `в ${time}`;
  if (days === 1) return `вчера в ${time}`;
  const day = Math.abs(now.getTime() - date.getTime()) < YEAR_MS
    ? date.toLocaleDateString(LOCALE, { day: "2-digit", month: "short" })
    : date.toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit", year: "2-digit" });
  return `${day} в ${time}`;
}

/**
 * The pinned row's title. `index` counts from the newest pin, which is 0.
 *
 * Telegram writes a number only once the bar has moved off the newest, and
 * counts it from the oldest, which is #1: with four pinned, a tap on the bar
 * goes to the newest and the bar then reads «#3», «#2», «#1», and back.
 */
export function pinnedTitle(index: number, total: number): string {
  const base = "Закреплённое сообщение";
  if (total < 2 || index <= 0) return base;
  return `${base} #${Math.min(total - 1, Math.max(1, total - index))}`;
}

/** The pin a tap moves the bar to after jumping: the next older, then the newest again. */
export function nextPinnedIndex(index: number, total: number): number {
  if (total < 2) return 0;
  return (Math.max(0, index) + 1) % total;
}

export interface PinnedLineGeometry {
  /** Segments drawn, one per pin. */
  total: number;
  /** How many fit the line at once: three at most, as in `PinnedLineView`. */
  visible: number;
  /** Which segment is lit, counted from the top. The newest pin is the lowest. */
  position: number;
  /** How many segments the column is scrolled up by, to keep the lit one in view. */
  offset: number;
}

/**
 * The line down the pinned row's left edge: a segment per pin, the one shown
 * lit and the rest at a third, the newest at the foot, and never more than
 * three in view — past three the column scrolls to keep the lit one second
 * from the top where it can, as Telegram's `PinnedLineView.onDraw` does.
 */
export function pinnedLine(index: number, total: number): PinnedLineGeometry {
  const count = Math.max(1, Math.floor(total));
  const shown = Math.min(Math.max(0, index), count - 1);
  const position = count - 1 - shown;
  const visible = Math.min(count, 3);
  const offset = count > 3 ? Math.min(Math.max(position - 1, 0), count - 3) : 0;
  return { total: count, visible, position, offset };
}
