import { expect, test, type Page, type Route } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * Tracker item 52. Two testers, on their first day: a message written without a
 * connection could not be sent later — it turned red at once, and a restart
 * lost it; a voice note had to be recorded again. «Прям сильно
 * пользовательский опыт погубило».
 *
 * Telegram's mechanic, which the outbox adopts: the bubble waits with a clock,
 * is kept on the device, and goes by itself, in order, when the connection
 * answers — after a restart too. Red only for a refusal. The rules and the
 * runner are `tests/unit/outbox.test.mts`; what is measured here is the
 * application: the composer, the bubble, the device's storage, the reload.
 */

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("b5111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("b5111111-1111-4111-8111-000000000002", "Анна Смирнова");
const TEAM = "b5222222-2222-4222-8222-000000000001";
const FIRST = "Макет главной готов";

type Server = "answer" | "unreachable" | "refuse";

async function boot(page: Page) {
  await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [chat(TEAM, "group", "Команда проекта", AT)],
    memberships: [membership(TEAM, ME, "owner", AT), membership(TEAM, ANNA, "member", AT)],
    messages: [message("b5333333-3333-4333-8333-000000000001", TEAM, ANNA, FIRST, AT)],
  });
  const server = { server: "answer" as Server, inserts: [] as Record<string, unknown>[], landed: new Map<string, Record<string, unknown>>() };
  await page.route("**/rest/v1/messages*", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const clientId = url.searchParams.get("client_message_id");
    if (request.method() === "POST") {
      if (server.server === "unreachable") return route.abort("internetdisconnected");
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      server.inserts.push(body);
      if (server.server === "refuse") {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ code: "42501", details: null, hint: null, message: 'new row violates row-level security policy for table "messages"' }),
        });
      }
      const row = {
        ...message(`b5444444-4444-4444-8444-${String(server.inserts.length).padStart(12, "0")}`, String(body.chat_id), ME, String(body.content ?? ""), new Date().toISOString()),
        client_message_id: body.client_message_id ?? null,
        client_sent_at: body.client_sent_at ?? null,
      };
      server.landed.set(String(body.client_message_id), row);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(row) });
    }
    // «Did it land?» — asked after an attempt that got no answer.
    if (clientId) {
      if (server.server === "unreachable") return route.abort("internetdisconnected");
      const landed = server.landed.get(decodeURIComponent(clientId.replace(/^eq\./, "")));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(landed ? [landed] : []) });
    }
    return route.fallback();
  });
  await page.goto(`/chat/${TEAM}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: FIRST })).toBeVisible();
  return server;
}

const bubble = (page: Page, text: string) => page.locator('[data-message-bubble="true"]').filter({ hasText: text });
/** The delivery mark's own words: the icon is `role="img"` named by its state. */
const state = (page: Page, text: string, name: "Отправляется" | "Не удалось отправить") =>
  bubble(page, text).locator("[data-message-delivery-slot]").getByRole("img", { name });

async function write(page: Page, text: string) {
  const composer = page.getByPlaceholder("Сообщение…").first();
  await composer.fill(text);
  await composer.press("Enter");
}

test.describe("messages written without a connection (item 52)", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("waits with its clock instead of turning red, and goes by itself when the connection answers", async ({ page }) => {
    const server = await boot(page);
    server.server = "unreachable";
    await write(page, "Бетон привезут к девяти");

    await expect(bubble(page, "Бетон привезут к девяти")).toBeVisible();
    // Given the time the old path took to turn red: a failed fetch is almost
    // instant, so a second is a fair premise.
    await page.waitForTimeout(1_000);
    await expect(state(page, "Бетон привезут к девяти", "Отправляется")).toBeVisible();
    await expect(bubble(page, "Бетон привезут к девяти").getByRole("button", { name: "Повторить" })).toHaveCount(0);
    await expect(page.getByText("Сетевой сбой", { exact: false })).toHaveCount(0);

    // The connection is back: the moment the browser says so, it goes.
    server.server = "answer";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => server.inserts.length).toBe(1);
    await expect(state(page, "Бетон привезут к девяти", "Отправляется")).toHaveCount(0);
    await expect(state(page, "Бетон привезут к девяти", "Не удалось отправить")).toHaveCount(0);
  });

  test("survives a restart and goes after it, once", async ({ page }) => {
    const server = await boot(page);
    server.server = "unreachable";
    await write(page, "Кран заказан на десять");
    await expect(state(page, "Кран заказан на десять", "Отправляется")).toBeVisible();

    // The application is closed and opened again, the connection still down.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(bubble(page, FIRST)).toBeVisible();
    await expect(bubble(page, "Кран заказан на десять"), "a restart lost the message").toBeVisible();
    await expect(state(page, "Кран заказан на десять", "Отправляется")).toBeVisible();

    server.server = "answer";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => server.inserts.length).toBe(1);
    await expect(state(page, "Кран заказан на десять", "Отправляется")).toHaveCount(0);
    // Once: the same client id, whatever the number of attempts.
    await page.waitForTimeout(1_000);
    expect(server.inserts.length).toBe(1);
    expect(new Set(server.inserts.map((row) => row.client_message_id)).size).toBe(1);
  });

  test("several go in the order they were written", async ({ page }) => {
    const server = await boot(page);
    server.server = "unreachable";
    for (const text of ["Первое", "Второе", "Третье"]) await write(page, text);
    await expect(state(page, "Третье", "Отправляется")).toBeVisible();
    server.server = "answer";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => server.inserts.length).toBe(3);
    expect(server.inserts.map((row) => row.content)).toEqual(["Первое", "Второе", "Третье"]);
  });

  test("a refusal is red at once: waiting would not change it", async ({ page }) => {
    const server = await boot(page);
    server.server = "refuse";
    await write(page, "Это не пройдёт");
    await expect(state(page, "Это не пройдёт", "Не удалось отправить")).toBeVisible();
    expect(server.inserts.length).toBe(1);
  });
});
