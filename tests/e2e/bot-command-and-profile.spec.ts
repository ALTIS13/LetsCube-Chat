import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Fixture,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * D-263's three complaints, each pressed rather than described.
 *
 * The entry records them as: a sent `/command` is inert text, a hand-typed
 * `/cmd` in a group is silently dropped, and a bot's profile answers nothing.
 * The first two are one mechanism seen from both ends — the authoriser's
 * grammar, `private.bot_can_receive_message` — and the third is a surface.
 *
 * **Why the assertions are on what went out and on what is on the screen**,
 * never on an identifier: four source-scanning guards in this repository
 * survived a mutation pass in September by matching a name that outlived the
 * thing it named. Every test below either reads the body of a POST to
 * `messages` or reads the rendered DOM.
 *
 * The authoriser's rule these rest on, read off
 * `.migration-backup/supabase/migrations/20260920120000_bot_full_visibility_request_removal.sql`:
 * a `restricted` membership — which is the only kind `chat_bot_add` can create
 * — admits a message only when its lowered content matches
 * `^/[a-z][a-z0-9_]{0,31}@<username>([[:space:]]|$)`, or mentions the bot, or
 * replies to it. `chat.type = 'private'` short-circuits the whole branch.
 *
 * Needs the dev server on the fixture host; it mocks the backend and refuses
 * any other configuration.
 */

const AT = "2026-09-21T09:00:00.000Z";

const ME = person("11111111-1111-4111-8111-00000000c001", "Максим Орлов", "maksim");
const MATE = person("11111111-1111-4111-8111-00000000c002", "Анна Лебедева", "anna");

const BOT_ID = "33333333-3333-4333-8333-00000000c001";
const BOT = {
  id: BOT_ID,
  username: "shiftbot",
  display_name: "Смены",
  description: "Присылаю смены и напоминания о них.",
  avatar_url: null,
  state: "active",
  created_at: AT,
  updated_at: AT,
};

/** A conversation with the bot: the authoriser needs no address here. */
const PRIVATE_CHAT = "22222222-2222-4222-8222-00000000c001";
/** A room that merely contains it: every command has to name it. */
const GROUP_CHAT = "22222222-2222-4222-8222-00000000c002";

const COMMANDS = [
  { command: "shift", description: "Ближайшая смена", sort_order: 0 },
  { command: "shifts", description: "Все смены на неделю", sort_order: 1 },
];

/**
 * The bot's own message, carrying two commands and one thing that is not one.
 *
 * `/report` is the control: it has the shape of a command and no bot
 * registered it, so it must stay text. Without it a tokenizer that made every
 * slash-word pressable would pass every other assertion here.
 */
const OFFER = "Напишите /shift для ближайшей смены, /shifts для недели, /report для отчёта.";
const BOT_MESSAGE = "55555555-5555-4555-8555-00000000c001";

/**
 * The boundary cases, in one message.
 *
 * A command begins a word or it is not a command: `private.bot_can_receive_message`
 * anchors at position 0, and a slash in the middle of something is a slash.
 * Both halves are here because they fail differently — `смены/shift` would be a
 * control drawn inside a word, and the URL's own `/shift` would be one drawn
 * inside a link.
 */
const EDGES = "График: смены/shift и https://example.com/shift — это не команды.";
const EDGES_MESSAGE = "55555555-5555-4555-8555-00000000c005";

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

interface Options {
  commands?: typeof COMMANDS;
  botState?: string;
}

