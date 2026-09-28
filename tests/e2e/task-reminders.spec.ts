import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Fixture,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * Tracker item 66, a tester on 2026-09-28: «комплектующие придут только через
 * неделю и тогда надо напоминание, что пора приступать делать. А потом будет
 * вторая поставка… и опять надо напоминание». A task carries reminders
 * (`task_reminders`), set through `task_reminder_add` for the author («Мне») or
 * for the task's assignee, and delivered by pg_cron as a `task_reminder`
 * notification that opens the task.
 */

const AT = "2026-09-28T09:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const ME = person("c7111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("c7111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT_TEAM = "c7222222-2222-4222-8222-000000000001";
const TASK = "c7444444-4444-4444-8444-000000000001";
const MINE_PENDING = "c7555555-5555-4555-8555-000000000001";
const MINE_SENT = "c7555555-5555-4555-8555-000000000002";
const ANNAS = "c7555555-5555-4555-8555-000000000003";
const ADDED = "c7555555-5555-4555-8555-000000000009";

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

function taskRow(createdBy: string, assigneeId: string | null): Row {
  return {
    id: TASK, title: "Сборка рабочей станции", description: "Корпус, плата, память — по мере поставок.", priority: "normal",
    status: assigneeId ? "assigned" : "new", created_by: createdBy, assignee_id: assigneeId, chat_id: null,
    due_at: null, starts_at: null, created_at: AT, updated_at: AT, visibility: "staff", assignment_scope: "user",
    location_id: null, target_role: null, route_admin_id: null, created_for_admin: false, recurrence_id: null,
    recurrence_template_task_id: null, recurrence_scheduled_for: null, deleted_at: null, deleted_by: null,
    delete_reason: null,
  };
}

function reminder(id: string, createdBy: string, recipient: "author" | "assignee", remindAt: number, note: string | null, status = "pending"): Row {
  const at = new Date(remindAt).toISOString();
  return {
    id, task_id: TASK, created_by: createdBy, recipient, remind_at: at, note, status,
    delivered_at: status === "pending" ? null : at, delivered_to: status === "sent" ? createdBy : null, created_at: AT,
  };
}

async function openTask(
  page: Page,
  { author, reminders }: { author: boolean; reminders: Row[] },
): Promise<Fixture> {
  // The author's task is assigned to Анна; the other one Анна wrote for the reader.
  const row = author ? taskRow(ME.id, ANNA.id) : taskRow(ANNA.id, ME.id);
  const people = author ? { assignee: ANNA, creator: ME } : { assignee: ME, creator: ANNA };
  const fixture = await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [membership(CHAT_TEAM, ME, "owner", AT), membership(CHAT_TEAM, ANNA, "member", AT)],
    messages: [message("c7666666-6666-4666-8666-000000000001", CHAT_TEAM, ANNA, "Макет готов", AT)],
    rest: (call) => {
      if (call.method !== "GET") return undefined;
      if (call.resource === "tasks") {
        return call.single
          ? { status: 200, body: { ...row, ...people, chat: null } }
          : { status: 200, body: [{ ...row, ...people, checklist: [] }] };
      }
      if (call.resource === "task_reminders") return { status: 200, body: reminders };
      if (call.resource === "task_checklist_items" || call.resource === "task_events") return { status: 200, body: [] };
      return undefined;
    },
    rpc: (name, body) => {
      // An ordinary account that may see tasks and nothing more, so only the
      // author's and the assignee's own rules apply.
      if (name === "has_permission" || name === "has_location_permission") return { body: String(body.p_permission_key) === "tasks.view" };
      if (name === "has_global_role" || name === "is_manager_or_admin") return { body: false };
      // The database's answer and its effect, so a read after a change finds it.
      if (name === "task_reminder_add") {
        reminders.push(reminder(ADDED, ME.id, (body.p_recipient as "author" | "assignee") ?? "author", Date.parse(String(body.p_remind_at)), (body.p_note as string | null) ?? null));
        return { body: ADDED };
      }
      if (name === "task_reminder_remove") {
        const at = reminders.findIndex((entry) => entry.id === body.p_reminder_id);
        if (at >= 0) reminders.splice(at, 1);
        return { body: null };
      }
      return undefined;
    },
  });
  await page.goto(`/tasks?task=${TASK}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("task-reminders")).toBeVisible();
  return fixture;
}

/** Three days ahead at 10:30, as the page's own clock and time zone read it. */
async function aheadInPage(page: Page) {
  return page.evaluate(() => {
    const date = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    date.setHours(10, 30, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      local: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T10:30`,
      iso: date.toISOString(),
    };
  });
}

