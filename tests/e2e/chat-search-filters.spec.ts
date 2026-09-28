import { expect, test, type Locator, type Page } from "@playwright/test";
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
 * Tracker item 36 c — «функция поиска удобно показывает что можно сделать и
 * даёт выбрать нужную функцию нажатием». The in-chat search parsed `from:`,
 * `has:`, `before:` and `after:` and offered none of them. Now, as Discord's
 * does (reference-clients §15.3), the empty field offers the filters, a press
 * inserts the prefix without searching, and a `from:` or `has:` being typed
 * offers its values: the conversation's members, the five kinds.
 *
 * The column's form from `md`, the phone's bar below it. The search runs over
 * the loaded messages: the fixture has no `search_chat_messages`.
 */

test.use({ screenshot: "off", trace: "off", video: "off" });

const AT = "2026-09-27T09:00:00.000Z";
const ME = person("a1111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("a1111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const BORIS = person("a1111111-1111-4111-8111-000000000003", "Борис Петров", "boris");
const TEAM = "a2222222-2222-4222-8222-000000000001";
const ANNA_LINE = "Смета по фасаду готова";
const BORIS_LINE = "Смета по кровле будет завтра";

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

async function boot(page: Page) {
  await openFixture(page, {
    me: ME,
    people: [ANNA, BORIS],
    chats: [chat(TEAM, "group", "Команда проекта", AT)],
    memberships: [
      membership(TEAM, ME, "owner", AT),
      membership(TEAM, ANNA, "member", AT),
      membership(TEAM, BORIS, "member", AT),
    ],
    messages: [
      message("a3333333-3333-4333-8333-000000000001", TEAM, ANNA, ANNA_LINE, "2026-09-27T09:01:00.000Z"),
      message("a3333333-3333-4333-8333-000000000002", TEAM, BORIS, BORIS_LINE, "2026-09-27T09:02:00.000Z"),
    ],
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("chat-list-item").filter({ hasText: "Команда проекта" }).first().click();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: BORIS_LINE })).toBeVisible();
  await page.getByRole("button", { name: "Ещё" }).first().click();
  await page.getByRole("button", { name: "Поиск в чате" }).first().click();
}

/** The field of whichever form is on screen. */
function field(page: Page): Locator {
  return page.locator("[data-testid='chat-search-input']:visible, input[placeholder^='Поиск в чате']:visible").first();
}

const offer = (page: Page) => page.getByTestId("search-filter-offer");

test("an empty field offers the filters, and a press inserts the prefix without searching", async ({ page }) => {
  await boot(page);
  await expect(offer(page)).toHaveAttribute("data-offer", "filters");
  await expect(offer(page).locator("[data-search-filter]")).toHaveCount(4);
  await expect(offer(page)).toContainText("От участника");
  await expect(offer(page)).toContainText("from:имя");

  await offer(page).locator("[data-search-filter='from:']").click();
  await expect(field(page)).toHaveValue("from:");
  await expect(field(page)).toBeFocused();
  // The prefix alone searches nothing: there is no counter yet.
  await expect(page.getByText("ничего не найдено")).toHaveCount(0);
});

test("a from: offers the conversation's people, and picking one filters to them", async ({ page }) => {
  await boot(page);
  await offer(page).locator("[data-search-filter='from:']").click();
  await expect(offer(page)).toHaveAttribute("data-offer", "from");
  await expect(offer(page).locator("[data-search-person]")).toHaveCount(3);

  await field(page).pressSequentially("ан");
  await expect(offer(page).locator("[data-search-person]")).toHaveCount(1);
  await offer(page).locator(`[data-search-person='${ANNA.id}']`).click();
  await expect(field(page)).toHaveValue('from:"Анна Смирнова" ');
  await expect(page.getByTestId("search-filter-chip-from")).toContainText("Анна Смирнова");
  await expect(offer(page)).toHaveCount(0);
  // Anna's message is found and Boris's is not.
  await expect(page.getByText(/1\/1/)).toBeVisible();
});

test("a has: offers its five kinds, by name as well as by value", async ({ page }) => {
  await boot(page);
  await offer(page).locator("[data-search-filter='has:']").click();
  await expect(offer(page)).toHaveAttribute("data-offer", "has");
  await expect(offer(page).locator("[data-search-has]")).toHaveCount(5);
  await field(page).pressSequentially("фо");
  await expect(offer(page).locator("[data-search-has]")).toHaveCount(1);
  await offer(page).locator("[data-search-has='image']").click();
  await expect(field(page)).toHaveValue("has:image ");
  await expect(page.getByTestId("search-filter-chip-has")).toBeVisible();
});

test("typing words offers nothing that would cover the results", async ({ page }) => {
  await boot(page);
  await field(page).fill("Смета");
  await expect(offer(page)).toHaveCount(0);
  await expect(page.getByText(/1\/2|2\/2/)).toBeVisible();
});
