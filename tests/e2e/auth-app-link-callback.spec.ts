import { expect, test } from "@playwright/test";

test("browser auth callback removes credentials from history before exchange completes", async ({ page }) => {
  await page.goto("/auth/callback?code=browser-fixture&type=recovery#access_token=browser-fixture");

  await expect(page).toHaveURL(/\/auth\/callback$/);

  await page.goto("/login");
  await page.goBack();

  await expect(page).not.toHaveURL(/browser-fixture/);
  const restoredUrl = new URL(page.url());
  expect(restoredUrl.searchParams.has("code")).toBe(false);
  expect(restoredUrl.searchParams.has("access_token")).toBe(false);
  expect(restoredUrl.hash).toBe("");
});
