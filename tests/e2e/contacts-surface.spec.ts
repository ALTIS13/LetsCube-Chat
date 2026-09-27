import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const fixture = {
  currentUser: { name: "Тестовый пользователь", username: "tester" },
  activeChat: { name: "Тестовая группа", memberCount: 2 },
  chats: [{ name: "Тестовая группа", preview: "Привет", time: "12:00", unread: 0 }],
  messages: [{ sender: "Тестовый пользователь", text: "Привет", time: "12:00", own: true }],
};

for (const width of [390, 1440]) {
  for (const theme of ["dark", "light"] as const) {
    test(`contacts panel stays usable at ${width}px in ${theme} theme`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.clock.setFixedTime(new Date("2026-09-03T18:00:00Z"));
      await page.addInitScript(([data, selectedTheme]) => {
        (window as unknown as Record<string, unknown>).__letscubePublicPreviewFixture = data;
        localStorage.setItem("kub-theme", selectedTheme);
      }, [fixture, theme] as const);
      await page.goto("/__qa/public-preview?surface=contacts");
      await expect(page.locator('[data-public-preview-ready="true"]')).toBeVisible();
      await expect(page.getByTestId("contacts-panel")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      if (process.env.KUB_CONTACT_VISUAL_CAPTURE === "1") {
        mkdirSync("output/contacts-visual", { recursive: true });
        await page.screenshot({ path: `output/contacts-visual/contacts-${width}-${theme}.png` });
      }
      await expect(page.getByRole("button", { name: "Добавить контакт" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Изменить имя:/ })).toHaveCount(3);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      if (width === 390) {
        const nav = page.getByRole("navigation", { name: "Навигация" });
        await expect(nav.getByRole("button", { name: "Контакты" })).toHaveAttribute("aria-current", "page");
        const buttons = await nav.getByRole("button").evaluateAll((nodes) => nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return { width: box.width, height: box.height, left: box.left, right: box.right };
        }));
        expect(buttons.every((box) => box.width >= 44 && box.height >= 44)).toBe(true);
        expect(buttons.every((box, index) => index === 0 || buttons[index - 1].right <= box.left)).toBe(true);
      }
      await page.getByRole("textbox", { name: "Поиск контактов" }).fill("Бор");
      await expect(page.getByRole("button", { name: /Изменить имя:/ })).toHaveCount(1);
      await expect(page.getByText("Борис Иванов")).toBeVisible();
      await page.getByRole("button", { name: "Удалить контакт: Борис Иванов" }).click();
      await expect(page.getByRole("heading", { name: "Удалить контакт?" })).toBeVisible();
      await expect(page.getByText("Борис Иванов исчезнет из вашего списка. Переписка останется.")).toBeVisible();
      await page.getByRole("button", { name: "Отмена" }).click();
      await expect(page.getByText("Борис Иванов")).toBeVisible();
    });
  }
}