async function seed(page: Page, options: Options = {}): Promise<Fixture> {
  const commands = options.commands ?? COMMANDS;
  const botState = options.botState ?? BOT.state;
  return openFixture(page, {
    me: ME,
    people: [MATE],
    chats: [
      chat(PRIVATE_CHAT, "private", "Смены", AT),
      chat(GROUP_CHAT, "group", "Бригада", AT),
    ],
    memberships: [
      membership(PRIVATE_CHAT, ME, "owner", AT),
      membership(GROUP_CHAT, ME, "owner", AT),
      membership(GROUP_CHAT, MATE, "member", AT),
    ],
    messages: [
      // Before the offer, not after it: the author's face is drawn on the
      // LAST message of a run, so a later bot message would take the avatar
      // off the row the profile tests press.
      botMessage(EDGES_MESSAGE, PRIVATE_CHAT, EDGES, "2026-09-21T09:59:00.000Z"),
      botMessage(BOT_MESSAGE, PRIVATE_CHAT, OFFER, "2026-09-21T10:00:00.000Z"),
      message("55555555-5555-4555-8555-00000000c002", PRIVATE_CHAT, ME, "Хорошо", "2026-09-21T10:05:00.000Z"),
      botMessage("55555555-5555-4555-8555-00000000c003", GROUP_CHAT, OFFER, "2026-09-21T10:00:00.000Z"),
      message("55555555-5555-4555-8555-00000000c004", GROUP_CHAT, ME, "Принято", "2026-09-21T10:05:00.000Z"),
    ],
    rest: ({ resource, method }) => {
      if (method !== "GET") return undefined;
      if (resource === "chat_bot_members") {
        return {
          status: 200,
          body: [
            { chat_id: PRIVATE_CHAT, bot_id: BOT_ID, joined_at: AT, removed_at: null, bot: { username: BOT.username, state: botState } },
            { chat_id: GROUP_CHAT, bot_id: BOT_ID, joined_at: AT, removed_at: null, bot: { username: BOT.username, state: botState } },
          ],
        };
      }
      if (resource === "bot_commands") return { status: 200, body: commands };
      if (resource === "bots") return { status: 200, body: [{ ...BOT, state: botState }] };
      return undefined;
    },
  });
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

/** The content of the nth message the client posted. */
function sentContent(fixture: Fixture, index = 0): unknown {
  const body = fixture.restCalls("messages", "POST")[index]?.body as Record<string, unknown> | undefined;
  const row = (Array.isArray(body) ? body[0] : body) as { content?: unknown } | undefined;
  return row?.content;
}

test.describe("a command in the conversation, and one typed whole (D-263)", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  // -------------------------------------------------------------------------
  // Complaint 1: a sent `/command` is inert text
  // -------------------------------------------------------------------------

  test("a command the bot registered is a control in the message, and the one it did not is text", async ({ page }) => {
    await seed(page);
    await openChat(page, PRIVATE_CHAT);

    const bubble = page.locator(`[data-message-id="${BOT_MESSAGE}"]`);
    await expect(bubble).toContainText("/report");

    // Both registered commands are pressable.
    await expect(bubble.locator('[data-bot-command-run="/shift"]')).toBeVisible();
    await expect(bubble.locator('[data-bot-command-run="/shifts"]')).toBeVisible();
    // The one nothing registered is not. A token that sent something no bot
    // answers would be the inert control §8 refuses, wearing a link's clothes.
    await expect(bubble.locator('[data-bot-command-run="/report"]')).toHaveCount(0);

    // And it is a control rather than coloured text: it is a button, and it is
    // drawn in the accent the mentions take rather than in the body colour.
    const [commandColour, bodyColour] = await page.evaluate((messageId) => {
      const row = document.querySelector(`[data-message-id="${messageId}"]`)!;
      const token = row.querySelector('[data-bot-command-run="/shift"]')!;
      const body = row.querySelector('[data-message-text-flow="true"]')!;
      return [getComputedStyle(token).color, getComputedStyle(body).color];
    }, BOT_MESSAGE);
    expect(commandColour).not.toBe(bodyColour);
    await expect(bubble.locator('button[data-bot-command-run="/shift"]')).toHaveCount(1);
  });

  test("a slash inside a word, and one inside a link, are both slashes", async ({ page }) => {
    await seed(page);
    await openChat(page, PRIVATE_CHAT);

    const row = page.locator(`[data-message-id="${EDGES_MESSAGE}"]`);
    await expect(row).toContainText("смены/shift");
    // Not one control in the whole message: the authoriser anchors at position
    // 0, so a slash that does not begin a word is a slash. The link's own
    // «/shift» is the same case wearing a different coat — it would be a
    // control drawn inside a URL.
    await expect(row.locator("[data-bot-command-run]")).toHaveCount(0);
    // And the link is still a link, so the fix did not take the URL with it.
    await expect(row.locator('a[href="https://example.com/shift"]')).toHaveCount(1);
  });

  test("pressing a command sends it, which is what the reference does", async ({ page }) => {
    // MEASURED on `P212C6000159`, 2026-09-21: tapping `/start` inside a
    // Telegram bubble sent `/start` again at once — the whole exchange
    // repeated on screen — with no confirmation and nothing put in the field.
    const fixture = await seed(page);
    await openChat(page, PRIVATE_CHAT);

    await page.locator(`[data-message-id="${BOT_MESSAGE}"] [data-bot-command-run="/shift"]`).click();
    await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(1);
    expect(sentContent(fixture)).toBe("/shift");
    // It sent rather than drafted: the composer is where it was.
    await expect(page.locator("textarea")).toHaveValue("");
  });

  test("in a group the same press names the bot, because a bare command reaches nothing", async ({ page }) => {
    const fixture = await seed(page);
    await openChat(page, GROUP_CHAT);

    await page.locator('[data-bot-command-run="/shift@shiftbot"]').first().click();
    await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(1);
    expect(sentContent(fixture)).toBe("/shift@shiftbot");
  });

  test("a chat with no bot has no command controls at all", async ({ page }) => {
    await openFixture(page, {
      me: ME,
      chats: [chat(GROUP_CHAT, "group", "Бригада", AT)],
      memberships: [membership(GROUP_CHAT, ME, "owner", AT)],
      messages: [message("55555555-5555-4555-8555-00000000c009", GROUP_CHAT, ME, OFFER, AT)],
    });
    await openChat(page, GROUP_CHAT);

    await expect(page.locator('[data-message-text-flow="true"]').first()).toContainText("/shift");
    await expect(page.locator("[data-bot-command-run]")).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // Complaint 2: a hand-typed `/cmd` in a group is silently dropped
  // -------------------------------------------------------------------------

  test("a command typed whole in a group goes out addressed, so the bot hears it", async ({ page }) => {
    const fixture = await seed(page);
    await openChat(page, GROUP_CHAT);

    const field = page.locator("textarea");
    await field.fill("/shift");
    await field.press("Enter");

    await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(1);
    expect(sentContent(fixture)).toBe("/shift@shiftbot");
  });

  test("an argument survives the address, which is what makes typing it worth the trouble", async ({ page }) => {
    const fixture = await seed(page);
    await openChat(page, GROUP_CHAT);

    const field = page.locator("textarea");
    await field.fill("/shift 12 марта");
    await field.press("Enter");

    await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(1);
    // The authoriser's own `([[:space:]]|$)` is what makes this form arrive.
    expect(sentContent(fixture)).toBe("/shift@shiftbot 12 марта");
  });

  test("what the person wrote is otherwise left exactly as written", async ({ page }) => {
    const fixture = await seed(page);
    await openChat(page, GROUP_CHAT);

    const field = page.locator("textarea");
    // Not a registered command: a joke in a group stays a joke.
    await field.fill("/report");
    await field.press("Enter");
    await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(1);
    expect(sentContent(fixture, 0)).toBe("/report");

    // Not at position 0, which is the only place the authoriser looks.
    await field.fill("напиши /shift сам");
    await field.press("Enter");
    await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(2);
    expect(sentContent(fixture, 1)).toBe("напиши /shift сам");

    // Already addressed, to somebody else. They meant that bot.
    await field.fill("/shift@otherbot");
    await field.press("Enter");
    await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(3);
    expect(sentContent(fixture, 2)).toBe("/shift@otherbot");
  });

  test("editing a message is not a new delivery, so nothing is addressed there", async ({ page }) => {
    // The mutation this exists for: dropping `isEditing` from the send path
    // stayed green through every other test in this file. An edit corrects a
    // message that was already delivered (or already dropped); rewriting its
    // text on the way would change what somebody wrote, months later, for a
    // delivery that is not going to happen. It is the same reason «/» does not
    // open the command menu while editing.
    const fixture = await seed(page);
    await openChat(page, GROUP_CHAT);

    const own = page.locator('[data-message-id="55555555-5555-4555-8555-00000000c004"]');
    await own.locator('[data-message-bubble="true"]').click({ button: "right" });
    const menu = page.locator("[data-action-menu]");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Изменить" }).click();

    const field = page.locator("textarea");
    await expect(field).toHaveValue("Принято");
    // The menu is shut here too, which is the same rule seen from the other end.
    await field.fill("/shift");
    await expect(page.getByTestId("bot-command-menu")).toHaveCount(0);
    await field.press("Enter");

    await expect.poll(() => fixture.restCalls("messages", "PATCH").length).toBe(1);
    const body = fixture.restCalls("messages", "PATCH")[0].body as Record<string, unknown>;
    expect(body.content).toBe("/shift");
    // And nothing was sent as a new message either.
    expect(fixture.restCalls("messages", "POST").length).toBe(0);
  });

  test("a conversation with the bot addresses nothing, because there it would be noise", async ({ page }) => {
    const fixture = await seed(page);
    await openChat(page, PRIVATE_CHAT);

    const field = page.locator("textarea");
    await field.fill("/shift");
    await field.press("Enter");

    await expect.poll(() => fixture.restCalls("messages", "POST").length).toBe(1);
    expect(sentContent(fixture)).toBe("/shift");
  });

  // -------------------------------------------------------------------------
  // Complaint 3: a bot's profile answers nothing
  // -------------------------------------------------------------------------

  test("a bot's face opens a card that says what it is and what it does", async ({ page }) => {
    await seed(page);
    await openChat(page, PRIVATE_CHAT);

    await page.locator(`[data-message-id="${BOT_MESSAGE}"]`).getByTestId("message-author-avatar").click();

    const card = page.getByTestId("bot-profile-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("bot-profile-name")).toHaveText("Смены");
    await expect(card.getByTestId("bot-profile-handle")).toHaveText("@shiftbot");
    await expect(card.getByTestId("bot-profile-description")).toContainText("Присылаю смены");
    // The block Telegram's card does not have and Discord's does. It is the
    // reason this card answers «what can it do» rather than only «what is it».
    await expect(card.locator("[data-bot-profile-command]")).toHaveCount(2);
    await expect(card.locator('[data-bot-profile-command="shift"]')).toContainText("Ближайшая смена");
  });

  test("the bot's name is the second anchor, exactly as a person's is", async ({ page }) => {
    await seed(page);
    await openChat(page, PRIVATE_CHAT);

    // The FIRST message of the bot's run, because that is where the name is
    // drawn — the face is on the last one. Two anchors, two rows, one card:
    // the same arrangement `MessageBubble` gives a person, and the reason
    // Discord's own popout has two importers for one person (§15.1).
    await page.locator(`[data-message-id="${EDGES_MESSAGE}"] [data-message-author="true"]`).click();
    await expect(page.getByTestId("bot-profile-card")).toBeVisible();
  });

  test("a bot's card carries none of the lines a person's does", async ({ page }) => {
    await seed(page);
    await openChat(page, PRIVATE_CHAT);
    await page.locator(`[data-message-id="${BOT_MESSAGE}"]`).getByTestId("message-author-avatar").click();

    const card = page.getByTestId("bot-profile-card");
    await expect(card).toBeVisible();
    // Presence, a standing in this chat, mutual groups, «Открыть чат» — every
    // one of them absent rather than drawn empty (§8). The card is opened from
    // inside the conversation it would open.
    await expect(card.getByTestId("member-card-presence")).toHaveCount(0);
    await expect(card.getByTestId("member-card-open-chat")).toHaveCount(0);
    await expect(card.getByTestId("profile-open-full")).toHaveCount(0);
    await expect(card).not.toContainText("Открыть чат");
  });

  test("choosing a command on the card fills the field rather than sending it", async ({ page }) => {
    // Where we differ from Discord on purpose: its sheet gives an
    // argument-free command «Отправить ➤» and an argument-taking one a form.
    // `public.bot_commands` holds no argument schema, so this product cannot
    // tell the two apart, and sending every one would make every command that
    // takes an argument unusable from the card.
    const fixture = await seed(page);
    await openChat(page, PRIVATE_CHAT);
    await page.locator(`[data-message-id="${BOT_MESSAGE}"]`).getByTestId("message-author-avatar").click();

    await page.locator('[data-bot-profile-command="shifts"]').click();

    await expect(page.locator("textarea")).toHaveValue("/shifts ");
    await expect(page.getByTestId("bot-profile-card")).toHaveCount(0);
    expect(fixture.restCalls("messages", "POST").length).toBe(0);
  });

  test("in a group the card's draft names this bot", async ({ page }) => {
    await seed(page);
    await openChat(page, GROUP_CHAT);
    await page.locator('[data-message-author="true"]').first().click();

    await page.locator('[data-bot-profile-command="shift"]').click();
    await expect(page.locator("textarea")).toHaveValue("/shift@shiftbot ");
  });

  test("a disabled bot still has a card, and nothing on it can be pressed", async ({ page }) => {
    // `public.bots`'s SELECT policy hands the row over whatever the state, so
    // the name stays readable to the people it was talking to; the authoriser
    // admits `active` alone, so the rows say why they are dead (D-247).
    await seed(page, { botState: "paused" });
    await openChat(page, PRIVATE_CHAT);
    await page.locator(`[data-message-id="${BOT_MESSAGE}"]`).getByTestId("message-author-avatar").click();

    const card = page.getByTestId("bot-profile-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-bot-profile-reachable", "false");
    await expect(card.locator('[data-bot-profile-command="shift"]')).toBeDisabled();
  });

  test("a bot with no commands says so rather than showing an empty heading", async ({ page }) => {
    await seed(page, { commands: [] });
    await openChat(page, PRIVATE_CHAT);
    await page.locator(`[data-message-id="${BOT_MESSAGE}"]`).getByTestId("message-author-avatar").click();

    await expect(page.getByTestId("bot-profile-commands")).toContainText("У этого бота пока нет команд.");
  });

  test("a person's face still opens a person, and the two cards are never both up", async ({ page }) => {
    const fixture = await seed(page);
    await openChat(page, GROUP_CHAT);

    // The bot first.
    await page.locator('[data-message-author="true"]').first().click();
    await expect(page.getByTestId("bot-profile-card")).toBeVisible();

    // Then the person's own message — which is `me`, whose own card opens too.
    await page.evaluate(async () => {
      const { useAppStore } = await import("/src/store/app.store.ts");
      useAppStore.getState().openUserProfile("11111111-1111-4111-8111-00000000c002", "named");
    });
    await expect(page.getByTestId("user-profile-overlay")).toBeVisible();
    await expect(page.getByTestId("bot-profile-card")).toHaveCount(0);
    expect(fixture.restCalls("messages", "POST").length).toBe(0);
  });
});
