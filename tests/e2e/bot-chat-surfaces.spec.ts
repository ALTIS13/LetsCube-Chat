import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import {
  chat,
  membership,
  message,
  missingFunction,
  openFixture,
  person,
  requireFixtureServer,
  type Fixture,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * What a bot offers, reaching the person it is offering it to
 * (D-125, D-126, D-127).
 *
 * The three entries are one gap seen three ways, so they are one spec: an
 * inline keyboard that was stored and never drawn, commands that were
 * registered and never listed, and a bot in search that led to a modal saying
 * it could not be opened.
 *
 * Two of the mechanics are measured against a door that **does not exist on the
 * deployment**, and that is deliberate rather than an oversight — see the module
 * header of `artifacts/kub/src/lib/botCallback.ts`:
 *
 *   - `public.bot_update_enqueue_internal`, the only writer of the bot update
 *     queue, is granted to `service_role` alone, so a press has no path from an
 *     ordinary account. The client calls `bot_callback_press`, a wrapper that
 *     has to exist; here it is played by the fixture, both answering and absent,
 *     so both halves of the behaviour are pinned before the wrapper is written.
 *   - `public.chat_bot_members` has SELECT and no other verb for
 *     `authenticated`, so a chat with a bot cannot be created from the client.
 *     What can be done today — opening one that already exists — is what the
 *     search test measures.
 *
 * Needs the dev server on the fixture host; it mocks the backend and refuses any
 * other configuration.
 */

const AT = "2026-09-14T09:00:00.000Z";

const ME = person("11111111-1111-4111-8111-00000000b001", "Максим Орлов", "maksim");

const BOT_ID = "33333333-3333-4333-8333-00000000b001";
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

/** The chat the person has already written in: composer, menu and «/». */
const CHAT_STARTED = "22222222-2222-4222-8222-00000000b001";
/** The chat nobody has written in: «Запустить» stands in for the composer. */
const CHAT_FRESH = "22222222-2222-4222-8222-00000000b002";

const KEYBOARD_MESSAGE = "55555555-5555-4555-8555-00000000b001";
const QUESTION = "Смена на завтра: 10:00–19:00, точка на Лесной. Подтвердите выход.";
const GREETING = "Я присылаю смены и напоминания.";

const COMMANDS = [
  { command: "shift", description: "Ближайшая смена", sort_order: 0 },
  { command: "shifts", description: "Все смены на неделю", sort_order: 1 },
  { command: "about", description: "О боте", sort_order: 2 },
];

/** A bot's message: `user_id` null, `bot_id` set, no sender profile. */
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
    [{ text: "Перенести", callback_data: "shift:2026-09-15:move" }],
  ],
};

interface Options {
  /** How `bot_callback_press` answers; absent leaves it answering `null`. */
  press?: { status?: number; body: unknown };
  /** True makes the wrapper missing, as it is on the deployment today. */
  pressMissing?: boolean;
  /** Bots `search_public_bots` finds. */
  searchBots?: boolean;
  commands?: typeof COMMANDS;
  /**
   * `bots.state` the membership read answers with. Defaults to `active`.
   *
   * The `bots` SELECT policy admits a row to anyone sharing a live chat with
   * the bot **whatever its state**, so a paused or deleted bot's name goes on
   * arriving here exactly as it does in production — which is what D-247 is
   * about.
   */
  botState?: string;
}

