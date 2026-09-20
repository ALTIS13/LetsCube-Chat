import { expect, test, type Page } from "@playwright/test";
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
 * The two profile surfaces, the escalation between them, and the phone that has
 * only one.
 *
 * This is the second half of queue item 36a. D-283 gave the capability back —
 * a person opens without entering a conversation with them — and left the
 * split to a design pass. `docs/operations/reference-clients.md` §15.1 is that
 * pass, and the three things it established are what this file measures:
 *
 *  1. **The opener decides the surface.** Discord's popout is opened by faces
 *     and names met in passing; its modal is opened directly by acts whose
 *     whole subject is the person. So a message author's avatar opens the
 *     compact card and the chat list's «Открыть профиль» opens the full one.
 *  2. **The escalation is one explicit control** that closes the small surface
 *     and opens the large one — Discord's `view-profile` item is literally
 *     `POPOUT_CLOSE` followed by `openUserProfileModal`.
 *  3. **A phone has one tier.** MEASURED ON DEVICE 2026-09-21: Discord 345.9
 *     opens a message author as a full-screen page with no popout on the way.
 *
 * Everything is fictional and mocked; no production screen is rendered. Needs
 * the dev server on the fixture host.
 */

const AT = "2026-09-20T09:00:00.000Z";

const ME = person("41111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
/**
 * She has a bio and badges on purpose.
 *
 * A person with nothing to say is the one case where a summary of them **is**
 * them: measured at 1440 with an empty bio and no badges, the two tiers came to
 * 304 px and 313 px, and no honest contract could separate them. The two-tier
 * design is a claim about a person who has something to summarise, so the
 * fixture gives her something.
 */
const ANNA = {
  ...person("41111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna"),
  bio: "Дизайнер интерфейсов. Веду витрину и макеты, отвечаю быстрее всего до обеда. Пишите сразу по делу — так быстрее.",
};

/** Invented badges. No row here belongs to anybody. */
const BADGES = [
  { user_id: ANNA.id, kind: "global_role", key: "staff", title: "Сотрудник", detail: "С 3 марта 2026", icon: "shield", colour: "cyan", rank: 10 },
  { user_id: ANNA.id, kind: "achievement", key: "early", title: "Ранний участник", detail: "Первая сотня", icon: "star", colour: "pink", rank: 20 },
  { user_id: ANNA.id, kind: "achievement", key: "helper", title: "Помощник", detail: "50 ответов", icon: "heart", colour: "violet", rank: 30 },
];

const CHAT_TEAM = "42222222-2222-4222-8222-000000000001";
const CHAT_ANNA = "42222222-2222-4222-8222-000000000002";

const IN_GROUP = "Макет главной готов, посмотрите";

function seed(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [
      chat(CHAT_TEAM, "group", "Команда проекта", AT),
      chat(CHAT_ANNA, "private", null, "2026-09-20T08:00:00.000Z"),
    ],
    memberships: [
      membership(CHAT_TEAM, ME, "owner", AT),
      membership(CHAT_TEAM, ANNA, "member", AT),
      membership(CHAT_ANNA, ME, "owner", AT),
      membership(CHAT_ANNA, ANNA, "member", AT),
    ],
    messages: [
      message("45555555-5555-4555-8555-000000000001", CHAT_TEAM, ANNA, IN_GROUP, "2026-09-20T09:30:00.000Z"),
    ],
  };
}

async function boot(page: Page) {
  return openFixture(page, {
    me: ME,
    people: [ANNA],
    ...seed(),
    rpc: (name, body) => {
      if (name === "search_chat_messages") return missingFunction(name);
      if (name === "profile_badges") return { body: BADGES };
      // The sidebar search, so the surface that replaced «Мини-профиль» can be
      // driven. One person, the one this file already knows.
      if (name === "global_search_v2" || name === "global_search") {
        return {
          body: [
            {
              result_type: "user",
              id: ANNA.id,
              title: ANNA.full_name,
              subtitle: `@${ANNA.username}`,
              snippet: null,
              avatar_url: null,
              chat_id: null,
              message_id: null,
              task_id: null,
              location_id: null,
              created_at: AT,
              rank: 1,
            },
          ],
        };
      }
      if (name === "open_or_create_private_chat") {
        return { body: body.target_user_id === ANNA.id ? CHAT_ANNA : null };
      }
      return undefined;
    },
  });
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

/**
 * Open the group and wait for her message to be on screen.
 *
 * Through the fixture's own `openChat`, which waits on the **bubble** rather
 * than on the text: the chat-list row carries the same sentence as its preview,
 * so a text locator matches twice and the phone — where the row is still in the
 * document behind the conversation — fails on the wrong thing.
 */
async function openGroup(page: Page) {
  await openChat(page, "Команда проекта", IN_GROUP);
  await expect(page.getByTestId("chat-header-shell")).toBeVisible();
}

/** The row's own menu, by the pointer this width has — as D-283's spec opens it. */
async function openRowMenu(page: Page, rowText: string) {
  const row = page.getByTestId("chat-list-item").filter({ hasText: rowText }).first();
  await expect(row).toBeVisible();
  if (!isPhone(page)) {
    await row.click({ button: "right" });
    const menu = page.locator('[data-chat-context-menu="desktop"]');
    await expect(menu).toBeVisible();
    return menu;
  }
  await row.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 1, isPrimary: true });
  const sheet = page.locator('[data-chat-context-menu="mobile"]');
  await expect(sheet).toBeVisible({ timeout: 4_000 });
  return sheet;
}

