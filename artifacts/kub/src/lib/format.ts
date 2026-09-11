// Locale used everywhere for date/time formatting.
const LOCALE = "ru-RU";

export function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Вчера";
  } else if (diffDays < 7) {
    return date.toLocaleDateString(LOCALE, { weekday: "short" });
  } else {
    return date.toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
  }
}

export function formatFullTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  return date.toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" });
}

/**
 * A moment in a message's «Детали»: «Сегодня в 09:20», «Вчера в 18:05»,
 * «3 сентября в 09:20», and the year only when it is not this one.
 *
 * Counted in calendar days, not in 24-hour spans: a message sent at 23:50 is
 * «Вчера» at 00:10, which is what a person reading the date means.
 */
export function formatMessageMoment(dateStr: string, now: Date = new Date()): string {
  const date = new Date(dateStr);
  const time = date.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `Сегодня в ${time}`;
  if (days === 1) return `Вчера в ${time}`;
  const day = date.toLocaleDateString(
    LOCALE,
    date.getFullYear() === now.getFullYear()
      ? { day: "numeric", month: "long" }
      : { day: "numeric", month: "long", year: "numeric" },
  );
  return `${day} в ${time}`;
}