async function seed(page: Page, options: Options = {}): Promise<Fixture> {
  const commands = options.commands ?? COMMANDS;
  const botState = options.botState ?? BOT.state;
  return openFixture(page, {
    me: ME,
    chats: [
      chat(CHAT_STARTED, "private", "Смены", AT),
      chat(CHAT_FRESH, "private", "Напоминания", "2026-09-14T08:00:00.000Z"),
    ],
    memberships: [membership(CHAT_STARTED, ME, "owner", AT), membership(CHAT_FRESH, ME, "owner", AT)],
    messages: [
      botMessage(KEYBOARD_MESSAGE, CHAT_STARTED, QUESTION, "2026-09-14T10:00:00.000Z", KEYBOARD),
      message("55555555-5555-4555-8555-00000000b002", CHAT_STARTED, ME, "Хорошо", "2026-09-14T10:05:00.000Z"),
      botMessage("55555555-5555-4555-8555-00000000b003", CHAT_FRESH, GREETING, "2026-09-14T09:30:00.000Z"),
    ],
    rest: ({ resource, method }) => {
      if (method !== "GET") return undefined;
      // Both bot tables are SELECT-able by an ordinary account in production,
      // under policies that require sharing a live chat with the bot. The
      // fixture's own router has no entry for either, so they are answered
      // here — and the client's `eq`/`limit` filters are server-side, so both
      // memberships come back and the reader picks.
      if (resource === "chat_bot_members") {
        // The embed is what `useBotChat` asks for since D-244: the bot's
        // username has to arrive in the same row as the `bot_id` whose
        // commands are being loaded, or a group addresses the wrong one. Its
        // `state` travels with it since D-247, because the authoriser reads
        // that column and the composer has to read the same one.
        return {
          status: 200,
          body: [
            { chat_id: CHAT_STARTED, bot_id: BOT_ID, joined_at: AT, removed_at: null, bot: { username: BOT.username, state: botState } },
            { chat_id: CHAT_FRESH, bot_id: BOT_ID, joined_at: AT, removed_at: null, bot: { username: BOT.username, state: botState } },
          ],
        };
      }
      if (resource === "bot_commands") return { status: 200, body: commands };
      return undefined;
    },
    rpc: (name) => {
      if (name === "search_public_bots") {
        return options.searchBots
          ? { body: [{ id: BOT_ID, username: BOT.username, display_name: BOT.display_name, description: BOT.description, avatar_url: null }] }
          : { body: [] };
      }
      if (name === "bot_callback_press") {
        if (options.pressMissing) return missingFunction("bot_callback_press");
        return options.press ?? { body: null };
      }
      return undefined;
    },
  });
}

async function openBotChat(page: Page, chatId: string) {
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
}

