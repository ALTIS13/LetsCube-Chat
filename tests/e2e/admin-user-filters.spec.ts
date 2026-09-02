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

  test("a loading list holds its shape instead of collapsing to a spinner", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    // Land on another admin tab first. The route below has to be installed
    // after the shell is up: the app reads `profiles` during startup too, and
    // holding that request leaves the page on its boot splash forever.
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /Обновить|Сводка/ }).first()).toBeVisible();

    // Hold the list's own request open. Without this it loads faster than any
    // assertion, and a spinner would pass for a skeleton.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(/\/rest\/v1\/profiles\?.*order=created_at/, async (route) => {
      await held;
      await route.continue();
    });

    await page.goto("/admin/users", { waitUntil: "commit" });

    const skeleton = page.getByRole("status", { name: /Загрузка списка пользователей/ });
    await expect(skeleton).toBeVisible();
    await expect(skeleton).toHaveAttribute("aria-busy", "true");

    // The point of a skeleton is that the region is already the right size, so
    // nothing jumps when the rows arrive. A spinner in an empty panel is a few
    // dozen pixels tall; this has to be the height of a list.
    const box = await skeleton.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(240);

    release();
    await expect(page.getByTestId("admin-user-row").first()).toBeVisible();
    await expect(skeleton).toHaveCount(0);
  });

  test("an empty result offers a way out rather than a full stop", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("admin-user-row").first()).toBeVisible();

    await page.getByPlaceholder(/Поиск по имени/).fill("zzzz-no-such-person");
    await expect(page.getByTestId("admin-user-row")).toHaveCount(0);

    // The offer to drop the condition by name is the whole difference between
    // this and a dead end, and it has to actually work.
    const drop = page.getByRole("button", { name: 'Снять «Поиск: zzzz-no-such-person»' });
    await expect(drop).toBeVisible();
    await drop.click();
    await expect(page.getByTestId("admin-user-row").first()).toBeVisible();

    // A count nobody can compute must not be invented: the unfiltered total is
    // not in memory once the server has already applied the search.
    await page.getByPlaceholder(/Поиск по имени/).fill("zzzz-no-such-person");
    await expect(page.getByText(/Условия отсеяли 0/)).toHaveCount(0);
    await expect(page.getByText(/Найдено 0 из 0/)).toHaveCount(0);
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
