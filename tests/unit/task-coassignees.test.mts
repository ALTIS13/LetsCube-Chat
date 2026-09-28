import assert from "node:assert/strict";
import test from "node:test";

import {
  COASSIGNEES_MAX,
  coassigneeIds,
  coassigneesChanged,
  coassigneesRefusal,
  isCoassignee,
} from "../../artifacts/kub/src/lib/taskCoassignees.ts";

// Tracker item 67: co-executors beside the assignee.

test("a reader is a co-executor only if a row names them", () => {
  const rows = [{ user_id: "anna" }, { user_id: "boris" }];
  assert.equal(isCoassignee(rows, "boris"), true);
  assert.equal(isCoassignee(rows, "me"), false);
  assert.equal(isCoassignee(null, "boris"), false);
  assert.equal(isCoassignee(rows, null), false);
});

test("the list sent is distinct, never the assignee, and at most ten", () => {
  assert.deepEqual(coassigneeIds(["anna", "boris", "anna", "", "me"], "me"), ["anna", "boris"]);
  const many = Array.from({ length: 14 }, (_, index) => `p${index}`);
  assert.equal(coassigneeIds(many, null).length, COASSIGNEES_MAX);
});

test("an unchanged list is not sent again, whatever its order", () => {
  assert.equal(coassigneesChanged(["anna", "boris"], ["boris", "anna"]), false);
  assert.equal(coassigneesChanged(["anna"], ["anna", "boris"]), true);
  assert.equal(coassigneesChanged(["anna", "boris"], ["anna", "vera"]), true);
  assert.equal(coassigneesChanged([], []), false);
});

test("each refusal of task_set_coassignees reads as a sentence", () => {
  assert.equal(coassigneesRefusal({ message: "too_many_coassignees" }), "Соисполнителей может быть не больше 10.");
  assert.equal(coassigneesRefusal({ message: "task_locked: status=confirmed" }), "Задача закрыта: соисполнителей больше не меняют.");
  assert.equal(coassigneesRefusal({ message: "Пользователь не относится к этой локации" }), "Соисполнитель должен относиться к локации задачи.");
  assert.equal(coassigneesRefusal({ message: "forbidden" }), "Соисполнителей меняют автор задачи или её руководитель.");
  assert.equal(coassigneesRefusal(null), "Не удалось сохранить соисполнителей. Попробуйте ещё раз.");
});
