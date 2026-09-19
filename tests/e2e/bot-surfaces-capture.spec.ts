import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * A photograph of the bot surfaces, not a contract.
 *
 * The owner judges a visual change on rendered pixels, so this exists to
 * produce them at the two release widths in both themes: the inline keyboard
 * under a bot's message, the same keyboard once the deployment has said it
 * cannot deliver a press, the command menu, the «/» list, and «Запустить» in
 * place of the composer. Every row it seeds is invented — no production chat,
 * no real person, no bot token, no owner id.
 *
 * The contract for the same surfaces is `bot-chat-surfaces.spec.ts`; this file
 * asserts nothing about the design and is safe to delete once the audit closes.
 */

const AT = "2026-09-14T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-00000000c001", "Максим Орлов", "maksim");

const BOT_ID = "33333333-3333-4333-8333-00000000c001";
const BOT = {
  id: BOT_ID,
  username: "shiftbot",
  display_name: "Смены",
  description: "Подтверждение смен",
  avatar_url: null,
  state: "active",
  created_at: AT,
  updated_at: AT,
};

const CHAT_STARTED = "22222222-2222-4222-8222-00000000c001";
const CHAT_FRESH = "22222222-2222-4222-8222-00000000c002";
const QUESTION = "Смена на завтра: 10:00–19:00, точка на Лесной. Подтвердите выход.";

function botMessage(id: string, chatId: string, content: string, createdAt: string, markup: unknown = null): Row {
  return {
    ...message(id, chatId, ME, content, createdAt),
    user_id: null,
    sender: null,
    bot_id: BOT_ID,
    bot: BOT,
    bot_reply_markup: markup,
  };
}

const KEYBOARD = {
  inline_keyboard: [
    [
      { text: "Выйду", callback_data: "shift:2026-09-15:yes" },
      { text: "Не смогу", callback_data: "shift:2026-09-15:no" },
    ],
    [{ text: "Перенести на 12:00", callback_data: "shift:2026-09-15:move" }],
  ],
};

const COMMANDS = [
  { command: "shift", description: "Ближайшая смена", sort_order: 0 },
  { command: "shifts", description: "Все смены на неделю", sort_order: 1 },
  { command: "about", description: "О боте", sort_order: 2 },
];

async function open(page: Page, theme: "dark" | "light", chatId: string, pressMissing = false) {
  await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_STARTED, "private", "Смены", AT), chat(CHAT_FRESH, "private", "Напоминания", AT)],
    memberships: [membership(CHAT_STARTED, ME, "owner", AT), membership(CHAT_FRESH, ME, "owner", AT)],
    messages: [
      botMessage("55555555-5555-4555-8555-00000000c001", CHAT_STARTED, QUESTION, "2026-09-14T10:00:00.000Z", KEYBOARD),
      message("55555555-5555-4555-8555-00000000c002", CHAT_STARTED, ME, "Хорошо", "2026-09-14T10:05:00.000Z"),
      botMessage("55555555-5555-4555-8555-00000000c003", CHAT_FRESH, "Я присылаю смены и напоминания.", "2026-09-14T09:30:00.000Z"),
    ],
    rest: ({ resource, method }) => {
      if (method !== "GET") return undefined;
      if (resource === "chat_bot_members") {
        // `useBotChat` embeds the bot since D-244; a row without it is a chat
        // with no bot, so the capture would draw an ordinary composer.
        return {
          status: 200,
          body: [
            { chat_id: CHAT_STARTED, bot_id: BOT_ID, joined_at: AT, removed_at: null, bot: { username: BOT.username } },
            { chat_id: CHAT_FRESH, bot_id: BOT_ID, joined_at: AT, removed_at: null, bot: { username: BOT.username } },
          ],
        };
      }
      if (resource === "bot_commands") return { status: 200, body: COMMANDS };
      return undefined;
    },
    rpc: (name) =>
      name === "bot_callback_press" && pressMissing ? missingFunction("bot_callback_press") : undefined,
  });
  // `openFixture` seeds the dark theme; a later init script wins. The drafts go
  // with it: a «/sh» typed for an earlier frame is a real draft and would be
  // restored into the next one, which photographs the previous step.
  await page.addInitScript((value) => {
    localStorage.setItem("kub-theme", value as string);
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("kub:draft:")) localStorage.removeItem(key);
    }
  }, theme);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect
    .poll(() =>
      page.evaluate(async (target) => {
        const { useAppStore } = await import("/src/store/app.store.ts");
        return useAppStore.getState().chats.some((row) => row.id === target);
      }, chatId),
    )
    .toBe(true);
  await page.evaluate(async (target) => {
    const { useAppStore } = await import("/src/store/app.store.ts");
    useAppStore.getState().setSelectedChatId(target);
  }, chatId);
  await page.evaluate(() => document.fonts.ready);
}

function shot(page: Page, name: string, theme: string) {
  const width = page.viewportSize()?.width ?? 0;
  return page.screenshot({ path: `output/bot-surfaces/${name}-${width}-${theme}.png` });
}

for (const theme of ["dark", "light"] as const) {
  test(`bot surfaces — ${theme}`, async ({ page, request }) => {
    await requireFixtureServer(request);

    await open(page, theme, CHAT_STARTED);
    await expect(page.locator('[data-bot-keyboard="true"]')).toBeVisible();
    await page.waitForTimeout(700);
    await shot(page, "keyboard", theme);

    await page.getByTestId("bot-commands-button").click();
    await expect(page.getByTestId("bot-command-menu")).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, "command-menu", theme);

    await page.getByTestId("bot-commands-button").click();
    await page.locator("textarea").fill("/sh");
    await expect(page.getByTestId("bot-command-menu")).toHaveAttribute("data-bot-command-variant", "typed");
    await page.waitForTimeout(400);
    await shot(page, "slash-list", theme);

    await open(page, theme, CHAT_FRESH);
    await expect(page.getByTestId("bot-start-button")).toBeVisible();
    await page.waitForTimeout(700);
    await shot(page, "start", theme);

    await open(page, theme, CHAT_STARTED, true);
    await expect(page.locator('[data-bot-keyboard="true"]')).toBeVisible();
    await page.locator('[data-bot-keyboard-button="0:0"]').click();
    await expect(page.locator('[data-bot-keyboard="true"]')).toHaveAttribute("data-bot-keyboard-state", "unavailable");
    await page.waitForTimeout(400);
    await shot(page, "keyboard-unavailable", theme);
  });
}
