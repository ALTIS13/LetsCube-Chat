import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * D-169: a channel is not a group. D-172: the invitations block explained
 * itself.
 *
 * **D-169.** The information card called every group-like chat a group —
 * «Информация о группе» over a channel, a «Участники» tab, «Покинуть группу»,
 * «Удалить групповой чат» — while three other surfaces had already learned the
 * difference and said it differently: the chat list's context menu offers
 * «Информация о канале», the conversation header counts «N подписчиков», and
 * the settings rows added the same morning say «Удалить канал». What differs
 * between the two is only the name: one `chat_members` table, one set of roles,
 * one message-insert policy with no type condition, and no code path in the
 * product that creates a channel at all. So the words change and nothing else
 * does, and this file proves that both halves of that sentence are true — the
 * channel's card is asserted beside a group's, so a rename would fail here.
 *
 * **D-172.** Under «ПРИГЛАШЕНИЯ» stood «Статусы обновляются без перезагрузки
 * панели.», a note about how the code works, beside a manual «Обновить» button
 * that contradicted it. The empty state named the block's own filter, and the
 * unavailable state named the database. Every state the block really has is
 * still here; what each one says is what is true for the person reading.
 *
 * Everything runs on the message-actions fixture — a mocked backend with
 * fictional people — so no production screen is ever rendered.
 */

const AT = "2026-09-12T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const PETR = person("11111111-1111-4111-8111-000000000003", "Пётр Ильин");
const LIDIA = person("11111111-1111-4111-8111-000000000004", "Лидия Кравец");
const OLEG = person("11111111-1111-4111-8111-000000000005", "Олег Дёмин");
const ELENA = person("11111111-1111-4111-8111-000000000006", "Елена Бажова");
const TIMUR = person("11111111-1111-4111-8111-000000000007", "Тимур Асланов");
const CHANNEL = "22222222-2222-4222-8222-000000000010";
const GROUP = "22222222-2222-4222-8222-000000000011";
const LINE = "Витрина переехала на новый макет";

type MyRole = "owner" | "admin" | "member";
type Kind = "channel" | "group";

const NAMES: Record<Kind, string> = { channel: "Новости студии", group: "Команда проекта" };
const IDS: Record<Kind, string> = { channel: CHANNEL, group: GROUP };

function seed(kind: Kind, myRole: MyRole): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  const id = IDS[kind];
  return {
    chats: [chat(id, kind, NAMES[kind], AT)],
    memberships: [
      membership(id, ME, myRole, AT),
      membership(id, ANNA, myRole === "owner" ? "admin" : "owner", AT),
      membership(id, PETR, "member", AT),
    ],
    messages: [message("55555555-5555-4555-8555-000000000001", id, ANNA, LINE, AT)],
  };
}

function shotPath(info: TestInfo, name: string): string {
  return `output/channel-card/${name}-${info.project.name}.png`;
}

/**
 * The theme, stamped the way the product's own runtime stamps it.
 *
 * Not through `localStorage`: the message-actions fixture writes «dark» in its
 * own init script, which runs after anything this file could add, so a theme set
 * that way is overwritten before the application ever reads it. These are the
 * same three things `applyResolvedTheme` does, and nothing else decides the
 * palette. Taken from `group-settings.spec.ts`, which measured it.
 */
async function stampTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
}

/**
 * Until the layers have finished sliding: a state attribute flips at once, the
 * paint does not. The layer that is leaving must reach zero, not merely hold a
 * value that is true at both ends of the transition.
 */
async function settled(page: Page) {
  await page.waitForFunction(() => {
    const layers = document.querySelectorAll<HTMLElement>(".kub-subview");
    return Array.from(layers).every((layer) => {
      const opacity = Number.parseFloat(getComputedStyle(layer).opacity);
      return layer.dataset.state === "current" ? opacity === 1 : opacity === 0;
    });
  });
}

/** An invitation row as the panel's own query shapes one. */
function invite(
  id: string,
  invitee: typeof ME,
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired",
  inviter: typeof ME = ANNA,
): Row {
  return {
    id,
    invitee_id: invitee.id,
    inviter_id: inviter.id,
    status,
    created_at: AT,
    expires_at: "2026-09-19T09:00:00.000Z",
    responded_at: status === "pending" ? null : AT,
    invitee,
    inviter,
  };
}

/**
 * What the `group_invites` table answers.
 *
 * Registered after `openFixture`, whose own handler covers the whole host and
 * would otherwise return an empty list: Playwright matches routes newest first,
 * so this one wins for this resource and the fixture keeps everything else.
 */
