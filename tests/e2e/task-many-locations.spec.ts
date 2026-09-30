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
 * Tracker item 72: a tester, 2026-09-28 — «задачам еще нужна возможность
 * выбрать сразу несколько локаций». For a route that names nobody, a new task
 * takes several locations and saving makes one task per location in one
 * request (`task_create_for_locations`, all or none). Fictional people.
 */

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("d9111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("d9111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT_TEAM = "d9222222-2222-4222-8222-000000000001";
const MINSK = "d9333333-3333-4333-8333-000000000001";
const PUSHKIN = "d9333333-3333-4333-8333-000000000002";
const LENIN = "d9333333-3333-4333-8333-000000000003";

const location = (id: string, name: string): Row => ({
  id,
  name,
  description: null,
  address: null,
  is_active: true,
  created_by: ME.id,
  created_at: AT,
  updated_at: AT,
});

const RIGHTS = new Set(["tasks.view", "tasks.create", "tasks.manage", "tasks.assign"]);

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

async function openForm(page: Page) {
  const fixture = await openFixture(page, {
    me: { ...ME, role: "manager" },
    people: [ANNA],
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [membership(CHAT_TEAM, ME, "owner", AT), membership(CHAT_TEAM, ANNA, "member", AT)],
    messages: [message("d9555555-5555-4555-8555-000000000001", CHAT_TEAM, ANNA, "Макет готов", AT)],
    rest: (call) => {
      if (call.method !== "GET") return undefined;
      if (call.resource === "locations") return { status: 200, body: [location(MINSK, "Минская"), location(PUSHKIN, "Пушкина"), location(LENIN, "Ленина")] };
      if (call.resource === "location_members") return { status: 200, body: [] };
      return undefined;
    },
    rpc: (name, body) => {
      if (name === "has_permission") return { body: RIGHTS.has(String(body.p_permission_key)) };
      if (name === "has_location_permission") return { body: RIGHTS.has(String(body.p_permission_key)) };
      if (name === "has_global_role") return { body: body.p_role_key === "manager" };
      if (name === "task_create_v4") return { body: "d9444444-4444-4444-8444-000000000001" };
      if (name === "task_create_for_locations") {
        return { body: (body.p_location_ids as string[]).map((_, index) => `d9444444-4444-4444-8444-00000000010${index}`) };
      }
      return undefined;
    },
  });
  await page.goto("/tasks", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Создать задачу" }).first().click();
  const form = page.getByRole("dialog").filter({ hasText: "Новая задача" });
  await expect(form.getByTestId("task-route")).toBeVisible();
  await form.getByPlaceholder(/Название|Что нужно сделать/).first().fill("Проверить кассу");
  return { fixture, form };
}

test("a workers' pool task goes to two locations as two tasks, in one request", async ({ page }) => {
  const { fixture, form } = await openForm(page);
  await form.getByTestId("task-route").selectOption({ label: "Любому работнику локации" });
  await form.locator("select").first().selectOption(MINSK);
  await form.getByTestId("task-add-location").selectOption(PUSHKIN);

  await expect(form.getByTestId("task-more-location")).toHaveText(["Пушкина"]);
  await expect(form.getByTestId("task-locations-note")).toHaveText("По одной задаче на каждую локацию — всего 2.");
  // One administrator is one person at one location.
  await expect(form.getByRole("combobox").filter({ hasText: "Не выбран" })).toBeDisabled();
  await form.getByRole("button", { name: "Создать 2 задачи", exact: true }).click();

  await expect.poll(() => fixture.rpcBodies("task_create_for_locations").length).toBe(1);
  expect(fixture.rpcBodies("task_create_for_locations")[0]).toMatchObject({
    p_location_ids: [MINSK, PUSHKIN],
    p_assignment_scope: "staff_pool",
    p_target_role: "staff",
    p_title: "Проверить кассу",
    p_frequency: null,
  });
  expect(fixture.rpcBodies("task_create_v4")).toHaveLength(0);
});

test("a location added is not offered twice, and one can be taken back", async ({ page }) => {
  const { form } = await openForm(page);
  await form.getByTestId("task-route").selectOption({ label: "Любому менеджеру локации" });
  await form.locator("select").first().selectOption(MINSK);
  const add = form.getByTestId("task-add-location");
  const offered = () => add.evaluate((select) => [...(select as HTMLSelectElement).options].map((option) => option.text));
  expect(await offered()).toEqual(["+ Ещё локация", "Пушкина", "Ленина"]);
  await add.selectOption(LENIN);
  expect(await offered()).toEqual(["+ Ещё локация", "Пушкина"]);
  await form.getByRole("button", { name: "Убрать локацию: Ленина" }).click();
  await expect(form.getByTestId("task-more-location")).toHaveCount(0);
  await expect(form.getByRole("button", { name: "Создать", exact: true })).toBeVisible();
});

test("a route that names a person keeps one location, and drops the others", async ({ page }) => {
  const { form } = await openForm(page);
  await form.getByTestId("task-route").selectOption({ label: "Любому работнику локации" });
  await form.locator("select").first().selectOption(MINSK);
  await form.getByTestId("task-add-location").selectOption(PUSHKIN);
  await form.getByTestId("task-route").selectOption({ label: "Конкретному человеку" });
  await expect(form.getByTestId("task-more-locations")).toHaveCount(0);
  await expect(form.getByRole("button", { name: "Создать", exact: true })).toBeVisible();
});

test("one location on a pool route is the task it always was", async ({ page }) => {
  const { fixture, form } = await openForm(page);
  await form.getByTestId("task-route").selectOption({ label: "Любому работнику локации" });
  await form.locator("select").first().selectOption(MINSK);
  await form.getByRole("button", { name: "Создать", exact: true }).click();
  await expect.poll(() => fixture.rpcBodies("task_create_v4").length).toBe(1);
  expect(fixture.rpcBodies("task_create_v4")[0]).toMatchObject({ p_location_id: MINSK, p_assignment_scope: "staff_pool" });
  expect(fixture.rpcBodies("task_create_for_locations")).toHaveLength(0);
});
