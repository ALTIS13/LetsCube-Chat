import { expect, test, type Page } from "@playwright/test";
import { formatTaskPeriod } from "../../artifacts/kub/src/lib/taskPeriod";
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
 * Tracker item 68, a tester on 2026-09-28: «не хватает возможности выбрать
 * промежуток… есть задачи которые идут месяц». A task may now run from a date
 * to a date: `tasks.starts_at`, written by `task_create_v4` and
 * `task_update_v4`, and read back everywhere the deadline was.
 */

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("c7111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("c7111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT_TEAM = "c7222222-2222-4222-8222-000000000001";
const NEW_TASK = "c7444444-4444-4444-8444-000000000001";
const TASK_RIGHTS = ["tasks.view", "tasks.create", "tasks.manage", "tasks.assign"];

const DAY = 86_400_000;
/** A period that begins in two days and runs a month, whatever day this runs. */
const startsAt = () => new Date(Math.ceil((Date.now() + 2 * DAY) / 3_600_000) * 3_600_000).toISOString();
const dueAt = () => new Date(Math.ceil((Date.now() + 30 * DAY) / 3_600_000) * 3_600_000).toISOString();

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

async function openTasks(page: Page, tasks: Row[] = []): Promise<Fixture> {
  const rights = new Set(TASK_RIGHTS);
  const fixture = await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [membership(CHAT_TEAM, ME, "owner", AT), membership(CHAT_TEAM, ANNA, "member", AT)],
    messages: [message("c7555555-5555-4555-8555-000000000001", CHAT_TEAM, ANNA, "Макет готов", AT)],
    rest: (call) => {
      if (call.method === "GET" && call.resource === "tasks") return { status: 200, body: tasks };
      return undefined;
    },
    rpc: (name, body) => {
      if (name === "has_permission") return { body: rights.has(String(body.p_permission_key)) };
      if (name === "has_location_permission") return { body: rights.has(String(body.p_permission_key)) };
      if (name === "has_global_role") return { body: body.p_role_key === "manager" };
      if (name === "task_create_v4") return { body: NEW_TASK };
      return undefined;
    },
  });
  await page.goto("/tasks", { waitUntil: "domcontentloaded" });
  return fixture;
}

/** The value a `datetime-local` field takes for a moment, in this machine's zone. */
function localInput(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function openForm(page: Page) {
  await page.getByRole("button", { name: "Создать задачу" }).first().click();
  const form = page.getByRole("dialog").filter({ hasText: "Новая задача" });
  await expect(form).toBeVisible();
  await form.getByPlaceholder(/Название|Что нужно сделать/).first().fill("Инвентаризация склада");
  return form;
}

test("a task runs from a date to a date: the form sends both", async ({ page }) => {
  const fixture = await openTasks(page);
  const form = await openForm(page);
  const start = startsAt();
  const due = dueAt();
  await form.getByTestId("task-starts-at").fill(localInput(start));
  await form.getByTestId("task-due-at").fill(localInput(due));
  await form.getByRole("button", { name: "Создать", exact: true }).click();

  await expect.poll(() => fixture.rpcBodies("task_create_v4").length).toBe(1);
  expect(fixture.rpcBodies("task_create_v4")[0]).toMatchObject({ p_starts_at: start, p_due_at: due });
});

test("a start after the deadline is refused before anything is sent", async ({ page }) => {
  const fixture = await openTasks(page);
  const form = await openForm(page);
  await form.getByTestId("task-starts-at").fill(localInput(dueAt()));
  await form.getByTestId("task-due-at").fill(localInput(startsAt()));
  await form.getByRole("button", { name: "Создать", exact: true }).click();

  await expect(form.getByText("Начало не может быть позже срока.")).toBeVisible();
  await page.waitForTimeout(400);
  expect(fixture.rpcBodies("task_create_v4"), "a backwards period reached the database").toHaveLength(0);
});

test("a task with a period says when it begins, and shows the period where the deadline was", async ({ page }) => {
  const start = startsAt();
  const due = dueAt();
  await openTasks(page, [
    {
      id: NEW_TASK,
      title: "Инвентаризация склада",
      description: null,
      priority: "normal",
      status: "assigned",
      created_by: ME.id,
      // Mine, so the list opens on it.
      assignee_id: ME.id,
      chat_id: null,
      due_at: due,
      starts_at: start,
      created_at: AT,
      updated_at: AT,
      visibility: "staff",
      assignment_scope: "user",
      location_id: null,
      target_role: null,
      route_admin_id: null,
      created_for_admin: false,
      recurrence_id: null,
      recurrence_template_task_id: null,
      recurrence_scheduled_for: null,
      deleted_at: null,
      deleted_by: null,
      delete_reason: null,
      assignee: ME,
      creator: ME,
    },
  ]);
  const period = formatTaskPeriod(start, due)!;
  await expect(page.getByText(period).first(), "the period is not where the deadline was").toBeVisible();
  await expect(page.getByText(/Начнётся через/).first(), "a period not begun reads as running out").toBeVisible();
});
