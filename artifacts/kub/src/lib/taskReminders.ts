/**
 * Reminders on a task (tracker item 66). A tester, 2026-09-28: «комплектующие
 * придут только через неделю и тогда надо напоминание, что пора приступать
 * делать. А потом будет вторая поставка… и опять надо напоминание».
 *
 * Stored in `task_reminders`, written only through `task_reminder_add` and
 * `task_reminder_remove`, and delivered by pg_cron every minute as a
 * `task_reminder` notification (`20260928190000_task_reminders.sql`). A
 * reminder goes to its author («Мне») or to whoever is the task's assignee
 * when it fires («Исполнителю»), and is read only by those two.
 *
 * Imports nothing, so `tests/unit/task-reminders.test.mts` reaches it directly.
 */

export const REMINDER_NOTE_MAX = 200;
export const REMINDERS_PER_AUTHOR = 20;
/** The database refuses a moment further out than this: `interval '2 years'`. */
const REMINDER_HORIZON_MS = 730 * 24 * 60 * 60 * 1000;

export type ReminderRecipient = "author" | "assignee";

export interface ReminderLine {
  id: string;
  remind_at: string;
  status: string;
}

/** The note a reminder may be saved with: trimmed, or null when there is none. */
export function reminderNote(raw: string): string | null {
  const note = raw.trim();
  if (!note) return null;
  return note.slice(0, REMINDER_NOTE_MAX);
}

/**
 * Why the moment in the form cannot be set, or null when it can. The value is
 * a `datetime-local` string, which JavaScript reads as local time.
 */
export function reminderMomentError(localValue: string, now: number): string | null {
  const at = localValue ? Date.parse(localValue) : Number.NaN;
  if (!Number.isFinite(at)) return "Выберите, когда напомнить.";
  if (at <= now) return "Это время уже прошло.";
  if (at > now + REMINDER_HORIZON_MS) return "Не дальше чем через два года.";
  return null;
}

/**
 * The form's first suggestion: tomorrow at 09:00, as `datetime-local` reads it.
 * An empty field has to be typed in full on a desktop; any concrete moment
 * saves that, and the next morning is the nearest one that is not «now».
 */
export function defaultReminderInput(now: Date): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  return toReminderInput(next);
}

/** A date as `YYYY-MM-DDTHH:mm`, in local time, for `<input type="datetime-local">`. */
export function toReminderInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Who a reminder goes to, as its line says it. The reader's own reminder reads
 * «Мне» or «Исполнителю»; one somebody else set for the reader, as the task's
 * assignee, reads «Вам».
 */
export function reminderRecipientLabel(recipient: string, mine: boolean): string {
  if (!mine) return "Вам";
  return recipient === "assignee" ? "Исполнителю" : "Мне";
}

/** What a reminder's line says of its delivery, or null while it waits. */
export function reminderStatusLabel(status: string): string | null {
  if (status === "sent") return "Отправлено";
  if (status === "skipped" || status === "failed") return "Не отправлено";
  return null;
}

/** The list's order: those still to come, soonest first, then the delivered, latest first. */
export function orderReminders<T extends ReminderLine>(rows: readonly T[]): T[] {
  const pending = rows.filter((row) => row.status === "pending");
  const done = rows.filter((row) => row.status !== "pending");
  const at = (row: T) => Date.parse(row.remind_at);
  return [
    ...pending.sort((a, b) => at(a) - at(b)),
    ...done.sort((a, b) => at(b) - at(a)),
  ];
}

/** The notification's line: «Инвентаризация склада» — Пришли комплектующие. */
export function reminderNotificationBody(title: string | undefined, note: string | undefined): string {
  const named = title ? `«${title}»` : null;
  if (named && note) return `${named} — ${note}`;
  return named ?? note ?? "Пора вернуться к задаче.";
}

/** What a refusal from the two functions says, in the words of the screen. */
export function reminderRefusal(error: { message?: string | null } | null | undefined): string {
  const message = error?.message ?? "";
  if (message === "reminder_in_past") return "Это время уже прошло.";
  if (message === "reminder_too_far") return "Не дальше чем через два года.";
  if (message === "reminder_no_assignee") return "У задачи нет исполнителя.";
  if (message === "reminder_note_invalid") return `Заметка — до ${REMINDER_NOTE_MAX} символов.`;
  if (message === "reminders_full") return `У вас уже ${REMINDERS_PER_AUTHOR} напоминаний на этой задаче.`;
  if (message.startsWith("task_locked")) return "Задача закрыта: напоминания больше не ставятся.";
  if (message === "forbidden") return "Напоминания ставят автор задачи, её исполнитель или руководитель.";
  if (message === "task_not_found" || message === "reminder_not_found") return "Напоминание или задача уже удалены.";
  return "Не удалось сохранить напоминание. Попробуйте ещё раз.";
}
