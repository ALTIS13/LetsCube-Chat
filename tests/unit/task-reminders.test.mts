import assert from "node:assert/strict";
import test from "node:test";

import {
  REMINDER_NOTE_MAX,
  defaultReminderInput,
  orderReminders,
  reminderMomentError,
  reminderNote,
  reminderNotificationBody,
  reminderRecipientLabel,
  reminderRefusal,
  reminderStatusLabel,
  toReminderInput,
} from "../../artifacts/kub/src/lib/taskReminders.ts";

// Tracker item 66: reminders on a task, `20260928190000_task_reminders.sql`.

test("a note is trimmed, and a blank one is no note", () => {
  assert.equal(reminderNote("  Пришли комплектующие  "), "Пришли комплектующие");
  assert.equal(reminderNote("   "), null);
  assert.equal(reminderNote("я".repeat(REMINDER_NOTE_MAX + 5))?.length, REMINDER_NOTE_MAX);
});

test("the moment must lie ahead, and not more than two years out, as the database asks", () => {
  const now = new Date(2026, 8, 28, 12, 0).getTime();
  assert.equal(reminderMomentError("", now), "Выберите, когда напомнить.");
  assert.equal(reminderMomentError("2026-09-28T11:59", now), "Это время уже прошло.");
  assert.equal(reminderMomentError("2026-09-28T12:00", now), "Это время уже прошло.");
  assert.equal(reminderMomentError("2026-09-28T12:01", now), null);
  assert.equal(reminderMomentError("2028-09-30T12:00", now), "Не дальше чем через два года.");
});

test("the form first suggests tomorrow at nine, in local time", () => {
  assert.equal(defaultReminderInput(new Date(2026, 8, 28, 23, 40)), "2026-09-29T09:00");
  // The last day of a month rolls into the next one.
  assert.equal(defaultReminderInput(new Date(2026, 8, 30, 8, 0)), "2026-10-01T09:00");
  assert.equal(toReminderInput(new Date(2026, 0, 5, 7, 3)), "2026-01-05T07:03");
});

test("the reader's own reminder names its recipient; one set for the reader says «Вам»", () => {
  assert.equal(reminderRecipientLabel("author", true), "Мне");
  assert.equal(reminderRecipientLabel("assignee", true), "Исполнителю");
  assert.equal(reminderRecipientLabel("assignee", false), "Вам");
});

test("a delivered reminder says so, a waiting one says nothing", () => {
  assert.equal(reminderStatusLabel("pending"), null);
  assert.equal(reminderStatusLabel("sent"), "Отправлено");
  assert.equal(reminderStatusLabel("skipped"), "Не отправлено");
  assert.equal(reminderStatusLabel("failed"), "Не отправлено");
});

test("those still to come go first, soonest first; the delivered follow, latest first", () => {
  const rows = [
    { id: "sent-early", remind_at: "2026-09-01T09:00:00Z", status: "sent" },
    { id: "later", remind_at: "2026-10-20T09:00:00Z", status: "pending" },
    { id: "sent-late", remind_at: "2026-09-20T09:00:00Z", status: "sent" },
    { id: "sooner", remind_at: "2026-10-05T09:00:00Z", status: "pending" },
  ];
  assert.deepEqual(orderReminders(rows).map((row) => row.id), ["sooner", "later", "sent-late", "sent-early"]);
  assert.equal(rows[0].id, "sent-early", "the rows given are not reordered in place");
});

test("the notification names the task and carries the note", () => {
  assert.equal(reminderNotificationBody("Сборка ПК", "Пришли комплектующие"), "«Сборка ПК» — Пришли комплектующие");
  assert.equal(reminderNotificationBody("Сборка ПК", undefined), "«Сборка ПК»");
  assert.equal(reminderNotificationBody(undefined, "Пришли комплектующие"), "Пришли комплектующие");
  assert.equal(reminderNotificationBody(undefined, undefined), "Пора вернуться к задаче.");
});

test("each refusal of the two functions reads as a sentence", () => {
  assert.equal(reminderRefusal({ message: "reminder_in_past" }), "Это время уже прошло.");
  assert.equal(reminderRefusal({ message: "reminder_no_assignee" }), "У задачи нет исполнителя.");
  assert.equal(reminderRefusal({ message: "task_locked: status=cancelled" }), "Задача закрыта: напоминания больше не ставятся.");
  assert.equal(reminderRefusal({ message: "forbidden" }), "Напоминания ставят автор задачи, её исполнитель или руководитель.");
  assert.equal(reminderRefusal({ message: "reminder_not_found" }), "Напоминание или задача уже удалены.");
  assert.equal(reminderRefusal({ message: "boom" }), "Не удалось сохранить напоминание. Попробуйте ещё раз.");
  assert.equal(reminderRefusal(null), "Не удалось сохранить напоминание. Попробуйте ещё раз.");
});