async function seedInvites(page: Page, rows: Row[] | "unavailable") {
  await page.route("**/rest/v1/group_invites*", async (route: Route) => {
    if (rows === "unavailable") {
      // The shape a missing migration really produces, not a made-up code:
      // `isGroupInviteUnavailableError` reads 42P01 as «the table is not there».
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          code: "42P01",
          details: null,
          hint: null,
          message: 'relation "public.group_invites" does not exist',
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
}

interface OpenOptions {
  myRole?: MyRole;
  theme?: "light" | "dark";
  invites?: Row[] | "unavailable";
}

async function openInfo(page: Page, kind: Kind, options: OpenOptions = {}) {
  const { myRole = "owner", theme = "light", invites } = options;
  const rows = seed(kind, myRole);
  await openFixture(page, {
    me: ME,
    chats: rows.chats,
    memberships: rows.memberships,
    messages: rows.messages,
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  if (invites !== undefined) await seedInvites(page, invites);
  await openChat(page, NAMES[kind], LINE);
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
  await stampTheme(page, theme);
}

const header = (page: Page) => page.getByTestId("chat-info-header");

/**
 * A control on the card's root layer, by its name.
 *
 * Scoped rather than global, because the three layers of this card stay mounted
 * at once and the settings screen holds a «Подписчики» row and a «Удалить
 * канал» row of its own. An unscoped `getByRole` resolves to both and Playwright
 * refuses the click — which is a fact about this card's shape, not about the
 * copy, so it is answered here rather than by weakening the assertion.
 */
const onRoot = (page: Page, name: string) =>
  page.getByTestId("chat-info-root-view").getByRole("button", { name, exact: true });

test("a channel's card is titled a channel's, and counts subscribers", async ({ page }, info) => {
  await openInfo(page, "channel");

  await expect(header(page)).toContainText("Информация о канале");
  // The summary line under the name. The conversation header behind this card
  // has counted «подписчиков» all along; the card said «участников» over the
  // same three rows of the same table.
  await expect(page.getByTestId("chat-info-summary")).toContainText("3 подписчика");
  await expect(onRoot(page, "Подписчики")).toBeVisible();
  await expect(onRoot(page, "Участники")).toBeHidden();

  await settled(page);
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "channel-root-light") });
});

test("a group's card is unchanged, so this is a branch and not a rename", async ({ page }, info) => {
  await openInfo(page, "group");

  await expect(header(page)).toContainText("Информация о группе");
  await expect(page.getByTestId("chat-info-summary")).toContainText("3 участника");
  await expect(onRoot(page, "Участники")).toBeVisible();

  await settled(page);
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "group-root-light") });
});

test("the channel's card holds in the dark theme", async ({ page }, info) => {
  await openInfo(page, "channel", { theme: "dark" });
  await settled(page);
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "channel-root-dark") });
  await expect(header(page)).toContainText("Информация о канале");
});

test("leaving a channel says channel, in the row and in what it asks", async ({ page }) => {
  // A member, not the owner: the owner is offered deletion instead.
  await openInfo(page, "channel", { myRole: "member" });

  await onRoot(page, "Покинуть канал").click();
  const dialog = page.locator('[aria-modal="true"]');
  await expect(dialog).toContainText("Покинуть канал?");
  // And the people left behind are subscribers, not members.
  await expect(dialog).toContainText("История у других подписчиков останется.");
});

test("deleting a channel says channel, in the row and in what it asks", async ({ page }) => {
  await openInfo(page, "channel");

  await onRoot(page, "Удалить канал").click();
  const dialog = page.locator('[aria-modal="true"]');
  await expect(dialog).toContainText("Удалить канал?");
  // The second line changed in `fd9255c` (D-150): it used to repeat the first
  // almost word for word — «Чат и история исчезнут у всех подписчиков» over
  // «После удаления канал исчезнет у всех подписчиков» — and now says the thing
  // an owner who only wants out actually needs to know. This test kept asserting
  // the old sentence and had been red since, which is why the wording is taken
  // from `chatVocabulary` rather than written out again here.
  await expect(dialog).toContainText("Чат и история исчезнут у всех подписчиков.");
  await expect(dialog).toContainText(
    "Если вы просто хотите уйти, передайте права владельца другому подписчику — тогда канал останется.",
  );
  // «Удалить групповой чат» was the card's own wording for the same button the
  // settings screen called «Удалить группу»; one name now, and it names this.
  await expect(page.getByTestId("chat-info-panel")).not.toContainText("Удалить групповой чат");
});

test("the settings screen of a channel is a channel's throughout", async ({ page }, info) => {
  await openInfo(page, "channel", { theme: "dark" });
  await page.getByLabel("Редактировать").click();
  await expect(page.getByTestId("chat-info-settings-view")).toHaveAttribute("data-state", "current");

  await expect(header(page)).toContainText("Настройки канала");
  await expect(page.getByTestId("chat-settings-row-members")).toContainText("Подписчики");
  await expect(page.getByTestId("chat-settings-row-members")).toHaveAttribute(
    "data-settings-value",
    "3 подписчика",
  );
  await expect(page.getByTestId("chat-settings-row-delete")).toContainText("Удалить канал");
  // The box asked «О чём эта группа» two rows under a title saying «Настройки
  // канала».
  await expect(page.getByTestId("chat-settings-description")).toHaveAttribute(
    "placeholder",
    "О чём этот канал",
  );

  await settled(page);
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "channel-settings-dark") });
});

