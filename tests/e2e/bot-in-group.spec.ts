import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  FIXTURE_HOST,
  type Fixture,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * A bot in a group, and the two surfaces that took it for a bot chat
 * (D-243, D-244).
 *
 * A bot in a group is a state that could not exist before
 * `20260919010000_a_bot_can_be_put_in_a_group.sql` shipped on 2026-09-19. The
 * rest of the product had been written for the only bot chat it could reach
 * until then — a private one — and both composer surfaces read «this chat holds
 * a bot» while meaning «this chat is a bot»:
 *
 *   - D-243: `botChatNeedsStart` replaced the whole composer with «Запустить»
 *     for anybody who had not yet written. In a conversation with a bot that
 *     means «you have not started it»; in a group it means «you have been
 *     reading», and a reader lost the message field, the attach button and the
 *     voice recorder.
 *   - D-244: the command menu filled the field with a bare `/shift`.
 *     `private.bot_can_receive_message`'s restricted branch — the only kind of
 *     membership `chat_bot_add` creates — admits `/command@username`, an
 *     `@username` mention or a reply to the bot's own message, and nothing
 *     else. So the command was sent, shown in the conversation, and never
 *     delivered. The exact strings asserted here were run against the live
 *     function on production, read-only, on 2026-09-19.
 *
 * Every test carries a control, because both defects are a difference between
 * two chats rather than one chat being wrong: the same bot, the same commands,
 * the same reader, in a group and in a private chat.
 *
 * Needs the dev server on the fixture host; the helper refuses any other
 * configuration.
 */

const AT = "2026-09-18T09:00:00.000Z";

const ME = person("11111111-1111-4111-8111-00000000d001", "Максим Орлов", "maksim");
const MATE = person("11111111-1111-4111-8111-00000000d002", "Анна Лебедева", "anna");

const BOT_ID = "33333333-3333-4333-8333-00000000d001";
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

/** The second bot, for the group that holds two. It joined later. */
const OTHER_BOT_ID = "33333333-3333-4333-8333-00000000d002";
const OTHER_BOT = { ...BOT, id: OTHER_BOT_ID, username: "dutybot", display_name: "Дежурства" };

/** A group holding the bot, in which this reader has never written. */
const GROUP = "22222222-2222-4222-8222-00000000d001";
/** The control: a group with no bot at all. */
const PLAIN_GROUP = "22222222-2222-4222-8222-00000000d002";
/** A conversation with the same bot that nobody has written in. */
const DIRECT_FRESH = "22222222-2222-4222-8222-00000000d003";
/** A conversation with the same bot that has been used. */
const DIRECT_STARTED = "22222222-2222-4222-8222-00000000d004";

const COMMANDS = [
  { command: "shift", description: "Ближайшая смена", sort_order: 0 },
  { command: "shifts", description: "Все смены на неделю", sort_order: 1 },
];
const OTHER_COMMANDS = [{ command: "duty", description: "Кто дежурит", sort_order: 0 }];

interface Options {
  /** True puts a second bot in the group, joined after the first. */
  twoBots?: boolean;
  /** True gives the group a message from this reader. */
  iHaveWritten?: boolean;
}

interface Seeded {
  fixture: Fixture;
  /** Whose commands were asked for, in order, as `bot_id=eq.…` said. */
  commandReads: string[];
}

