import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * The profile settings had been squeezed into a dialog half the width of the
 * screen: every field in one narrow column, a 230px banner holding an avatar
 * and a name, and the phone section pushed below the fold so it could only be
 * reached by scrolling inside the dialog. Widening the dialog and pairing the
 * two short fields fixed that; the settings rework then replaced the field
 * cards with rows, so each field is one line across the dialog.
 *
 * D-160 moved the screen again, and this file moved with it. From `md` the
 * settings are the list column's body, so the old desktop assertion — an input
 * at least 403px wide, inside a `role="dialog"` — is measuring a surface that
 * no longer exists at that width. **The premise changed, not just the number:**
 * a 360px column cannot and should not hold a 403px input. What replaced it is
 * the contract that actually matters at this width, and it is the pair the
 * dialog could not satisfy at once:
 *
 *  - an input still wide enough to read what is typed into it, and
 *  - the phone section reachable **without scrolling**, which in the column is
 *    what the search is for. In the dialog it was reachable only because the
 *    dialog was 896px wide, and 332px of the screen still sat below the fold.
 *
 * The phone half of this file is untouched: below `md` the screen is the same
 * full-screen sheet it has always been.
 */
async function openProfileSettingsSheet(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Меню" }).first().click();
  await page.getByText("Настройки", { exact: true }).first().click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Профиль", exact: true })).toBeVisible();
}

async function openProfileSettingsColumn(page: import("@playwright/test").Page) {
  await page.getByTestId("side-menu-button").click();
  await expect(page.getByTestId("side-menu-layer")).toBeVisible();
  await page.getByTestId("side-menu-layer").getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.getByTestId("sidebar-settings")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Профиль", exact: true })).toBeVisible();
}

test.describe("LETSCUBE profile settings layout", () => {
  test("on a desktop the fields keep a readable width in the column, and the phone row is one query away", async ({ page }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) < 900,
      "this contract is about desktop width",
    );
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openProfileSettingsColumn(page);

    const nameBox = await page.getByTestId("settings-field-name").boundingBox();
    const usernameBox = await page.getByTestId("settings-field-username").boundingBox();
    expect(nameBox, "the name field was not found").not.toBeNull();
    expect(usernameBox, "the username field was not found").not.toBeNull();

    // One field per row: the caption column is fixed, so all three inputs start
    // at the same x and each one gets the rest of the column.
    expect(
      usernameBox!.y,
      "the fields are sharing a row instead of taking one each",
    ).toBeGreaterThan(nameBox!.y + 20);
    expect(usernameBox!.x).toBe(nameBox!.x);

    // The caption column costs 5.5rem. What is left has to be enough to read a
    // name in — the same floor the phone half of this file holds.
    expect(
      Math.round(nameBox!.width),
      "the caption column has eaten the input",
    ).toBeGreaterThanOrEqual(150);

    // And the phone row is reachable without scrolling: in the column that is
    // the search, which the dialog never had.
    await page.getByTestId("settings-search-input").fill("телефон");
    await expect(page.getByTestId("settings-open-phone")).toBeInViewport();
  });

  test("on a phone the fields stack and stay wide enough to read", async ({ page }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) >= 900,
      "this contract is about narrow width",
    );
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openProfileSettingsSheet(page);

    const nameBox = await page.getByTestId("settings-field-name").boundingBox();
    const usernameBox = await page.getByTestId("settings-field-username").boundingBox();
    expect(nameBox).not.toBeNull();
    expect(usernameBox).not.toBeNull();
    expect(
      usernameBox!.y,
      "two fields on one line would leave each too narrow to read",
    ).toBeGreaterThan(nameBox!.y + 20);

    // The caption column costs 5.5rem on a 375px sheet. What is left has to be
    // enough to see a name in, or the row has bought density with legibility.
    expect(
      Math.round(nameBox!.width),
      "the caption column has eaten the input",
    ).toBeGreaterThanOrEqual(150);
  });
});
