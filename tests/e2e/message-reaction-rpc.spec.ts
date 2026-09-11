import { expect, test } from "@playwright/test";

import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openDesktopMenu,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * One reaction per person, made in one call.
 *
 * The client used to look up the person's reactions, delete them and insert the
 * new one — three requests, and two devices racing could leave two reactions.
 * `set_message_reaction` (20260911142000) makes the toggle atomically and
 * answers with every reaction on the message, which the conversation then
 * shows as it is. Where that function is not deployed, the three requests, as
 * before, and the function is not asked again.
 */

const ME = person("11111111-1111-4111-8111-1111111111d1", "Максим");
const ANYA = person("11111111-1111-4111-8111-1111111111d2", "Аня");
const BORIS = person("11111111-1111-4111-8111-1111111111d3", "Борис");
const GROUP_CHAT = "22222222-2222-4222-8222-2222222222d1";
const MESSAGE = "55555555-5555-4555-8555-5555555555d1";
const GROUP_NAME = "Выходные";
const TEXT = "Пятница в силе?";
const SENT = new Date(Date.now() - 20 * 60_000).toISOString();

function group(rpc: (name: string, body: Row) => ReturnType<typeof missingFunction> | { body: unknown } | undefined) {
  return {
    me: ME,
    chats: [chat(GROUP_CHAT, "group", GROUP_NAME, SENT)],
    memberships: [
      membership(GROUP_CHAT, ME, "member", SENT),
      membership(GROUP_CHAT, ANYA, "owner", SENT),
      membership(GROUP_CHAT, BORIS, "member", SENT),
    ],
    messages: [message(MESSAGE, GROUP_CHAT, ANYA, TEXT, SENT)],
    rpc,
  };
}

test.describe("a reaction is one call to the server", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("choosing ❤️ calls set_message_reaction, and the message shows what the server holds", async ({ page }) => {
    const fixture = await openFixture(page, group((name, body) =>
      name === "set_message_reaction"
        ? {
            body: [
              { id: "reaction-boris", message_id: MESSAGE, user_id: BORIS.id, emoji: "👍", created_at: SENT },
              { id: "reaction-me", message_id: MESSAGE, user_id: ME.id, emoji: String(body.p_emoji), created_at: new Date().toISOString() },
            ],
          }
        : undefined,
    ));
    const bubble = await openChat(page, GROUP_NAME, TEXT);
    const row = page.locator(`[data-message-id="${MESSAGE}"]`);
    const menu = await openDesktopMenu(page, bubble);
    await menu.getByRole("button", { name: "Поставить реакцию ❤️" }).click();

    await expect(row.locator('[data-reaction-chip="❤️"]')).toBeVisible();
    await expect(row.locator('[data-reaction-chip="👍"]'), "the server's answer did not replace the guess").toBeVisible();
    expect(fixture.rpcBodies("set_message_reaction")).toEqual([{ p_message_id: MESSAGE, p_emoji: "❤️" }]);
    expect(fixture.restCalls("reactions"), "the reaction was still made with table requests").toEqual([]);
  });

  test("where the server has no set_message_reaction, the reaction is made as before, and the function is not asked again", async ({ page }) => {
    const fixture = await openFixture(page, group((name) => (name === "set_message_reaction" ? missingFunction(name) : undefined)));
    const bubble = await openChat(page, GROUP_NAME, TEXT);
    const row = page.locator(`[data-message-id="${MESSAGE}"]`);

    let menu = await openDesktopMenu(page, bubble);
    await menu.getByRole("button", { name: "Поставить реакцию ❤️" }).click();
    await expect(row.locator('[data-reaction-chip="❤️"]')).toBeVisible();
    await expect.poll(() => fixture.restCalls("reactions", "POST").length).toBe(1);

    menu = await openDesktopMenu(page, bubble);
    await menu.getByRole("button", { name: "Поставить реакцию ❤️" }).click();
    await expect(row.locator('[data-reaction-chip="❤️"]')).toHaveCount(0);
    await expect.poll(() => fixture.restCalls("reactions", "DELETE").length).toBe(1);
    expect(fixture.rpcBodies("set_message_reaction"), "a function the server lacks was asked for again").toHaveLength(1);
  });
});
