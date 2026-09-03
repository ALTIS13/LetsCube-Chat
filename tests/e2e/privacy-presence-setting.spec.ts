import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * Presence is the first privacy setting, and it was asked for under one
 * condition: nothing here may stop a colleague being found or being written to.
 * So what is asserted is narrow on purpose — the switch is reachable, it
 * survives a round trip through the database, and it says plainly that being
 * found and being messaged are unaffected.
 *
 * It is honest privacy rather than a display filter: `profiles.online_at` is
 * written by this person's own client, so turning the switch off stops the
 * publishing and clears what was stored. That part is covered by the store's
 * unit tests, which can observe the calls; here we only prove the setting is
 * real and persists.
 */
async function openGeneralSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Меню" }).first().click();
  await page.getByText("Настройки", { exact: true }).first().click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
}

function presenceSwitch(page: import("@playwright/test").Page) {
  return page.getByRole("switch", { name: "Показывать, когда я в сети" });
}

/**
 * The switch is disabled until the stored answer arrives, and until then it
 * shows the default. Reading it before that is reading a placeholder, which is
 * how this test first passed against a value it had not actually persisted.
 */
async function settledPresenceSwitch(page: import("@playwright/test").Page) {
  const toggle = presenceSwitch(page);
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled({ timeout: 10_000 });
  return toggle;
}

test.describe("presence privacy setting", () => {
  test("the switch is in the settings and states that reachability is unaffected", async ({ page }) => {
    const role = findFirstAvailableQaRole(["client", "owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openGeneralSettings(page);

    await expect(page.getByText("Конфиденциальность", { exact: true })).toBeVisible();
    const toggle = await settledPresenceSwitch(page);

    // Whatever the stored answer is, the off-state copy has to promise that
    // colleagues can still find you and write to you. A privacy setting that
    // quietly hid staff from each other is the one thing this must not become.
    const initial = await toggle.getAttribute("aria-checked");
    try {
      if (initial === "true") {
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-checked", "false");
      }
      await expect(page.getByText(/можно найти и написать вам/)).toBeVisible();
    } finally {
      if ((await toggle.getAttribute("aria-checked")) !== initial) {
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-checked", initial ?? "true");
      }
    }
  });

  test("the choice survives closing the settings and reloading the page", async ({ page }) => {
    const role = findFirstAvailableQaRole(["client", "owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");
    test.skip(
      process.env.KUB_QA_ALLOW_MUTATIONS !== "1",
      "this writes a preference row; set KUB_QA_ALLOW_MUTATIONS=1 to run it",
    );

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openGeneralSettings(page);

    const toggle = await settledPresenceSwitch(page);
    const initial = await toggle.getAttribute("aria-checked");

    try {
      // The switch updates optimistically, so the attribute flips before the
      // write lands. Reloading on that alone cancels the request in flight and
      // tests nothing; wait for the write to be acknowledged first.
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes("privacy_preferences") && response.request().method() === "POST",
      );
      await toggle.click();
      const flipped = initial === "true" ? "false" : "true";
      await expect(toggle).toHaveAttribute("aria-checked", flipped);
      expect((await saved).status(), "the preference was not accepted").toBeLessThan(300);

      await page.reload();
      await openGeneralSettings(page);
      await expect(await settledPresenceSwitch(page)).toHaveAttribute("aria-checked", flipped);
    } finally {
      // Put the account back the way it was found, and do not leave before
      // that write has landed either.
      const current = await settledPresenceSwitch(page);
      if ((await current.getAttribute("aria-checked")) !== initial) {
        const restored = page.waitForResponse(
          (response) =>
            response.url().includes("privacy_preferences") && response.request().method() === "POST",
        );
        await current.click();
        await expect(current).toHaveAttribute("aria-checked", initial ?? "true");
        await restored;
      }
    }
  });
});
