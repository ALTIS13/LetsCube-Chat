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
 * Tracker item 47 — «всё в кучу сваливается… шум из чатов». The owner's own
 * proposal, a small capsule that filters the list by the kind of conversation:
 * people, groups, bots. Telegram can express it only by building a folder by
 * hand (reference-clients §17), which is why the noise stays; here it is always
 * there while the list holds more than one kind.
 *
 * A bot's conversation is a private chat with the bot beside it, served the way
 * the chat list reads it: one `chat_bot_members` request.
 */

test.use({ screenshot: "off", trace: "off", video: "off" });

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("c1111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("c1111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const ANNA_CHAT = "c2222222-2222-4222-8222-000000000001";
const TEAM = "c2222222-2222-4222-8222-000000000002";
const BOT_CHAT = "c2222222-2222-4222-8222-000000000003";
const BOT = {
  id: "cbbbbbbb-1111-4111-8111-000000000001",
  username: "helper_bot",
  display_name: "Помощник",
  description: "Напоминает о встречах",
  avatar_url: null,
  state: "active",
  created_at: AT,
  updated_at: AT,
};

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

async function boot(page: Page, options: { onlyPeople?: boolean } = {}) {
  const chats = options.onlyPeople
    ? [chat(ANNA_CHAT, "private", null, AT)]
    : [chat(ANNA_CHAT, "private", null, AT), chat(TEAM, "group", "Команда проекта", AT), chat(BOT_CHAT, "private", null, AT)];
  await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats,
    memberships: [
      membership(ANNA_CHAT, ME, "owner", "2026-09-28T08:00:00.000Z"),
      membership(ANNA_CHAT, ANNA, "member", AT),
      ...(options.onlyPeople
        ? []
        : [
            membership(TEAM, ME, "owner", "2026-09-28T08:00:00.000Z"),
            membership(TEAM, ANNA, "member", AT),
            membership(BOT_CHAT, ME, "owner", AT),
          ]),
    ],
    messages: [
      message("c3333333-3333-4333-8333-000000000001", ANNA_CHAT, ANNA, "Подпишешь акт?", AT),
      ...(options.onlyPeople ? [] : [message("c3333333-3333-4333-8333-000000000002", TEAM, ANNA, "Бетон завтра", AT)]),
    ],
  });
  await page.route("**/rest/v1/chat_bot_members*", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const rows = options.onlyPeople ? [] : [{ chat_id: BOT_CHAT, bot: BOT }];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(options.onlyPeople ? 1 : 3);
}

const capsule = (page: Page) => page.getByTestId("chat-kind-filter");
const pill = (page: Page, kind: string) => capsule(page).locator(`[data-chat-kind="${kind}"]`);
const rows = (page: Page) => page.getByTestId("chat-list-item");

test("the list offers its kinds, and a press shows one kind", async ({ page }) => {
  await boot(page);
  await expect(capsule(page)).toBeVisible();
  // No «Все» of its own — the folder's «Все» is beside it — and no «Каналы»,
  // because there is no channel in this list to show.
  await expect(capsule(page).locator("[data-chat-kind]")).toHaveText([/^Люди/, /^Группы/, "Боты"]);
  await expect(capsule(page).locator('[aria-pressed="true"]')).toHaveCount(0);

  await pill(page, "group").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Команда проекта");

  await pill(page, "bot").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Помощник");

  await pill(page, "person").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Анна Смирнова");

  // A kind is a toggle: pressed again, the list is everything again.
  await pill(page, "person").click();
  await expect(pill(page, "person")).toHaveAttribute("aria-pressed", "false");
  await expect(rows(page)).toHaveCount(3);
});

test("a pill that is not chosen still says something waits in its kind", async ({ page }) => {
  await boot(page);
  await pill(page, "bot").click();
  // Anna's line and the team's are both unread, and neither is on screen.
  await expect(pill(page, "person").getByTestId("chat-kind-unread")).toBeVisible();
  await expect(pill(page, "group").getByTestId("chat-kind-unread")).toBeVisible();
  await expect(pill(page, "bot").getByTestId("chat-kind-unread")).toHaveCount(0);
});

test("the choice is where the list was left, across a reload", async ({ page }) => {
  await boot(page);
  await pill(page, "group").click();
  await expect(rows(page)).toHaveCount(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(pill(page, "group")).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Команда проекта");
});

test("a list of one kind draws no capsule, which would filter nothing", async ({ page }) => {
  await boot(page, { onlyPeople: true });
  await expect(capsule(page)).toHaveCount(0);
});
