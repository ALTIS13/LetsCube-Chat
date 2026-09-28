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
 * The sections beside the lists (tracker item 41).
 *
 * The owner, 2026-09-20: «ботов и т.п можно перенести в место подобное тому
 * что на скриншоте 3» — Discord's home list, whose rows above the direct
 * messages open their pages in the main area while the lists stay. Read in
 * Discord's web bundle (build 621195) before building: navigation rows with a
 * route, an icon and a word. `lib/shellSection.ts` holds the rule and
 * `tests/unit/shell-section.test.mts` its cases; what is measured here is what
 * a pure function cannot see:
 *
 *  1. on a computer the rows are above the conversations, and a section opens
 *     in the main area with the chat list still on screen;
 *  2. while a section is open no conversation row claims to be the one being
 *     read, and the section's own row does;
 *  3. a row pressed during a section leaves it — the conversation that stayed
 *     selected behind the section included, which the store alone would not
 *     count as a change;
 *  4. Escape over a section closes nothing it cannot see;
 *  5. «Задачи» has a row only with the right to it;
 *  6. a phone has no rows — Discord's phone app has none either — and a
 *     section is the one pane, with its own way back to the list.
 *
 * Mocks everything it reads; needs the dev server on the fixture host.
 */

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const BORIS = person("11111111-1111-4111-8111-000000000003", "Борис Ковалёв");
const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";
const CHAT_BORIS = "22222222-2222-4222-8222-000000000002";
const LINE_TEAM = "Макет главной готов";
const LINE_BORIS = "Созвонимся вечером?";

const TASK_RIGHTS = new Set(["tasks.view", "tasks.create", "tasks.manage"]);

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 768;

