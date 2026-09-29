import { expect, type Page, test } from "@playwright/test";
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
import { RealtimeFixture } from "./helpers/realtime-fixture";

/**
 * D-260: a group's membership arrives by itself — in the information panel as
 * well as in the header — and costs nothing when it has not changed.
 *
 * The owner's report was the header: somebody accepted an invitation and the
 * count stayed where it was. `22fd0fdb` gave the store a peer's join and leave.
 * What this holds is the rest of the sweep the report asked for:
 *
 *   - the open panel hears a join, and the header does too;
 *   - a read mark — which is nearly every UPDATE on `chat_members` — does not
 *     reload the panel or the chat list behind it, where every one of them used
 *     to reload both, for as long as the panel stayed open;
 *   - a promotion does, and the new role is what the list shows;
 *   - somebody who leaves while their card is open takes the card with them;
 *   - a panel whose channel dropped reads itself again when it comes back,
 *     so a join nobody heard is not lost until the panel is reopened.
 *
 * Everything is fictional and mocked, the realtime server included. No
 * production screen is rendered.
 */

const AT = "2026-09-12T09:00:00.000Z";
const ZOYA = person("35353535-3535-4535-8535-000000000001", "Зоя Яблокова", "zoya");
const OLGA = person("35353535-3535-4535-8535-000000000002", "Ольга Крылова", "olga");
const BORIS = person("35353535-3535-4535-8535-000000000003", "Борис Ильин", "boris");
const KLARA = person("35353535-3535-4535-8535-000000000004", "Клара Новикова", "klara");
const CHAT_TEAM = "45454545-4545-4545-8545-000000000001";
const LINE = "Смета готова, посмотрите";

type Opened = { fixture: Fixture; memberships: Row[]; realtime: RealtimeFixture };

async function openPanel(page: Page): Promise<Opened> {
  const realtime = new RealtimeFixture();
  const memberships: Row[] = [
    membership(CHAT_TEAM, ZOYA, "owner", AT),
    membership(CHAT_TEAM, OLGA, "member", AT),
    membership(CHAT_TEAM, BORIS, "member", AT),
  ];
  const fixture = await openFixture(page, {
    me: ZOYA,
    people: [OLGA, BORIS, KLARA],
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships,
    messages: [message("55555555-5555-4555-8555-000000000001", CHAT_TEAM, OLGA, LINE, AT)],
    rpc: (name) => {
      if (name === "profile_badges") return { body: [] };
      if (name === "search_chat_messages") return missingFunction(name);
      return undefined;
    },
  });
  await realtime.install(page);
  await openChat(page, "Команда проекта", LINE);
  await page.getByTestId("chat-header-info-button").click();
  const panel = page.getByTestId("chat-info-panel");
  await expect(panel).toBeVisible();
  await panel.getByText("УЧАСТНИКИ", { exact: false }).first().click();
  await expect(row(page, OLGA)).toBeVisible();
  await expect.poll(() => realtime.isJoined("chat-info:")).toBe(true);
  return { fixture, memberships, realtime };
}

const row = (page: Page, who: { id: string }) =>
  page.locator(`[data-testid="chat-info-member"][data-member-id="${who.id}"]`);

const headerSays = (page: Page, text: string) =>
  expect(page.getByTestId("chat-control-row").getByText(text, { exact: true })).toBeVisible();

/** The panel's own member read — the only one that joins `profiles`. */
function panelReads(fixture: Fixture): number {
  return fixture
    .restCalls("chat_members", "GET")
    .filter((call) => decodeURIComponent((call as { search?: string }).search ?? "").includes("profiles("))
    .length;
}

/** The chat list's own read, which `dispatchChatsRefresh` brings about. */
function listReads(fixture: Fixture): number {
  return fixture.restCalls("chats", "GET").length;
}

