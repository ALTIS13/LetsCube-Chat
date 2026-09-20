import { expect, test, type Page } from "@playwright/test";
import { openBotSettings, openBotTab } from "./helpers/botSettingsFixture";
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
 * A photograph of the two surfaces D-276 changes, not a contract.
 *
 * The owner judges a visual change on rendered pixels, so this produces them at
 * the two release widths in both themes:
 *
 *   1. «Приватность в группах» in the bot settings panel — where the request
 *      button stood;
 *   2. «Боты в группе» in a group's information panel — where the privacy state
 *      now has its audience, on each bot's own row.
 *
 * Every row it seeds is invented: no production chat, no real person, no bot
 * token, no owner id. The contracts for the same surfaces are
 * `bot-management.spec.ts`, `bot-group-membership.spec.ts` and the unit suites;
 * this file asserts nothing about the design and is safe to delete once the
 * change is signed off.
 *
 * Run it with `KUB_CAPTURE_LABEL=before` on the unchanged tree and again with
 * `KUB_CAPTURE_LABEL=after`, so the two sets sit side by side under
 * `output/bot-privacy/`.
 */

const LABEL = process.env.KUB_CAPTURE_LABEL ?? "after";
const WIDTHS = [390, 1440] as const;
const THEMES = ["dark", "light"] as const;

const AT = "2026-09-18T09:00:00.000Z";
const GROUP = "61111111-1111-4111-8111-000000000001";
const LINE = "Собираемся в четверг";

const ME = person("62222222-2222-4222-8222-000000000001", "Зоя Яблокова", "zoya");
const OLGA = person("62222222-2222-4222-8222-000000000002", "Ольга Мишина", "olga");

const HELPER = {
  id: "6bbbbbbb-1111-4111-8111-000000000001",
  username: "helper_bot",
  display_name: "Помощник",
  description: "Напоминает о встречах",
  avatar_url: null,
  state: "active",
  created_at: AT,
  updated_at: AT,
};

/**
 * A second bot, so the per-row line is photographed doing the thing a section
 * paragraph cannot do: saying two different things at once.
 *
 * `privacy_mode: "full"` is not reachable on the deployment today — nothing
 * writes it — so this row is what the surface will draw once a bot's owner can
 * turn the setting off, and it is here so the layout of that line is judged now
 * rather than after it ships.
 */
const SCRIBE = {
  id: "6bbbbbbb-1111-4111-8111-000000000002",
  username: "scribe_bot",
  display_name: "Протокол",
  description: "Ведёт итоги встреч",
  avatar_url: null,
  state: "active",
  created_at: AT,
  updated_at: AT,
};

async function shoot(page: Page, name: string, width: number, theme: string) {
  return page.screenshot({ path: `output/bot-privacy/${LABEL}-${name}-${width}-${theme}.png` });
}

test.describe("bot privacy surfaces, photographed", () => {
  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      test(`the bot settings privacy section at ${width} in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await openBotSettings(page, { theme, webFont: true });
        await openBotTab(page, "API");
        const section = page.locator('section[aria-labelledby="bot-section-Приватность в группах"]');
        await expect(section).toBeVisible();
        await section.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await shoot(page, "settings", width, theme);
      });

      test(`the group's bot list at ${width} in ${theme}`, async ({ page, request }) => {
        await requireFixtureServer(request);
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await openGroupPanel(page, theme);
        const bots = page.getByTestId("chat-info-bots");
        await expect(bots).toBeVisible();
        await bots.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await shoot(page, "group", width, theme);
      });
    }
  }
});

async function openGroupPanel(page: Page, theme: string) {
  const groupRow = { ...chat(GROUP, "group", "Команда проекта", AT), invite_policy: "owner_admin_only" };
  /**
   * What `chat_bot_members` answers, with the column the audience is drawn
   * from. Both shapes of row are seeded: the one every live membership has
   * today, and the one a bot whose owner turned privacy off would have.
   */
  const live: Row[] = [
    { chat_id: GROUP, privacy_mode: "restricted", bot: HELPER },
    { chat_id: GROUP, privacy_mode: "full", bot: SCRIBE },
  ];

  await openFixture(page, {
    me: ME,
    people: [OLGA],
    chats: [groupRow],
    memberships: [membership(GROUP, ME, "owner", AT), membership(GROUP, OLGA, "admin", AT)] as Row[],
    messages: [message("63333333-3333-4333-8333-000000000001", GROUP, OLGA, LINE, AT)],
    rpc: (name) => {
      if (name === "search_chat_messages") return missingFunction(name);
      if (name === "current_user_access_snapshot") return missingFunction(name);
      if (name === "has_permission") return { body: false };
      return undefined;
    },
  });

  await page.route("**/rest/v1/group_invites*", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/chat_bot_members*", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(live) });
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
}
