import type { TaskAssignmentScope, TaskTargetRole } from "../types/database.ts";

/**
 * Who a task goes to, as one choice (tracker item 63).
 *
 * The form used to ask it twice: «Получатель» set the task's `target_role` and
 * «Тип назначения» its `assignment_scope`, and a tester read the two as one
 * question — «Менеджер локации» beside «Пул менеджеров»: «по идее это может
 * быть в одном пункте едином». The database keeps both columns, because they
 * are read apart: `_task_visible_to_current_user_v3` shows a location's tasks
 * to its managers only when the pool is the managers' or the role is a
 * manager's or above, `task_claim` lets a pool's own people take a task, and
 * the task list's filters sort by the role. So each route here is a pair of
 * the two, and only pairs that mean something are offered:
 *
 * - a person, chosen under «Исполнитель»;
 * - anyone among the location's workers, or among its managers, who takes it;
 * - for whoever may route to management: a manager, the administrator or the
 *   owner, by name or through the location's administrator.
 *
 * A saved pair is shown as the route it means to its readers — who sees the
 * task and who may take it, which is what the database decides by — so the
 * pairs the old two fields made name their route: a person with the workers'
 * role is still a person, a pool with no role is still that pool. The form
 * sends the saved pair back untouched until the field is changed, so editing
 * a title never moves a task, even between the list's filters. A pair that
 * means none of the routes is shown as it is and kept.
 *
 * Pure, so `node --test` reads every case.
 */

export type TaskRouteId = "person" | "staff_pool" | "manager_pool" | "manager" | "admin" | "owner" | "kept";

export interface TaskRoute {
  id: TaskRouteId;
  label: string;
  scope: TaskAssignmentScope;
  targetRole: TaskTargetRole | "";
  /** Offered only to whoever may route a task to management. */
  management: boolean;
}

export const TASK_ROUTES: readonly TaskRoute[] = [
  { id: "person", label: "Конкретному человеку", scope: "user", targetRole: "", management: false },
  { id: "staff_pool", label: "Любому работнику локации", scope: "staff_pool", targetRole: "staff", management: false },
  { id: "manager_pool", label: "Любому менеджеру локации", scope: "manager_pool", targetRole: "", management: false },
  { id: "manager", label: "Менеджеру локации", scope: "user", targetRole: "manager", management: true },
  { id: "admin", label: "Администратору локации", scope: "user", targetRole: "admin", management: true },
  { id: "owner", label: "Владельцу", scope: "user", targetRole: "owner", management: true },
];

const SCOPE_WORDS: Record<TaskAssignmentScope, string> = {
  user: "исполнителю",
  manager_pool: "пул менеджеров",
  staff_pool: "пул работников",
};

const ROLE_WORDS: Record<TaskTargetRole, string> = {
  staff: "работники",
  manager: "менеджер",
  admin: "администратор",
  owner: "владелец",
};

const byId = (id: TaskRouteId) => TASK_ROUTES.find((route) => route.id === id) as TaskRoute;

/** The route a saved pair means, or the pair itself when it means none of them. */
export function routeOfTask(scope: TaskAssignmentScope, targetRole: TaskTargetRole | "" | null | undefined): TaskRoute {
  const role = targetRole ?? "";
  const exact = TASK_ROUTES.find((route) => route.scope === scope && route.targetRole === role);
  if (exact) return exact;
  // The same audience and the same people who may take it, by
  // `_task_visible_to_current_user_v3` and `task_claim`: the workers' role on
  // a person's task, no role on a pool, or the pool's own role on it.
  if (scope === "user" && role === "staff") return byId("person");
  if (scope === "staff_pool" && role === "") return byId("staff_pool");
  if (scope === "manager_pool" && role === "manager") return byId("manager_pool");
  return {
    id: "kept",
    label: `Как сейчас: ${SCOPE_WORDS[scope]}${role ? `, ${ROLE_WORDS[role]}` : ""}`,
    scope,
    targetRole: role,
    management: false,
  };
}

/**
 * What the one field offers: the routes this person may choose, and the saved
 * pair when it is none of them.
 */
export function routeChoices(current: TaskRoute, canRouteToManagement: boolean): TaskRoute[] {
  const offered = TASK_ROUTES.filter((route) => canRouteToManagement || !route.management);
  if (!offered.some((route) => route.id === current.id)) offered.push(current);
  return offered;
}
