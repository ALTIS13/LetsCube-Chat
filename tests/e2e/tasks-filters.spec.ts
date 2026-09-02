import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * The tasks page kept three selects and a checkbox open above the list at all
 * times, on top of nine tabs. Same trade as the staff screens: the filters cost
 * the list its space, and an inactive select looks like an active one.
 *
 * The view toggle deliberately stays outside the collapse — it is not a filter,
 * it changes how the same set is drawn, and hiding it would cost a switch
 * people use constantly.
 */
test.describe("LETSCUBE task filters", () => {
  test("filters collapse but the view toggle stays out", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/tasks", { waitUntil: "domcontentloaded" });

    const filters = page.getByRole("button", { name: /Фильтры/ });
    await expect(filters).toBeVisible();
    await expect(filters).toHaveAttribute("aria-expanded", "false");

    // Closed means gone from the layout, not merely invisible: a hidden select
    // that still occupies its row would defeat the whole change.
    await expect(page.locator("#task-assignee-filter")).toBeHidden();

    // The toggle is reachable without opening anything.
    await expect(page.getByRole("button", { name: "Карточки" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Список" })).toBeVisible();

    await filters.click();
    await expect(filters).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#task-assignee-filter")).toBeVisible();
  });

  test("a search shows as a chip that removes itself", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/tasks", { waitUntil: "domcontentloaded" });

    // Nothing filtered, nothing said.
    await expect(page.getByText(/Найдено|Ничего не найдено/)).toHaveCount(0);

    const search = page.getByPlaceholder(/Поиск по задачам/);
    await search.fill("zzzz-no-such-task");
    await expect(page.getByText("Поиск: zzzz-no-such-task", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Фильтры/ })).toContainText("1");

    await page.getByRole("button", { name: "Убрать фильтр: Поиск: zzzz-no-such-task" }).click();
    await expect(search).toHaveValue("");
    await expect(page.getByText(/Найдено|Ничего не найдено/)).toHaveCount(0);
  });
});
