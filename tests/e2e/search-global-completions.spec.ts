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
 * Tracker item 36 c, the global half's completions. The sidebar's search of
 * everything parses `from:` and `in:` and offered neither: a person had to know
 * a name to type one. It now offers them as the in-chat field does — inside a
 * filter token, one group of up to ten (reference-clients §15.3) — with `in:`
 * limited to conversations that have a name, since the server matches `in:`
 * against a name or an id.
 */

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("cf411111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("cf411111-1111-4111-8111-000000000002", "Анна Смирнова");
const BORIS = person("cf411111-1111-4111-8111-000000000003", "Борис Ковалёв");
const TEAM = "cf422222-2222-4222-8222-000000000001";
const SUPPLY = "cf422222-2222-4222-8222-000000000002";
const PRIVATE = "cf422222-2222-4222-8222-000000000003";

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 768;

async function boot(page: Page) {
  await openFixture(page, {
    me: ME,
    people: [ANNA, BORIS],
    chats: [
      chat(TEAM, "group", "Команда проекта", AT),
      chat(SUPPLY, "group", "Снабжение", AT),
      chat(PRIVATE, "private", null, AT),
    ],
    memberships: [
      membership(TEAM, ME, "owner", AT),
      membership(TEAM, ANNA, "member", AT),
      membership(SUPPLY, ME, "owner", AT),
      membership(SUPPLY, BORIS, "member", AT),
      membership(PRIVATE, ME, "member", AT),
      membership(PRIVATE, ANNA, "member", AT),
    ],
    messages: [
      message("cf455555-5555-4555-8555-000000000001", TEAM, ANNA, "Макет главной готов", AT),
      message("cf455555-5555-4555-8555-000000000002", SUPPLY, BORIS, "Арматура приедет в четверг", AT),
      message("cf455555-5555-4555-8555-000000000003", PRIVATE, ANNA, "Созвонимся вечером?", AT),
    ],
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(3);
}

const field = (page: Page) => page.getByTestId("sidebar-search-input");
const offer = (page: Page, kind: string) => page.locator(`[data-testid="search-filter-offer"][data-offer="${kind}"]`);

async function type(page: Page, text: string) {
  await field(page).click();
  await field(page).fill(text);
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("from: offers everybody from the reader's conversations, and a press fills the filter", async ({ page }) => {
  await boot(page);
  await type(page, "from:");
  const people = offer(page, "from");
  await expect(people).toBeVisible();
  await expect(people.locator("[data-search-person]")).toHaveCount(3);
  // The syntax hint teaches what is being typed, and its plate hangs where these
  // rows are: on the first renders it lay over the first of them.
  await page.waitForTimeout(600);
  await expect(page.getByTestId("kub-hint")).toHaveCount(0);

  await field(page).fill("from:бор");
  await expect(people.locator("[data-search-person]")).toHaveCount(1);
  await people.locator(`[data-search-person="${BORIS.id}"]`).click();

  await expect(field(page)).toHaveValue('from:"Борис Ковалёв" ');
  await expect(field(page)).toBeFocused();
  await expect(page.getByTestId("search-filter-chip-from")).toBeVisible();
  await expect(offer(page, "from")).toHaveCount(0);
});

test("in: offers the conversations that have a name, and not a private chat", async ({ page }) => {
  await boot(page);
  await type(page, "in:");
  const places = offer(page, "in");
  await expect(places).toBeVisible();
  await expect(places.locator("[data-search-chat]")).toHaveCount(2);
  await expect(places.locator(`[data-search-chat="${PRIVATE}"]`)).toHaveCount(0);

  await field(page).fill("смета in:снаб");
  await expect(places.locator("[data-search-chat]")).toHaveCount(1);
  await places.locator(`[data-search-chat="${SUPPLY}"]`).click();

  await expect(field(page)).toHaveValue("смета in:Снабжение ");
  await expect(field(page)).toBeFocused();
  await expect(page.getByTestId("search-filter-chip-in")).toBeVisible();
});

test("the conversation on screen comes first among the places", async ({ page }) => {
  test.skip(!isDesktop(page), "a phone's list and its conversation are not on screen together");
  await boot(page);
  await page.getByTestId("chat-list-item").filter({ hasText: "Снабжение" }).click();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: "Арматура приедет в четверг" })).toBeVisible();

  await type(page, "in:");
  const first = offer(page, "in").locator("[data-search-chat]").first();
  await expect(first).toHaveAttribute("data-search-chat", SUPPLY);
});
