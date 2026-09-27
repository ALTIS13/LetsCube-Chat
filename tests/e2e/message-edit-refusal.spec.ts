import { expect, type Page, test } from "@playwright/test";

import {
  chat,
  membership,
  message,
  openChat,
  openDesktopMenu,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

const ME = person("11111111-1111-4111-8111-0000000000e1", "Тестовый участник");
const PEER = person("11111111-1111-4111-8111-0000000000e2", "Собеседник");
const CHAT_ID = "22222222-2222-4222-8222-0000000000e1";
const MESSAGE_ID = "55555555-5555-4555-8555-0000000000e1";
const ORIGINAL = "Исходный текст сообщения";
const REVISION = "Исправленный текст сообщения";
const AT = "2026-09-27T09:00:00.000Z";

async function startEdit(page: Page) {
  const bubble = await openChat(page, PEER.full_name, ORIGINAL);
  const menu = await openDesktopMenu(page, bubble);
  await menu.locator('[data-message-action="edit"]').click();
  const input = page.locator('textarea[placeholder="Сообщение…"]');
  await expect(input).toHaveValue(ORIGINAL);
  await input.fill(REVISION);
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  return input;
}

test.use({
  hasTouch: false,
  isMobile: false,
  viewport: { width: 1440, height: 900 },
  screenshot: "off",
  trace: "off",
  video: "off",
});

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("a refused edit keeps the correction in the composer and names the failure", async ({
  page,
}, testInfo) => {
  const fixture = await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "private", null, AT)],
    memberships: [membership(CHAT_ID, ME, "member", AT), membership(CHAT_ID, PEER, "member", AT)],
    messages: [message(MESSAGE_ID, CHAT_ID, ME, ORIGINAL, AT)],
    rest: ({ resource, method }) =>
      resource === "messages" && method === "PATCH"
        ? { status: 403, body: { code: "42501", message: "permission denied" } }
        : undefined,
  });

  const input = await startEdit(page);

  await expect.poll(() => fixture.restCalls("messages", "PATCH").length).toBe(1);
  await expect(input).toHaveValue(REVISION);
  await expect(page.getByText("Редактирование", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Не удалось сохранить изменение");
  await expect(
    page.locator('[data-message-bubble="true"]').filter({ hasText: ORIGINAL }),
  ).toBeVisible();

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((value) => {
        document.documentElement.classList.toggle("dark", value === "dark");
        document.documentElement.classList.toggle("light", value === "light");
        document.documentElement.setAttribute("data-theme", value);
        document.documentElement.style.colorScheme = value;
      }, theme);
      const inputBounds = await input.boundingBox();
      expect(inputBounds).not.toBeNull();
      expect(inputBounds!.y + inputBounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      await page.locator('[data-testid="chat-composer-dock"]').screenshot({
        path: `output/message-edit-refusal/edit-failure-${width}-${theme}-${testInfo.project.name}.png`,
      });
    }
  }
});

test("an edit that updated no row does not discard the correction", async ({ page }) => {
  const fixture = await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "private", null, AT)],
    memberships: [membership(CHAT_ID, ME, "member", AT), membership(CHAT_ID, PEER, "member", AT)],
    messages: [message(MESSAGE_ID, CHAT_ID, ME, ORIGINAL, AT)],
    rest: ({ resource, method }) =>
      resource === "messages" && method === "PATCH" ? { status: 200, body: null } : undefined,
  });

  const input = await startEdit(page);
  await expect.poll(() => fixture.restCalls("messages", "PATCH").length).toBe(1);
  await expect(input).toHaveValue(REVISION);
  await expect(page.getByText("Редактирование", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Сообщение недоступно для редактирования");
});

test("a confirmed edit exits correction mode", async ({ page }) => {
  const fixture = await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_ID, "private", null, AT)],
    memberships: [membership(CHAT_ID, ME, "member", AT), membership(CHAT_ID, PEER, "member", AT)],
    messages: [message(MESSAGE_ID, CHAT_ID, ME, ORIGINAL, AT)],
    rest: ({ resource, method }) =>
      resource === "messages" && method === "PATCH"
        ? { status: 200, body: { id: MESSAGE_ID } }
        : undefined,
  });

  const input = await startEdit(page);
  await expect.poll(() => fixture.restCalls("messages", "PATCH").length).toBe(1);
  await expect(page.getByText("Редактирование", { exact: true })).toHaveCount(0);
  await expect(input).toHaveValue("");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
