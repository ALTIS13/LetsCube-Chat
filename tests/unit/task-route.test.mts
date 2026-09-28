import assert from "node:assert/strict";
import test from "node:test";

import { routeChoices, routeOfTask, TASK_ROUTES } from "../../artifacts/kub/src/lib/taskRoute.ts";

/**
 * Tracker item 63: «Получатель» («Менеджер локации») and «Тип назначения»
 * («Пул менеджеров») read as one question — «по идее это может быть в одном
 * пункте едином». One field now sets both columns.
 */

test("each route is one pair of the two columns, and no two routes share a pair", () => {
  const pairs = TASK_ROUTES.map((route) => `${route.scope}/${route.targetRole}`);
  assert.equal(new Set(pairs).size, pairs.length);
  assert.deepEqual(
    TASK_ROUTES.map((route) => [route.id, route.scope, route.targetRole]),
    [
      ["person", "user", ""],
      ["staff_pool", "staff_pool", "staff"],
      // No role on the managers' pool: the pool alone shows it to managers and
      // lets them take it, and a manager's role would demand an administrator
      // to route through — a question the pool does not have.
      ["manager_pool", "manager_pool", ""],
      ["manager", "user", "manager"],
      ["admin", "user", "admin"],
      ["owner", "user", "owner"],
    ],
  );
});

test("the tester's pair — «Менеджер локации» with «Пул менеджеров» — is one route", () => {
  assert.equal(routeOfTask("manager_pool", "manager").id, "manager_pool");
  assert.equal(routeOfTask("manager_pool", "").id, "manager_pool");
  assert.equal(routeOfTask("staff_pool", "staff").id, "staff_pool");
  assert.equal(routeOfTask("staff_pool", null).id, "staff_pool");
  // A person's task with the workers' role is seen by the same people as one
  // with none (`_task_visible_to_current_user_v3`), so it is still a person.
  assert.equal(routeOfTask("user", "staff").id, "person");
  assert.equal(routeOfTask("user", undefined).id, "person");
  assert.equal(routeOfTask("user", "admin").id, "admin");
});

test("a saved pair that means no route is shown as it is and kept", () => {
  const kept = routeOfTask("staff_pool", "manager");
  assert.equal(kept.id, "kept");
  assert.equal(kept.scope, "staff_pool");
  assert.equal(kept.targetRole, "manager");
  assert.equal(kept.label, "Как сейчас: пул работников, менеджер");
  // Offered beside the routes, so the field can show what the task is.
  const offered = routeChoices(kept, false).map((route) => route.id);
  assert.deepEqual(offered, ["person", "staff_pool", "manager_pool", "kept"]);
});

test("management routes are offered only to whoever may route to management", () => {
  const person = routeOfTask("user", "");
  assert.deepEqual(routeChoices(person, false).map((route) => route.id), ["person", "staff_pool", "manager_pool"]);
  assert.deepEqual(
    routeChoices(person, true).map((route) => route.id),
    ["person", "staff_pool", "manager_pool", "manager", "admin", "owner"],
  );
  // A task already routed to management stays readable for someone who could
  // not have chosen it.
  assert.deepEqual(
    routeChoices(routeOfTask("user", "owner"), false).map((route) => route.id),
    ["person", "staff_pool", "manager_pool", "owner"],
  );
});
