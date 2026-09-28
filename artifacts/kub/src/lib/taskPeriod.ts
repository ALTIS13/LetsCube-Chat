/**
 * A task that runs from a date to a date (tracker item 68). A tester,
 * 2026-09-28: «не хватает возможности выбрать промежуток… есть задачи которые
 * идут месяц». The start lives in `tasks.starts_at`, written by
 * `task_create_v4` / `task_update_v4`; null is a plain deadline, as before.
 *
 * Imports nothing, so `tests/unit/task-period.test.mts` reaches it directly.
 */

const LOCALE = "ru-RU";

/** «30 окт., 18:00» — the form a task's deadline already takes on every surface. */
export function formatTaskMoment(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * What a task's dates read as: «01 окт., 09:00 — 30 окт., 18:00» for a period,
 * «с 01 окт., 09:00» for a start alone, the deadline alone as it always read,
 * and null when there is neither.
 */
export function formatTaskPeriod(startsAt: string | null | undefined, dueAt: string | null | undefined): string | null {
  const start = startsAt && Number.isFinite(Date.parse(startsAt)) ? startsAt : null;
  const due = dueAt && Number.isFinite(Date.parse(dueAt)) ? dueAt : null;
  if (start && due) return `${formatTaskMoment(start)} — ${formatTaskMoment(due)}`;
  if (start) return `с ${formatTaskMoment(start)}`;
  if (due) return formatTaskMoment(due);
  return null;
}

/** The refusal the form shows, or null. The database refuses the same as `task_starts_after_due`. */
export function taskPeriodError(startsAt: string | null, dueAt: string | null): string | null {
  if (!startsAt || !dueAt) return null;
  const start = Date.parse(startsAt);
  const due = Date.parse(dueAt);
  if (!Number.isFinite(start) || !Number.isFinite(due)) return null;
  return start > due ? "Начало не может быть позже срока." : null;
}

/** Whether the task's period has not begun yet, at `nowMs`. */
export function taskNotStarted(startsAt: string | null | undefined, nowMs: number): boolean {
  if (!startsAt) return false;
  const start = Date.parse(startsAt);
  return Number.isFinite(start) && start > nowMs;
}
