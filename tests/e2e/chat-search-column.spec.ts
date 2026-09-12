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
 * In-chat search, after it moved out of the conversation and into the list
 * column (2026-09-12).
 *
 * What was wrong, measured on the fixture below at 1440 before the change: the
 * phone's capsule was worn at every width. It counted seven matches, rendered
 * the first six, showed two of those whole inside a 144px well holding 320px of
 * rows — slicing a third through its own text — and covered 23% of the
 * conversation it was searching, while the column beside it stood 360×900
 * showing chats nobody had asked about.
 *
 * So the contract here is four separate facts, each of which fails on its own
 * if the defect comes back by a different road:
 *
 *  1. every match is rendered — a slice of the set makes the count wrong;
 *  2. every rendered row is whole — a cap on the well slices the last one, and
 *     a count alone would not notice;
 *  3. the conversation is covered by nothing — putting the panel back over the
 *     chat pane makes the overlap non-zero;
 *  4. the chat pane carries no search field of its own at this width — two
 *     mounted forms would each run the query and each jump the conversation.
 *
 * And the phone keeps the capsule, because below `md` the column is not on
 * screen and there is nowhere else for it to go. That is asserted here too, so
 * «moved to the column» can never quietly become «removed from the phone».
 *
 * The jump contract (CLAUDE.md §11, «Search and notification jumps land on the
 * exact message») gets its own test: a row lands on its own message, and the
 * counter and steppers still walk the matches.
 *
 * Needs the dev server on the fixture host; it mocks the backend and refuses
 * any other configuration.
 */

const AT = "2026-09-12T09:00:00.000Z";

const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");

const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";
const CHAT_COUNT = 4;

/**
 * Fourteen lines, of which exactly seven carry «смета» — the others carry a
 * different form of the word, so a search for it is a genuine subset rather
 * than everything in the chat.
 */
const TEAM_LINES = [
  "Макет главной готов, посмотрите",
  "Смета на витрину готова, посмотри",
  "Пришлю смету после обеда",
  "В смете не хватает одной позиции",
  "Смета пересчитана по новым ценам",
  "Отправил смету на согласование",
  "Смета в таблице, вкладка «Витрина»",
  "По смете вопрос: краска входит?",
  "Итоговая смета подписана",
  "Смета ушла подрядчику сегодня утром",
  "Правки по смете внесены",
  "Смета согласована с бухгалтерией",
  "Последняя версия сметы в папке",
  "Смета закрыта, спасибо всем",
];

const QUERY = "смета";
const MATCHES = TEAM_LINES.filter((line) => line.toLocaleLowerCase("ru-RU").includes(QUERY)).length;

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
    // The deployment's own search function is answered as absent, so both forms
    // fall back to the loaded conversation and the set under test is decided
    // here rather than by a database this spec does not have.
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(CHAT_COUNT);
}

async function openTeamChat(page: Page) {
  await page.getByTestId("chat-list-item").filter({ hasText: "Команда проекта" }).first().click();
  await expect(page.getByTestId("chat-header-info-button")).toBeVisible();
  await expect(page.locator('[data-message-bubble="true"]').first()).toBeVisible();
}

/** The one entry point the header offers, which both forms answer. */
async function openInChatSearch(page: Page) {
  await page.getByRole("button", { name: "Ещё" }).first().click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("button", { name: "Поиск в чате" }).first().click();
}

async function searchFor(page: Page, field: string, query: string) {
  const input = page.locator(field);
  await expect(input).toBeVisible();
  await input.fill(query);
}

/** Rows whose box is not wholly inside the well that scrolls them. */
function clippedRows(page: Page) {
  return page.evaluate(() => {
    const well = document.querySelector("[data-testid='chat-search-results']");
    if (!well) return ["the results well is missing"];
    const w = well.getBoundingClientRect();
    return [...document.querySelectorAll("[data-testid='chat-search-result']")]
      .filter((row) => {
        const q = row.getBoundingClientRect();
        return q.top < w.top - 1 || q.bottom > w.bottom + 1;
      })
      .map((row) => (row.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60));
  });
}