async function boot(page: Page, { tasks = true }: { tasks?: boolean } = {}) {
  const chats: Row[] = [chat(CHAT_TEAM, "group", "Команда проекта", AT), chat(CHAT_BORIS, "private", null, AT)];
  const memberships: Row[] = [
    membership(CHAT_TEAM, ME, "owner", AT),
    membership(CHAT_TEAM, ANNA, "member", AT),
    membership(CHAT_BORIS, ME, "owner", AT),
    membership(CHAT_BORIS, BORIS, "member", AT),
  ];
  const messages: Row[] = [
    message("55555555-5555-4555-8555-000000000001", CHAT_TEAM, ANNA, LINE_TEAM, AT),
    message("55555555-5555-4555-8555-000000000002", CHAT_BORIS, BORIS, LINE_BORIS, AT),
  ];
  const fixture = await openFixture(page, {
    me: { ...ME, role: tasks ? "manager" : "user" },
    chats,
    memberships,
    messages,
    rpc: (name, body) => {
      if (name === "has_permission") return { body: tasks && TASK_RIGHTS.has(String(body.p_permission_key)) };
      if (name === "has_global_role") return { body: tasks && body.p_role_key === "manager" };
      return undefined;
    },
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(2);
  return fixture;
}

const rows = (page: Page) => page.getByTestId("shell-sections");
const section = (page: Page, name: "bots" | "tasks") => page.locator(`[data-shell-section="${name}"]`);
const chatRow = (page: Page, text: string) => page.getByTestId("chat-list-item").filter({ hasText: text });

test.describe("sections open beside the lists (item 41)", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("the rows sit above the conversations and a section opens beside the list", async ({ page }) => {
    test.skip(!isDesktop(page), "the rows are a computer's");
    await boot(page);

    // Above the conversations, and in the product's words.
    await expect(rows(page)).toBeVisible();
    await expect(section(page, "bots")).toHaveText("Мои боты");
    await expect(section(page, "tasks")).toHaveText("Задачи");
    const order = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="shell-sections"]')!.getBoundingClientRect();
      const first = document.querySelector('[data-testid="chat-list-item"]')!.getBoundingClientRect();
      return { navBottom: nav.bottom, firstTop: first.top };
    });
    expect(order.navBottom).toBeLessThanOrEqual(order.firstTop);

    await section(page, "tasks").click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId("tasks-page").first()).toBeVisible();
    // The whole point: the lists stay, with nothing gone from them.
    await expect(page.getByTestId("chat-list-item")).toHaveCount(2);
    await expect(rows(page)).toBeVisible();
    await expect(section(page, "tasks")).toHaveAttribute("aria-current", "page");
    await expect(section(page, "bots")).not.toHaveAttribute("aria-current", "page");

    // In the main area, beside the list rather than over it.
    const geometry = await page.evaluate(() => {
      const list = document.querySelector("[data-kub-left-region]")!.getBoundingClientRect();
      const pane = document.querySelector('[data-testid="tasks-page"]')!.getBoundingClientRect();
      return { listRight: list.right, paneLeft: pane.left, paneBottom: pane.bottom, viewport: window.innerHeight };
    });
    expect(geometry.paneLeft).toBeGreaterThanOrEqual(geometry.listRight - 1);
    expect(Math.round(geometry.paneBottom)).toBe(geometry.viewport);

    // The way back on a computer is the list beside it, so the page's own
    // «Назад» — the only way out on a phone — is not drawn here.
    await expect(page.getByTestId("tasks-page").first().getByRole("button", { name: "Назад" })).toBeHidden();

    await section(page, "bots").click();
    await expect(page).toHaveURL(/\/bots$/);
    await expect(page.getByTestId("bots-page")).toBeVisible();
    await expect(page.getByTestId("tasks-page")).toHaveCount(0);
    await expect(section(page, "bots")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("bots-page").getByRole("button", { name: "Назад к чатам" })).toBeHidden();
  });

  test("a conversation behind a section is not marked, and pressing it leaves the section", async ({ page }) => {
    test.skip(!isDesktop(page), "the rows are a computer's");
    await boot(page);

    await chatRow(page, "Команда проекта").click();
    await expect(page).toHaveURL(new RegExp(`/chat/${CHAT_TEAM}$`));
    await expect(chatRow(page, "Команда проекта")).toHaveAttribute("data-selected", "true");

    await section(page, "bots").click();
    await expect(page).toHaveURL(/\/bots$/);
    await expect(page.getByTestId("bots-page")).toBeVisible();
    // Discord marks the Friends row, not the last direct message, while
    // Friends is open. The conversation stays selected in the store — walking
    // into a section and back has always kept it — but it is not on screen.
    await expect(page.locator('[data-testid="chat-list-item"][data-selected="true"]')).toHaveCount(0);

    // Escape over a section closes nothing: the conversation it used to close
    // is not on screen, and a key that closes something invisible lies.
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/bots$/);
    await expect(page.getByTestId("bots-page")).toBeVisible();

    // The same conversation, pressed again. The store already holds it, so
    // only the row's own navigation can leave the section — the case that would
    // otherwise do nothing at all.
    await chatRow(page, "Команда проекта").click();
    await expect(page).toHaveURL(new RegExp(`/chat/${CHAT_TEAM}$`));
    await expect(page.getByTestId("bots-page")).toHaveCount(0);
    await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: LINE_TEAM })).toBeVisible();
    await expect(chatRow(page, "Команда проекта")).toHaveAttribute("data-selected", "true");

    // And a different one, from a section.
    await section(page, "tasks").click();
    await expect(page).toHaveURL(/\/tasks$/);
    await chatRow(page, "Борис").click();
    await expect(page).toHaveURL(new RegExp(`/chat/${CHAT_BORIS}$`));
    await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: LINE_BORIS })).toBeVisible();
  });

  test("«Задачи» is an icon on the folder rail with how many are in work, and nothing else is its door", async ({ page }) => {
    // Tracker item 64: «отдельная иконка, например между папками и меню. И на
    // этой иконке была цифра сколько задач у тебя сейчас в работе».
    test.skip(!isDesktop(page), "the rail is a computer's");
    await boot(page);
    // After the fixture's own route, so this one answers first; the page is
    // loaded again so the rail counts under it.
    const counted: string[] = [];
    await page.route("**/rest/v1/tasks*", async (route) => {
      const request = route.request();
      if (!(request.headers().prefer ?? "").includes("count=")) return route.fallback();
      counted.push(new URL(request.url()).search);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-expose-headers": "Content-Range", "content-range": "*/3" },
        body: "[]",
      });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item")).toHaveCount(2);

    const tasks = page.getByTestId("folder-rail-tasks");
    await expect(tasks.getByTestId("folder-rail-tasks-count")).toHaveText("3");
    await expect(tasks).toHaveAccessibleName("Задачи, в работе 3");
    // Between the menu and the folders.
    const order = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return {
        menu: box('[data-testid="side-menu-button"]').bottom,
        tasksTop: box('[data-testid="folder-rail-tasks"]').top,
        tasksBottom: box('[data-testid="folder-rail-tasks"]').bottom,
        folder: box('[data-testid="folder-rail-item"]').top,
      };
    });
    expect(order.menu).toBeLessThanOrEqual(order.tasksTop);
    expect(order.tasksBottom).toBeLessThanOrEqual(order.folder);
    // In work is this person's, taken and not yet handed back.
    const query = new URLSearchParams(counted[0]);
    expect(query.get("assignee_id")).toBe(`eq.${ME.id}`);
    expect(query.get("status")).toBe("in.(accepted,in_progress)");
    expect(query.get("deleted_at")).toBe("is.null");

    // One page, one door: the row above the conversations is gone.
    await expect(rows(page).locator('[data-shell-section="tasks"]')).toHaveCount(0);
    await tasks.click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(tasks).toHaveAttribute("aria-current", "page");
  });

  test("«Задачи» has a row only with the right to it", async ({ page }) => {
    test.skip(!isDesktop(page), "the rows are a computer's");
    const fixture = await boot(page, { tasks: false });
    await expect(section(page, "bots")).toBeVisible();
    // The right is asked for asynchronously; an absence before the answer
    // proves nothing.
    await expect.poll(() => fixture.rpcBodies("has_permission").length).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    await expect(section(page, "tasks")).toHaveCount(0);
  });

  test("a phone has no rows, and a section is the one pane with its own way back", async ({ page }) => {
    test.skip(isDesktop(page), "the phone keeps its menu");
    await boot(page);
    await expect(rows(page)).toBeHidden();

    // The staff hint beside the header's shield belongs to the list. The
    // premise first: this account is a manager and has not read it.
    const hint = page.getByText("Управление сообществом живёт здесь", { exact: false }).filter({ visible: true });
    await expect(hint).toHaveCount(1);

    await page.locator('[aria-label="Меню"]:visible').click();
    // The section rows carry the same words, `md:hidden`-gated off a phone.
    await page.getByText("Мои боты", { exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/bots$/);
    const bots = page.getByTestId("bots-page");
    await expect(bots).toBeVisible();
    // One pane: the list is not beside it here.
    await expect(page.getByTestId("chat-list-item").first()).toBeHidden();
    // And the list's hint went with it rather than staying behind anchored to
    // a hidden header, over the page — photographed so on 2026-09-28.
    await expect(hint).toHaveCount(0);
    const box = await bots.boundingBox();
    expect(Math.round(box!.width)).toBe(page.viewportSize()!.width);

    await bots.getByRole("button", { name: "Назад к чатам" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("chat-list-item")).toHaveCount(2);
    await expect(page.getByTestId("bots-page")).toHaveCount(0);
    // Back on the list, still unread, so it is offered again.
    await expect(hint).toHaveCount(1);

    // The same for a conversation, the pane a phone shows most often.
    await chatRow(page, "Борис").click();
    await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: LINE_BORIS })).toBeVisible();
    await expect(hint).toHaveCount(0);
  });
});
