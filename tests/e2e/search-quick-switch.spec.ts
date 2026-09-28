import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * Tracker item 36, c — the global half. The owner, of Discord's quick
 * switcher: «Глобальный поиск исполнен немного иначе чем в Telegram, но тем не
 * менее интересно». Our field showed nothing until a letter was typed; now an
 * empty focused field offers where to go, as Discord's switcher does — where
 * the reader was (the conversation on screen skipped), then what is unread
 * (`lib/quickSwitch.ts`) — and the arrows and Enter walk it.
 */

const AT = "2026-09-28T09:00:00.000Z";
const EARLIER = "2026-09-28T08:00:00.000Z";
const ME = person("cf111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("cf111111-1111-4111-8111-000000000002", "Анна Смирнова");
const BORIS = person("cf111111-1111-4111-8111-000000000003", "Борис Ковалёв");
const TEAM = "cf222222-2222-4222-8222-000000000001";
const SITE = "cf222222-2222-4222-8222-000000000002";
const SUPPLY = "cf222222-2222-4222-8222-000000000003";

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 768;

async function boot(page: Page) {
  await openFixture(page, {
    me: ME,
    people: [ANNA, BORIS],
    chats: [
      chat(TEAM, "group", "Команда проекта", AT),
      chat(SITE, "group", "Объект на Минской", AT),
      chat(SUPPLY, "group", "Снабжение", AT),
    ],
    memberships: [
      membership(TEAM, ME, "owner", AT),
      membership(TEAM, ANNA, "member", AT),
      membership(SITE, ME, "owner", AT),
      membership(SITE, BORIS, "member", AT),
      // Read up to an hour ago: the delivery below is unread.
      membership(SUPPLY, ME, "member", EARLIER),
      membership(SUPPLY, BORIS, "member", AT),
    ],
    messages: [
      message("cf555555-5555-4555-8555-000000000001", TEAM, ANNA, "Макет главной готов", AT),
      message("cf555555-5555-4555-8555-000000000002", SITE, BORIS, "Бетон привезут к девяти", AT),
      message("cf555555-5555-4555-8555-000000000003", SUPPLY, BORIS, "Арматура приедет в четверг", AT),
    ],
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(3);
}

async function visit(page: Page, name: string, line: string) {
  await page.getByTestId("chat-list-item").filter({ hasText: name }).click();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: line })).toBeVisible();
  if (!isDesktop(page)) await page.getByTestId("chat-control-row").getByLabel("Назад").click();
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("an empty focused search offers where the reader was and what is unread, and the keys walk it", async ({ page }) => {
  await boot(page);
  await visit(page, "Команда проекта", "Макет главной готов");
  await visit(page, "Объект на Минской", "Бетон привезут к девяти");

  const field = page.getByTestId("sidebar-search-input");
  await field.click();
  const quick = page.getByTestId("quick-switch");
  await expect(quick).toBeVisible();

  const recent = quick.locator('[data-quick-switch-section="recent"]');
  const unread = quick.locator('[data-quick-switch-section="unread"]');
  await expect(recent.getByRole("heading", { name: "Недавние" })).toBeVisible();
  if (isDesktop(page)) {
    // The conversation on screen is not somewhere to go.
    await expect(recent.getByTestId("chat-list-item")).toHaveCount(1);
    await expect(recent).toContainText("Команда проекта");
  } else {
    // A phone left both for the list: both are behind the reader.
    await expect(recent.getByTestId("chat-list-item")).toHaveCount(2);
    await expect(recent.getByTestId("chat-list-item").first()).toContainText("Объект на Минской");
  }
  await expect(unread.getByRole("heading", { name: "Непрочитанные" })).toBeVisible();
  await expect(unread).toContainText("Снабжение");

  // Down to the unread one, and Enter opens it.
  const rows = quick.getByTestId("chat-list-item");
  const count = await rows.count();
  for (let step = 1; step < count; step += 1) await field.press("ArrowDown");
  await field.press("Enter");
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: "Арматура приедет в четверг" })).toBeVisible();
  await expect(quick).toHaveCount(0);
});

test("a press opens the row, and Escape or a letter puts the list back", async ({ page }) => {
  await boot(page);
  await visit(page, "Команда проекта", "Макет главной готов");
  const field = page.getByTestId("sidebar-search-input");

  await field.click();
  const quick = page.getByTestId("quick-switch");
  await expect(quick).toBeVisible();
  await field.press("Escape");
  await expect(quick).toHaveCount(0);

  await field.click();
  await expect(quick).toBeVisible();
  // Typing is a search again.
  await field.fill("Снаб");
  await expect(quick).toHaveCount(0);
  await field.fill("");

  await expect(quick).toBeVisible();
  await quick.getByTestId("chat-list-item").filter({ hasText: "Снабжение" }).click();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: "Арматура приедет в четверг" })).toBeVisible();
});
