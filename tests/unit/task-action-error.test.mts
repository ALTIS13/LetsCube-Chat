import assert from "node:assert/strict";
import test from "node:test";
import { mapPgError } from "../../artifacts/kub/src/lib/errors.ts";

test("task self-review refusals explain the rule instead of suggesting lost permissions", () => {
  assert.equal(mapPgError({ code: "42501", message: "Нельзя подтверждать собственную задачу" }),
    "Вы участвуете в выполнении этой задачи. Подтвердить её может другой руководитель или владелец.");
  assert.equal(mapPgError({ code: "42501", message: "Нельзя отклонять собственную задачу" }),
    "Вы участвуете в выполнении этой задачи. Проверить её может другой руководитель или владелец.");
  assert.equal(mapPgError({ code: "42501", message: "Это действие доступно только исполнителю задачи" }),
    "Это действие доступно только исполнителю или соисполнителю задачи.");
});

test("unknown or extended database permission messages do not leak through the task allowlist", () => {
  for (const message of ["permission denied for table secrets", "Нельзя подтверждать собственную задачу: private@example.invalid", "неизвестная приватная причина"]) {
    assert.equal(mapPgError({ code: "42501", message }), "Недостаточно прав для этого действия.");
  }
});
