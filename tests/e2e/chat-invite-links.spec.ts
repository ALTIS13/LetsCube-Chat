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
 * A link into a group — D-170's last half (2026-09-30).
 *
 * Made where people are invited by name, as Telegram keeps «Пригласить по
 * ссылке» at the top of that screen; limited as Telegram's link editor limits
 * it (1 hour, 1 day, 1 week or none; 1, 10, 100 or none); copied the moment it
 * exists; withdrawn at once. Opened, it shows the owner's answer, ± Telegram:
 * the group's picture, name and member count, and one button.
 *
 * Everything is fictional and mocked on the fixture host.
 */

test.use({ screenshot: "off", trace: "off", video: "off" });

const AT = "2026-09-30T09:00:00.000Z";
const LINE = "Склад открыт до восьми";
const GROUP = "e1111111-1111-4111-8111-000000000001";
const ME = person("e2222222-2222-4222-8222-000000000001", "Зоя Яблокова", "zoya");
const OLGA = person("e2222222-2222-4222-8222-000000000002", "Ольга Мишина", "olga");
const TOKEN = "AbCdEfGhIjKlMnOpQrStU_";

interface Seen {
  created: Record<string, unknown>[];
  revoked: string[];
  joined: string[];
}

async function boot(
  page: Page,
  options: { myRole?: "owner" | "member"; preview?: Record<string, unknown>; panelPolicy?: string; modalPolicy?: string } = {},
): Promise<Seen> {
  const { myRole = "owner", preview, panelPolicy = "owner_admin_only", modalPolicy = panelPolicy } = options;
  const seen: Seen = { created: [], revoked: [], joined: [] };
  const groupRow = { ...chat(GROUP, "group", "Команда склада", AT), invite_policy: panelPolicy };
  const links: Record<string, unknown>[] = [];
  await openFixture(page, {
    me: ME,
    people: [OLGA],
    chats: [groupRow],
    memberships: [
      membership(GROUP, ME, myRole, AT),
      membership(GROUP, OLGA, myRole === "owner" ? "member" : "owner", AT),
    ] as Row[],
    messages: [message("e3333333-3333-4333-8333-000000000001", GROUP, OLGA, LINE, AT)],
    rpc: (name, body) => {
      if (name === "search_chat_messages" || name === "current_user_access_snapshot") return missingFunction(name);
      if (name === "has_permission") return { body: false };
      if (name === "chat_invite_link_create") {
        seen.created.push(body);
        const row = {
          id: `e4444444-4444-4444-8444-00000000000${seen.created.length}`,
          chat_id: GROUP,
          token: TOKEN,
          title: body.p_title ?? null,
          created_by: ME.id,
          created_at: new Date().toISOString(),
          expires_at: typeof body.p_expires_in_seconds === "number"
            ? new Date(Date.now() + Number(body.p_expires_in_seconds) * 1000).toISOString()
            : null,
          max_uses: body.p_max_uses ?? null,
          uses: 0,
          revoked_at: null,
        };
        links.unshift(row);
        return { body: row };
      }
      if (name === "chat_invite_link_revoke") {
        seen.revoked.push(String(body.p_link_id));
        return { body: null };
      }
      if (name === "chat_invite_link_preview") return { body: [preview ?? { state: "invalid", chat_id: null, name: null, avatar_url: null, member_count: null }] };
      if (name === "chat_invite_link_join") {
        seen.joined.push(String(body.p_token));
        return { body: GROUP };
      }
      return undefined;
    },
  });
  await page.route("**/rest/v1/chat_invite_links*", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(links) });
  });
  await page.route("**/rest/v1/group_invites*", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/chat_members*", (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.fallback();
    if (!(url.searchParams.get("select") ?? "").includes("chat:chats")) return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ role: myRole, chat: { ...groupRow, invite_policy: modalPolicy } }) });
  });
  return seen;
}

