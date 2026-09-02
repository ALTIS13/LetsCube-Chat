import { expect, test } from "@playwright/test";
import { loadQaCredentials, loginIfNeeded } from "./helpers/auth";

/**
 * A stalled session load must not lock a person out of signing in.
 *
 * `supabase.auth.getSession()` refreshes a stale token internally, and that
 * request can fail to come back. `loading` then stays true, and because the
 * boot gate covered every route, `/login` rendered the loading screen too —
 * so the one route that can rescue the situation was unreachable. The only way
 * through was the "Выйти" button on the loading screen, which is a poor thing
 * to require of someone who just wants to sign in.
 *
 * This is a product defect, found while chasing an intermittent test failure
 * whose page snapshot showed exactly this state on production.
 */
test.describe("LETSCUBE boot recovery", () => {
  test("the login form appears even when the session load never settles", async ({ page }) => {
    const credentials = loadQaCredentials("owner");
    test.skip(!credentials, "owner QA credentials are not configured");

    // Sign in for real, then age the stored session so the next boot refreshes.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await loginIfNeeded(page, credentials!, { authStateName: "owner" });
    await expect(page.getByRole("button", { name: "Меню" }).first()).toBeVisible();

    const aged = await page.evaluate(() => {
      for (const key of Object.keys(window.localStorage)) {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }
        if (typeof parsed !== "object" || parsed === null) continue;
        if (typeof (parsed as { expires_at?: unknown }).expires_at !== "number") continue;
        (parsed as { expires_at: number }).expires_at = Math.floor(Date.now() / 1000) - 10;
        window.localStorage.setItem(key, JSON.stringify(parsed));
        return key;
      }
      return null;
    });
    expect(aged, "no stored session was found to age").not.toBeNull();

    // Hold the refresh open for longer than any grace, so the boot genuinely
    // never settles rather than merely being slow.
    await page.route(/\/auth\/v1\/token\?grant_type=refresh_token/, async () => {
      await new Promise((resolve) => setTimeout(resolve, 120_000));
    });

    await page.goto("/login", { waitUntil: "domcontentloaded" });

    // The form has to arrive on its own. Before the fix this stayed on the
    // loading screen until someone pressed "Выйти".
    await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test("a healthy boot still shows no login form to a signed-in person", async ({ page }) => {
    const credentials = loadQaCredentials("owner");
    test.skip(!credentials, "owner QA credentials are not configured");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await loginIfNeeded(page, credentials!, { authStateName: "owner" });

    // The grace must not become a flash of the login form on every visit: a
    // healthy session settles long before it, and /login redirects inward.
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Меню" }).first()).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });
});
