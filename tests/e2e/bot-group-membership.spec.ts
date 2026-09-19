import { expect, type Page, type Route, type TestInfo, test } from "@playwright/test";
import {
  chat,
  type Fixture,
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
 * D-235: «бота нельзя добавить в групповой чат (его не видно в списке
 * приглашения)».
 *
 * The invite list was never hiding one. `GroupInviteModal` searches
 * `public.profiles` and a bot is not a profile — it is a row in `public.bots`
 * whose membership lives in `public.chat_bot_members`, a table that had exactly
 * one policy, `SELECT`, and no write path but `open_or_create_bot_chat`, which
 * makes the *private* chat.
 *
 * `20260919010000_a_bot_can_be_put_in_a_group.sql` added the door and nothing
 * else: three definer functions and still **no** INSERT policy. What this spec
 * pins is that the interface asks them rather than deciding for itself —
 * `chat_bots_available` answers **nothing at all** for somebody who may not add
 * a bot, so a role test on this side would be a second copy of a rule the
 * server already enforces, and the second copy is the one that drifts.
 *
 * It also pins the sentence. A bot always joins `restricted` —
 * `chat_bot_members_visibility_approval_check` forbids a `full` row without an
 * approver — so there is no one-step way to add one that reads everything, and
 * the screen has to say what the bot will and will not see **before** the
 * button is pressed, not in a tooltip and not afterwards.
 *
 * Everything is fictional and mocked on the DEV fixture host. No production
 * screen is rendered and no production data is fetched.
 */

const AT = "2026-09-18T09:00:00.000Z";
const GROUP = "51111111-1111-4111-8111-000000000001";
const LINE = "Собираемся в четверг";

const ME = person("52222222-2222-4222-8222-000000000001", "Зоя Яблокова", "zoya");
const OLGA = person("52222222-2222-4222-8222-000000000002", "Ольга Мишина", "olga");
/** Not in the group, so the people half of the screen is not empty beside the bots. */
const ANNA = person("52222222-2222-4222-8222-000000000003", "Анна Смирнова", "anna_s");

const HELPER = {
  id: "5bbbbbbb-1111-4111-8111-000000000001",
  username: "helper_bot",
  display_name: "Помощник",
  description: "Напоминает о встречах",
  avatar_url: null,
  state: "active",
  created_at: AT,
  updated_at: AT,
};

/** The five columns `chat_bots_available` returns, named as it names them. */
const AVAILABLE_ROW = {
  bot_id: HELPER.id,
  username: HELPER.username,
  display_name: HELPER.display_name,
  description: HELPER.description,
  avatar_url: HELPER.avatar_url,
};

interface OpenOptions {
  /** My role in the group, which is also what opens the panel's invite button. */
  myRole?: "owner" | "admin" | "member";
  /**
   * What `chat_bots_available` answers.
   *
   * `[]` is what the server really answers an ordinary member: the function's
   * body requires `is_chat_admin(p_chat_id)` and returns an empty set rather
   * than an error, so an empty answer and a refusal look identical from here.
   * That is the point — a listing cannot be used to enumerate bots from a chat
   * you administer nothing in.
   */
  available?: Row[];
  /** The bots already in the group, as `chat_bot_members` answers. */
  joined?: Row[];
  /** A refusal `chat_bot_add` raises, e.g. `not_an_admin`. */
  addRaises?: string;
  /** The deployment never took the migration. */
  doorMissing?: boolean;
  /**
   * What the group's row says about who may invite.
   *
   * `members_can_invite` is how an ordinary member reaches this screen at all —
   * and it is the case worth measuring: they get in, and are still offered no
   * bots, because `chat_bots_available` asks `is_chat_admin` rather than the
   * invite policy.
   */
  invitePolicy?: "owner_admin_only" | "members_can_invite";
  theme?: "light" | "dark";
}

async function openPanel(page: Page, options: OpenOptions = {}): Promise<Fixture> {
  const {
    myRole = "owner",
    available = [],
    joined = [],
    addRaises,
    doorMissing = false,
    invitePolicy = "owner_admin_only",
    theme = "dark",
  } = options;

  const groupRow = { ...chat(GROUP, "group", "Команда проекта", AT), invite_policy: invitePolicy };
  const live = [...joined];

  const fixture = await openFixture(page, {
    me: ME,
    people: [OLGA, ANNA],
    chats: [groupRow],
    memberships: [
      membership(GROUP, ME, myRole, AT),
      membership(GROUP, OLGA, myRole === "owner" ? "admin" : "owner", AT),
    ] as Row[],
    messages: [message("53333333-3333-4333-8333-000000000001", GROUP, OLGA, LINE, AT)],
    rpc: (name, body) => {
      if (name === "search_chat_messages") return missingFunction(name);
      if (name === "current_user_access_snapshot") return missingFunction(name);
      if (name === "has_permission") return { body: false };
      if (doorMissing && name.startsWith("chat_bot")) return missingFunction(name);
      if (name === "chat_bots_available") {
        const query =
          typeof body.p_query === "string" ? body.p_query.toLocaleLowerCase("ru-RU") : null;
        const rows = available.filter(
          (row) =>
            !query ||
            String(row.username).toLocaleLowerCase("ru-RU").includes(query) ||
            String(row.display_name).toLocaleLowerCase("ru-RU").includes(query),
        );
        return { body: rows };
      }
      if (name === "chat_bot_add") {
        if (addRaises) {
          return {
            status: 400,
            body: { code: "P0001", message: addRaises, details: null, hint: null },
          };
        }
        live.push({ chat_id: GROUP, bot: HELPER });
        return { body: true };
      }
      if (name === "chat_bot_remove") {
        for (let index = live.length - 1; index >= 0; index -= 1) {
          if ((live[index] as { bot?: { id?: string } }).bot?.id === body.p_bot_id)
            live.splice(index, 1);
        }
        return { body: true };
      }
      return undefined;
    },
  });

  // The invite screen's own page of people. Without it the fixture answers
  // only `me`, and every screenshot of this modal shows «Пока некого
  // приглашать» above the bots — which is not the layout anybody will see.
  await page.route("**/rest/v1/profiles*", (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.fallback();
    // Only the invite screen's own read: `select=*` with `id=neq.<me>`. Every
    // other read of `profiles` — the signed-in account's own row above all,
    // which is `id=eq.<me>` and is answered as a single object — must reach the
    // fixture. Answering that one with a list emptied the chat list entirely.
    if ((url.searchParams.get("select") ?? "") !== "*") return route.fallback();
    if (!(url.searchParams.get("id") ?? "").startsWith("neq.")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([ANNA]),
    });
  });

  await page.route("**/rest/v1/group_invites*", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.route("**/rest/v1/chat_bot_members*", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(live),
    });
  });

  // The modal's own read of «my role, and this chat's row».
  await page.route("**/rest/v1/chat_members*", (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.fallback();
    if (!(url.searchParams.get("select") ?? "").includes("chat:chats")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ role: myRole, chat: groupRow }),
    });
  });

  await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), theme);
  await openChat(page, "Команда проекта", LINE);
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
  await page.getByRole("button", { name: "Участники" }).first().click();
  await page.evaluate(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", (root.dataset.theme ?? "") !== "light");
  });
  return fixture;
}

