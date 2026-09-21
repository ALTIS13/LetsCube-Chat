import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * A photograph of what D-263 changed, not a contract.
 *
 * The owner judges a visual change on rendered pixels, so this produces them
 * at the two release widths in both themes: a command drawn as a control
 * inside a bot's message, the card its face opens, and the composer's commands
 * button — whose width §19.3 corrects a written claim about.
 *
 * Every row it seeds is invented: no production chat, no real person, no bot
 * belonging to anybody. The contract for the same surfaces is
 * `bot-command-and-profile.spec.ts`; this file asserts only that it
 * photographed what it says it did, because a capture that silently shot the
 * wrong surface is worse than no capture.
 */

const AT = "2026-09-21T09:00:00.000Z";

const ME = person("61111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const MATE = person("61111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna_smirnova");

const BOT_ID = "63333333-3333-4333-8333-000000000001";
const BOT = {
  id: BOT_ID,
  username: "shiftbot",
  display_name: "Смены",
  description:
    "Присылаю ближайшую смену и напоминание за час до выхода. Отвечаю на команды в личном чате и в группе, если обратиться по имени.",
  avatar_url: null,
  state: "active",
  created_at: AT,
  updated_at: AT,
};

const PRIVATE_CHAT = "62222222-2222-4222-8222-000000000001";
const GROUP_CHAT = "62222222-2222-4222-8222-000000000002";

const COMMANDS = [
  { command: "shift", description: "Ближайшая смена", sort_order: 0 },
  { command: "shifts", description: "Все смены на неделю", sort_order: 1 },
  { command: "swap", description: "Предложить обмен сменами", sort_order: 2 },
];

const OFFER =
  "Смена завтра: 10:00–19:00, точка на Лесной. Напишите /shift для ближайшей, /shifts для недели, /report для отчёта.";
const BOT_MESSAGE = "65555555-5555-4555-8555-000000000001";

function botMessage(id: string, chatId: string, content: string, createdAt: string): Row {
  return {
    ...message(id, chatId, ME, content, createdAt),
    user_id: null,
    sender: null,
    bot_id: BOT_ID,
    bot: BOT,
    bot_reply_markup: null,
  };
}

async function open(page: Page, theme: "dark" | "light") {
  await openFixture(page, {
    me: ME,
    people: [MATE],
    chats: [chat(PRIVATE_CHAT, "private", "Смены", AT), chat(GROUP_CHAT, "group", "Бригада", AT)],
    memberships: [
      membership(PRIVATE_CHAT, ME, "owner", AT),
      membership(GROUP_CHAT, ME, "owner", AT),
      membership(GROUP_CHAT, MATE, "member", AT),
    ],
    messages: [
      botMessage(BOT_MESSAGE, PRIVATE_CHAT, OFFER, "2026-09-21T10:00:00.000Z"),
      message("65555555-5555-4555-8555-000000000002", PRIVATE_CHAT, ME, "Подтверждаю", "2026-09-21T10:05:00.000Z"),
    ],
    rest: ({ resource, method }) => {
      if (method !== "GET") return undefined;
      if (resource === "chat_bot_members") {
        return {
          status: 200,
          body: [
            { chat_id: PRIVATE_CHAT, bot_id: BOT_ID, joined_at: AT, removed_at: null, bot: { username: BOT.username, state: BOT.state } },
            { chat_id: GROUP_CHAT, bot_id: BOT_ID, joined_at: AT, removed_at: null, bot: { username: BOT.username, state: BOT.state } },
          ],
        };
      }
      if (resource === "bot_commands") return { status: 200, body: COMMANDS };
      if (resource === "bots") return { status: 200, body: [BOT] };
      return undefined;
    },
  });
  // `openFixture` seeds the dark theme; a later init script wins.
  await page.addInitScript((value) => {
    localStorage.setItem("kub-theme", value as string);
  }, theme);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect
    .poll(() =>
      page.evaluate(async (target) => {
        const { useAppStore } = await import("/src/store/app.store.ts");
        return useAppStore.getState().chats.some((row) => row.id === target);
      }, PRIVATE_CHAT),
    )
    .toBe(true);
  await page.evaluate(async (target) => {
    const { useAppStore } = await import("/src/store/app.store.ts");
    useAppStore.getState().setSelectedChatId(target);
  }, PRIVATE_CHAT);
  await page.evaluate(() => document.fonts.ready);
}

function shot(page: Page, name: string, theme: string) {
  const width = page.viewportSize()?.width ?? 0;
  return page.screenshot({ path: `output/bot-command-profile/${name}-${width}-${theme}.png` });
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

for (const theme of ["dark", "light"] as const) {
  test(`a bot's commands and its card — ${theme}`, async ({ page, request }) => {
    await requireFixtureServer(request);
    await open(page, theme);

    // 1. The conversation: two commands drawn as controls and one — `/report`,
    //    which nothing registered — left as text beside them. That contrast is
    //    the whole of the first complaint's answer and has to be in the frame.
    const bubble = page.locator(`[data-message-id="${BOT_MESSAGE}"]`);
    await expect(bubble.locator('[data-bot-command-run="/shift"]')).toBeVisible();
    await expect(bubble.locator('[data-bot-command-run="/report"]')).toHaveCount(0);
    await page.waitForTimeout(300);
    await shot(page, "conversation", theme);

    // 2. The composer's commands button, whose width §19.3 of
    //    `reference-clients.md` corrects a written claim about. Measured here
    //    rather than described, and recorded in the test's own output.
    const button = page.getByTestId("bot-commands-button");
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    const gap = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="bot-commands-button"]');
      return el ? Number.parseFloat(getComputedStyle(el).marginLeft) : 0;
    });
    console.log(`bot-commands-button: ${box.width}x${box.height} css px, margin-left ${gap}`);
    expect(box.height).toBeGreaterThanOrEqual(40);

    // 3. The card the face opens: a popout beside the message at 1440, the
    //    phone's whole screen at 390 — one body, two containers.
    await bubble.getByTestId("message-author-avatar").click();
    const card = page.getByTestId("bot-profile-card");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("bot-profile-overlay")).toHaveAttribute(
      "data-profile-surface",
      isPhone(page) ? "full" : "compact",
    );
    await expect(card.getByTestId("bot-profile-description")).toBeVisible();
    await expect(card.locator("[data-bot-profile-command]")).toHaveCount(COMMANDS.length);
    await page.waitForTimeout(350);
    await shot(page, "card", theme);
  });
}
