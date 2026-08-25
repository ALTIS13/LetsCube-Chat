import { expect, test } from "@playwright/test";

test("browser auth callback keeps its query and recovery hash on the same origin", async ({ page }) => {
  await page.goto("/auth/callback?code=browser-fixture#type=recovery");

  await expect(page).toHaveURL(/\/auth\/callback\?code=browser-fixture#type=recovery$/);
});