async function seed(page: Page, options: Options = {}): Promise<Seeded> {
  const messages: Row[] = [
    message("55555555-5555-4555-8555-00000000d001", GROUP, MATE, "Собираемся в четверг", "2026-09-18T10:00:00.000Z"),
    message("55555555-5555-4555-8555-00000000d002", PLAIN_GROUP, MATE, "И тут тоже", "2026-09-18T10:00:00.000Z"),
    message("55555555-5555-4555-8555-00000000d004", DIRECT_STARTED, ME, "Привет", "2026-09-18T10:00:00.000Z"),
  ];
  if (options.iHaveWritten) {
    messages.push(
      message("55555555-5555-4555-8555-00000000d003", GROUP, ME, "Буду", "2026-09-18T10:05:00.000Z"),
    );
  }

  const fixture = await openFixture(page, {
    me: ME,
    chats: [
      chat(GROUP, "group", "Четверг", AT),
      chat(PLAIN_GROUP, "group", "Без ботов", AT),
      chat(DIRECT_FRESH, "private", "Напоминания", AT),
      chat(DIRECT_STARTED, "private", "Смены", AT),
    ],
    memberships: [
      membership(GROUP, ME, "member", AT),
      membership(GROUP, MATE, "owner", AT),
      membership(PLAIN_GROUP, ME, "member", AT),
      membership(PLAIN_GROUP, MATE, "owner", AT),
      membership(DIRECT_FRESH, ME, "owner", AT),
      membership(DIRECT_STARTED, ME, "owner", AT),
    ],
    messages,
  });

  /**
   * The memberships this deployment holds, as `chat_bot_members` rows.
   *
   * The shape PostgREST answers for `select=bot_id,joined_at,bot:bots(username)`
   * and for the sidebar's own `select=chat_id,bot:bots(…)` alike; each reader
   * picks out the columns it asked for.
   */
  const memberRows: Row[] = [
    { chat_id: GROUP, bot_id: BOT_ID, joined_at: AT, removed_at: null, bot: BOT },
    { chat_id: DIRECT_FRESH, bot_id: BOT_ID, joined_at: AT, removed_at: null, bot: BOT },
    { chat_id: DIRECT_STARTED, bot_id: BOT_ID, joined_at: AT, removed_at: null, bot: BOT },
  ];
  if (options.twoBots) {
    memberRows.push({
      chat_id: GROUP,
      bot_id: OTHER_BOT_ID,
      // Later than the first, so «the one that joined first» has an answer that
      // does not depend on the order of this array.
      joined_at: "2026-09-18T12:00:00.000Z",
      removed_at: null,
      bot: OTHER_BOT,
    });
  }

  // Both bot tables are filtered server-side in production, and the filter is
  // the whole point in two of these tests — a group with no bot must be
  // answered nothing rather than another group's row, and a chat holding two
  // bots must be answered both. The fixture's own `rest` hook is not given the
  // query string, so these two are routed here. Registered after
  // `openFixture`, and Playwright matches routes newest first, so they win.
  await page.route(`${FIXTURE_HOST}/rest/v1/chat_bot_members*`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const filter = new URL(route.request().url()).searchParams.get("chat_id") ?? "";
    const wanted = new Set<string>();
    if (filter.startsWith("eq.")) wanted.add(filter.slice(3));
    else if (filter.startsWith("in.")) {
      for (const id of filter.slice(3).replace(/^\(/, "").replace(/\)$/, "").split(",")) {
        wanted.add(id.replace(/^"|"$/g, ""));
      }
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(memberRows.filter((row) => wanted.has(row.chat_id as string))),
    });
  });

  const commandReads: string[] = [];
  await page.route(`${FIXTURE_HOST}/rest/v1/bot_commands*`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const filter = new URL(route.request().url()).searchParams.get("bot_id") ?? "";
    const botId = filter.startsWith("eq.") ? filter.slice(3) : filter;
    commandReads.push(botId);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(botId === OTHER_BOT_ID ? OTHER_COMMANDS : COMMANDS),
    });
  });

  return { fixture, commandReads };
}

