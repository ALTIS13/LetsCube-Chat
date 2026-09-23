import { expect, test } from "@playwright/test";

const LOCAL_ORIGIN = new URL(process.env.KUB_BASE_URL || "http://127.0.0.1:5173").origin;
const THEMES = ["light", "dark"] as const;

test.describe("public page navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin === LOCAL_ORIGIN) {
        await route.continue();
      } else {
        await route.abort();
      }
    });
  });

  for (const theme of THEMES) {
    test(`support is reachable from the public header in ${theme} theme`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem("kub-theme", value), theme);

      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });

        for (const route of ["/", "/download", "/bots/docs"]) {
          await page.goto(route);
          const nav = page.getByRole("navigation", { name: "Публичные страницы" });
          const privacy = nav.getByRole("link", { name: "Конфиденциальность" });
          const support = nav.getByRole("link", { name: "Поддержка" });
          const login = nav.getByRole("link", { name: "Войти" });

          await expect(support, `${route} at ${width}px`).toBeVisible();
          const [privacyBox, supportBox, loginBox] = await Promise.all([
            privacy.boundingBox(),
            support.boundingBox(),
            login.boundingBox(),
          ]);
          expect(privacyBox).not.toBeNull();
          expect(supportBox).not.toBeNull();
          expect(loginBox).not.toBeNull();
          expect(supportBox!.width).toBeGreaterThanOrEqual(44);
          expect(supportBox!.height).toBeGreaterThanOrEqual(44);
          expect(supportBox!.x).toBeGreaterThanOrEqual(privacyBox!.x + privacyBox!.width);
          expect(loginBox!.x).toBeGreaterThanOrEqual(supportBox!.x + supportBox!.width);
          expect(loginBox!.x + loginBox!.width).toBeLessThanOrEqual(width);
        }
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/bots/docs");
      await page
        .getByRole("navigation", { name: "Публичные страницы" })
        .getByRole("link", { name: "Поддержка" })
        .click();
      await expect(page).toHaveURL(/\/support$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Поддержка LETSCUBE" }),
      ).toBeVisible();
    });

    test(`Bot API contents links meet the 44px target in ${theme} theme`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem("kub-theme", value), theme);

      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.goto("/bots/docs");
        const links = page.getByRole("navigation", { name: "Разделы Bot API" }).getByRole("link");
        await expect(links).toHaveCount(5);

        for (const link of await links.all()) {
          const box = await link.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.height, `${await link.innerText()} at ${width}px`).toBeGreaterThanOrEqual(44);
        }
      }
    });
  }
});
