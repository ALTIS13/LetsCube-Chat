import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * The contact card, after it stopped being a window on the conversation
 * (D-161, 2026-09-13).
 *
 * What was wrong, measured on this fixture at 1440 with the card open: a
 * 380x620 window `position: fixed` over the chat, covering 26.2% of the
 * conversation and four of its fourteen bubbles, standing on the composer, and
 * scrolling 639px of itself inside 562px — while the pane beside it measured
 * 1001px and had 621 to spare. At 1920 it covered 14.7% and three bubbles.
 *
 * So the contract is four facts, each of which fails on its own if the defect
 * returns by a different road:
 *
 *  1. the card is a column — in the flow, flush to the pane's right edge;
 *  2. it covers none of the conversation and none of the composer;
 *  3. the conversation REFLOWS by exactly the column's width, and what is left
 *     is still above the product's own minimum for a column;
 *  4. nothing inside the card was lost in the move, and it has more room to
 *     show it in than the window gave it.
 *
 * And below the dock breakpoint the sheet is unchanged, asserted here so that
 * «it became a column» can never quietly become «the phone changed too».
 *
 * Needs the dev server on the fixture host; it mocks the backend and refuses
 * any other configuration.
 */

const AT = "2026-09-12T09:00:00.000Z";

const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");

const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";
const CHAT_COUNT = 4;

const TEAM_LINES = [
  "Макет главной готов, посмотрите",
  "Смета на витрину готова, посмотри",
  "Пришлю смету после обеда",
  "В смете не хватает одной позиции",
  "Смета пересчитана по новым ценам",
  "Отправил смету на согласование",
  "Смета в таблице, вкладка «Витрина»",
  "Итоговая смета подписана",
];

const FIRST_LINE = TEAM_LINES[0];

/**
 * The width below which this file says nothing.
 *
 * The shape is decided by the PANE, not by the window — the chat list is
 * dragged — so a viewport gate can only ever be a safe approximation of it.
 * 1200 is comfortably above the threshold with the list at its default 360
 * (1200 - 433 = 767 of pane, against the 640 a column needs), and the projects
 * that run these tests are 1440, 1920 and 3840. Between 640 and 1200 the card
 * may be either shape depending on how wide the person has dragged their list,
 * and this file deliberately does not assert which.
 */
const COLUMN_FROM = 1200;

function fixtureRows() {
  const chats: Row[] = [];
  const memberships: Row[] = [];
  const messages: Row[] = [];

  const add = (index: number, id: string, name: string, lines: string[]) => {
    const at = new Date(Date.UTC(2026, 8, 12, 14, 55 - index)).toISOString();
    chats.push(chat(id, "group", name, at));
    memberships.push(membership(id, ME, "owner", AT), membership(id, ANNA, "member", at));
    lines.forEach((text, line) => {
      const stamp = new Date(Date.UTC(2026, 8, 12, 10 + Math.floor(line / 6), (line * 7) % 60)).toISOString();
      messages.push(
        message(
          `55555555-5555-4555-8555-${String(index * 100 + line + 1).padStart(12, "0")}`,
          id,
          line % 3 === 0 ? ME : ANNA,
          text,
          stamp,
        ),
      );
    });
  };

  add(0, CHAT_TEAM, "Команда проекта", TEAM_LINES);
  for (let index = 1; index < CHAT_COUNT; index += 1) {
    add(index, `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`, `Группа ${index}`, [
      `Сообщение в группе ${index}`,
    ]);
  }
  return { chats, memberships, messages };
}