function memberRow(who: { id: string }, role: string, at = new Date().toISOString()) {
  return {
    chat_id: CHAT_TEAM,
    user_id: who.id,
    role,
    joined_at: AT,
    last_read_at: at,
    last_delivered_at: at,
    hidden_at: null,
    cleared_at: null,
    pinned: false,
    pinned_at: null,
    pinned_order: null,
  };
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("somebody who joins appears in the open panel and in the header", async ({ page }) => {
  const { memberships, realtime } = await openPanel(page);
  await headerSays(page, "3 участника");

  memberships.push(membership(CHAT_TEAM, KLARA, "member", AT));
  expect(realtime.emit({ type: "INSERT", table: "chat_members", record: memberRow(KLARA, "member") })).toBeGreaterThan(0);

  await expect(row(page, KLARA)).toBeVisible();
  await headerSays(page, "4 участника");
});

test("a read mark costs the panel nothing, and the chat list nothing either", async ({ page }) => {
  const { fixture, realtime } = await openPanel(page);
  // Past the reads that opening the panel itself brought about.
  await page.waitForTimeout(800);
  const panelBefore = panelReads(fixture);
  const listBefore = listReads(fixture);

  // Olga reads, three times, which is what the table carries nearly always.
  for (let i = 0; i < 3; i += 1) {
    const at = new Date(Date.now() + i * 1000).toISOString();
    expect(realtime.emit({ type: "UPDATE", table: "chat_members", record: memberRow(OLGA, "member", at) })).toBeGreaterThan(0);
  }
  await page.waitForTimeout(800);

  expect(panelReads(fixture), "the panel reloaded its members for a read mark").toBe(panelBefore);
  expect(listReads(fixture), "the chat list was fetched again for a read mark").toBe(listBefore);
});

test("a promotion reloads the panel, and the list shows the new role", async ({ page }) => {
  const { fixture, memberships, realtime } = await openPanel(page);
  await page.waitForTimeout(800);
  const before = panelReads(fixture);
  await expect(row(page, OLGA)).not.toContainText("Администратор");

  const olga = memberships.find((entry) => entry.user_id === OLGA.id) as Row;
  olga.role = "admin";
  expect(realtime.emit({ type: "UPDATE", table: "chat_members", record: memberRow(OLGA, "admin") })).toBeGreaterThan(0);

  await expect.poll(() => panelReads(fixture), { message: "a promotion did not reach the panel" }).toBeGreaterThan(before);
  await expect(row(page, OLGA)).toContainText("Администратор");
});

test("somebody who leaves while their card is open takes the card with them", async ({ page }) => {
  const { memberships, realtime } = await openPanel(page);
  await row(page, BORIS).getByTestId("chat-info-member-open").click();
  const card = page.getByTestId("chat-info-member-card");
  await expect(card).toHaveAttribute("data-state", "current");

  memberships.splice(memberships.findIndex((entry) => entry.user_id === BORIS.id), 1);
  const gone = { chat_id: CHAT_TEAM, user_id: BORIS.id };
  expect(realtime.emit({ type: "DELETE", table: "chat_members", record: gone, old_record: gone })).toBeGreaterThan(0);

  await expect(card, "the card stayed open on somebody who had left").not.toHaveAttribute("data-state", "current");
  await expect(row(page, BORIS)).toHaveCount(0);
  await headerSays(page, "2 участника");
});

test("a panel whose channel dropped reads itself again when it comes back", async ({ page }) => {
  const { memberships, realtime } = await openPanel(page);
  const joinsBefore = realtime.joinCount("chat-info:");

  // Klara joins while nobody is listening: the event is lost with the socket.
  await realtime.dropConnections();
  memberships.push(membership(CHAT_TEAM, KLARA, "member", AT));

  await expect
    .poll(() => realtime.joinCount("chat-info:"), { timeout: 20_000, message: "the panel's channel never came back" })
    .toBeGreaterThan(joinsBefore);
  await expect(row(page, KLARA), "a join made while the channel was down stayed unseen").toBeVisible({ timeout: 10_000 });
});
