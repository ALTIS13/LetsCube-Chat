// One task, sent to several locations — tracker item 72.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createTasksLabel,
  locationsLeftToAdd,
  routeTakesSeveralLocations,
  severalLocationsNote,
  taskLocationsRefusalText,
  taskLocationsToSend,
} from "../../artifacts/kub/src/lib/taskLocations.ts";

test("only the routes that name nobody take several locations, and only a new task", () => {
  assert.equal(routeTakesSeveralLocations("staff_pool", false), true);
  assert.equal(routeTakesSeveralLocations("manager_pool", false), true);
  for (const route of ["person", "manager", "admin", "owner"]) {
    assert.equal(routeTakesSeveralLocations(route, false), false, route);
  }
  assert.equal(routeTakesSeveralLocations("staff_pool", true), false, "an existing task stays where it is");
});

test("the locations go in the order chosen, each once, none empty", () => {
  assert.deepEqual(taskLocationsToSend("a", ["b", "a", "", " c "]), ["a", "b", "c"]);
  assert.deepEqual(taskLocationsToSend("", ["b"]), ["b"]);
  assert.deepEqual(taskLocationsToSend("", []), []);
});

test("a location already chosen is not offered again", () => {
  const all = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(locationsLeftToAdd(all, "a", ["c"]).map((location) => location.id), ["b"]);
  assert.deepEqual(locationsLeftToAdd(all, "", []).map((location) => location.id), ["a", "b", "c"]);
});

test("saving says what it will do, in Russian", () => {
  assert.equal(severalLocationsNote(1), null);
  assert.equal(severalLocationsNote(2), "По одной задаче на каждую локацию — всего 2.");
  assert.equal(createTasksLabel(1), "Создать");
  assert.equal(createTasksLabel(3), "Создать 3 задачи");
  assert.equal(createTasksLabel(5), "Создать 5 задач");
  assert.equal(createTasksLabel(21), "Создать 21 задачу", "the accusative, not «21 задача»");
});

test("the function's own refusals are sentences; others are left to the form's mapper", () => {
  assert.match(taskLocationsRefusalText({ message: "task_locations_need_a_pool" }) ?? "", /любому работнику или менеджеру/);
  assert.match(taskLocationsRefusalText({ message: "task_too_many_locations" }) ?? "", /50/);
  assert.equal(taskLocationsRefusalText({ message: "task_location_required" }), "Выберите хотя бы одну локацию.");
  assert.equal(taskLocationsRefusalText({ message: "forbidden" }), null);
  assert.equal(taskLocationsRefusalText(null), null);
});