async function openInvite(page: Page) {
  await openChat(page, "Команда склада", LINE);
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
  await page.getByRole("button", { name: "Пригласить пользователя" }).first().click();
  await expect(page.getByTestId("invite-candidates")).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("an owner makes a link with Telegram's limits, it is copied at once, and withdrawn", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const seen = await boot(page);
  await openInvite(page);

  await page.getByTestId("invite-by-link").click();
  const panel = page.getByTestId("invite-links-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("invite-links-empty")).toBeVisible();
  // Telegram's defaults: neither limit.
  await expect(panel.getByTestId("invite-link-expiry").getByRole("radio", { name: "Без срока" })).toHaveAttribute("aria-checked", "true");
  await expect(panel.getByTestId("invite-link-uses").getByRole("radio", { name: "Без ограничений" })).toHaveAttribute("aria-checked", "true");

  await panel.getByTestId("invite-link-expiry").getByRole("radio", { name: "1 день" }).click();
  await panel.getByTestId("invite-link-uses").getByRole("radio", { name: "10", exact: true }).click();
  await panel.getByTestId("invite-link-title").fill("Для склада");
  await panel.getByTestId("invite-link-create").click();

  await expect.poll(() => seen.created.length).toBe(1);
  expect(seen.created[0]).toMatchObject({ p_chat_id: GROUP, p_expires_in_seconds: 86_400, p_max_uses: 10, p_title: "Для склада" });
  const row = panel.getByTestId("invite-link-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Для склада");
  await expect(row).toContainText("0 из 10 входов · истекает через 1 день");
  const origin = new URL(page.url()).origin;
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/join/${TOKEN}`);

  await row.getByRole("button", { name: /Отозвать ссылку/ }).click();
  await page.getByRole("button", { name: "Отозвать", exact: true }).click();
  await expect.poll(() => seen.revoked.length).toBe(1);
  await expect(row).toHaveCount(0);

  // Back to inviting by name, where the dialog began.
  await page.getByTestId("invite-links-back").click();
  await expect(page.getByTestId("invite-candidates")).toBeVisible();
});

test("a plain member of a group whose owner alone invites is not offered a link", async ({ page }) => {
  // The panel read «members may invite» and offers the button; the dialog's own
  // read a moment later says the owner alone may. The server decides by the
  // second, and so must the link.
  await boot(page, { myRole: "member", panelPolicy: "members_can_invite", modalPolicy: "owner_admin_only" });
  await openChat(page, "Команда склада", LINE);
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
  // D-165: the action is not hidden in silence — the dialog opens and says why.
  await page.getByRole("button", { name: "Пригласить пользователя" }).first().click();
  await expect(page.getByTestId("invite-denied")).toBeVisible();
  await expect(page.getByTestId("invite-by-link")).toHaveCount(0);
});

test("a link shows the group's picture, name and count, and one button joins", async ({ page }) => {
  const seen = await boot(page, { myRole: "owner", preview: { state: "ok", chat_id: GROUP, name: "Команда склада", avatar_url: null, member_count: 3 } });
  await page.goto(`/join/${TOKEN}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("join-name")).toHaveText("Команда склада");
  await expect(page.getByTestId("join-count")).toHaveText("3 участника");
  await page.getByTestId("join-button").click();
  await expect.poll(() => seen.joined).toEqual([TOKEN]);
  await expect(page).toHaveURL(new RegExp(`/chat/${GROUP}$`));
});

test("a dead link says why and names no group", async ({ page }) => {
  await boot(page, { preview: { state: "revoked", chat_id: null, name: null, avatar_url: null, member_count: null } });
  await page.goto(`/join/${TOKEN}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("join-dead")).toHaveAttribute("data-join-state", "revoked");
  await expect(page.getByTestId("join-dead")).toContainText("отозвали");
  await expect(page.getByTestId("join-name")).toHaveCount(0);
  await expect(page.getByTestId("join-button")).toHaveCount(0);
});

test("somebody already inside is taken to the group, and no use is spent", async ({ page }) => {
  const seen = await boot(page, { preview: { state: "member", chat_id: GROUP, name: "Команда склада", avatar_url: null, member_count: 2 } });
  await page.goto(`/join/${TOKEN}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("join-open").click();
  await expect(page).toHaveURL(new RegExp(`/chat/${GROUP}$`));
  expect(seen.joined).toEqual([]);
});
