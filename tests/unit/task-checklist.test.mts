import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECKLIST_TEXT_MAX,
  checklistProgress,
  checklistRefusal,
  checklistText,
} from "../../artifacts/kub/src/lib/taskChecklist.ts";

// Tracker item 62: a checklist inside a task.

test("the card reads done of total, and nothing for a task without a checklist", () => {
  assert.deepEqual(checklistProgress([{ done: true }, { done: false }, { done: true }]), { done: 2, total: 3 });
  assert.equal(checklistProgress([]), null);
  assert.equal(checklistProgress(null), null);
});

test("an item is saved trimmed and within the database's limit, and an empty one not at all", () => {
  assert.equal(checklistText("  Сверить накладные  "), "Сверить накладные");
  assert.equal(checklistText("   "), null);
  assert.equal(checklistText("x".repeat(CHECKLIST_TEXT_MAX + 20))?.length, CHECKLIST_TEXT_MAX);
});

test("each refusal the functions give reads as what happened", () => {
  assert.equal(checklistRefusal({ message: "task_locked: status=cancelled" }), "Задача закрыта: чек-лист больше не меняется.");
  assert.equal(checklistRefusal({ message: "forbidden" }), "Менять этот чек-лист может автор задачи или её руководитель.");
  assert.equal(checklistRefusal({ message: "checklist_full" }), "В чек-листе уже 100 пунктов.");
  assert.equal(checklistRefusal({ message: "something else" }), "Не удалось сохранить чек-лист. Попробуйте ещё раз.");
});
