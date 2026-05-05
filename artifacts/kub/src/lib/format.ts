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
