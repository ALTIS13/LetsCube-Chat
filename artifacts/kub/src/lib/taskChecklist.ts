/**
 * A checklist inside a task (tracker item 62). A tester, 2026-09-28:
 * «прописать пункты и отмечать какие выполнены». Stored in
 * `task_checklist_items`, written only through `task_checklist_add`,
 * `…_rename`, `…_set_done` and `…_remove`, which ask the rule `task_update_v3`
 * asks — except ticking, which the assignee may do too.
 *
 * Imports nothing, so `tests/unit/task-checklist.test.mts` reaches it directly.
 */

export const CHECKLIST_TEXT_MAX = 500;
export const CHECKLIST_MAX_ITEMS = 100;

export interface ChecklistProgress {
  done: number;
  total: number;
}

/** «2/5» on the card, or null for a task without a checklist. */
export function checklistProgress(items: readonly { done: boolean }[] | null | undefined): ChecklistProgress | null {
  if (!items?.length) return null;
  return { done: items.filter((item) => item.done).length, total: items.length };
}

/** The text an item may be saved with, or null when there is nothing to save. */
export function checklistText(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  return text.slice(0, CHECKLIST_TEXT_MAX);
}

/** What a refusal from the four functions says, in the words of the screen. */
export function checklistRefusal(error: { message?: string | null } | null | undefined): string {
  const message = error?.message ?? "";
  if (message.startsWith("task_locked")) return "Задача закрыта: чек-лист больше не меняется.";
  if (message === "forbidden") return "Менять этот чек-лист может автор задачи или её руководитель.";
  if (message === "checklist_full") return `В чек-листе уже ${CHECKLIST_MAX_ITEMS} пунктов.`;
  if (message === "checklist_text_invalid") return `Пункт — от 1 до ${CHECKLIST_TEXT_MAX} символов.`;
  if (message === "task_not_found" || message === "checklist_item_not_found") return "Пункт или задача уже удалены.";
  return "Не удалось сохранить чек-лист. Попробуйте ещё раз.";
}
