/**
 * One task, sent to several locations — tracker item 72.
 *
 * A tester, 2026-09-28: «задачам еще нужна возможность выбрать сразу несколько
 * локаций». A task is routed within one location, so several locations make one
 * task each (`task_create_for_locations`, all or none). Only for the routes that
 * name nobody: a manager, an administrator or the owner is a person, and a
 * person works at one location.
 *
 * Pure, so `node --test` decides every case (`tests/unit/task-locations.test.mts`).
 */

import { selectRussianPluralForm, type RussianPluralForms } from "./messageMediaSections.ts";

/** The routes whose task may go to several locations. */
const POOL_ROUTES: ReadonlySet<string> = new Set(["staff_pool", "manager_pool"]);

/** The most the database accepts in one request. */
export const TASK_LOCATIONS_MAX = 50;

/** Whether this route, in this form, may take more than one location. */
export function routeTakesSeveralLocations(routeId: string, isEdit: boolean): boolean {
  return !isEdit && POOL_ROUTES.has(routeId);
}

/** The locations to send, in the order they were chosen, each once and none empty. */
export function taskLocationsToSend(first: string, more: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of [first, ...more]) {
    const clean = id.trim();
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

/** The locations still offered for adding: not the first, not one already added. */
export function locationsLeftToAdd<L extends { id: string }>(all: readonly L[], first: string, more: readonly string[]): L[] {
  const taken = new Set([first, ...more].filter(Boolean));
  return all.filter((location) => !taken.has(location.id));
}

/** «Создать …» takes the accusative: 1 задачу, 3 задачи, 5 задач, 21 задачу. */
const TASKS_ACCUSATIVE: RussianPluralForms = ["задачу", "задачи", "задач"];

/**
 * What saving will do, said before it is done — worded so that no verb has to
 * agree with a number, which «Будет создано 21 задача» did not.
 */
export function severalLocationsNote(count: number): string | null {
  if (count < 2) return null;
  return `По одной задаче на каждую локацию — всего ${count}.`;
}

/** The button's word: one task or several. */
export function createTasksLabel(count: number): string {
  return count >= 2 ? `Создать ${count} ${selectRussianPluralForm(count, TASKS_ACCUSATIVE)}` : "Создать";
}

/** A refusal of `task_create_for_locations` that is its own, as a sentence; null for the rest. */
export function taskLocationsRefusalText(error: unknown): string | null {
  const message =
    error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "";
  if (message.includes("task_locations_need_a_pool")) {
    return "Сразу в несколько локаций можно отправить только задачу любому работнику или менеджеру.";
  }
  if (message.includes("task_too_many_locations")) {
    return `За раз — не больше ${TASK_LOCATIONS_MAX} локаций.`;
  }
  if (message.includes("task_location_required")) return "Выберите хотя бы одну локацию.";
  return null;
}