async function boot(page: Page) {
  await openFixture(page, {
    me: ME,
    ...fixtureRows(),
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
}

/** The one entry point the chat header offers. */
async function openCard(page: Page): Promise<Locator> {
  await page.getByTestId("chat-header-info-button").click();
  const card = page.getByTestId("chat-info-panel");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("chat-info-summary")).toBeVisible();
  return card;
}

/** Pixels of one box that another box stands on. */
function overlap(page: Page, a: string, b: string) {
  return page.evaluate(
    ([first, second]) => {
      const one = document.querySelector(first);
      const two = document.querySelector(second);
      if (!one || !two) return null;
      const p = one.getBoundingClientRect();
      const r = two.getBoundingClientRect();
      const ox = Math.max(0, Math.min(p.right, r.right) - Math.max(p.left, r.left));
      const oy = Math.max(0, Math.min(p.bottom, r.bottom) - Math.max(p.top, r.top));
      return Math.round(ox * oy);
    },
    [a, b],
  );
}

/** The width of the conversation itself — the scroller, not the header. */
function conversationWidth(page: Page) {
  return page.evaluate(() => {
    const list = document.querySelector("[data-testid='message-scroll-container']");
    return list ? Math.round(list.getBoundingClientRect().width) : null;
  });
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test.describe("the contact card is a column beside the conversation", () => {
  test("it docks as a third column and the conversation reflows around it", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < COLUMN_FROM, "the pane cannot be relied on to hold a column below this");

    await boot(page);
    await openChat(page, "Команда проекта", FIRST_LINE);

    const before = await conversationWidth(page);
    expect(before).not.toBeNull();

    const card = await openCard(page);
    await expect(card).toHaveAttribute("data-surface", "column");
    // `data-docked` has only ever meant the phone's sheet, and a column is not
    // one. Asserted so the two attributes cannot quietly merge.
    await expect(card).toHaveAttribute("data-docked", "false");

    const cardBox = (await card.boundingBox())!;
    const paneBox = (await page.locator("[data-kub-conversation-pane]").boundingBox())!;

    // 1. In the flow, and flush to the right edge of the pane.
    expect(await card.evaluate((node) => getComputedStyle(node).position)).not.toBe("fixed");
    expect(Math.abs(cardBox.x + cardBox.width - (paneBox.x + paneBox.width))).toBeLessThanOrEqual(1);
    // Full height of the pane: a column, not a card sitting in one.
    expect(Math.abs(cardBox.height - paneBox.height)).toBeLessThanOrEqual(1);

    // 2. It covers nothing. These two were 235,600px² and 15,200px² before.
    expect(await overlap(page, "[data-testid='chat-info-panel']", "[data-testid='message-scroll-container']")).toBe(0);
    expect(await overlap(page, "[data-testid='chat-info-panel']", "[data-testid='chat-composer-dock']")).toBe(0);

    // 3. The conversation gave up exactly the column and kept the rest. The
    // reflow is the point: covered messages would leave this number unchanged.
    const after = await conversationWidth(page);
    expect(before! - after!).toBeGreaterThanOrEqual(cardBox.width - 1);
    expect(before! - after!).toBeLessThanOrEqual(cardBox.width + 1);
    // And what is left is above the width this product already calls the
    // narrowest a column may be (`CHAT_LIST_MIN_WIDTH`).
    expect(after!).toBeGreaterThanOrEqual(260);
  });

  test("nothing inside the card was lost in the move, and it has more room to show it", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < COLUMN_FROM, "the pane cannot be relied on to hold a column below this");

    await boot(page);
    await openChat(page, "Команда проекта", FIRST_LINE);
    const card = await openCard(page);
    await expect(card).toHaveAttribute("data-surface", "column");

    // Its two tabs, and the switch between them. `exact`, because the card
    // also carries an invite-policy button reading «Все участники» and a
    // substring match takes both — which is a strict-mode violation, not a
    // missing tab. The spellings are the source's; the tabs are drawn
    // uppercase by CSS and the DOM never holds «УЧАСТНИКИ».
    const details = card.getByRole("button", { name: "Сведения", exact: true });
    await expect(details).toBeVisible();
    const members = card.getByRole("button", { name: "Участники", exact: true });
    await expect(members).toBeVisible();
    await members.click();
    await expect(card.getByText(ANNA.full_name, { exact: false }).first()).toBeVisible();
    await details.click();

    // Its actions. Read out of the source rather than off a screenshot: these
    // are the literals `tests/unit/profile-window.test.mts` binds to handlers.
    await expect(card.getByText("Закрепить чат", { exact: true })).toBeVisible();
    await expect(card.getByText("Очистить историю у себя", { exact: true })).toBeVisible();

    // Its own scroll, against the box it scrolls inside. The window gave the
    // card 562px of it and had 639px to show; a column has the pane's height.
    const room = await page
      .getByTestId("chat-info-root-view")
      .evaluate((node) => ({ visible: node.clientHeight, content: node.scrollHeight }));
    expect(room.visible).toBeGreaterThan(562);

    // And it closes from the same control it always did.
    await card.getByRole("button", { name: "Закрыть" }).click();
    await expect(page.getByTestId("chat-info-panel")).toHaveCount(0);
    // The conversation is still open behind it: closing the card is not a way
    // out of the chat.
    await expect(page.getByTestId("chat-header-info-button")).toBeVisible();
  });

  test("a column is not a window, so its title bar offers no drag", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < COLUMN_FROM, "the pane cannot be relied on to hold a column below this");

    await boot(page);
    await openChat(page, "Команда проекта", FIRST_LINE);
    await openCard(page);

    const cursor = await page
      .getByTestId("chat-info-header")
      .evaluate((node) => getComputedStyle(node).cursor);
    expect(cursor).not.toBe("grab");
  });

  test("below the dock breakpoint the card is still the sheet over the conversation", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) >= 640, "the column is the subject of the tests above");

    await boot(page);
    await openChat(page, "Команда проекта", FIRST_LINE);
    const card = await openCard(page);

    // Unchanged, and that is the assertion: the sheet, laid over the whole
    // pane, not a 380px column squeezing a phone's conversation into nothing.
    await expect(card).toHaveAttribute("data-surface", "docked");
    await expect(card).toHaveAttribute("data-docked", "true");

    const cardBox = (await card.boundingBox())!;
    const paneBox = (await page.locator("[data-kub-conversation-pane]").boundingBox())!;
    expect(Math.abs(cardBox.width - paneBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(cardBox.height - paneBox.height)).toBeLessThanOrEqual(1);

    const cursor = await page
      .getByTestId("chat-info-header")
      .evaluate((node) => getComputedStyle(node).cursor);
    expect(cursor).not.toBe("grab");
  });
});