/** Pixels of the conversation's scroller that a box stands on. */
function overlapWithConversation(page: Page, selector: string) {
  return page.evaluate((target) => {
    const node = document.querySelector(target);
    const list = document.querySelector("[data-testid='message-scroll-container']");
    if (!node || !list) return null;
    const p = node.getBoundingClientRect();
    const r = list.getBoundingClientRect();
    const ox = Math.max(0, Math.min(p.right, r.right) - Math.max(p.left, r.left));
    const oy = Math.max(0, Math.min(p.bottom, r.bottom) - Math.max(p.top, r.top));
    return Math.round(ox * oy);
  }, selector);
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test.describe("in-chat search is a state of the list column", () => {
  test("every match is rendered, whole, and over none of the conversation", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "below md the column is off screen; the capsule is asserted separately");

    await boot(page);
    await openTeamChat(page);
    await openInChatSearch(page);

    const panel = page.getByTestId("sidebar-chat-search");
    await expect(panel).toBeVisible();
    await searchFor(page, "[data-testid='chat-search-input']", QUERY);

    // 1. Every match, not the first six.
    await expect(page.getByTestId("chat-search-counter")).toHaveText(`1/${MATCHES}`);
    await expect(page.getByTestId("chat-search-result")).toHaveCount(MATCHES);

    // 2. Every rendered row whole. This is the one a count alone cannot see:
    // the overlay rendered six and sliced the third through its own text.
    expect(await clippedRows(page)).toEqual([]);

    // 3. Nothing of the conversation is covered.
    expect(await overlapWithConversation(page, "[data-testid='sidebar-chat-search']")).toBe(0);

    // 4. And the chat pane grew no second field of its own.
    await expect(
      page.locator("[data-testid='chat-chrome-stack'] input[placeholder^='Поиск в чате']"),
    ).toHaveCount(0);
  });

  test("a result lands on its own message, and the steppers walk the matches", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "the column is the subject of this test");

    await boot(page);
    await openTeamChat(page);
    await openInChatSearch(page);
    await searchFor(page, "[data-testid='chat-search-input']", QUERY);
    await expect(page.getByTestId("chat-search-result")).toHaveCount(MATCHES);

    // The last match, which is the one furthest from where the conversation
    // rests, so landing on it cannot be a coincidence of the entry position.
    const last = page.getByTestId("chat-search-result").nth(MATCHES - 1);
    const wanted = (await last.innerText()).replace(/\s+/g, " ").trim();
    await last.click();

    await expect(page.getByTestId("chat-search-counter")).toHaveText(`${MATCHES}/${MATCHES}`);
    const line = TEAM_LINES.find((text) => wanted.includes(text.slice(0, 18)));
    expect(line, `the row's text did not name one of the chat's lines: ${wanted}`).toBeTruthy();
    const bubble = page.locator('[data-message-bubble="true"]').filter({ hasText: line! }).first();
    await expect(bubble).toBeInViewport();

    // Stepping back moves the counter and stays inside the set.
    await page.getByTestId("chat-search-previous").click();
    await expect(page.getByTestId("chat-search-counter")).toHaveText(`${MATCHES - 1}/${MATCHES}`);
    await page.getByTestId("chat-search-next").click();
    await expect(page.getByTestId("chat-search-counter")).toHaveText(`${MATCHES}/${MATCHES}`);
  });

  test("closing gives the column back to the chat list", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, "the column is the subject of this test");

    await boot(page);
    await openTeamChat(page);
    await openInChatSearch(page);
    await expect(page.getByTestId("sidebar-chat-search")).toBeVisible();

    await page.getByTestId("chat-search-close").click();
    await expect(page.getByTestId("sidebar-chat-search")).toHaveCount(0);
    await expect(page.getByTestId("chat-list-item")).toHaveCount(CHAT_COUNT);
    // The conversation is still open behind it: closing the search is not a way
    // out of the chat.
    await expect(page.getByTestId("chat-header-info-button")).toBeVisible();
  });

  test("below md the search stays a capsule over the conversation", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) >= 768, "from md the column has the room and takes it");

    await boot(page);
    await openTeamChat(page);
    await openInChatSearch(page);

    // The phone's form, in the chat pane's chrome where it has always been.
    await expect(
      page.locator("[data-testid='chat-chrome-stack'] input[placeholder^='Поиск в чате']"),
    ).toHaveCount(1);
    // And no column panel, which is not merely hidden here: mounting it behind
    // the conversation would run a second query and jump the chat.
    await expect(page.getByTestId("sidebar-chat-search")).toHaveCount(0);
  });
});
