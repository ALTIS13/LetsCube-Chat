import { expect, type Page, type Route, type TestInfo, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  type Row,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * D-236: «у самого бота в списке чатов нет никакой пометки что это бот
 * (выглядит будто я в диалоге просто с человеком)».
 *
 * The owner is right about the cause as well as the symptom. `ChatListItem`
 * already resolved the bot actor — for the **preview line**, and behind
 * `chat.type !== "private"` — so the one conversation where it matters was the
 * one case the condition excluded. Nothing else on any surface asked.
 *
 * And nothing could have: a chat row in the store carried no fact that answers
 * «is this a bot?». `chats` has no bot column, a bot is not a `chat_members`
 * row, and `last_message.bot` is about the newest message — null in a fresh bot
 * chat, non-null in a group a bot has spoken in. So the fixture below mocks
 * what the product now reads: one `chat_bot_members` request for the whole
 * list, embedding `bots`.
 *
 * Everything is fictional and mocked on the DEV fixture host. No production
 * screen is rendered and no production data is fetched.
 */

const AT = "2026-09-18T09:00:00.000Z";
const ME = person("42222222-2222-4222-8222-000000000001", "Зоя Яблокова", "zoya");
const OLGA = person("42222222-2222-4222-8222-000000000002", "Ольга Мишина", "olga");

const BOT_CHAT = "41111111-1111-4111-8111-000000000001";
const HUMAN_CHAT = "41111111-1111-4111-8111-000000000002";

const BOT = {
  id: "4bbbbbbb-1111-4111-8111-000000000001",
  username: "helper_bot",
  display_name: "Помощник",
  description: "Напоминает о встречах",
  avatar_url: null,
  state: "active",
  created_at: AT,
  updated_at: AT,
};

const BOT_LINE = "Напомню за час до встречи";
const HUMAN_LINE = "Договорились, до четверга";

interface OpenOptions {
  theme?: "light" | "dark";
  /** Answer the membership read with nothing, as a refused read does. */
  botsUnreadable?: boolean;
}

async function openList(page: Page, options: OpenOptions = {}) {
  const { theme = "dark", botsUnreadable = false } = options;

  await openFixture(page, {
    me: ME,
    people: [OLGA],
    // A bot chat is `private` and holds exactly one human: `open_or_create_bot_chat`
    // names it after the bot, because a private chat's title comes from the other
    // person and a bot chat has none.
    chats: [chat(BOT_CHAT, "private", "Помощник", AT), chat(HUMAN_CHAT, "private", null, AT)],
    memberships: [
      membership(BOT_CHAT, ME, "owner", AT),
      membership(HUMAN_CHAT, ME, "member", AT),
      membership(HUMAN_CHAT, OLGA, "member", AT),
    ] as Row[],
    messages: [
      message("43333333-3333-4333-8333-000000000001", BOT_CHAT, ME, "/start", AT, {
        // A bot's message: `user_id` null, `bot_id` set, and the bot joined.
        user_id: null,
        bot_id: BOT.id,
        sender: null,
        bot: BOT,
        content: BOT_LINE,
      }),
      message("43333333-3333-4333-8333-000000000002", HUMAN_CHAT, OLGA, HUMAN_LINE, AT),
    ],
    rpc: (name) => {
      if (name === "search_chat_messages") return missingFunction(name);
      if (name === "current_user_access_snapshot") return missingFunction(name);
      return undefined;
    },
  });

  // The one read the chat list now makes for the whole sidebar.
  await page.route("**/rest/v1/chat_bot_members*", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const rows = botsUnreadable ? [] : [{ chat_id: BOT_CHAT, bot: BOT }];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows),
    });
  });

  await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), theme);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(2);
  await page.evaluate(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", (root.dataset.theme ?? "") !== "light");
  });
}

const row = (page: Page, chatId: string) =>
  page.locator(`[data-testid="chat-list-item"][data-chat-id="${chatId}"]`);
const marks = (scope: Page | ReturnType<Page["locator"]>) => scope.locator("[data-bot-tag]");

