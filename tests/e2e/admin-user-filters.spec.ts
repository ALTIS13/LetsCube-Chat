import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * The users tab used to keep five selects permanently open above the list. They
 * cost the list the space it needed, and — worse — an inactive select looks like
 * an active one, so a filtered list read as the full one.
 *
 * The filters now collapse behind a button that carries their count, and what
 * is actually narrowing the list is a row of chips that each remove themselves.
 * This spec pins the behaviour that makes that trade honest: the count, the
 * chips, and the fact that removing one really does widen the list again.
 */
test.describe("LETSCUBE admin user filters", () => {
  test("filters collapse, announce themselves, and can be undone one at a time", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });

    const filtersButton = page.getByRole("button", { name: /Фильтры/ });
    await expect(filtersButton).toBeVisible();

    // At rest the panel is closed and there is no summary line at all: a
    // permanent "0 filters" row would be exactly the noise this replaced.
    await expect(page.locator("select")).toHaveCount(0);
    await expect(page.getByText(/Найдено \d/)).toHaveCount(0);
    await expect(filtersButton).toHaveAttribute("aria-expanded", "false");

    // Count only once the list has actually loaded. Counting an empty list and
    // then comparing against a filtered one passes for the wrong reason.
    await expect(page.getByTestId("admin-user-row").first()).toBeVisible();
    const rowsBefore = await page.getByTestId("admin-user-row").count();
    expect(rowsBefore).toBeGreaterThan(0);

    await filtersButton.click();
    await expect(filtersButton).toHaveAttribute("aria-expanded", "true");
    const statusSelect = page.locator("select").last();
    await expect(statusSelect).toBeVisible();
    await statusSelect.selectOption("worker");

    // The count is the whole point of collapsing them: it is the one fact the
    // selects used to carry that a closed panel would otherwise hide.
    await expect(filtersButton).toContainText("1");

    const chip = page.getByText("Статус: Работники", { exact: true });
    await expect(chip).toBeVisible();
    await expect(page.getByText(/Найдено \d/)).toBeVisible();

    const rowsFiltered = await page.getByTestId("admin-user-row").count();
    expect(rowsFiltered).toBeLessThanOrEqual(rowsBefore);

    // Removing the chip must actually widen the list again, not merely hide the
    // chip — the failure that would make the whole affordance a lie.
    await page.getByRole("button", { name: "Убрать фильтр: Статус: Работники" }).click();
    await expect(page.getByText("Статус: Работники", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("admin-user-row")).toHaveCount(rowsBefore);
    await expect(page.getByText(/Найдено \d/)).toHaveCount(0);
  });

  test("the search is a filter like any other and appears as a chip", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });

    const search = page.getByPlaceholder(/Поиск по имени/);
    await search.fill("zzzz-no-such-person");
    await expect(page.getByText("Поиск: zzzz-no-such-person", { exact: true })).toBeVisible();

    // "Сбросить всё" has to clear the search too. It sits outside the panel, so
    // it would be easy to wire it to the panel's selects only.
    await page.getByRole("button", { name: "Сбросить всё" }).click();
    await expect(search).toHaveValue("");
    await expect(page.getByText(/Найдено \d/)).toHaveCount(0);
  });
});