test("the invitations block says nothing about how it works", async ({ page }, info) => {
  await openInfo(page, "group", {
    invites: [
      // Four people who are not in the chat, in four of the six states, each
      // invited by somebody who is: nobody invites themselves and nobody
      // invites the owner into his own group.
      invite("aaaa0000-0000-4000-8000-000000000001", LIDIA, "pending", ME),
      invite("aaaa0000-0000-4000-8000-000000000002", OLEG, "pending"),
      invite("aaaa0000-0000-4000-8000-000000000003", ELENA, "declined"),
      invite("aaaa0000-0000-4000-8000-000000000004", TIMUR, "expired", ME),
    ],
  });
  await onRoot(page, "Участники").click();

  const panel = page.getByTestId("chat-info-panel");
  await expect(panel).not.toContainText("Статусы обновляются без перезагрузки панели");
  // The button contradicted that sentence, and the binding on `group_invites`
  // had made both of them beside the point.
  await expect(page.getByRole("button", { name: "Обновить" })).toBeHidden();

  // What stands there instead is the one thing on this list a person can act on.
  await expect(page.getByTestId("chat-info-invites-waiting")).toHaveText("2 приглашения ждут ответа");

  const states = page.getByTestId("chat-info-invite-state");
  await expect(states).toHaveText(["Ждёт ответа", "Ждёт ответа", "Отклонено", "Истекло"]);
  // «Отказался» was a past tense agreeing with the invitee, so it was wrong for
  // every woman it named.
  await expect(panel).not.toContainText("Отказался");
  await expect(panel).not.toContainText("Ожидает подтверждения");

  await settled(page);
  await panel.screenshot({ path: shotPath(info, "invites-light") });
  await stampTheme(page, "dark");
  await panel.screenshot({ path: shotPath(info, "invites-dark") });
});

test("somebody who accepted and left is not shown as though they were here", async ({ page }) => {
  // The label knew the difference and the colour did not, because one read the
  // membership and the other read only the status.
  await openInfo(page, "group", {
    invites: [invite("aaaa0000-0000-4000-8000-000000000005", LIDIA, "accepted")],
  });
  await onRoot(page, "Участники").click();

  await expect(page.getByTestId("chat-info-invite-state")).toHaveText("Уже не в группе");
  await expect(page.getByRole("button", { name: "Пригласить снова" })).toBeVisible();
});

test("an empty list says which of the two kinds of empty it is", async ({ page }) => {
  await openInfo(page, "group", { invites: [] });
  await onRoot(page, "Участники").click();
  await expect(page.getByTestId("chat-info-invites-empty")).toHaveText("В группу ещё никого не приглашали.");
});

test("everybody invited having arrived is not the same as nobody invited", async ({ page }) => {
  // An accepted invitation from somebody who is in the chat is hidden, so the
  // old wording told people who had invited three and watched all three arrive
  // that there were no invitations.
  await openInfo(page, "group", {
    invites: [
      invite("aaaa0000-0000-4000-8000-000000000006", ANNA, "accepted"),
      invite("aaaa0000-0000-4000-8000-000000000007", PETR, "accepted"),
    ],
  });
  await onRoot(page, "Участники").click();
  await expect(page.getByTestId("chat-info-invites-empty")).toHaveText("Все приглашённые уже в группе.");
});

test("a channel's empty list speaks of a channel", async ({ page }) => {
  await openInfo(page, "channel", { invites: [] });
  await onRoot(page, "Подписчики").click();
  await expect(page.getByTestId("chat-info-invites-empty")).toHaveText("В канал ещё никого не приглашали.");
});

test("invitations being unavailable tells the reader what they cannot do", async ({ page }, info) => {
  await openInfo(page, "group", { invites: "unavailable" });
  await onRoot(page, "Участники").click();

  const banner = page.getByTestId("chat-info-invites-error");
  await expect(banner).toHaveText("Приглашения сейчас недоступны. Попробуйте позже.");
  // The condition is a missing migration. That is ours, and it named a repair
  // nobody reading it could make.
  await expect(banner).not.toContainText("базы данных");
  // And nothing under it claims to know what the list holds. The first frame of
  // this state carried «В группу ещё никого не приглашали.» directly beneath
  // the banner, over a list that had never loaded.
  await expect(page.getByTestId("chat-info-invites-empty")).toBeHidden();

  await settled(page);
  await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, "invites-unavailable-light") });
});
