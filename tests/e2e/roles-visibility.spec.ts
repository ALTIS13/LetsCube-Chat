import { expect, type Page, test } from "@playwright/test";
import {
  findFirstAvailableQaRole,
  gotoOrSkip,
  loginAsRoleOrSkip,
  type QaAuthStateName,
} from "./helpers/auth";

test.describe("KUB role visibility", () => {
  test("client account keeps task and admin UI hidden", async ({ page }) => {
    await openAsRole(page, "client");

    await expect(page.getByTestId("sidebar-search-input")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expectSidebarMenuItem(page, "Задачи", false);
    await expectSidebarMenuItem(page, "Админ-панель", false);
    await expect(page.getByText("Произошла ошибка интерфейса")).toHaveCount(0);
  });

  test("location staff can open tasks but does not see management controls", async ({ page }) => {
    await openAsRole(page, "location_staff");

    await expectSidebarMenuItem(page, "Задачи", true);
    await openSidebarMenuItem(page, "Задачи");
    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.getByRole("heading", { name: "Задачи" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Новая задача|Создать задачу/ })).toHaveCount(0);
    await expect(page.getByText("Показать удалённые")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Удалить выбранные|Удалить задачу/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Приостановить|Возобновить|Остановить повтор/ }),
    ).toHaveCount(0);
  });

  test("location admin can reach tasks and scoped admin surfaces", async ({ page }) => {
    await openAsRole(page, "location_admin");

    await expectSidebarMenuItem(page, "Задачи", true);
    await openSidebarMenuItem(page, "Задачи");
    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.getByRole("heading", { name: "Задачи" }).first()).toBeVisible();

    await gotoOrSkip(page, "/admin");
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByText("Админ-панель")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Пользователи" }).first()).toBeVisible();
  });

  test("owner or tech admin can reach global admin and task cleanup controls", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "owner/tech_admin/default QA auth state or credentials are not configured");

    await openAsRole(page, role);
    await expectSidebarMenuItem(page, "Админ-панель", true);

    await gotoOrSkip(page, "/admin");
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByText("Админ-панель")).toBeVisible();
    await expect(page.getByRole("link", { name: "Пользователи" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Локации" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Роли и права" })).toBeVisible();

    await gotoOrSkip(page, "/tasks");
    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.getByText("Показать удалённые")).toBeVisible();
  });
});

async function openAsRole(page: Page, role: QaAuthStateName) {
  await gotoOrSkip(page, "/");
  await loginAsRoleOrSkip(page, role);
  await ensureSidebarVisible(page);
}

async function ensureSidebarVisible(page: Page) {
  const backButton = page.getByRole("button", { name: "Назад" }).first();
  if (await backButton.isVisible().catch(() => false)) {
    await backButton.click();
  }
  await expect(page.getByTestId("sidebar-search-input")).toBeVisible();
}

async function openSidebarMenu(page: Page) {
  await ensureSidebarVisible(page);
  const existingMenu = page.locator('[role="menu"][data-kub-menu="true"]').first();
  if (await existingMenu.isVisible().catch(() => false)) return existingMenu;
  await page.getByRole("button", { name: "Меню" }).first().click();
  await expect(existingMenu).toBeVisible();
  return existingMenu;
}

async function expectSidebarMenuItem(page: Page, label: string, visible: boolean) {
  const menu = await openSidebarMenu(page);
  const item = menu.getByRole("button", { name: label });
  if (visible) {
    await expect(item).toBeVisible();
  } else {
    await expect(item).toHaveCount(0);
  }
  await page.keyboard.press("Escape");
}

async function openSidebarMenuItem(page: Page, label: string) {
  const menu = await openSidebarMenu(page);
  await menu.getByRole("button", { name: label }).click();
}