async function openInvite(page: Page) {
  await page.getByRole("button", { name: "Пригласить пользователя" }).first().click();
  await expect(page.getByTestId("invite-candidates")).toBeVisible();
}

function shotPath(info: TestInfo, name: string): string {
  return `output/bot-group-membership/${name}-${info.project.name}.png`;
}

const botSection = (page: Page) => page.getByTestId("invite-bots");
const memberBots = (page: Page) => page.getByTestId("chat-info-bots");

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("an administrator is offered the bots, with what each will see", async ({ page }, info) => {
  await openPanel(page, { available: [AVAILABLE_ROW] });
  await openInvite(page);

  await expect(botSection(page)).toBeVisible();
  await expect(botSection(page)).toContainText("Боты");
  await expect(botSection(page)).toContainText("Помощник");
  await expect(botSection(page)).toContainText("@helper_bot");

  // The sentence, on the screen and not in a tooltip, before the press.
  const note = page.getByTestId("invite-bot-visibility");
  await expect(note).toBeVisible();
  await expect(note).toContainText("только обращённые к нему");
  await expect(note).toContainText("не увидит");
  await expect(note, "the note does not say the history before joining is excluded").toContainText(
    "историю до добавления",
  );

  // Nothing offers full visibility, because nothing implements it.
  await expect(botSection(page)).not.toContainText("Полный доступ");
  await page.screenshot({ path: shotPath(info, "invite-bots"), fullPage: false });
});

test("a plain member is offered no bots and has nothing to press", async ({ page }) => {
  // `chat_bots_available` returns the empty set for anybody who is not an
  // administrator of the group; the interface asks and believes it.
  const fixture = await openPanel(page, {
    myRole: "member",
    invitePolicy: "members_can_invite",
    available: [],
  });
  await openInvite(page);

  await expect(page.getByTestId("invite-candidates")).toBeVisible();
  await expect(botSection(page), "a member was offered bots").toHaveCount(0);
  await expect(page.getByTestId("invite-bot-visibility")).toHaveCount(0);
  await expect(page.locator("[data-invite-bot]")).toHaveCount(0);
  expect(fixture.rpcBodies("chat_bot_add"), "a member's screen sent an add").toEqual([]);
});

