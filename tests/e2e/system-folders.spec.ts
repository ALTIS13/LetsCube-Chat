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
 * Tracker items 47 and 69. The kinds of conversation were a capsule of pills
 * over the list; a tester asked for it to go — «у меня не перестает гореть от
 * этого фильтра… сделай просто как папки системные, и всё» — and they are
 * system folders beside «Все» now: «Личные», «Группы», and «Каналы» and «Боты»
 * while there are any, each a rule rather than a list (`lib/systemFolders.ts`).
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

const FOLDER = "c4444444-4444-4444-8444-000000000001";

async function boot(page: Page, options: { onlyPeople?: boolean; folder?: boolean } = {}) {
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
  if (options.folder) {
    // The reader's own folder, holding a person's chat and a group.
    await page.route("**/rest/v1/folders*", (route: Route) =>
      route.fulfill({
        json: [{ id: FOLDER, user_id: ME.id, created_by: ME.id, scope: "personal", name: "Работа", emoji: null, position: 1, created_at: AT }],
      }),
    );
    await page.route("**/rest/v1/folder_chats*", (route: Route) =>
      route.fulfill({ json: [{ folder_id: FOLDER, chat_id: ANNA_CHAT }, { folder_id: FOLDER, chat_id: TEAM }] }),
    );
  }
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(options.onlyPeople ? 1 : 3);
}

const rows = (page: Page) => page.getByTestId("chat-list-item");
const isComputer = (page: Page) => (page.viewportSize()?.width ?? 0) >= 768;

/** The folders' names in order: the rail's from `md`, the strip's below it. */
async function folderNames(page: Page): Promise<string[]> {
  if (isComputer(page)) {
    return page.getByTestId("folder-rail-item").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label") ?? ""));
  }
  return page
    .getByTestId("folder-tabs-row")
    .locator("button:not([aria-label='Новая папка'])")
    .evaluateAll((items) => items.map((item) => (item.textContent ?? "").replace(/\d+/g, "").trim()));
}

function folder(page: Page, name: string) {
  return isComputer(page)
    ? page.getByTestId("folder-rail-item").filter({ hasText: name })
    : page.getByTestId("folder-tabs-row").getByRole("button", { name: new RegExp(`^${name}`) });
}

test("the kinds are folders beside «Все», and there is no filter over the list", async ({ page }) => {
  await boot(page);
  // No «Каналы»: there is no channel in this list to show.
  await expect.poll(() => folderNames(page)).toEqual(["Все", "Личные", "Группы", "Боты"]);
  await expect(page.getByTestId("chat-kind-filter"), "the capsule is gone").toHaveCount(0);

  await folder(page, "Группы").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Команда проекта");

  await folder(page, "Боты").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Помощник");

  await folder(page, "Личные").click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Анна Смирнова");

  await folder(page, "Все").click();
  await expect(rows(page)).toHaveCount(3);
});

test("a system folder says what waits in it, and pressed again opens no editor", async ({ page }) => {
  await boot(page);
  // Anna's line and the team's are both unread.
  if (isComputer(page)) {
    await expect(folder(page, "Личные").getByTestId("folder-rail-count")).toHaveText("1");
    await expect(folder(page, "Группы").getByTestId("folder-rail-count")).toHaveText("1");
    await expect(folder(page, "Боты").getByTestId("folder-rail-count")).toHaveCount(0);
  } else {
    await expect(folder(page, "Личные")).toContainText("1");
    await expect(folder(page, "Группы")).toContainText("1");
  }
  await folder(page, "Группы").click();
  await folder(page, "Группы").click();
  await page.waitForTimeout(300);
  await expect(page.getByRole("dialog"), "a rule has nothing to edit").toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
});

test("a list of one kind has no system folders, which would repeat «Все»", async ({ page }) => {
  await boot(page, { onlyPeople: true });
  await expect(folder(page, "Личные")).toHaveCount(0);
  await expect(page.getByTestId("chat-kind-filter")).toHaveCount(0);
});

test("a folder of the reader's own stays its own list, after the system ones", async ({ page }) => {
  // Tracker item 69: «я создал себе уже отдельную папку, а тут мне еще
  // фильтруют люди или группы… не в отдельной папке».
  await boot(page, { folder: true });
  await expect.poll(() => folderNames(page)).toEqual(["Все", "Личные", "Группы", "Боты", "Работа"]);
  await folder(page, "Группы").click();
  await expect(rows(page)).toHaveCount(1);

  await folder(page, "Работа").click();
  // Both of the folder's chats, whatever folder was open before it.
  await expect(rows(page)).toHaveCount(2);
});
