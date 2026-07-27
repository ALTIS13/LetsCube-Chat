import { expect, test } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

test.describe("public privacy and support surfaces", () => {
  test("/privacy is public, complete, and viewport-safe", async ({ page }) => {
    await gotoOrSkip(page, "/privacy");

    await expect(page).toHaveTitle(/Политика конфиденциальности.*LETSCUBE/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Политика конфиденциальности LETSCUBE",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Оглавление политики" })).toBeVisible();
    await expect(page.getByTestId("privacy-print")).toBeVisible();
    await expect(page.getByText("ООО «КУБ»").first()).toBeVisible();
    await expect(page.getByText("privacy@app.letscube.ru").first()).toBeVisible();
    await expect(page.getByText("15. Контакты")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    const scrollRoot = page.getByTestId("public-scroll-root");
    const viewportSafety = await scrollRoot.evaluate((node) => ({
      clientHeight: node.clientHeight,
      clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight,
      scrollWidth: node.scrollWidth,
    }));
    expect(viewportSafety.scrollHeight).toBeGreaterThan(viewportSafety.clientHeight);
    expect(viewportSafety.scrollWidth).toBeLessThanOrEqual(viewportSafety.clientWidth + 1);

    await page.getByRole("heading", { name: "15. Контакты" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: "15. Контакты" })).toBeInViewport();

    const documentSafety = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(documentSafety.bodyWidth).toBeLessThanOrEqual(documentSafety.viewportWidth + 1);
    expect(documentSafety.documentWidth).toBeLessThanOrEqual(documentSafety.viewportWidth + 1);
  });
});