test("adding one calls the door with this group and this bot, and says what it did", async ({
  page,
}) => {
  const fixture = await openPanel(page, { available: [AVAILABLE_ROW] });
  await openInvite(page);

  await page
    .locator(`[data-invite-bot="${HELPER.id}"]`)
    .getByRole("button", { name: "Добавить" })
    .click();

  await expect
    .poll(() => fixture.rpcBodies("chat_bot_add"))
    .toEqual([{ p_chat_id: GROUP, p_bot_id: HELPER.id }]);
  await expect(page.getByTestId("invite-candidates").locator("..")).toContainText(
    "Помощник добавлен в группу",
  );
  await expect(page.locator(`[data-invite-bot="${HELPER.id}"]`)).toHaveAttribute(
    "data-invite-bot-state",
    "added",
  );
  await expect(page.locator(`[data-invite-bot="${HELPER.id}"]`).getByRole("button")).toBeDisabled();
});

test("the group's own list shows the bot once it is in, marked as one", async ({ page }, info) => {
  await openPanel(page, { joined: [{ chat_id: GROUP, bot: HELPER }] });

  await expect(memberBots(page)).toBeVisible();
  await expect(memberBots(page)).toContainText("Боты в группе");
  await expect(memberBots(page).getByTestId("chat-info-bot")).toHaveCount(1);
  await expect(
    memberBots(page).locator("[data-bot-tag]"),
    "a bot member is not marked as a bot",
  ).toHaveCount(1);
  await expect(memberBots(page)).toContainText("@helper_bot");
  await page.screenshot({ path: shotPath(info, "group-bot-member"), fullPage: false });
});

test("an administrator can take it out again; a member cannot", async ({ page }) => {
  const fixture = await openPanel(page, { joined: [{ chat_id: GROUP, bot: HELPER }] });

  const remove = memberBots(page).getByTestId("chat-info-bot-remove");
  await expect(remove).toHaveCount(1);
  await remove.click();
  await expect
    .poll(() => fixture.rpcBodies("chat_bot_remove"))
    .toEqual([{ p_chat_id: GROUP, p_bot_id: HELPER.id }]);
  // Soft on the server — `removed_at`, which is what the authoriser joins on —
  // and gone from this list at once, because nothing about bots streams.
  await expect(memberBots(page).getByTestId("chat-info-bot")).toHaveCount(0);
});

test("a member sees which bots are in the room but is offered no way out for them", async ({
  page,
}) => {
  await openPanel(page, { myRole: "member", joined: [{ chat_id: GROUP, bot: HELPER }] });
  await expect(memberBots(page).getByTestId("chat-info-bot")).toHaveCount(1);
  await expect(
    memberBots(page).getByTestId("chat-info-bot-remove"),
    "a member was offered the removal",
  ).toHaveCount(0);
});

test("a group with no bots tells its administrator so, and tells nobody else", async ({ page }) => {
  await openPanel(page, {});
  await expect(page.getByTestId("chat-info-bots-empty")).toBeVisible();

  await openPanel(page, { myRole: "member" });
  await expect(memberBots(page), "an empty bot list was drawn for a plain member").toHaveCount(0);
});

test("a refusal from the door is said in words, not in SQLSTATE", async ({ page }) => {
  await openPanel(page, { available: [AVAILABLE_ROW], addRaises: "not_an_admin" });
  await openInvite(page);
  await page
    .locator(`[data-invite-bot="${HELPER.id}"]`)
    .getByRole("button", { name: "Добавить" })
    .click();

  const modal = page.locator(".kub-modal-panel");
  await expect(modal).toContainText("Добавлять и убирать ботов может только администратор группы.");
  await expect(modal).not.toContainText("P0001");
  await expect(modal).not.toContainText("not_an_admin");
});

test("a deployment without the migration shows no bot section rather than an error", async ({
  page,
}) => {
  await openPanel(page, { available: [AVAILABLE_ROW], doorMissing: true });
  await openInvite(page);
  await expect(page.getByTestId("invite-candidates")).toBeVisible();
  await expect(botSection(page)).toHaveCount(0);
  const modal = page.locator(".kub-modal-panel");
  await expect(modal).not.toContainText("Не удалось");
});

test("typing narrows the bots the way it narrows the people", async ({ page }) => {
  const fixture = await openPanel(page, { available: [AVAILABLE_ROW] });
  await openInvite(page);
  await expect(botSection(page)).toBeVisible();

  await page.getByPlaceholder("Поиск по имени или @никнейму…").fill("зззз");
  await expect(botSection(page)).toHaveCount(0);
  await expect
    .poll(() => fixture.rpcBodies("chat_bots_available").map((body) => body.p_query))
    .toContain("зззз");
});

test("both surfaces, photographed in both themes", async ({ page }, info) => {
  for (const theme of ["dark", "light"] as const) {
    await openPanel(page, {
      available: [AVAILABLE_ROW],
      joined: [{ chat_id: GROUP, bot: HELPER }],
      theme,
    });
    await expect(memberBots(page).getByTestId("chat-info-bot")).toHaveCount(1);
    await page.screenshot({ path: shotPath(info, `group-bots-${theme}`), fullPage: false });
    await openInvite(page);
    await expect(botSection(page)).toBeVisible();
    await page.screenshot({ path: shotPath(info, `invite-bots-${theme}`), fullPage: false });
  }
});
