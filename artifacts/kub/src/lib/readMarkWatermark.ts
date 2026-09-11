/**
 * Timestamps as the server wrote them, compared without losing the digits a
 * JavaScript `Date` drops.
 *
 * A message's `created_at` comes back from PostgREST with microseconds —
 * `2026-09-11T10:00:00.123456+00:00` — and a `Date` keeps milliseconds. A read
 * reported through `mark_chat_read_through` as the `Date` of the newest message
 * would be up to 999 microseconds before that message, and the server, which
 * counts a message read when `last_read_at >= created_at`, would leave the
 * newest message unread. So the report carries the server's own string, and
 * choosing the later of two compares all six digits.
 *
 * Kept free of React and Supabase so `node --test` can load it.
 */

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

function normalizeOffset(zone: string): string {
  if (zone.toUpperCase() === "Z") return "Z";
  const sign = zone[0];
  const digits = zone.slice(1).replace(":", "");
  return `${sign}${digits.slice(0, 2)}:${(digits.slice(2) || "00").padEnd(2, "0")}`;
}

/** Microseconds since the epoch, or null for anything that is not a timestamp. */
export function timestampMicros(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = TIMESTAMP.exec(value.trim());
  if (!match) return null;
  const [, date, time, fraction = "", zone = "Z"] = match;
  const wholeSecondsMs = Date.parse(`${date}T${time}${normalizeOffset(zone)}`);
  if (!Number.isFinite(wholeSecondsMs)) return null;
  const micros = Number(`${fraction}000000`.slice(0, 6));
  return wholeSecondsMs * 1000 + micros;
}

/** The later of two timestamps, as the string it was given. An unreadable one loses. */
export function laterTimestamp(a: string | null | undefined, b: string | null | undefined): string | null {
  const aMicros = timestampMicros(a);
  const bMicros = timestampMicros(b);
  if (aMicros === null) return bMicros === null ? null : (b as string);
  if (bMicros === null) return a as string;
  return bMicros > aMicros ? (b as string) : (a as string);
}
