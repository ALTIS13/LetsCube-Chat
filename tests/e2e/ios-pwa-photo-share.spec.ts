import { expect, type Page, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

const me = person("11111111-1111-4111-8111-000000000001", "Тестовый пользователь");
const sender = person("11111111-1111-4111-8111-000000000002", "Анна Тестовая");
const chatId = "22222222-2222-4222-8222-000000000001";
const photoUrl = "/__fixture-media/photo.svg";

async function openPhoto(page: Page, canShare: boolean) {
  await requireFixtureServer(page.request);
  await page.addInitScript((supported) => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    });
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    const shared: Array<{ name: string; type: string }> = [];
    (window as unknown as { __shared: typeof shared }).__shared = shared;
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => supported });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: (data: ShareData) => {
        const file = data.files?.[0];
        if (file) shared.push({ name: file.name, type: file.type });
        return Promise.resolve();
      },
    });
    const saved: string[] = [];
    (window as unknown as { __saved: typeof saved }).__saved = saved;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
      if (this.download) saved.push(this.download);
    };
  }, canShare);
  await openFixture(page, {
    me,
    chats: [chat(chatId, "group", "Команда проекта", "2026-09-24T12:00:00Z")],
    memberships: [
      membership(chatId, me, "owner", null),
      membership(chatId, sender, "member", null),
    ],
    messages: [
      message(
        "33333333-3333-4333-8333-000000000001",
        chatId,
        sender,
        "Тестовое фото",
        "2026-09-24T12:00:00Z",
        {
          type: "image",
          media_url: photoUrl,
          media_metadata: { width: 200, height: 100 },
        },
      ),
    ],
  });
  await page.route(`**${photoUrl}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#57bcdd"/></svg>',
    }),
  );
  const bubble = await openChat(page, "Команда проекта", "Тестовое фото");
  await bubble.getByRole("button", { name: "Открыть фото" }).click();
  await expect(page.getByRole("dialog", { name: "Тестовое фото" })).toBeVisible();
}

test("iPhone PWA shares a preloaded photo as a file", async ({ page }, info) => {
  await openPhoto(page, true);
  const action = page.getByTestId("media-viewer-file-action");
  await expect(action).toHaveAttribute("data-action-kind", "share");
  await expect(action.getByText("Поделиться")).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(action.getByText("Поделиться")).toBeVisible();
  await page.screenshot({ path: info.outputPath("ios-share-viewer.png") });
  await action.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared.length))
    .toBe(1);
  expect(
    await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared),
  ).toEqual([{ name: "photo.svg", type: "image/svg+xml" }]);
});

test("iPhone PWA falls back to a truthful download without file sharing", async ({ page }) => {
  await openPhoto(page, false);
  const action = page.getByTestId("media-viewer-file-action");
  await expect(action).toHaveAttribute("data-action-kind", "save");
  await expect(action).toHaveAccessibleName("Сохранить");
  await action.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __saved: unknown[] }).__saved.length))
    .toBe(1);
  expect(
    await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared),
  ).toEqual([]);
});
