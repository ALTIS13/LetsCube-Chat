import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * Tracker item 63: «Получатель» («Менеджер локации») and «Тип назначения»
 * («Пул менеджеров») read as the same question — «по идее это может быть в
 * одном пункте едином». One field, «Кому», now sets both columns the database
 * reads (`lib/taskRoute.ts`).
 */

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("c9111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("c9111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT_TEAM = "c9222222-2222-4222-8222-000000000001";
const LOCATION = "c9333333-3333-4333-8333-000000000001";
const NEW_TASK = "c9444444-4444-4444-8444-000000000001";

const LOCATION_ROW: Row = {
  id: LOCATION,
  name: "Минская",
  description: null,
  address: null,
  is_active: true,
  created_by: ME.id,
  created_at: AT,
  updated_at: AT,
};
const ADMIN_MEMBER: Row = {
  location_id: LOCATION,
  user_id: ANNA.id,
  role: "admin",
  role_id: null,
  primary_admin_id: null,
  is_primary: true,
  created_at: AT,
  updated_at: AT,
  profile: ANNA,
  primary_admin: null,
};

const TASK_RIGHTS = ["tasks.view", "tasks.create", "tasks.manage", "tasks.assign"];
const MANAGEMENT_RIGHTS = ["tasks.manage_admin_tasks"];

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

async function openForm(page: Page, { management }: { management: boolean }) {
  const rights = new Set([...TASK_RIGHTS, ...(management ? MANAGEMENT_RIGHTS : [])]);
  const fixture = await openFixture(page, {
    me: { ...ME, role: "manager" },
    people: [ANNA],
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [membership(CHAT_TEAM, ME, "owner", AT), membership(CHAT_TEAM, ANNA, "member", AT)],
    messages: [message("c9555555-5555-4555-8555-000000000001", CHAT_TEAM, ANNA, "Макет готов", AT)],
    rest: (call) => {
      if (call.method !== "GET") return undefined;
      if (call.resource === "locations") return { status: 200, body: [LOCATION_ROW] };
      if (call.resource === "location_members") return { status: 200, body: [ADMIN_MEMBER] };
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
  await page.getByRole("button", { name: "Создать задачу" }).first().click();
  const form = page.getByRole("dialog").filter({ hasText: "Новая задача" });
  await expect(form).toBeVisible();
  await expect(form.getByTestId("task-route")).toBeVisible();
  return { fixture, form };
}

const optionLabels = (page: Page) =>
  page.getByTestId("task-route").evaluate((select) => [...(select as HTMLSelectElement).options].map((option) => option.text));

test("one field asks who the task goes to, where two asked it", async ({ page }) => {
  const { form } = await openForm(page, { management: false });
  await expect(form.getByText("Кому", { exact: true })).toBeVisible();
  // Neither of the two questions it replaces is asked any more.
  await expect(form.getByText("Тип назначения", { exact: true })).toHaveCount(0);
  await expect(form.getByText("Получатель", { exact: true })).toHaveCount(0);
  expect(await optionLabels(page)).toEqual(["Конкретному человеку", "Любому работнику локации", "Любому менеджеру локации"]);
});

test("choosing the managers' pool sends both columns the database reads", async ({ page }) => {
  const { fixture, form } = await openForm(page, { management: false });
  await form.getByPlaceholder(/Название|Что нужно сделать/).first().fill("Проверить кассу");
  await form.locator("select").first().selectOption(LOCATION);
  await form.getByTestId("task-route").selectOption({ label: "Любому менеджеру локации" });
  // A pool has nobody to name: the person picker says so instead.
  await expect(form.getByText("Для задач из пула конкретный исполнитель не назначается сразу.", { exact: false })).toBeVisible();
  await form.getByRole("button", { name: "Создать", exact: true }).click();

  await expect.poll(() => fixture.rpcBodies("task_create_v4").length).toBe(1);
  expect(fixture.rpcBodies("task_create_v4")[0]).toMatchObject({
    p_assignment_scope: "manager_pool",
    p_target_role: null,
    p_assignee_id: null,
    p_location_id: LOCATION,
  });
});

test("the workers' pool, and routes to management only for whoever may use them", async ({ page }) => {
  const { fixture, form } = await openForm(page, { management: true });
  expect(await optionLabels(page)).toEqual([
    "Конкретному человеку",
    "Любому работнику локации",
    "Любому менеджеру локации",
    "Менеджеру локации",
    "Администратору локации",
    "Владельцу",
  ]);

  // «Задача для администратора» is the administrator's route, and the field says so.
  const adminBox = form.getByRole("checkbox", { name: /Задача для администратора/ });
  await adminBox.check();
  await expect(form.getByTestId("task-route")).toHaveValue("admin");
  // Another route is another addressee: the box lets go rather than pulling the field back.
  await form.getByTestId("task-route").selectOption({ label: "Любому работнику локации" });
  await expect(adminBox).not.toBeChecked();
  await expect(form.getByTestId("task-route")).toHaveValue("staff_pool");

  await form.getByPlaceholder(/Название|Что нужно сделать/).first().fill("Разложить инвентарь");
  await form.locator("select").first().selectOption(LOCATION);
  await form.getByRole("button", { name: "Создать", exact: true }).click();
  await expect.poll(() => fixture.rpcBodies("task_create_v4").length).toBe(1);
  expect(fixture.rpcBodies("task_create_v4")[0]).toMatchObject({
    p_assignment_scope: "staff_pool",
    p_target_role: "staff",
    p_created_for_admin: false,
  });
});
