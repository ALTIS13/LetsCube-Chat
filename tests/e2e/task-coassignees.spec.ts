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
 * Tracker item 67, a tester on 2026-09-28: «есть задачи которые два человека
 * ведут параллельно». One person stays responsible; co-executors beside them
 * (`task_coassignees`, set whole by `task_set_coassignees`) do the work as the
 * assignee does.
 */

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("c9111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("c9111111-1111-4111-8111-000000000002", "Анна Смирнова");
const BORIS = person("c9111111-1111-4111-8111-000000000003", "Борис Ковалёв");
const CHAT_TEAM = "c9222222-2222-4222-8222-000000000001";
const TASK = "c9444444-4444-4444-8444-000000000001";

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

function taskRow(createdBy: string, assigneeId: string): Row {
  return {
    id: TASK, title: "Сборка двух стоек", description: "Каждый собирает свою.", priority: "normal",
    status: "assigned", created_by: createdBy, assignee_id: assigneeId, chat_id: null,
    due_at: null, starts_at: null, created_at: AT, updated_at: AT, visibility: "staff", assignment_scope: "user",
    location_id: null, target_role: null, route_admin_id: null, created_for_admin: false, recurrence_id: null,
    recurrence_template_task_id: null, recurrence_scheduled_for: null, deleted_at: null, deleted_by: null,
    delete_reason: null,
  };
}

async function openTask(
  page: Page,
  { author, coassignees }: { author: boolean; coassignees: { user_id: string; profile: Row }[] },
): Promise<Fixture> {
  // The co-executor's case: Анна wrote it for herself and put the reader beside her.
  const row = taskRow(author ? ME.id : ANNA.id, ANNA.id);
  const people = { assignee: ANNA, creator: author ? ME : ANNA };
  const fixture = await openFixture(page, {
    me: ME,
    people: [ANNA, BORIS],
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [membership(CHAT_TEAM, ME, "owner", AT), membership(CHAT_TEAM, ANNA, "member", AT)],
    messages: [message("c9666666-6666-4666-8666-000000000001", CHAT_TEAM, ANNA, "Макет готов", AT)],
    rest: (call) => {
      if (call.method !== "GET") return undefined;
      if (call.resource === "tasks") {
        const full = { ...row, ...people, chat: null, coassignees };
        return call.single ? { status: 200, body: full } : { status: 200, body: [{ ...full, checklist: [] }] };
      }
      if (call.resource === "task_coassignees") return { status: 200, body: coassignees.map((entry) => ({ task_id: TASK, user_id: entry.user_id })) };
      if (call.resource === "task_checklist_items" || call.resource === "task_events" || call.resource === "task_reminders") return { status: 200, body: [] };
      // Only the form's people search: every other read of profiles is the fixture's own.
      if (call.resource === "profiles" && decodeURIComponent(call.search ?? "").includes("ilike")) return { status: 200, body: [BORIS] };
      return undefined;
    },
    rpc: (name, body) => {
      if (name === "has_permission" || name === "has_location_permission") return { body: String(body.p_permission_key) === "tasks.view" };
      if (name === "has_global_role" || name === "is_manager_or_admin") return { body: false };
      if (name === "task_accept" || name === "task_set_coassignees" || name === "task_update_v4") return { body: null };
      return undefined;
    },
  });
  await page.goto(`/tasks?task=${TASK}`, { waitUntil: "domcontentloaded" });
  return fixture;
}

test("a co-executor sees themselves beside the assignee and takes the task on", async ({ page }) => {
  const fixture = await openTask(page, { author: false, coassignees: [{ user_id: ME.id, profile: ME }] });
  // The row carries the avatar's monogram before the name.
  await expect(page.getByTestId("task-coassignee")).toContainText(ME.full_name as string);
  // The assignee's own first step, offered to the one doing it beside her.
  await page.getByRole("button", { name: "Принять" }).click();
  await expect.poll(() => fixture.rpcBodies("task_accept").length).toBe(1);
  expect(fixture.rpcBodies("task_accept")[0]).toEqual({ p_task_id: TASK });
});

test("the author adds a co-executor in the form, and it is saved after the task", async ({ page }) => {
  const fixture = await openTask(page, { author: true, coassignees: [] });
  await expect(page.getByTestId("task-coassignees")).toHaveCount(0);
  await page.getByRole("button", { name: "Редактировать" }).click();
  const field = page.getByTestId("task-coassignees-field");
  await field.getByTestId("task-coassignee-search").fill("Бор");
  await field.getByRole("button", { name: /Борис Ковалёв/ }).click();
  await expect(field.getByTestId("task-coassignee-chip")).toHaveText(/Борис Ковалёв/);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect.poll(() => fixture.rpcBodies("task_set_coassignees").length).toBe(1);
  expect(fixture.rpcBodies("task_set_coassignees")[0]).toEqual({ p_task_id: TASK, p_user_ids: [BORIS.id] });
  expect(fixture.rpcBodies("task_update_v4").length, "the task itself was not saved first").toBe(1);
});

test("«Мои» holds the tasks the reader does beside the assignee", async ({ page }) => {
  // The page reads every task its reader may see and sorts them into tabs
  // itself; a co-executed task is one of «Мои», with its count on the card.
  await openTask(page, { author: false, coassignees: [{ user_id: ME.id, profile: ME }] });
  await page.goto("/tasks", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Мои" })).toBeVisible();
  await expect(page.getByText("Сборка двух стоек").first()).toBeVisible();
  await expect(page.getByTestId("task-coassignees-count").first()).toHaveText("+1");
});
