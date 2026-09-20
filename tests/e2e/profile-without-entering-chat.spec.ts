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
 * D-283: «Открыть профиль» in the chat list opened the conversation.
 *
 * The owner's sentence is the whole of the measurement: «У нас пропала
 * возможность открыть профиль пользователя не заходя в ЛС с ним.» So the thing
 * this file measures is not what the profile card says — that is covered where
 * the card lives — but **what else happened** when it was asked for.
 *
 * `ChatList.tsx` built the entry's `run` as `selectAndOpenPanel("info")`, which
 * is `onChatSelect(chat.id)` followed by `requestChatPanel(chat.id, "info")`.
 * The label promised a profile and the action entered a private conversation
 * with that person — an act with consequences, because entering a chat marks
 * its messages read.
 *
 * **Against the shipped build the first test in each viewport goes red**, and
 * it goes red on the assertion that names the defect rather than on a missing
 * element: at 1440 the welcome pane is replaced by the conversation, and at 390
 * the chat list is gone from the screen entirely. That was run before the fix
 * and recorded; a spec that only checked «a profile is visible» would have
 * passed both before and after, because a profile *was* visible — inside the
 * chat it had just opened.
 *
 * The second test is the other half of the contract and the reason the first
 * one is not simply «nothing happens»: the profile must still be **reachable**,
 * and from it the conversation must still be **one press away**. A repair that
 * removed the entry would pass an assertion written only as a negative.
 *
 * Everything is fictional and mocked; no production screen is rendered. Needs
 * the dev server on the fixture host.
 */

const AT = "2026-09-20T09:00:00.000Z";

const ME = person("31111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("31111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const BORIS = person("31111111-1111-4111-8111-000000000003", "Борис Ильин", "boris");

const CHAT_ANNA = "32222222-2222-4222-8222-000000000001";
const CHAT_TEAM = "32222222-2222-4222-8222-000000000002";

const HERS = "Смета на витрину готова, посмотри";
const IN_GROUP = "Макет главной готов, посмотрите";

function seed(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [
      chat(CHAT_ANNA, "private", null, AT),
      chat(CHAT_TEAM, "group", "Команда проекта", "2026-09-20T08:00:00.000Z"),
    ],
    memberships: [
      membership(CHAT_ANNA, ME, "owner", AT),
      membership(CHAT_ANNA, ANNA, "member", AT),
      membership(CHAT_TEAM, ME, "owner", AT),
      membership(CHAT_TEAM, BORIS, "member", AT),
    ],
    messages: [
      message("35555555-5555-4555-8555-000000000001", CHAT_ANNA, ANNA, HERS, "2026-09-20T10:00:00.000Z"),
      message("35555555-5555-4555-8555-000000000002", CHAT_TEAM, BORIS, IN_GROUP, "2026-09-20T09:30:00.000Z"),
    ],
  };
}

async function boot(page: Page) {
  return openFixture(page, {
    me: ME,
    people: [ANNA, BORIS],
    ...seed(),
    rpc: (name, body) => {
      if (name === "search_chat_messages") return missingFunction(name);
      // The one door to a private conversation. It is answered here because
      // the second test's whole subject is that the card still offers it and
      // that taking it is what enters — the conversation must be reachable
      // from the overlay, and unreachable without pressing for it.
      if (name === "open_or_create_private_chat") {
        return { body: body.target_user_id === ANNA.id ? CHAT_ANNA : null };
      }
      return undefined;
    },
  });
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

/**
 * The row's own menu, by the pointer this width has.
 *
 * A phone reaches it by a long press — `ChatListItem` arms that on
 * `pointerdown` with `pointerType === "touch"` — and a computer by a right
 * click. Both land on the same `buildActions` list; only the container differs.
 */
async function openRowMenu(page: Page, rowText: string) {
  const row = page.getByTestId("chat-list-item").filter({ hasText: rowText }).first();
  await expect(row).toBeVisible();
  if (!isPhone(page)) {
    await row.click({ button: "right" });
    const menu = page.locator('[data-chat-context-menu="desktop"]');
    await expect(menu).toBeVisible();
    return menu;
  }
  // A tap is down-and-up inside one frame, so `touchscreen.tap` would open the
  // conversation rather than the menu — which is the very act this file is
  // measuring the absence of. The press is dispatched on its own and the 520ms
  // timer is then allowed to elapse; nothing sends the matching `pointerup`,
  // because `onPointerUp` is what cancels it.
  await row.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 1, isPrimary: true });
  const sheet = page.locator('[data-chat-context-menu="mobile"]');
  await expect(sheet).toBeVisible({ timeout: 4_000 });
  return sheet;
}

test.describe("a person's profile is reachable without entering the conversation", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("«Открыть профиль» does not open the private chat", async ({ page }) => {
    const fixture = await boot(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const menu = await openRowMenu(page, ANNA.full_name);
    await menu.getByText("Открыть профиль", { exact: true }).click();

    const profile = page.getByTestId("user-profile-overlay");
    await expect(profile).toBeVisible();
    await expect(profile).toContainText(ANNA.full_name);

    // The conversation is not on screen. `chat-header-shell` is drawn only
    // when one is open, so the count is read rather than the visibility: an
    // overlay covering an opened chat would still satisfy «the welcome screen
    // is not what I can see», and would not satisfy this.
    await expect(page.getByTestId("chat-header-shell")).toHaveCount(0);
    if (isPhone(page)) {
      await expect(page.getByTestId("chat-list-scroller")).toBeVisible();
    } else {
      await expect(page.getByTestId("welcome-screen")).toBeVisible();
    }

    // And the consequence the reader cannot see, which is the reason this is a
    // defect rather than a routing preference: entering a conversation reports
    // her message read. Asking who somebody is must not tell them you have
    // read what they wrote. Measured against the shipped build on 2026-09-20,
    // both viewports sent `mark_chat_read_through` with her message's
    // timestamp.
    //
    // **`mark_chat_delivered` is deliberately not in this list.** `useChats`
    // sends it from the LIST, for a row whose last message arrived — it fires
    // whether or not anybody opened anything, and at 390 it landed inside this
    // window while at 1440 it did not. Asserting on it would make this test
    // about the receipt scheduler's timing rather than about the entry, and
    // «delivered» is true either way: the device did receive the message.
    await page.waitForTimeout(1_200);
    const read = [...fixture.rpcBodies("mark_chat_read"), ...fixture.rpcBodies("mark_chat_read_through")];
    expect(read, "asking for a profile must not report her message read").toEqual([]);
  });

  test("the profile still offers the conversation, and taking it enters", async ({ page }) => {
    await boot(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const menu = await openRowMenu(page, ANNA.full_name);
    await menu.getByText("Открыть профиль", { exact: true }).click();

    const profile = page.getByTestId("user-profile-overlay");
    await expect(profile).toBeVisible();

    await profile.getByTestId("member-card-open-chat").click();
    await expect(page.getByTestId("chat-header-shell")).toBeVisible();
    await expect(page.getByTestId("user-profile-overlay")).toHaveCount(0);
  });
});
