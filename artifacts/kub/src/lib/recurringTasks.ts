import { mapPgError } from "@/lib/errors";
import type { TaskRecurrence, TaskRecurrenceFrequency } from "@/types/database";

export const RECURRING_TASKS_REQUIRED_MESSAGE =
  "Повторяемые задачи требуют обновления базы данных.";

export const RECURRENCE_FREQUENCY_LABEL: Record<TaskRecurrenceFrequency, string> = {
  daily: "Каждый день",
  weekly: "Каждую неделю",
  monthly: "Каждый месяц",
  yearly: "Каждый год",
  custom: "Настроить",
};

export const WEEKDAY_OPTIONS = [
  { value: 1, label: "Пн" },
  { value: 2, label: "Вт" },
  { value: 3, label: "Ср" },
  { value: 4, label: "Чт" },
  { value: 5, label: "Пт" },
  { value: 6, label: "Сб" },
  { value: 7, label: "Вс" },
];

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

export function isRecurringTasksMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as ErrorLike;
  const code = typeof err.code === "string" ? err.code : "";
  const text = [err.message, err.details, err.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (
    code === "42P01" ||
    code === "42703" ||
    code === "42883" ||
    code === "PGRST202" ||
    code === "PGRST204" ||
    code === "PGRST205"
  ) {
    return (
      text.includes("task_recurrences") ||
      text.includes("task_recurrence") ||
      text.includes("recurrence_id") ||
      text.includes("recurrence_scheduled_for")
    );
  }

  return false;
}

export function isRecurringTasksPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as ErrorLike;
  const code = typeof err.code === "string" ? err.code.toUpperCase() : "";
  const text = [err.message, err.details, err.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return code === "42501" || text.includes("permission denied") || text.includes("forbidden");
}

export function mapRecurringTaskError(error: unknown): string {
  if (isRecurringTasksMissingError(error)) return RECURRING_TASKS_REQUIRED_MESSAGE;
  if (isRecurringTasksPermissionError(error)) return "Недостаточно прав для изменения повторения.";
  const mapped = mapPgError(error);
  if (mapped.includes("permission") || mapped.includes("прав")) return "Недостаточно прав для изменения повторения.";
  return mapped;
}

export function formatRecurrenceDate(iso: string | null | undefined): string {
  if (!iso) return "не задано";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "не задано";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRecurrenceSummary(
  frequency: TaskRecurrenceFrequency,
  intervalCount: number,
  byWeekday: number[] | null | undefined,
  byMonthday: number | null | undefined,
): string {
  const interval = Math.max(1, Number.isFinite(intervalCount) ? intervalCount : 1);
  const base = RECURRENCE_FREQUENCY_LABEL[frequency];

  if (frequency === "weekly") {
    const weekdays = (byWeekday ?? [])
      .map((day) => WEEKDAY_OPTIONS.find((option) => option.value === day)?.label)
      .filter(Boolean)
      .join(", ");
    if (interval === 1) return weekdays ? `Каждую неделю: ${weekdays}` : base;
    return weekdays ? `Каждые ${interval} недели: ${weekdays}` : `Каждые ${interval} недели`;
  }

  if (frequency === "monthly") {
    const day = byMonthday ? `, день ${byMonthday}` : "";
    return interval === 1 ? `Каждый месяц${day}` : `Каждые ${interval} месяца${day}`;
  }

  if (frequency === "yearly") {
    return interval === 1 ? "Каждый год" : `Каждые ${interval} года`;
  }

  if (frequency === "custom") {
    return `Каждые ${interval} дня`;
  }

  return interval === 1 ? base : `Каждые ${interval} дня`;
}

export function formatStoredRecurrenceSummary(recurrence: TaskRecurrence): string {
  const summary = formatRecurrenceSummary(
    recurrence.frequency,
    recurrence.interval_count,
    recurrence.by_weekday,
    recurrence.by_monthday,
  );

  if (recurrence.stopped_at) return `${summary}. Остановлено.`;
  if (recurrence.paused_at) return `${summary}. На паузе.`;
  if (recurrence.next_run_at) return `${summary}. Следующее выполнение: ${formatRecurrenceDate(recurrence.next_run_at)}.`;
  return summary;
}
