import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * Locations, invites and roles each kept their creation form permanently
 * expanded, and in each one the list a person had actually come to read started
 * below the fold. Creating is the occasional act; reading the list is the
 * constant one, and the layout had them the wrong way round.
 *
 * The three cases are asserted together because they are one decision applied
 * three times: if the shared section regresses, all three go with it.
 */
const SCREENS = [
  { name: "locations", path: "/admin/locations", label: "Новая локация", listText: "Список локаций" },
  { name: "invites", path: "/admin/invites", label: "Создать инвайт", listText: "Активные и прошлые инвайты" },
  { name: "roles", path: "/admin/roles", label: "Новая роль", listText: "Роли" },
];

test.describe("LETSCUBE admin creation forms", () => {
  for (const screen of SCREENS) {
    test(`${screen.name}: the list leads and creation is one click away`, async ({ page }) => {
      const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
      test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

      await gotoOrSkip(page, "/");
      await loginAsRoleOrSkip(page, role);
      await page.goto(screen.path, { waitUntil: "domcontentloaded" });

      const trigger = page.getByRole("button", { name: screen.label, exact: true });
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");

      // The list has to be on screen without scrolling — that is the whole
      // point of closing the form, and a screen that merely hid the fields
      // somewhere below would pass a weaker assertion.
      const list = page.getByText(screen.listText, { exact: false }).first();
      await expect(list).toBeInViewport();

      await trigger.click();
      await expect(page.getByRole("button", { name: "Отмена", exact: true })).toHaveAttribute(
        "aria-expanded",
        "true",
      );

      // Opening moves focus into the form. Without it the fields appear
      // somewhere below the button and a keyboard user has to hunt for them,
      // which is the usual reason a disclosure is worse than what it replaced.
      const focused = await page.evaluate(() => {
        const active = document.activeElement;
        return active ? active.tagName.toLowerCase() : null;
      });
      expect(["input", "select", "textarea"]).toContain(focused);
    });
  }

  test("the roles explainer stays put away once it is closed", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: false });
    test.skip(!role, "owner/tech_admin QA auth state or credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/roles", { waitUntil: "domcontentloaded" });

    // Open by default: deleting the explanation would cost a first-time
    // administrator real help, so it shows until someone says otherwise.
    const toggle = page.getByRole("button", { name: "Что такое роли и права" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Что такое роль", { exact: true })).toBeVisible();

    await toggle.click();
    await expect(page.getByText("Что такое роль", { exact: true })).toHaveCount(0);

    // And it stays closed across a reload — a preference that forgets itself is
    // not a preference.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Что такое роли и права" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByText("Что такое роль", { exact: true })).toHaveCount(0);
  });
});