async function openChat(page: Page, chatId: string) {
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

/** What a message POST carried, whether PostgREST was sent a row or an array. */
function sentContent(fixture: Fixture, index = 0): unknown {
  const body = fixture.restCalls("messages", "POST")[index].body as Record<string, unknown>;
  return ((Array.isArray(body) ? body[0] : body) as { content?: unknown }).content;
}

test.describe("a bot in a group", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  // -------------------------------------------------------------------------
  // D-243
  // -------------------------------------------------------------------------

  test("a group member who has never written keeps the composer the group has always had (D-243)", async ({ page }) => {
    await seed(page);
    await openChat(page, GROUP);
    await expect(page.getByText("Собираемся в четверг").first()).toBeVisible();

    // The bot is loaded — its menu button is the proof — and the composer is
    // still a composer. Before the fix this was one «Запустить» button and
    // nothing else: no field, no attach, no recorder.
    await expect(page.getByTestId("bot-commands-button")).toBeVisible();
    await expect(page.getByTestId("bot-start-button")).toHaveCount(0);
    await expect(page.locator("textarea")).toBeVisible();
    await expect(page.getByTestId("composer-recorder-button")).toBeVisible();
  });

  test("the control: the same bot in a conversation still offers «Запустить» (D-243)", async ({ page }) => {
    const { fixture } = await seed(page);
    await openChat(page, DIRECT_FRESH);

    // Nobody has written in this one either, and here that really does mean the
    // bot has not been started. The fix narrows the button to this chat; it
    // does not remove it.
    const start = page.getByTestId("bot-start-button");
    await expect(start).toBeVisible();
    await expect(start).toHaveText("Запустить");
    await expect(page.locator("textarea"), "the composer is replaced, not shown beside it").toHaveCount(0);

    await start.click();
    await expect.poll(() => fixture.restCalls("messages", "POST").length).toBeGreaterThan(0);
    expect(sentContent(fixture), "a private chat delivers a bare /start; no address is needed").toBe("/start");
  });

  test("the other control: a group with no bot has no bot surfaces at all (D-243)", async ({ page }) => {
    await seed(page);
    await openChat(page, PLAIN_GROUP);
    await expect(page.getByText("И тут тоже").first()).toBeVisible();

    await expect(page.getByTestId("bot-start-button")).toHaveCount(0);
    await expect(page.getByTestId("bot-commands-button")).toHaveCount(0);
    await expect(page.locator("textarea")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // D-244
  // -------------------------------------------------------------------------

  test("in a group the command menu names the bot, and sends it that way (D-244)", async ({ page }) => {
    const { fixture } = await seed(page);
    await openChat(page, GROUP);

    const menuButton = page.getByTestId("bot-commands-button");
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    const menu = page.getByTestId("bot-command-menu");
    await expect(menu).toBeVisible();
    await menu.locator('[data-bot-command="shift"]').click();

    const field = page.locator("textarea");
    await expect(
      field,
      "a bare /shift matches no branch of private.bot_can_receive_message",
    ).toHaveValue("/shift@shiftbot ");
    expect(fixture.restCalls("messages", "POST"), "choosing still must not send").toHaveLength(0);

    // And what actually goes on the wire, because the field is only half the
    // claim: the composer trims, and the delivery rule is anchored at the start
    // of the trimmed content.
    await field.press("Enter");
    await expect.poll(() => fixture.restCalls("messages", "POST").length).toBeGreaterThan(0);
    expect(sentContent(fixture)).toBe("/shift@shiftbot");
  });

  test("the control: the same command in a conversation with the bot stays bare (D-244)", async ({ page }) => {
    await seed(page);
    await openChat(page, DIRECT_STARTED);

    await page.getByTestId("bot-commands-button").click();
    await page.getByTestId("bot-command-menu").locator('[data-bot-command="shift"]').click();
    await expect(
      page.locator("textarea"),
      "chat.type = 'private' short-circuits the restricted branch; an address here is noise",
    ).toHaveValue("/shift ");
  });

  test("«/» typed in a group inserts the same addressed command (D-244)", async ({ page }) => {
    await seed(page, { iHaveWritten: true });
    await openChat(page, GROUP);
    await expect(page.getByTestId("bot-commands-button")).toBeVisible();

    const field = page.locator("textarea");
    await field.fill("/shi");
    const menu = page.getByTestId("bot-command-menu");
    await expect(menu).toHaveAttribute("data-bot-command-variant", "typed");
    await menu.locator('[data-bot-command="shift"]').click();
    await expect(field).toHaveValue("/shift@shiftbot ");
  });

  test("with two bots in the group, the address names the bot whose command it is (D-244)", async ({ page }) => {
    const { commandReads } = await seed(page, { twoBots: true });
    await openChat(page, GROUP);

    // The composer has room for one bot's menu, so one is chosen: the bot that
    // joined first. What matters is that the commands and the name come from
    // the same membership row — addressing @dutybot with a command only
    // @shiftbot knows would be the same silence D-244 is about, with a
    // plausible string on screen.
    await expect(page.getByTestId("bot-commands-button")).toBeVisible();
    expect(commandReads, "the earlier membership is the one loaded").toEqual([BOT_ID]);

    await page.getByTestId("bot-commands-button").click();
    const menu = page.getByTestId("bot-command-menu");
    await expect(menu.locator('[data-bot-command="duty"]')).toHaveCount(0);
    await menu.locator('[data-bot-command="shift"]').click();
    await expect(page.locator("textarea")).toHaveValue("/shift@shiftbot ");
  });
});
