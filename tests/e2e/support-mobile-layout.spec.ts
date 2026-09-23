import { expect, test } from "@playwright/test";
import { openAdmin, openAdminFixture, person, requireFixtureServer } from "./helpers/adminFixture";

const SUBTITLE = "Приём, переписка и передача обращений";
const FILTERS = ["Общий пул", "Мои", "Срочные", "Ожидают", "Решённые", "Спам"];

test.use({ screenshot: "off", trace: "off", video: "off" });

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

async function openSupport(page: import("@playwright/test").Page, theme: "dark" | "light") {
  await openAdminFixture(page, {
    me: person("11111111-1111-4111-8111-000000000039", "Тестовый оператор", "operator"),
    globalRoleKeys: ["owner"],
    globalPermissionKeys: ["system.manage", "support.view"],
    theme,
  });
  await openAdmin(page, "/admin/support");
  await expect(page.getByTestId("support-operator-workspace")).toBeVisible();
}

for (const theme of ["dark", "light"] as const) {
  test(`support subtitle remains fully readable (${theme})`, async ({ page }, info) => {
    await openSupport(page, theme);
    const subtitle = page
      .getByTestId("support-operator-workspace")
      .getByText(SUBTITLE, { exact: true });
    await expect(subtitle).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const widths = await subtitle.evaluate((node) => ({
      content: node.scrollWidth,
      available: node.clientWidth,
    }));
    await page.screenshot({
      path: `output/support-mobile-layout/subtitle-${info.project.name}-${theme}.png`,
    });
    expect(
      widths.content - widths.available,
      "support subtitle loses visible text",
    ).toBeLessThanOrEqual(1);
  });

  test(`support queue filters retain 44px targets at 390 (${theme})`, async ({ page }, info) => {
    const coarsePointer = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(page.viewportSize()?.width).toBe(390);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(coarsePointer);
    await openSupport(page, theme);
    const queue = page.getByRole("region", { name: "Очередь поддержки" });
    for (const label of FILTERS) {
      const button = queue.getByRole("button", { name: label, exact: true });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box, `${label} has no rendered hit area`).not.toBeNull();
      expect(box!.height, `${label} is too short at 390px`).toBeGreaterThanOrEqual(44);
    }
    await queue.getByRole("button", { name: "Мои", exact: true }).click();
    await expect(queue.getByRole("button", { name: "Мои", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.waitForTimeout(200);
    await page.screenshot({
      path: `output/support-mobile-layout/filters-${info.project.name}-${theme}.png`,
    });
  });
}
