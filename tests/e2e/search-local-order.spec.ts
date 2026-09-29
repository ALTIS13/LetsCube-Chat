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
 * Tracker item 36, c — the order the search puts conversations in
 * (`lib/localChatSearch.ts`). Discord's quick switcher scores a match-quality
 * ladder times a usage booster; ours scored `indexOf` over one string that
 * joined a conversation's name with its last message. So:
 *
 *   - words typed in another order found nothing — «проекта команда» missed
 *     «Команда проекта»;
 *   - where the reader had just been counted for nothing;
 *   - a conversation found by the last thing said in it ranked with one found
 *     by its name.
 *
 * The order is read off the rendered boxes, not the DOM, because a list in the
 * right order in the markup can still be drawn in the wrong one.
 */

const LATER = "2026-09-28T10:00:00.000Z";
const AT = "2026-09-28T09:00:00.000Z";
const ME = person("cf311111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("cf311111-1111-4111-8111-000000000002", "Анна Смирнова");
const TEAM = "cf322222-2222-4222-8222-000000000001";
const STORE = "cf322222-2222-4222-8222-000000000002";
const SUPPLY = "cf322222-2222-4222-8222-000000000003";

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 768;

async function boot(page: Page) {
  await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [
      // The later one wins a tie on the old order, so a visit has to overturn it.
      chat(TEAM, "group", "Команда проекта", LATER),
      chat(STORE, "group", "Команда склада", AT),
      chat(SUPPLY, "group", "Снабжение", AT),
    ],
    memberships: [
      membership(TEAM, ME, "owner", LATER),
      membership(TEAM, ANNA, "member", LATER),
      membership(STORE, ME, "owner", AT),
      membership(STORE, ANNA, "member", AT),
      membership(SUPPLY, ME, "owner", AT),
      membership(SUPPLY, ANNA, "member", AT),
    ],
    messages: [
      message("cf355555-5555-4555-8555-000000000001", TEAM, ANNA, "Макет главной готов", LATER),
      message("cf355555-5555-4555-8555-000000000002", STORE, ANNA, "Приёмка в пятницу", AT),
      // «команд» only in what was said, never in the name.
      message("cf355555-5555-4555-8555-000000000003", SUPPLY, ANNA, "Смета от команды готова", AT),
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

/** The conversations the search found, top to bottom as drawn. */
async function foundChats(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="sidebar-search-result-chat"]')]
      .map((el) => ({ text: (el as HTMLElement).innerText, top: el.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top)
      .map((entry) => entry.text.split("\n")[0].trim()),
  );
}

async function search(page: Page, query: string) {
  const field = page.getByTestId("sidebar-search-input");
  await field.click();
  await field.fill(query);
  await expect(page.getByTestId("sidebar-global-search-results")).toBeVisible();
  await expect(page.locator('[data-testid="sidebar-search-result-chat"]').first()).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("words in another order still find the conversation", async ({ page }) => {
  await boot(page);
  await search(page, "проекта команда");
  expect(await foundChats(page)).toEqual(["Команда проекта"]);
});

test("a name comes before what was said, and where the reader has been comes first", async ({ page }) => {
  await boot(page);

  // Nobody has been anywhere: the two names tie, and the tie goes to the later.
  // The one found only in what was said comes after both.
  await search(page, "команд");
  expect(await foundChats(page)).toEqual(["Команда проекта", "Команда склада", "Снабжение"]);

  // The reader goes to the other one, and comes back to the same search.
  await page.getByTestId("sidebar-search-input").fill("");
  await page.getByTestId("sidebar-search-input").press("Escape");
  await visit(page, "Команда склада", "Приёмка в пятницу");
  await search(page, "команд");
  expect(await foundChats(page)).toEqual(["Команда склада", "Команда проекта", "Снабжение"]);
});
