import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  screenshot: "off",
  trace: "off",
  video: "off",
});

test("the guest viewport probe reports geometry and accepts a lower-edge touch", async ({ page }) => {
  const response = await page.goto("/__qa/ios-paintability.html");
  expect(response?.status()).toBe(200);

  await expect(page.locator("#viewport-metrics")).toContainText("innerHeight=");
  const edge = await page.locator("#edge-target").boundingBox();
  expect(edge?.y, "the lower 120px must be touch-testable").toBeCloseTo(724, 0);
  expect(edge?.height).toBe(120);
  await page.getByRole("button", { name: "Контроль касания" }).click();
  await expect(page.locator("#last-touch")).toHaveText("control");

  await page.touchscreen.tap(195, 834);
  await expect(page.locator("#last-touch")).toHaveText("edge");
});
