import { expect, test } from "@playwright/test";
import {
  FIXTURE_HOST,
  chat,
  membership,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

const ME = person("11111111-1111-4111-8111-0000000000a1", "Тестовый участник", "participant");
const PEER = person("11111111-1111-4111-8111-0000000000a2", "Другой участник", "other_user");
const CHAT_ID = "22222222-2222-4222-8222-0000000000b1";
const AT = "2026-09-27T09:00:00.000Z";

// The synthetic backend is fulfilled by page.route, which WebKit bypasses after
// a reload under a controlling service worker.
test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });

test("an ordinary member manages a contact independently of the chat", async ({ page, request }) => {
  await requireFixtureServer(request);
  await page.setViewportSize({ width: 390, height: 844 });
  const contacts: Row[] = [{ owner_user_id: ME.id, contact_user_id: PEER.id, alias: null, created_at: AT }];
  const fixture = await openFixture(page, {
    me: ME,
    people: [PEER],
    chats: [chat(CHAT_ID, "private", null, AT)],
    memberships: [membership(CHAT_ID, ME, "member", AT), membership(CHAT_ID, PEER, "member", AT)],
    messages: [],
    rest: ({ resource, method, body }) => {
      if (resource !== "user_contacts") return undefined;
      if (method === "GET") return { status: 200, body: [...contacts] };
      if (method === "POST") {
        contacts.push({ ...(body as Row), alias: null, created_at: AT });
        return { status: 201, body: [] };
      }
      if (method === "PATCH") {
        contacts[0].alias = (body as Row).alias;
        return { status: 200, body: [] };
      }
      if (method === "DELETE") {
        contacts.splice(0, 1);
        return { status: 200, body: [] };
      }
      return undefined;
    },
  });
  await page.route(
    (url) => url.href.startsWith(FIXTURE_HOST) && url.pathname === "/rest/v1/profiles" && url.searchParams.has("or"),
    (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(new URL(route.request().url()).searchParams.get("or")?.includes("username.ilike.%other_user%") ? [PEER] : []),
    }),
  );

  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Навигация" });
  await nav.getByRole("button", { name: "Контакты" }).click();
  const panel = page.getByTestId("contacts-panel");
  await expect(panel.getByText("Другой участник")).toBeVisible();
  await panel.getByRole("button", { name: "Изменить имя: Другой участник" }).click();
  await page.getByRole("textbox", { name: "Личное имя контакта" }).fill("Коллега");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(panel.getByText("Коллега")).toBeVisible();
  await nav.getByRole("button", { name: "Чаты" }).click();
  const aliasedChat = page.getByTestId("chat-list-item").filter({ hasText: "Коллега" });
  await expect(aliasedChat).toBeVisible();
  await aliasedChat.click();
  await expect(page.getByTestId("chat-header-info-button")).toContainText("Коллега");
  await page.getByRole("button", { name: "Назад", exact: true }).click();

  await nav.getByRole("button", { name: "Контакты" }).click();
  await panel.getByRole("button", { name: "Удалить контакт: Коллега" }).click();
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(panel.getByText("Контактов пока нет")).toBeVisible();
  await expect.poll(() => fixture.restCalls("user_contacts", "DELETE").length).toBe(1);

  await panel.getByRole("button", { name: "Добавить контакт" }).first().click();
  await expect(page.getByRole("dialog", { name: "Добавить контакт" })).toBeVisible();
  await page.getByRole("textbox", { name: "Найти человека" }).fill("@other_user");
  await page.getByRole("button", { name: /Другой участник/ }).click();
  await expect(panel.getByText("Другой участник")).toBeVisible();

  await nav.getByRole("button", { name: "Чаты" }).click();
  await page.getByTestId("chat-list-item").filter({ hasText: "Другой участник" }).click();
  await expect(page).toHaveURL(new RegExp(`/chat/${CHAT_ID}$`));
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/chat/${CHAT_ID}$`));
  await expect(page.getByTestId("chat-header-info-button")).toContainText("Другой участник");
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await nav.getByRole("button", { name: "Контакты" }).click();
  await expect(page.getByTestId("contacts-panel").getByText("Другой участник")).toBeVisible();
  expect(contacts).toHaveLength(1);
  expect(contacts[0].alias).toBeNull();
});
