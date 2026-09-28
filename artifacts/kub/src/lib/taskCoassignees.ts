/**
 * Co-executors of a task (tracker item 67). A tester, 2026-09-28: «есть задачи
 * которые два человека ведут параллельно». One person stays responsible
 * (`assignee_id`); `task_coassignees` adds the others, set whole by
 * `task_set_coassignees`, and a co-executor may do what the work needs — move
 * the task along, comment, tick the checklist, set reminders — but, like the
 * assignee, not confirm or reject it (`20260929100000_task_coassignees.sql`).
 *
 * Imports nothing, so `tests/unit/task-coassignees.test.mts` reaches it directly.
 */

export const COASSIGNEES_MAX = 10;

export interface CoassigneeRow {
  user_id: string;
}

/** Whether this reader is one of the task's co-executors. */
export function isCoassignee(rows: readonly CoassigneeRow[] | null | undefined, userId: string | null | undefined): boolean {
  if (!userId || !rows?.length) return false;
  return rows.some((row) => row.user_id === userId);
}

/** The list the form sends: distinct, without the assignee, at most ten. */
export function coassigneeIds(ids: readonly string[], assigneeId: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || id === assigneeId || seen.has(id)) continue;
    seen.add(id);
  }
  return [...seen].slice(0, COASSIGNEES_MAX);
}

/** Whether the list changed, so an unchanged save sends nothing. */
export function coassigneesChanged(before: readonly string[], after: readonly string[]): boolean {
  if (before.length !== after.length) return true;
  const known = new Set(before);
  return after.some((id) => !known.has(id));
}

/** What a refusal from `task_set_coassignees` says, in the words of the screen. */
export function coassigneesRefusal(error: { message?: string | null } | null | undefined): string {
  const message = error?.message ?? "";
  if (message === "too_many_coassignees") return `Соисполнителей может быть не больше ${COASSIGNEES_MAX}.`;
  if (message === "coassignee_unavailable") return "Одного из соисполнителей нельзя добавить.";
  if (message === "coassignees_need_a_person") return "Соисполнители бывают только у задачи с исполнителем.";
  if (message.startsWith("task_locked")) return "Задача закрыта: соисполнителей больше не меняют.";
  if (message === "forbidden") return "Соисполнителей меняют автор задачи или её руководитель.";
  if (message.includes("не относится к этой локации")) return "Соисполнитель должен относиться к локации задачи.";
  return "Не удалось сохранить соисполнителей. Попробуйте ещё раз.";
}
