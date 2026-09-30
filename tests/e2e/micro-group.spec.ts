import { expect, test, type Page, type Route } from "@playwright/test";
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
 * The micro-group, «групповой чат» — tracker item 45, first phase.
 *
 * The owner's design: two people are talking in a private chat, one presses
 * «Добавить в беседу», and a small group exists — the two of them and whoever
 * was picked — with a crown on its creator as its only hierarchy. The rules are
 * the database's (`20260930150000_micro_groups.sql`): ten at most, anybody adds,
 * the crown removes, nobody across a block. Here the functions are mocked on
 * the fixture host and everybody is fictional.
 */

test.use({ screenshot: "off", trace: "off", video: "off" });

const AT = "2026-09-30T09:00:00.000Z";
const ME = person("f1111111-1111-4111-8111-000000000001", "Зоя Яблокова", "zoya");
const ANNA = person("f1111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const BORIS = person("f1111111-1111-4111-8111-000000000003", "Борис Ильин", "boris");
const PRIVATE = "f2222222-2222-4222-8222-000000000001";
const TEAM = "f2222222-2222-4222-8222-000000000002";
const MICRO = "f2222222-2222-4222-8222-000000000003";
const LINE = "Созвонимся втроём?";

interface Seen {
  calls: { name: string; body: Row }[];
}

async function boot(
  page: Page,
  options: { micro?: { owner: typeof ME } ; blocked?: string[]; failCreate?: string } = {},
): Promise<Seen> {
  const seen: Seen = { calls: [] };
  const chats: Row[] = [
    chat(PRIVATE, "private", null, "2026-09-30T09:10:00.000Z"),
    chat(TEAM, "group", "Команда", AT),
  ];
  const memberships: Row[] = [
    membership(PRIVATE, ME, "owner", AT),
    membership(PRIVATE, ANNA, "member", AT),
    membership(TEAM, ME, "owner", AT),
    membership(TEAM, BORIS, "member", AT),
  ];
  const messages: Row[] = [message("f3333333-3333-4333-8333-000000000001", PRIVATE, ANNA, LINE, "2026-09-30T09:10:00.000Z")];
  if (options.micro) {
    chats.push(chat(MICRO, "dm_group", null, "2026-09-30T09:20:00.000Z"));
    const owner = options.micro.owner;
    for (const who of [ME, ANNA, BORIS]) memberships.push(membership(MICRO, who, who.id === owner.id ? "owner" : "member", AT));
    messages.push(message("f3333333-3333-4333-8333-000000000002", MICRO, ANNA, "Всем привет", "2026-09-30T09:20:00.000Z"));
  }
  await openFixture(page, {
    me: ME,
    people: [ANNA, BORIS],
    chats,
    memberships,
    messages,
    rpc: (name, body) => {
      if (name === "search_chat_messages" || name === "current_user_access_snapshot") return missingFunction(name);
      if (!name.startsWith("micro_group_")) return undefined;
      seen.calls.push({ name, body });
      if (name === "micro_group_create") {
        if (options.failCreate) return { status: 403, body: { message: options.failCreate, code: "42501" } };
        chats.push(chat(MICRO, "dm_group", null, "2026-09-30T09:30:00.000Z"));
        memberships.push(membership(MICRO, ME, "owner", AT));
        for (const id of [ANNA.id, ...(body.p_user_ids as string[])]) {
          const who = [ANNA, BORIS].find((candidate) => candidate.id === id);
          if (who) memberships.push(membership(MICRO, who, "member", AT));
        }
        return { body: MICRO };
      }
      return { body: null };
    },
  });
  await page.route("**/rest/v1/user_blocks*", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const rows = (options.blocked ?? []).map((id) => ({ blocked_id: id, created_at: AT }));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
  return seen;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("the gesture: from a private chat, «Добавить в беседу» makes a group chat of the two and the one picked", async ({ page }) => {
  const seen = await boot(page);
  await openChat(page, "Анна Смирнова", LINE);
  await page.getByTestId("chat-header-add-people").click();

  const candidates = page.getByTestId("micro-group-candidate");
  await expect(candidates.filter({ hasText: "Борис Ильин" })).toHaveCount(1);
  await expect(candidates.filter({ hasText: "Анна Смирнова" }), "the private chat's other person is in it already").toHaveCount(0);
  await expect(page.getByTestId("micro-group-room")).toHaveText("Выбрано 0 из 8");

  await candidates.filter({ hasText: "Борис Ильин" }).click();
  await expect(page.getByTestId("micro-group-submit")).toHaveText("Создать групповой чат (3)");
  await page.getByTestId("micro-group-submit").click();

  await expect.poll(() => seen.calls.map((call) => call.name)).toEqual(["micro_group_create"]);
  expect(seen.calls[0].body).toEqual({ p_private_chat_id: PRIVATE, p_user_ids: [BORIS.id] });
  // Called what this reader sees: the others' first names, in the order they came.
  await expect(page.getByTestId("chat-header-info-button")).toContainText("Анна, Борис");
  await expect(page.getByTestId("chat-header-info-button")).toContainText("3 участника");
});

test("the card: «Участники — 3», a crown on its creator, a name any member gives, the crown's removal", async ({ page }) => {
  const seen = await boot(page, { micro: { owner: ME } });
  await openChat(page, "Анна, Борис", "Всем привет");
  await page.getByTestId("chat-header-info-button").click();
  const section = page.getByTestId("micro-group-section");
  await expect(section).toBeVisible();
  await expect(section.getByTestId("micro-group-members-heading")).toHaveText("Участники — 3");
  const crowned = section.locator('[data-testid="micro-group-member"][data-owner="true"]');
  await expect(crowned).toHaveCount(1);
  await expect(crowned).toContainText("Зоя Яблокова");
  await expect(crowned.getByTestId("micro-group-crown")).toBeVisible();
  // The crown removes; nobody removes the crown.
  await expect(section.getByRole("button", { name: /Удалить из чата: Анна Смирнова/ })).toBeVisible();
  await expect(section.getByRole("button", { name: /Удалить из чата: Зоя/ })).toHaveCount(0);

  await section.getByTestId("micro-group-rename").click();
  await section.getByTestId("micro-group-name-input").fill("Склад");
  await section.getByTestId("micro-group-name-save").click();
  await expect.poll(() => seen.calls.find((call) => call.name === "micro_group_rename")?.body).toEqual({ p_chat_id: MICRO, p_name: "Склад" });
  // Leaving and deleting are at the card's foot, below the rows every chat has.
  await expect(page.getByTestId("micro-group-delete")).toBeVisible();
});

test("a member without the crown removes nobody, and leaving asks first", async ({ page }) => {
  const seen = await boot(page, { micro: { owner: ANNA } });
  await openChat(page, "Анна, Борис", "Всем привет");
  await page.getByTestId("chat-header-info-button").click();
  const section = page.getByTestId("micro-group-section");
  await expect(section.locator('[data-testid="micro-group-member"][data-owner="true"]')).toContainText("Анна Смирнова");
  await expect(section.getByRole("button", { name: /Удалить из чата/ })).toHaveCount(0);
  await expect(page.getByTestId("micro-group-delete")).toHaveCount(0);

  await page.getByTestId("micro-group-leave").click();
  await page.getByRole("button", { name: "Покинуть", exact: true }).click();
  await expect.poll(() => seen.calls.map((call) => call.name)).toContain("micro_group_leave");
});

test("somebody the reader blocked is not offered, and their being in a group is said", async ({ page }) => {
  await boot(page, { micro: { owner: ME }, blocked: [BORIS.id] });
  await openChat(page, "Анна Смирнова", LINE);
  await page.getByTestId("chat-header-add-people").click();
  await expect(page.getByTestId("micro-group-candidates")).toBeVisible();
  await expect(page.getByTestId("micro-group-candidate").filter({ hasText: "Борис Ильин" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await openChat(page, "Анна, Борис", "Всем привет");
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("micro-group-blocked-note")).toBeVisible();
});

test("a refusal is said in words, and a block against the reader is not named", async ({ page }) => {
  await boot(page, { failCreate: "micro_group_unavailable" });
  await openChat(page, "Анна Смирнова", LINE);
  await page.getByTestId("chat-header-add-people").click();
  await page.getByTestId("micro-group-candidate").filter({ hasText: "Борис Ильин" }).click();
  await page.getByTestId("micro-group-submit").click();
  await expect(page.getByTestId("micro-group-error")).toHaveText("Одного из выбранных нельзя добавить.");
});
