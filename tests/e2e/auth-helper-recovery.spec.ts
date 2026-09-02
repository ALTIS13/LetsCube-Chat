import { expect, test } from "@playwright/test";
import { loadQaCredentials, loginIfNeeded } from "./helpers/auth";

/**
 * The sign-in helper has to survive a stalled session restore.
 *
 * Observed intermittently in otherwise green runs: the app sits on its own
 * "Загрузка длится дольше обычного" panel because the token refresh has not
 * come back, so neither the login form nor the authenticated shell appears and
 * the helper gives up. Waiting longer is not the fix — the request is not
 * coming — but the panel itself offers "Выйти", which drops the stuck session
 * and returns the form.
 *
 * The stall is reproduced deliberately rather than waited for: only the refresh
 * grant is held open, so the password grant the helper then uses still works.
 * Stubbing both would have made the test pass for the wrong reason, which an
 * earlier version of it did.
 */
test.describe("LETSCUBE e2e sign-in helper", () => {
  test("recovers when a session restore stalls instead of failing the run", async ({ page }) => {
    const credentials = loadQaCredentials("owner");
    test.skip(!credentials, "owner QA credentials are not configured");

    // Sign in for real once, so there is a genuine session to stall on.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await loginIfNeeded(page, credentials!, { authStateName: "owner" });
    await expect(page.getByRole("button", { name: "Меню" }).first()).toBeVisible();

    // Age the stored session so the client has to refresh it on the next boot.
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

    // Hold the refresh open — and only the refresh. The password grant the
    // helper falls back to has to keep working, or this proves nothing.
    await page.route(/\/auth\/v1\/token\?grant_type=refresh_token/, async () => {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await loginIfNeeded(page, credentials!, { authStateName: "owner" });
    await expect(page.getByRole("button", { name: "Меню" }).first()).toBeVisible();
  });
});
