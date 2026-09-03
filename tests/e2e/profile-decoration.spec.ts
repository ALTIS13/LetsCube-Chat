import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * Earned decoration is visible to everyone, which is what makes it worth
 * earning — and what makes the interface the wrong place to enforce it. The
 * contracts here are that the screen reports what the server says, that a
 * locked option cannot be chosen, and, most importantly, that going around the
 * screen does not work either.
 */
async function openDecoration(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Меню" }).first().click();
  await page.getByText("Настройки", { exact: true }).first().click();
  await page.getByText("Профиль", { exact: true }).first().click();
  await expect(page.getByText("Оформление", { exact: true })).toBeVisible();
  await page.getByText("Рамка аватара", { exact: true }).scrollIntoViewIfNeeded();
}

test.describe("profile decoration", () => {
  test("achievements show what is held and how far the rest are", async ({ page }) => {
    const role = findFirstAvailableQaRole(["client", "owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openDecoration(page);

    await expect(page.getByText("Достижения", { exact: true })).toBeVisible();
    // A countable criterion reports a distance rather than only an absence.
    await expect(page.getByText(/^\d+ из \d+$/).first()).toBeVisible();
  });

  test("a locked decoration cannot be chosen", async ({ page }) => {
    const role = findFirstAvailableQaRole(["client", "owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openDecoration(page);

    const locked = page.getByRole("button", { name: "Рамка ветерана" });
    await expect(locked).toBeVisible();
    await expect(locked, "an unearned frame is not selectable").toBeDisabled();
  });

  test("the server refuses an unearned decoration, not only the screen", async ({ page }) => {
    const role = findFirstAvailableQaRole(["client", "owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");

    // The application's own REST traffic carries everything the probe needs:
    // the endpoint, the public key and this person's bearer token. Capturing a
    // real request avoids reconstructing configuration the test would then be
    // free to get wrong — and a probe that skips itself proves nothing, so a
    // missing prerequisite fails here rather than passing quietly.
    const captured = page.waitForRequest(
      (request) => request.url().includes("/rest/v1/") && request.headers().apikey !== undefined,
      { timeout: 20_000 },
    );
    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    const sample = await captured;
    const headers = sample.headers();
    const origin = new URL(sample.url()).origin;

    await openDecoration(page);

    const userId = await page.evaluate(() => {
      // `kub-auth` is this application's storage key; see lib/supabase/client.
      const stored = localStorage.getItem("kub-auth");
      if (!stored) throw new Error("no stored session: the probe cannot prove anything");
      const id = JSON.parse(stored)?.user?.id;
      if (!id) throw new Error("stored session carries no user");
      return id as string;
    });

    // The screen is skipped entirely: this writes to the profile with the
    // person's own session, exactly as a REST client would. A badge that only
    // the interface protects is not earned, it is suggested.
    const response = await page.request.patch(
      `${origin}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        headers: {
          "content-type": "application/json",
          apikey: headers.apikey,
          authorization: headers.authorization,
          prefer: "return=representation",
        },
        data: { profile_frame: "frame_veteran" },
      },
    );
    const outcome = { status: response.status(), body: (await response.text()).slice(0, 300) };

    expect(outcome.status, "an unearned frame must not be accepted").toBeGreaterThanOrEqual(400);
    expect(outcome.body).toContain("cosmetic_not_unlocked");
  });
});
