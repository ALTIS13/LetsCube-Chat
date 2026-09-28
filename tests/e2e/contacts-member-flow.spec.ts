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
import { emulateInstalledIosApp, expectClearOfHardware, type Insets } from "./helpers/ios-standalone";

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

// Tracker item 57, the same tester, 2026-09-27: after the first contact the
// search box filtered only contacts, and how to add the second was unclear.
// Telegram's contacts search lists everybody else who matches under «Глобальный
// поиск», where the question is asked.
test("the contacts search also finds people outside the contacts, and adds one where it stands", async ({ page, request }) => {
  await requireFixtureServer(request);
  await page.setViewportSize({ width: 390, height: 844 });
  const STRANGER = person("11111111-1111-4111-8111-0000000000a3", "Дружелюбный сосед", "friendly");
  const contacts: Row[] = [{ owner_user_id: ME.id, contact_user_id: PEER.id, alias: null, created_at: AT }];
  const fixture = await openFixture(page, {
    me: ME,
    people: [PEER, STRANGER],
    chats: [chat(CHAT_ID, "private", null, AT)],
    memberships: [membership(CHAT_ID, ME, "member", AT), membership(CHAT_ID, PEER, "member", AT)],
    messages: [],
    rest: ({ resource, method, body }) => {
      if (resource !== "user_contacts") return undefined;
      if (method === "GET") {
        const people = [PEER, STRANGER];
        return { status: 200, body: contacts.map((row) => ({ ...row, profile: people.find((p) => p.id === row.contact_user_id) ?? null })) };
      }
      if (method === "POST") {
        contacts.push({ ...(body as Row), alias: null, created_at: AT });
        return { status: 201, body: [] };
      }
      return undefined;
    },
  });
  await page.route(
    (url) => url.href.startsWith(FIXTURE_HOST) && url.pathname === "/rest/v1/profiles" && url.searchParams.has("or"),
    (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      // The contact matches too: the global section must not list them twice.
      body: JSON.stringify(new URL(route.request().url()).searchParams.get("or")?.includes("Дру") ? [PEER, STRANGER] : []),
    }),
  );

  await page.goto("/");
  await page.getByRole("navigation", { name: "Навигация" }).getByRole("button", { name: "Контакты" }).click();
  const panel = page.getByTestId("contacts-panel");
  await expect(panel.getByText("Другой участник")).toBeVisible();
  await panel.getByRole("textbox", { name: "Поиск контактов" }).fill("Дру");

  const global = panel.getByTestId("contacts-global");
  await expect(global.getByRole("heading", { name: "Глобальный поиск" })).toBeVisible();
  await expect(global.getByTestId("contacts-global-row")).toHaveCount(1);
  await expect(global).toContainText("Дружелюбный сосед");
  await expect(global).not.toContainText("Другой участник");

  await global.getByRole("button", { name: "Добавить в контакты: Дружелюбный сосед" }).click();
  await expect.poll(() => fixture.restCalls("user_contacts", "POST").length).toBe(1);
  expect(contacts.map((row) => row.contact_user_id)).toContain(STRANGER.id);
  // Now a contact, and so no longer outside them.
  await expect(global.getByTestId("contacts-global-row")).toHaveCount(0);
});

// D-315 and D-317, from a tester's iPhone on 2026-09-27. In the installed app
// the panel's header sat under the status bar: «Контакты» over the clock, and
// the add button beside the battery where the status bar takes the touch. Once
// one contact existed the empty state's button was gone, so that unreachable
// icon was the only way to add a second, and the tester read the contacts
// filter as a search that had stopped finding people. The chat list's header
// clears the same edge with pt-window-top; this one had nothing.
test("in the installed iPhone app the contacts header clears the status bar and adds a second contact", async ({ page, request }) => {
  await requireFixtureServer(request);
  const insets: Insets = { top: 59, right: 0, bottom: 34, left: 0 };
  await page.setViewportSize({ width: 390, height: 844 });
  await emulateInstalledIosApp(page, insets);
  const contacts: Row[] = [{ owner_user_id: ME.id, contact_user_id: PEER.id, alias: null, created_at: AT }];
  await openFixture(page, {
    me: ME,
    people: [PEER],
    chats: [chat(CHAT_ID, "private", null, AT)],
    memberships: [membership(CHAT_ID, ME, "member", AT), membership(CHAT_ID, PEER, "member", AT)],
    messages: [],
    rest: ({ resource, method }) => {
      if (resource !== "user_contacts") return undefined;
      if (method === "GET") return { status: 200, body: [...contacts] };
      return undefined;
    },
  });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Навигация" }).getByRole("button", { name: "Контакты" }).click();
  const panel = page.getByTestId("contacts-panel");
  await expect(panel.getByText("Другой участник")).toBeVisible();
  await expect(panel.getByText("Контактов пока нет")).toHaveCount(0);

  const add = panel.getByRole("button", { name: "Добавить контакт" });
  await expect(add).toHaveCount(1);
  const reach = await add.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { top: rect.top, pressable: hit === button || button.contains(hit) };
  });
  expect(reach.top, "the add button starts below the status bar").toBeGreaterThanOrEqual(insets.top);
  expect(reach.pressable, "the add button takes the touch").toBe(true);
  await expectClearOfHardware(page, insets, "contacts, one contact, installed iPhone");

  await add.click();
  await expect(page.getByRole("dialog", { name: "Добавить контакт" })).toBeVisible();
});