function shotPath(info: TestInfo, name: string): string {
  return `output/bot-identity-mark/${name}-${info.project.name}.png`;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("the bot's row is marked and the person's row is not", async ({ page }) => {
  await openList(page);

  await expect(row(page, BOT_CHAT)).toContainText("Помощник");
  await expect(marks(row(page, BOT_CHAT)), "the bot's row carries no mark").toHaveCount(1);
  await expect(marks(row(page, BOT_CHAT))).toHaveText("Бот");
  await expect(marks(row(page, HUMAN_CHAT)), "a person's row was marked as a bot").toHaveCount(0);
});

test("the preview line is still the message, not the bot's name again", async ({ page }) => {
  await openList(page);
  // `ChatListItem` prefixes the preview with the actor's name in a group. In a
  // private chat that would print «Помощник: …» under a row already titled
  // «Помощник», which is why the condition excludes `private` — and why the
  // mark had to go beside the title instead of into the preview.
  await expect(row(page, BOT_CHAT)).toContainText(BOT_LINE);
  await expect(row(page, BOT_CHAT)).not.toContainText(`Помощник: ${BOT_LINE}`);
});

test("a list that cannot read bot memberships looks like a list with no bots", async ({ page }) => {
  // The degradation `useBotChat` already chose, applied to the sidebar: an
  // error about bots on the screen of somebody talking to a person is worse
  // than no mark.
  await openList(page, { botsUnreadable: true });
  await expect(marks(page)).toHaveCount(0);
  await expect(row(page, BOT_CHAT)).toContainText("Помощник");
});

test("the header and the card say it too, and the header stops inventing presence", async ({
  page,
}, info) => {
  await openList(page);
  await openChat(page, "Помощник", BOT_LINE);

  const header = page.getByTestId("chat-header-info-button");
  await expect(marks(header), "the chat header carries no bot mark").toHaveCount(1);
  // A bot has no presence. With no `other_user` this line used to answer the
  // never-seen state, so the header reported when a bot was «last online».
  await expect(header).toContainText("@helper_bot");
  await expect(header).not.toContainText("сети");

  await page.getByTestId("chat-header-info-button").click();
  const card = page.getByTestId("chat-info-summary");
  await expect(card).toBeVisible();
  await expect(marks(card), "the information card carries no bot mark").toHaveCount(1);
  // This line read «Без имени пользователя» before: it looked for a profile,
  // and a bot has none.
  await expect(card).toContainText("@helper_bot");
  await expect(card).not.toContainText("Без имени пользователя");
  // And the panel is not titled after a profile the bot does not have.
  await expect(page.getByTestId("chat-info-header")).toContainText("Профиль бота");
  await expect(page.getByTestId("chat-info-header")).not.toContainText("Профиль пользователя");

  await page.screenshot({ path: shotPath(info, "bot-chat-card"), fullPage: false });
});

test("the message above the conversation keeps the same mark", async ({ page }) => {
  await openList(page);
  await openChat(page, "Помощник", BOT_LINE);
  const bubble = page.locator('[data-message-id="43333333-3333-4333-8333-000000000001"]');
  await expect(marks(bubble)).toHaveCount(1);
  await expect(marks(bubble)).toHaveText("Бот");
});

test("a conversation with a person carries no mark anywhere", async ({ page }, info) => {
  await openList(page);
  await openChat(page, "Ольга Мишина", HUMAN_LINE);
  await expect(page.getByTestId("chat-header-info-button")).toContainText("Ольга Мишина");
  // The conversation, not the whole page: at 1440 the sidebar is still on
  // screen beside it and the bot's row is correctly marked there.
  await expect(
    marks(page.getByTestId("chat-chrome-stack")),
    "the person's conversation says «Бот»",
  ).toHaveCount(0);
  await expect(marks(row(page, HUMAN_CHAT)), "the person's own row says «Бот»").toHaveCount(0);
  await page.screenshot({ path: shotPath(info, "person-chat"), fullPage: false });
});

test("the marked list, photographed in both themes", async ({ page }, info) => {
  for (const theme of ["dark", "light"] as const) {
    await openList(page, { theme });
    await expect(marks(row(page, BOT_CHAT))).toHaveCount(1);
    await page.screenshot({ path: shotPath(info, `chat-list-${theme}`), fullPage: false });
    await openChat(page, "Помощник", BOT_LINE);
    await page.screenshot({ path: shotPath(info, `bot-chat-${theme}`), fullPage: false });
  }
});