test("the author sets one for the assignee, with a note, and removes their own", async ({ page }) => {
  const now = Date.now();
  const fixture = await openTask(page, {
    author: true,
    reminders: [
      reminder(MINE_SENT, ME.id, "author", now - DAY, null, "sent"),
      reminder(MINE_PENDING, ME.id, "author", now + 2 * DAY, "Проверить поставку"),
    ],
  });
  const section = page.getByTestId("task-reminders");
  const lines = section.getByTestId("task-reminder");
  // Those still to come first; the delivered one says so.
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toHaveAttribute("data-status", "pending");
  await expect(lines.nth(0)).toContainText("Мне");
  await expect(lines.nth(0)).toContainText("Проверить поставку");
  await expect(lines.nth(1)).toContainText("Отправлено");

  await section.getByTestId("task-reminder-open").click();
  const group = section.getByRole("radiogroup", { name: "Кому напомнить" });
  await expect(group.getByRole("radio", { name: "Исполнителю — Анна Смирнова" }), "the assignee is not the first suggestion").toHaveAttribute("aria-checked", "true");
  const ahead = await aheadInPage(page);
  await section.getByTestId("task-reminder-at").fill(ahead.local);
  await section.getByTestId("task-reminder-note").fill("  Пришли комплектующие  ");
  await section.getByTestId("task-reminder-save").click();
  await expect.poll(() => fixture.rpcBodies("task_reminder_add").length).toBe(1);
  expect(fixture.rpcBodies("task_reminder_add")[0]).toEqual({
    p_task_id: TASK,
    p_remind_at: ahead.iso,
    p_recipient: "assignee",
    p_note: "Пришли комплектующие",
  });
  await expect(section.getByTestId("task-reminder-form"), "the form stayed open after the answer").toHaveCount(0);
  await expect(lines.filter({ hasText: "Пришли комплектующие" })).toContainText("Исполнителю");

  await lines.filter({ hasText: "Проверить поставку" }).getByTestId("task-reminder-remove").click();
  await expect.poll(() => fixture.rpcBodies("task_reminder_remove").length).toBe(1);
  expect(fixture.rpcBodies("task_reminder_remove")[0]).toEqual({ p_reminder_id: MINE_PENDING });
});

test("a moment already past is refused in the form, before the database is asked", async ({ page }) => {
  const fixture = await openTask(page, { author: true, reminders: [] });
  const section = page.getByTestId("task-reminders");
  await section.getByTestId("task-reminder-open").click();
  await section.getByTestId("task-reminder-at").fill("2020-01-01T09:00");
  await section.getByTestId("task-reminder-save").click();
  await expect(section.getByRole("alert")).toHaveText("Это время уже прошло.");
  expect(fixture.rpcBodies("task_reminder_add")).toHaveLength(0);
});

test("the assignee reads the one set for them, may not remove it, and sets their own", async ({ page }) => {
  const fixture = await openTask(page, {
    author: false,
    reminders: [reminder(ANNAS, ANNA.id, "assignee", Date.now() + 2 * DAY, "Вторая поставка")],
  });
  const section = page.getByTestId("task-reminders");
  const annas = section.getByTestId("task-reminder").filter({ hasText: "Вторая поставка" });
  await expect(annas).toContainText("Вам");
  await expect(annas.getByTestId("task-reminder-remove"), "the assignee was offered to remove the author's reminder").toHaveCount(0);

  await section.getByTestId("task-reminder-open").click();
  await expect(section.getByRole("radiogroup"), "the assignee was asked whom to remind").toHaveCount(0);
  const ahead = await aheadInPage(page);
  await section.getByTestId("task-reminder-at").fill(ahead.local);
  await section.getByTestId("task-reminder-save").click();
  await expect.poll(() => fixture.rpcBodies("task_reminder_add").length).toBe(1);
  expect(fixture.rpcBodies("task_reminder_add")[0]).toMatchObject({ p_recipient: "author", p_note: null });
});

test("a reminder in the notification centre reads as one and opens its task", async ({ page }) => {
  await openTask(page, { author: false, reminders: [] });
  await page.route("http://127.0.0.1:54321/rest/v1/notifications**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "c7777777-7777-4777-8777-000000000001",
          user_id: ME.id,
          kind: "task_reminder",
          payload: { task_id: TASK, title: "Сборка рабочей станции", note: "Пришли комплектующие", priority: "normal" },
          read_at: null,
          created_at: new Date().toISOString(),
        },
      ]),
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("notification-bell-button").click();
  const item = page.getByTestId("notification-panel").getByTestId("notification-item").first();
  await expect(item).toContainText("Напоминание");
  await expect(item).toContainText("«Сборка рабочей станции» — Пришли комплектующие");
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/tasks\\?task=${TASK}$`));
  await expect(page.getByTestId("task-reminders")).toBeVisible();
});
