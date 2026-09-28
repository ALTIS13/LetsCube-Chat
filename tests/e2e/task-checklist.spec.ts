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
 * Tracker item 62, a tester on 2026-09-28: «прописать пункты и отмечать какие
 * выполнены». A task carries a checklist (`task_checklist_items`), written
 * through four functions: whoever may edit the task adds, renames and removes
 * points, and the assignee may tick them off too.
 */

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("c6111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("c6111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT_TEAM = "c6222222-2222-4222-8222-000000000001";
const TASK = "c6444444-4444-4444-8444-000000000001";
const ITEM_ONE = "c6555555-5555-4555-8555-000000000001";
const ITEM_TWO = "c6555555-5555-4555-8555-000000000002";

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

function taskRow(createdBy: string, assigneeId: string | null): Row {
  return {
    id: TASK, title: "Инвентаризация склада", description: "Всё, что пришло за неделю.", priority: "normal",
    status: assigneeId ? "assigned" : "new", created_by: createdBy, assignee_id: assigneeId, chat_id: null,
    due_at: null, starts_at: null, created_at: AT, updated_at: AT, visibility: "staff", assignment_scope: "user",
    location_id: null, target_role: null, route_admin_id: null, created_for_admin: false, recurrence_id: null,
    recurrence_template_task_id: null, recurrence_scheduled_for: null, deleted_at: null, deleted_by: null,
    delete_reason: null,
  };
}

function item(id: string, text: string, position: number, done: boolean): Row {
  return {
    id, task_id: TASK, text, done, position, created_by: ME.id, done_by: done ? ME.id : null,
    done_at: done ? AT : null, created_at: AT, updated_at: AT,
  };
}

async function openTask(page: Page, { author }: { author: boolean }): Promise<Fixture> {
  // Both are the reader's own tasks, so «Мои» opens on them: the author's is
  // the one they wrote for themselves, the assignee's one Анна wrote.
  const row = author ? taskRow(ME.id, ME.id) : taskRow(ANNA.id, ME.id);
  const people = { assignee: ME, creator: author ? ME : ANNA };
  const items = [item(ITEM_ONE, "Пересчитать коробки", 1, true), item(ITEM_TWO, "Сверить накладные", 2, false)];
  const fixture = await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [membership(CHAT_TEAM, ME, "owner", AT), membership(CHAT_TEAM, ANNA, "member", AT)],
    messages: [message("c6666666-6666-4666-8666-000000000001", CHAT_TEAM, ANNA, "Макет готов", AT)],
    rest: (call) => {
      if (call.method !== "GET") return undefined;
      if (call.resource === "tasks") {
        return call.single
          ? { status: 200, body: { ...row, ...people, chat: null } }
          : { status: 200, body: [{ ...row, ...people, checklist: items.map((entry) => ({ done: entry.done })) }] };
      }
      if (call.resource === "task_checklist_items") return { status: 200, body: items };
      if (call.resource === "task_events") return { status: 200, body: [] };
      return undefined;
    },
    rpc: (name, body) => {
      // An ordinary account that may see tasks and nothing more, so only the
      // author's and the assignee's own rules apply.
      if (name === "has_permission" || name === "has_location_permission") return { body: String(body.p_permission_key) === "tasks.view" };
      if (name === "has_global_role") return { body: false };
      if (name === "is_manager_or_admin") return { body: false };
      // The database's answer and its effect, so a read after a change finds it.
      if (name === "task_checklist_add") {
        items.push(item("c6555555-5555-4555-8555-000000000003", String(body.p_text), items.length + 1, false));
        return { body: "c6555555-5555-4555-8555-000000000003" };
      }
      if (name === "task_checklist_set_done") {
        const target = items.find((entry) => entry.id === body.p_item_id);
        if (target) target.done = Boolean(body.p_done);
        return { body: null };
      }
      if (name === "task_checklist_remove") {
        const at = items.findIndex((entry) => entry.id === body.p_item_id);
        if (at >= 0) items.splice(at, 1);
        return { body: null };
      }
      return undefined;
    },
  });
  await page.goto("/tasks", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("task-checklist-badge").first(), "the card does not say how much is done").toHaveText("1/2");
  await page.getByText("Инвентаризация склада").first().click();
  await expect(page.getByTestId("task-checklist")).toBeVisible();
  return fixture;
}

test("the author adds, ticks and removes points", async ({ page }) => {
  const fixture = await openTask(page, { author: true });
  const checklist = page.getByTestId("task-checklist");
  await expect(checklist.getByTestId("task-checklist-progress")).toHaveText("1 из 2");

  await checklist.getByRole("checkbox", { name: "Сверить накладные" }).check();
  await expect.poll(() => fixture.rpcBodies("task_checklist_set_done").length).toBe(1);
  expect(fixture.rpcBodies("task_checklist_set_done")[0]).toEqual({ p_item_id: ITEM_TWO, p_done: true });
  await expect(checklist.getByTestId("task-checklist-progress"), "a tick is drawn before its answer").toHaveText("2 из 2");

  await checklist.getByTestId("task-checklist-draft").fill("  Подписать акт  ");
  await checklist.getByRole("button", { name: "Добавить" }).click();
  await expect.poll(() => fixture.rpcBodies("task_checklist_add").length).toBe(1);
  expect(fixture.rpcBodies("task_checklist_add")[0]).toEqual({ p_task_id: TASK, p_text: "Подписать акт" });

  await checklist.getByRole("button", { name: "Удалить пункт «Пересчитать коробки»" }).click();
  await expect.poll(() => fixture.rpcBodies("task_checklist_remove").length).toBe(1);
  expect(fixture.rpcBodies("task_checklist_remove")[0]).toEqual({ p_item_id: ITEM_ONE });
});

test("the assignee ticks points off, and is offered nothing else", async ({ page }) => {
  const fixture = await openTask(page, { author: false });
  const checklist = page.getByTestId("task-checklist");
  await checklist.getByRole("checkbox", { name: "Сверить накладные" }).check();
  await expect.poll(() => fixture.rpcBodies("task_checklist_set_done").length).toBe(1);
  await expect(checklist.getByTestId("task-checklist-draft"), "the assignee was offered to add").toHaveCount(0);
  await expect(checklist.getByRole("button", { name: /^Удалить пункт/ }), "the assignee was offered to remove").toHaveCount(0);
});