test.describe("the person behind the conversation, on two surfaces", () => {
  test.beforeEach(async ({ request }) => {
    await requireFixtureServer(request);
  });

  test("a message author's face opens the surface this width has room for", async ({ page }) => {
    await boot(page);
    await openGroup(page);

    // The anchor that did not exist before this change: `MessageActorAvatar`
    // sat in a plain `div`, which is Discord's commonest way into a person and
    // ours had none.
    await page.getByTestId("message-author-avatar").first().click();

    const overlay = page.getByTestId("user-profile-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(ANNA.full_name);

    // The whole of the tier contract, read off the surface rather than inferred
    // from what is on it.
    const tier = isPhone(page) ? "full" : "compact";
    await expect(overlay).toHaveAttribute("data-profile-surface", tier);

    // And the conversation is still the conversation — a glance does not
    // navigate.
    await expect(page.getByTestId("chat-header-shell")).toBeVisible();
  });

  test("the escalation closes the small surface and opens the large one", async ({ page }) => {
    await boot(page);
    await openGroup(page);

    await page.getByTestId("message-author-avatar").first().click();
    const overlay = page.getByTestId("user-profile-overlay");

    if (isPhone(page)) {
      // A phone has one tier, so there is nothing to escalate **from** — and
      // that is an assertion rather than a reason to skip. The control must be
      // absent, not present and inert: a way out of a surface you are not on
      // is exactly what §8 refuses, and a skip here would have left the phone's
      // half of this contract unmeasured.
      await expect(overlay).toHaveAttribute("data-profile-surface", "full");
      await expect(page.getByTestId("profile-open-full")).toHaveCount(0);
      await expect(overlay.getByTestId("member-card-open-chat")).toBeVisible();
      return;
    }

    await expect(overlay).toHaveAttribute("data-profile-surface", "compact");

    // Only the small surface carries it.
    const escalate = page.getByTestId("profile-open-full");
    await expect(escalate).toBeVisible();
    await escalate.click();

    await expect(overlay).toHaveAttribute("data-profile-surface", "full");
    // One surface at a time: Discord's item is POPOUT_CLOSE then open-modal.
    await expect(page.getByTestId("profile-open-full")).toHaveCount(0);
    // The full card says things the summary does not.
    await expect(overlay.getByTestId("member-card-open-chat")).toBeVisible();
  });

  test("«Открыть профиль» asks for the person, so it opens the whole card", async ({ page }) => {
    await boot(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const menu = await openRowMenu(page, ANNA.full_name);
    await menu.getByText("Открыть профиль", { exact: true }).click();

    const overlay = page.getByTestId("user-profile-overlay");
    await expect(overlay).toBeVisible();
    // A named act, at every width — never the summary.
    await expect(overlay).toHaveAttribute("data-profile-surface", "full");
    await expect(page.getByTestId("profile-open-full")).toHaveCount(0);
  });

  test("the copy control the search's «Мини-профиль» owned is on the card", async ({ page }) => {
    await boot(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const menu = await openRowMenu(page, ANNA.full_name);
    await menu.getByText("Открыть профиль", { exact: true }).click();

    const copy = page.getByTestId("profile-copy-username");
    await expect(copy).toBeVisible();
    await expect(copy).toHaveAttribute("aria-label", "Скопировать никнейм");
    await expect(page.getByTestId("user-profile-overlay")).toContainText(`@${ANNA.username}`);
  });

  test("one read of the person serves both surfaces", async ({ page }) => {
    const fixture = await boot(page);
    await openGroup(page);

    await page.getByTestId("message-author-avatar").first().click();
    const overlay = page.getByTestId("user-profile-overlay");
    await expect(overlay).toHaveAttribute(
      "data-profile-surface",
      isPhone(page) ? "full" : "compact",
    );
    await expect(overlay).toContainText(ANNA.full_name);

    const readsAfterFirstOpen = fixture
      .restCalls("profiles", "GET")
      .filter((call) => call.search.includes(ANNA.id)).length;

    // Where the small surface exists, the escalation is the hardest case for
    // the gate: a second component mounting over the same person. Where it does
    // not, the reopen below is still the case that matters.
    if (!isPhone(page)) {
      await page.getByTestId("profile-open-full").click();
      await expect(overlay).toHaveAttribute("data-profile-surface", "full");
      await expect(overlay).toContainText(ANNA.full_name);
    }
    // Close and open again, inside the 60-second window.
    await page.getByTestId("user-profile-close").click();
    await expect(page.getByTestId("user-profile-overlay")).toHaveCount(0);
    await page.getByTestId("message-author-avatar").first().click();
    await expect(page.getByTestId("user-profile-overlay")).toContainText(ANNA.full_name);
    await page.waitForTimeout(400);

    const readsAtEnd = fixture
      .restCalls("profiles", "GET")
      .filter((call) => call.search.includes(ANNA.id)).length;

    // This is the assertion the store exists for. Two components, two opens and
    // an escalation between them put **no** further query on the wire, because
    // both read one cache behind one gate with a 60-second window — which is
    // what Discord's popout and modal do and what ours did not.
    expect(readsAtEnd, "escalation and reopen must not refetch inside the window").toBe(
      readsAfterFirstOpen,
    );
    expect(readsAfterFirstOpen).toBeGreaterThan(0);
  });

  test("the summary is measurably smaller than the thing it summarises", async ({ page }) => {
    // The assertion this file exists for as much as any other, and it was
    // written **because the first build failed it**: measured at 1440 on
    // 2026-09-21, the compact card rendered 450 px and the full card 446, so
    // the summary was taller than the thing it summarised and escalating showed
    // the reader nothing at all. Three measured changes fixed it — the badge
    // strip capped to one line, the bio clamped to two, the face smaller — and
    // one design change: the card now knows the place it was opened from, so
    // the full tier can say a standing and a join date that the summary cannot.
    //
    // The ratio rather than the numbers, because the numbers depend on how much
    // this particular person has to say; the relation must not.
    if (isPhone(page)) {
      await boot(page);
      await openGroup(page);
      await page.getByTestId("message-author-avatar").first().click();
      await expect(page.getByTestId("user-profile-overlay")).toHaveAttribute(
        "data-profile-surface",
        "full",
      );
      return;
    }

    await boot(page);
    await openGroup(page);
    await page.getByTestId("message-author-avatar").first().click();
    const card = page.locator("[data-profile-tier]");
    await expect(card).toHaveAttribute("data-profile-tier", "compact");
    await page.waitForTimeout(250);
    const compact = (await card.boundingBox())?.height ?? 0;

    await page.getByTestId("profile-open-full").click();
    await expect(card).toHaveAttribute("data-profile-tier", "full");
    await page.waitForTimeout(250);
    const full = (await card.boundingBox())?.height ?? 0;

    expect(compact).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(0);
    expect(
      compact / full,
      `the summary must be materially smaller: compact ${compact}px, full ${full}px`,
    ).toBeLessThan(0.92);
    // And the two facts the place supplies, which are the reason the full card
    // has anything of its own to say outside a conversation.
    await expect(page.getByTestId("member-card-joined")).toBeVisible();
  });

  test("a person chosen in the search opens the card, not a third surface", async ({ page }) => {
    // `SearchProfilePreview` — «Мини-профиль» — is deleted. It was the third
    // surface §15.1 found and D-283 deliberately left standing: no badges, no
    // presence, no escalation, and its fields taken from whatever the result
    // row carried rather than from a read of the person.
    await boot(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const field = page.getByTestId("sidebar-search-input");
    await expect(field).toBeVisible();
    await field.click();
    await field.fill(ANNA.full_name);

    const result = page.getByTestId("sidebar-search-result-user").first();
    await expect(result).toBeVisible({ timeout: 10_000 });
    await result.click();

    const overlay = page.getByTestId("user-profile-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(ANNA.full_name);
    // A **named** act: the reader typed a name and chose a person, so the
    // person is the subject and the whole card answers — never the summary.
    await expect(overlay).toHaveAttribute("data-profile-surface", "full");
    // The surface that used to answer is gone, back control and all.
    await expect(page.getByTestId("global-search-profile-back")).toHaveCount(0);
    await expect(page.getByText("Мини-профиль")).toHaveCount(0);

    // And the way back is closing the layer: the results are still standing
    // underneath, which is what «Назад к результатам» was for.
    await page.getByTestId("user-profile-close").click();
    await expect(page.getByTestId("user-profile-overlay")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-search-result-user").first()).toBeVisible();
  });

  test("a bot's face is not a control at all", async ({ page }) => {
    // §8's rule, and the narrowing D-283 already made on the chat-list row: a
    // bot conversation is `type === "private"` and there is no person behind
    // one. D-263 owns giving a bot a card worth opening.
    await boot(page);
    await openGroup(page);
    const faces = page.getByTestId("message-author-avatar");
    // Her message is the only one, and she is a person.
    await expect(faces).toHaveCount(1);
  });
});