test.describe("what a bot offers reaches the person", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  // -------------------------------------------------------------------------
  // D-125
  // -------------------------------------------------------------------------

  test("a bot's inline keyboard is drawn under its message, in the rows the bot laid out", async ({ page }) => {
    await seed(page);
    await openBotChat(page, CHAT_STARTED);

    const keyboard = page.locator('[data-bot-keyboard="true"]');
    await expect(keyboard).toBeVisible();
    await expect(keyboard.locator("button")).toHaveCount(3);
    await expect(keyboard.locator("button").nth(0)).toHaveText("Выйду");
    await expect(keyboard.locator("button").nth(1)).toHaveText("Не смогу");
    await expect(keyboard.locator("button").nth(2)).toHaveText("Перенести");

    // Under the bubble, not inside it, and part of the same message.
    const bubble = page.locator(`[data-message-id="${KEYBOARD_MESSAGE}"] [data-message-bubble="true"]`);
    await expect(bubble).toContainText(QUESTION);
    expect(await bubble.locator('[data-bot-keyboard="true"]').count()).toBe(0);
    const bubbleBox = (await bubble.boundingBox())!;
    const keyboardBox = (await keyboard.boundingBox())!;
    expect(keyboardBox.y).toBeGreaterThanOrEqual(bubbleBox.y + bubbleBox.height - 1);

    // The rows are the bot's: two buttons on one line, one on the next.
    const first = (await keyboard.locator("button").nth(0).boundingBox())!;
    const second = (await keyboard.locator("button").nth(1).boundingBox())!;
    const third = (await keyboard.locator("button").nth(2).boundingBox())!;
    expect(Math.abs(first.y - second.y)).toBeLessThan(2);
    expect(third.y).toBeGreaterThan(first.y + first.height - 1);

    // A finger's target, on the projects that emulate one.
    const coarse = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
    expect(first.height).toBeGreaterThanOrEqual(coarse ? 44 : 36);
  });

  test("a press says so on its own button, and the bot's answer arrives as a confirmation", async ({ page }) => {
    await seed(page, { press: { body: { text: "Смена подтверждена", show_alert: false } } });
    // The press is held open from the test rather than delayed by a timer.
    // Measured first with a 600ms delay, and that version could not fail: every
    // Playwright assertion retries, so «the other button is still enabled» went
    // on polling until the press had finished and the button was enabled again
    // — a check that passes whatever the product does. The gate keeps the
    // in-flight state standing while both assertions are made.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/rest/v1/rpc/bot_callback_press", async (route) => {
      await held;
      await route.fallback();
    });
    await openBotChat(page, CHAT_STARTED);

    const keyboard = page.locator('[data-bot-keyboard="true"]');
    const pressed = keyboard.locator('[data-bot-keyboard-button="0:0"]');
    const sibling = keyboard.locator('[data-bot-keyboard-button="0:1"]');
    await pressed.click();

    await expect(pressed).toHaveAttribute("data-bot-keyboard-busy", "true");
    await expect(pressed, "the button that was pressed stops taking a second press").toBeDisabled();
    await expect(sibling).toHaveAttribute("data-bot-keyboard-busy", "false");
    await expect(sibling, "one press in flight must not freeze the bot's whole question").toBeEnabled();

    release();
    await expect(page.getByText("Смена подтверждена")).toBeVisible();
    await expect(pressed).toHaveAttribute("data-bot-keyboard-busy", "false");
    await expect(pressed).toBeEnabled();
  });

  test("an answer the bot asked to be acknowledged is a dialog, not a passing line", async ({ page }) => {
    await seed(page, { press: { body: { text: "Смена уже занята", show_alert: true } } });
    await openBotChat(page, CHAT_STARTED);

    await page.locator('[data-bot-keyboard-button="0:0"]').click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Смена уже занята" });
    await expect(dialog).toBeVisible();
  });

  test("a failed press puts the button back and says why", async ({ page }) => {
    await seed(page, {
      press: { status: 500, body: { code: "XX000", message: "upstream unavailable", details: null, hint: null } },
    });
    await openBotChat(page, CHAT_STARTED);

    const pressed = page.locator('[data-bot-keyboard-button="0:0"]');
    await pressed.click();
    await expect(page.getByText("Не удалось нажать кнопку. Попробуйте ещё раз.")).toBeVisible();
    await expect(pressed, "the press must not be swallowed").toBeEnabled();
    await expect(pressed).toHaveAttribute("data-bot-keyboard-busy", "false");
  });

  test("a deployment with no way to deliver a press says so once, under the keyboard", async ({ page }) => {
    // Exactly the state production is in: `bot_update_enqueue_internal` is
    // service_role only and no wrapper exists, so PostgREST answers PGRST202.
    await seed(page, { pressMissing: true });
    await openBotChat(page, CHAT_STARTED);

    const keyboard = page.locator('[data-bot-keyboard="true"]');
    await expect(keyboard).toHaveAttribute("data-bot-keyboard-state", "ready");
    await keyboard.locator('[data-bot-keyboard-button="0:0"]').click();

    await expect(keyboard).toHaveAttribute("data-bot-keyboard-state", "unavailable");
    await expect(keyboard.getByText("Кнопки этого бота пока не работают.")).toBeVisible();
    await expect(keyboard.locator('[data-bot-keyboard-button="0:1"]')).toBeDisabled();
    // The bot's question stays readable; only the answering stops.
    await expect(page.locator(`[data-message-id="${KEYBOARD_MESSAGE}"]`)).toContainText(QUESTION);
    await expect(keyboard.locator('[data-bot-keyboard-button="0:0"]')).toHaveText("Выйду");
  });

  // -------------------------------------------------------------------------
  // D-126
  // -------------------------------------------------------------------------

  test("a bot chat has a menu of its commands, and choosing one fills the field without sending", async ({ page }) => {
    const fixture = await seed(page);
    await openBotChat(page, CHAT_STARTED);

    const menuButton = page.getByTestId("bot-commands-button");
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    const menu = page.getByTestId("bot-command-menu");
    await expect(menu).toHaveAttribute("data-bot-command-variant", "menu");
    await expect(menu.locator("[data-bot-command]")).toHaveCount(3);
    await expect(menu).toContainText("/shift");
    await expect(menu).toContainText("Ближайшая смена");
    await expect(menu).toContainText("/about");
    await expect(menu).toContainText("О боте");

    await menu.locator('[data-bot-command="shift"]').click();
    const field = page.locator("textarea");
    await expect(field).toHaveValue("/shift ");
    await expect(page.getByTestId("bot-command-menu")).toHaveCount(0);
    expect(
      fixture.restCalls("messages", "POST"),
      "choosing a command must not send it; a command that takes an argument would be unusable",
    ).toHaveLength(0);
  });

  test("«/» in the field filters the same list", async ({ page }) => {
    await seed(page);
    await openBotChat(page, CHAT_STARTED);

    // The bot's menu button first: it is the proof that this chat's composer is
    // mounted and its bot has loaded. Filling before that, the chat's own draft
    // effect runs afterwards and clears the field — measured, not supposed.
    await expect(page.getByTestId("bot-commands-button")).toBeVisible();
    const field = page.locator("textarea");
    await field.fill("/shift");
    const menu = page.getByTestId("bot-command-menu");
    await expect(menu).toHaveAttribute("data-bot-command-variant", "typed");
    await expect(menu.locator("[data-bot-command]")).toHaveCount(2);
    await expect(menu.locator('[data-bot-command="about"]')).toHaveCount(0);

    await field.fill("/shift 12");
    await expect(page.getByTestId("bot-command-menu"), "a command with an argument has finished asking").toHaveCount(0);

    await field.fill("/zzz");
    await expect(page.getByTestId("bot-command-menu")).toContainText("Нет подходящих команд.");
  });

  /**
   * D-246. The composer's hints are Radix popovers portalled to the body at
   * `z-50`; the command menu is an ordinary box inside the composer. At 390 the
   * two open into the same corner, and the plate painted across the menu — of a
   * three-command bot, the bottom two rows survived as a ⚡ and a sliver of «/».
   *
   * Three assertions, because the fix has to be a suppression and not a
   * removal: the plate is up before the menu opens, gone while it is open, and
   * back afterwards. The third is the one that tells `withdraw` from `dismiss`
   * — `useHint` withdraws an offer that is no longer enabled without spending
   * or dismissing it, so the hint still has its budget when the menu shuts.
   *
   * Phone projects only: the plate is offered on a coarse pointer below `md`
   * and nowhere else, so on a desktop viewport there is nothing to collide.
   */
  test("the recorder hint steps aside while the bot's command menu is open", async ({ page }, testInfo) => {
    test.skip(
      !testInfo.project.name.includes("mobile"),
      "the recorder hint is offered on a coarse pointer below md; a desktop viewport never draws it",
    );
    await seed(page);
    await openBotChat(page, CHAT_STARTED);

    const plate = page.getByTestId("kub-hint");
    const menuButton = page.getByTestId("bot-commands-button");
    await expect(menuButton).toBeVisible();
    await expect(plate, "the hint has to be up first, or this test proves nothing").toBeVisible();

    await menuButton.click();
    const menu = page.getByTestId("bot-command-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator("[data-bot-command]")).toHaveCount(3);
    await expect(
      plate,
      "the recorder hint is painting over the command menu again",
    ).toHaveCount(0);

    // Every row readable, which is what the defect took away. `toBeVisible`
    // alone would pass on a row behind the plate, so the boxes are compared:
    // nothing portalled may overlap the menu.
    const clear = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="bot-command-menu"]')?.getBoundingClientRect();
      if (!box) return null;
      return [...document.querySelectorAll("[data-radix-popper-content-wrapper]")]
        .map((node) => node.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .filter((r) => r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top)
        .length;
    });
    expect(clear, "a portalled layer still overlaps the command menu's box").toBe(0);

    // Closed again, and the hint comes back rather than having been spent.
    await menuButton.click();
    await expect(menu).toHaveCount(0);
    await expect(
      plate,
      "the hint did not come back, so it was dismissed or spent rather than withdrawn",
    ).toBeVisible();
  });

  test("a bot with no commands says so rather than opening an empty menu", async ({ page }) => {
    await seed(page, { commands: [] });
    await openBotChat(page, CHAT_STARTED);

    await page.getByTestId("bot-commands-button").click();
    await expect(page.getByTestId("bot-command-menu")).toContainText("У этого бота пока нет команд.");
  });

  test("a chat without a bot has no menu button and no «/» list", async ({ page }) => {
    await openFixture(page, {
      me: ME,
      chats: [chat(CHAT_STARTED, "group", "Команда", AT)],
      memberships: [membership(CHAT_STARTED, ME, "owner", AT)],
      messages: [message("55555555-5555-4555-8555-00000000b009", CHAT_STARTED, ME, "Привет", AT)],
    });
    await openBotChat(page, CHAT_STARTED);

    await expect(page.locator("textarea")).toBeVisible();
    await expect(page.getByTestId("bot-commands-button")).toHaveCount(0);
    await page.locator("textarea").fill("/sh");
    await expect(page.getByTestId("bot-command-menu")).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // D-127
  // -------------------------------------------------------------------------

  test("a bot nobody has written to shows «Запустить» in place of the composer, and it sends /start", async ({ page }) => {
    const fixture = await seed(page);
    await openBotChat(page, CHAT_FRESH);

    const start = page.getByTestId("bot-start-button");
    await expect(start).toBeVisible();
    await expect(start).toHaveText("Запустить");
    await expect(page.locator("textarea"), "the composer is replaced, not shown beside it").toHaveCount(0);
    await expect(page.getByTestId("bot-commands-button")).toHaveCount(0);

    await start.click();
    await expect
      .poll(() => fixture.restCalls("messages", "POST").length)
      .toBeGreaterThan(0);
    const sent = fixture.restCalls("messages", "POST")[0].body as Record<string, unknown>;
    const row = (Array.isArray(sent) ? sent[0] : sent) as { content?: unknown };
    expect(row.content).toBe("/start");
  });

  // -------------------------------------------------------------------------
  // D-247
  // -------------------------------------------------------------------------

  /**
   * A bot the authoriser will not deliver to offers nothing.
   *
   * `private.bot_can_receive_message` requires `bots.state = 'active'`, so a
   * paused or deleted bot takes a command and drops it — no error, no reply,
   * nothing. `fetchChatBots` already filtered the state for the sidebar's «Бот»
   * mark and `useBotChat` did not, and two readers of one fact disagreeing is
   * the whole of the entry.
   *
   * Every state but `active` is checked, because the CHECK on the column lists
   * five and only one of them is deliverable: pinning `paused` alone would let
   * a filter written as «not deleted» pass.
   */
  for (const state of ["paused", "suspended", "pending_delete", "deleted"] as const) {
    test(`a ${state} bot offers no commands, because nothing it is sent arrives`, async ({ page }) => {
      await seed(page, { botState: state });
      await openBotChat(page, CHAT_STARTED);

      // The composer is there and ordinary — this is a chat, and a chat whose
      // bot is off is not a broken screen.
      await expect(page.locator("textarea")).toBeVisible();
      await expect(page.getByTestId("bot-commands-button")).toHaveCount(0);

      // And «/» opens nothing either. The button and the slash are two doors
      // onto one list; closing one of them would be half a fix.
      await page.locator("textarea").fill("/shift");
      await expect(page.getByTestId("bot-command-menu")).toHaveCount(0);
    });
  }

  /**
   * The same rule on the other composer: `/start` is a message like any other,
   * and `private.bot_can_receive_message` drops it for the same reason.
   *
   * The waits are the whole difficulty. «No start button» is true the instant
   * the chat opens, because `useBotChat` has not answered yet and a composer
   * with no bot is an ordinary composer — so asserting it straight away proves
   * only that the page is fast. The membership read is therefore waited for by
   * name, and then the frame is given time to become the wrong one: measured
   * against the state filter removed, the button is up well inside this, and
   * without the wait that mutation stayed green.
   */
  test("a disabled bot is not offered «Запустить» either, since /start would not arrive", async ({ page }) => {
    const fixture = await seed(page, { botState: "paused" });
    await openBotChat(page, CHAT_FRESH);

    await expect.poll(() => fixture.restCalls("chat_bot_members", "GET").length).toBeGreaterThan(0);
    await page.waitForTimeout(1500);

    await expect(page.getByTestId("bot-start-button")).toHaveCount(0);
    await expect(page.locator("textarea"), "the ordinary composer stands in its place").toBeVisible();
    await expect(page.getByTestId("bot-commands-button")).toHaveCount(0);
  });

  test("a bot found in search opens its chat instead of a modal", async ({ page }) => {
    await seed(page, { searchBots: true });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const input = page.getByTestId("sidebar-search-input");
    await input.click();
    await input.fill("shiftbot");
    const botSection = page.locator('section[data-search-section="bot"]');
    await expect(botSection).toBeVisible();
    await botSection.getByText("Смены", { exact: true }).click();

    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { useAppStore } = await import("/src/store/app.store.ts");
          return useAppStore.getState().selectedChatId;
        }),
      )
      .toBe(CHAT_STARTED);
    await expect(page.getByRole("dialog").filter({ hasText: "пока недоступн" })).toHaveCount(0);
  });

  test("a bot with no chat yet says what is not available rather than opening nothing", async ({ page }) => {
    // The deployment today: no INSERT on `chat_bot_members` and no
    // `open_or_create_bot_chat`, so the create is asked for and nothing answers.
    await openFixture(page, {
      me: ME,
      chats: [],
      memberships: [],
      messages: [],
      rest: ({ resource, method }) =>
        method === "GET" && resource === "chat_bot_members" ? { status: 200, body: [] } : undefined,
      rpc: (name) => {
        if (name === "search_public_bots") {
          return { body: [{ id: BOT_ID, username: BOT.username, display_name: BOT.display_name, description: BOT.description, avatar_url: null }] };
        }
        if (name === "open_or_create_bot_chat") return missingFunction("open_or_create_bot_chat");
        return undefined;
      },
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const input = page.getByTestId("sidebar-search-input");
    await input.click();
    await input.fill("shiftbot");
    await page.locator('section[data-search-section="bot"]').getByText("Смены", { exact: true }).click();
    await expect(page.getByRole("dialog").filter({ hasText: "Чат с ботом пока недоступен." })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // D-263
  // -------------------------------------------------------------------------

  /**
   * A bot's answers are not three more messages from it.
   *
   * Until 2026-09-20 the keyboard button took `--kub-message-in` bare — the
   * identical token the bubble above it takes — so the fill step between the
   * question and its answers was exactly nothing. Probed at 1440: bubble
   * rgb(30,38,64) and button rgb(30,38,64) in the dark theme, rgb(255,255,255)
   * and rgb(255,255,255) in the light one. Photographed, both steps measured
   * **0.00**, and three answers under a question read as three more bubbles.
   *
   * Measured from pixels rather than from tokens, which is rule 7 of
   * `docs/operations/interface-material.md`: the bubble and the button are both
   * opaque here today, but either could stop being, and a comparison of two
   * computed `background-color` strings would go on agreeing while the render
   * diverged. What the reader sees is the composite.
   *
   * The floor is 10 rather than rule 11's 23. 23 is the step by which a *panel*
   * stands off the *page* — the largest relationship in the product — and a
   * control inside a message is not that. What the button rests on is one
   * `--kub-raise-veil`, the same single layer `KubButton`'s `secondary` rests
   * on against its panel, which composites to a step of 14.67 in the dark theme
   * and 14.00 in the light one. 10 is under both with room for antialiasing and
   * above the 0.00 this exists to catch.
   */
  for (const theme of ["dark", "light"] as const) {
    test(`a bot's answers stand off the question it asked — ${theme}`, async ({ page }) => {
      await seed(page);
      // `openFixture` seeds the dark theme; a later init script wins.
      await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), theme);
      await openBotChat(page, CHAT_STARTED);
      await expect(page.locator('[data-bot-keyboard="true"]')).toBeVisible();

      const boxes = await page.evaluate(() => {
        const bubble = document.querySelector('[data-message-bubble="true"]') as HTMLElement;
        const button = document.querySelector('[data-bot-keyboard-button="0:0"]') as HTMLElement;
        return {
          bubble: bubble.getBoundingClientRect().toJSON(),
          button: button.getBoundingClientRect().toJSON(),
          ink: getComputedStyle(button).color,
          rest: getComputedStyle(button).backgroundImage,
          hoverable: window.matchMedia("(hover: hover)").matches,
        };
      });

      const shot = await page.screenshot();
      const raw = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width, channels } = raw.info;
      const scale = width / (page.viewportSize()?.width ?? width);
      /**
       * The most common pixel inside a box with its own ink thrown out — the
       * method `profile-badge-colour.spec.ts` established, and for its reason:
       * on a scaled device a glyph's strokes are several device pixels of one
       * flat colour, so the words would otherwise win the tally.
       */
      const ground = (box: { x: number; y: number; width: number; height: number }) => {
        const ink = boxes.ink.match(/[\d.]+/g)!.slice(0, 3).map(Number);
          const left = Math.round((box.x + 3) * scale);
        const top = Math.round((box.y + 3) * scale);
        const right = Math.round((box.x + box.width - 3) * scale);
        const bottom = Math.round((box.y + box.height - 3) * scale);
        const tally = new Map<string, number>();
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            const at = (y * width + x) * channels;
            const px = [raw.data[at], raw.data[at + 1], raw.data[at + 2]];
            if (px.every((v, i) => Math.abs(v - ink[i]) <= 24)) continue;
            const key = px.join(",");
            tally.set(key, (tally.get(key) ?? 0) + 1);
          }
        }
        expect(tally.size, "the box has no pixel that is not its own ink").toBeGreaterThan(0);
        return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
      };

      const bubbleGround = ground(boxes.bubble);
      const buttonGround = ground(boxes.button);
      const step = bubbleGround.reduce((sum, v, i) => sum + Math.abs(v - buttonGround[i]), 0) / 3;
      expect(
        step,
        `a bot's answer is drawn rgb(${buttonGround.join(",")}) on a question drawn `
          + `rgb(${bubbleGround.join(",")}), a step of ${step.toFixed(2)}. The keyboard has gone flush `
          + `with the bubble it hangs under, which is what D-263 measured: the answers read as more `
          + `messages from the bot.`,
      ).toBeGreaterThanOrEqual(10);

      // And the resting step is not the hover's own layer, which is the trap
      // `edge-vocabulary.test.mjs` names: `.kub-raise` and `.kub-raise-hover`
      // set the SAME single-layer background-image, so a control carrying both
      // wears its hover at rest and the hover stops existing. «Новый канал»
      // shipped exactly that before it was probed.
      expect(boxes.rest, "the keyboard button rests flat again").not.toBe("none");
      if (boxes.hoverable) {
        await page.locator('[data-bot-keyboard-button="0:0"]').hover();
        const hovered = await page.evaluate(
          () => getComputedStyle(document.querySelector('[data-bot-keyboard-button="0:0"]') as HTMLElement).backgroundImage,
        );
        expect(
          hovered.split("linear-gradient").length,
          `the button rests on ${boxes.rest} and hovers on ${hovered} — the same layer, so the hover has stopped existing`,
        ).toBeGreaterThan(boxes.rest.split("linear-gradient").length);
      }
    });
  }
});
