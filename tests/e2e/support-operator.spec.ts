import { expect, type Page, test } from "@playwright/test";
import {
  findFirstAvailableQaRole,
  gotoOrSkip,
  loginAsRoleOrSkip,
} from "./helpers/auth";

test.describe("LETSCUBE operator support workspace", () => {
  test("hides support from an account without support.view", async ({ page }) => {
    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, "client");

    await page.goto("/admin/support", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/admin\/support(?:[/?#]|$)/);
    await expect(page.getByRole("link", { name: "Поддержка" })).toHaveCount(0);
    await expect(page.getByTestId("support-operator-workspace")).toHaveCount(0);
  });

  test("shows queues, masks pool contacts and reports an atomic claim conflict", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await mockSupportApi(page, { claimConflict: true });
    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/support", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("support-operator-workspace")).toBeVisible();
    for (const tab of ["Общий пул", "Мои", "Срочные", "Ожидают", "Решённые", "Спам"]) {
      await expect(page.getByRole("button", { name: tab, exact: true })).toBeVisible();
    }

    await page.getByText("Не удаётся войти в аккаунт").click();
    await expect(page.getByText("Контакт скрыт до принятия")).toBeVisible();
    await page.getByRole("button", { name: "Принять" }).click();
    await expect(page.getByText("Обращение уже принял другой оператор. Очередь обновлена.")).toBeVisible();
  });

  test("keeps conversation and privileged actions inside a bounded mobile workspace", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await mockSupportApi(page, { assigned: true });
    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/support?ticket=11111111-1111-4111-8111-111111111111", {
      waitUntil: "domcontentloaded",
    });

    const workspace = page.getByTestId("support-operator-workspace");
    const scroll = page.getByTestId("support-ticket-scroll");
    await expect(workspace).toBeVisible();
    await expect(scroll).toBeVisible();
    await expect(page.getByText("operator@example.com")).toBeVisible();
    await expect(page.getByText("+79991234567")).toBeVisible();
    await expect(page.getByText("Не могу войти после смены пароля.")).toBeVisible();
    await expect(page.getByText("История действий")).toBeVisible();

    for (const action of ["Ответить", "Передать", "Вернуть в пул", "Передать старшему", "Настройки"]) {
      await expect(page.getByRole("button", { name: action, exact: true })).toBeVisible();
    }

    const box = await workspace.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.width ?? 0) <= page.viewportSize()!.width).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  });
});

type MockOptions = {
  assigned?: boolean;
  claimConflict?: boolean;
};

async function mockSupportApi(page: Page, options: MockOptions) {
  const ticketId = "11111111-1111-4111-8111-111111111111";
  const now = "2026-07-27T12:00:00.000Z";
  const assignedOperatorId = options.assigned ? "22222222-2222-4222-8222-222222222222" : null;

  await page.route("**/rest/v1/support_tickets**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: ticketId,
          public_reference: "LC-2026-ABCDEF123456",
          requester_user_id: null,
          source: "web_guest",
          status: options.assigned ? "in_progress" : "new",
          category: "access",
          subject: "Не удаётся войти в аккаунт",
          priority: "high",
          assigned_operator_id: assignedOperatorId,
          assigned_at: assignedOperatorId ? now : null,
          urgent: false,
          linked_ticket_id: null,
          resolution_summary: null,
          resolved_at: null,
          closed_at: null,
          last_requester_message_at: now,
          last_operator_message_at: null,
          last_activity_at: now,
          created_at: now,
          updated_at: now,
          version: 1,
        },
      ]),
    });
  });

  await page.route("**/rest/v1/support_ticket_messages**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "33333333-3333-4333-8333-333333333333",
          ticket_id: ticketId,
          author_user_id: null,
          author_kind: "requester",
          source: "web",
          body: "Не могу войти после смены пароля.",
          created_at: now,
        },
      ]),
    });
  });

  await page.route("**/rest/v1/support_ticket_events**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "44444444-4444-4444-8444-444444444444",
          ticket_id: ticketId,
          event_type: "ticket_created",
          actor_user_id: null,
          visibility: "requester",
          payload: {},
          created_at: now,
        },
      ]),
    });
  });

  await page.route("**/rest/v1/support_ticket_contacts**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        options.assigned
          ? [{
              ticket_id: ticketId,
              contact_name: "Операторский тест",
              email_original: "operator@example.com",
              phone_e164: "+79991234567",
              email_verified: false,
              phone_verified: false,
            }]
          : [],
      ),
    });
  });

  await page.route("**/rest/v1/support_settings**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: true,
        intake_enabled: true,
        guest_intake_enabled: true,
        closed_message: "Приём обращений временно закрыт.",
        ticket_limit_15m: 3,
        ticket_limit_day: 10,
        message_limit_5m: 20,
        message_limit_day: 200,
      }]),
    });
  });

  await page.route("**/rest/v1/rpc/support_ticket_claim", async (route) => {
    if (options.claimConflict) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "P0001",
          message: "support_ticket_already_claimed_or_unavailable",
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ticketId) });
  });
}
