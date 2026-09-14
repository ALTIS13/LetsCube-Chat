import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openDesktopMenu,
  openFixture,
  openPhoneMenu,
  person,
  requireFixtureServer,
  type Fixture,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * A person can refuse another person, and can report a message or a person.
 *
 * The database half shipped on 2026-09-14
 * (`20260914120000_personal_blocks_and_reports.sql`). What is measured here is
 * the interface over it, and in particular the three things that fail silently
 * if they drift:
 *
 *  1. **The report insert carries no `RETURNING`.** Reading the row back needs
 *     a SELECT policy the reporter deliberately does not have, so a chained
 *     `.select()` is refused in production with «new row violates row-level
 *     security policy» — an error that reads like a failing WITH CHECK and is
 *     not one. Nothing about the screen shows it; the `Prefer` header does.
 *  2. **A second report about one message says so.** SQLSTATE 23505 from
 *     `content_reports_one_per_message_idx` must become «Вы уже пожаловались на
 *     это сообщение.», not a generic failure that invites a third attempt.
 *  3. **A blocked sender is told one sentence.** The refused insert into
 *     `public.messages` is a row-level-security error, and the composer must
 *     say «Пользователь ограничил переписку.» beside itself — while the message
 *     itself stays in the conversation rather than disappearing.
 *
 * And the question that guards the block itself: it is asked before anything is
 * written, and it says what actually happens.
 *
 * Needs the dev server on the fixture host; it mocks the backend and refuses
 * any other configuration.
 */

const AT = "2026-09-14T09:00:00.000Z";

const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const BORIS = person("11111111-1111-4111-8111-000000000003", "Борис Ильин", "boris");

const CHAT_ANNA = "22222222-2222-4222-8222-000000000001";
const CHAT_TEAM = "22222222-2222-4222-8222-000000000002";

const HERS = "Смета на витрину готова, посмотри";
const MINE = "Посмотрю вечером";
const IN_GROUP = "Макет главной готов, посмотрите";

const HER_MESSAGE = "55555555-5555-4555-8555-000000000001";

function seed(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [
      chat(CHAT_ANNA, "private", null, AT),
      chat(CHAT_TEAM, "group", "Команда проекта", "2026-09-14T08:00:00.000Z"),
    ],
    memberships: [
      membership(CHAT_ANNA, ME, "owner", AT),
      membership(CHAT_ANNA, ANNA, "member", AT),
      membership(CHAT_TEAM, ME, "owner", AT),
      membership(CHAT_TEAM, BORIS, "member", AT),
    ],
    messages: [
      message(HER_MESSAGE, CHAT_ANNA, ANNA, HERS, "2026-09-14T10:00:00.000Z"),
      message("55555555-5555-4555-8555-000000000002", CHAT_ANNA, ME, MINE, "2026-09-14T10:05:00.000Z"),
      message("55555555-5555-4555-8555-000000000003", CHAT_TEAM, BORIS, IN_GROUP, "2026-09-14T09:30:00.000Z"),
    ],
  };
}

type Extra = {
  blocks?: string[];
  rest?: (call: { resource: string; method: string; body: unknown }) => { status: number; body: unknown } | undefined;
};

async function boot(page: Page, extra: Extra = {}): Promise<Fixture> {
  const rows = seed();
  return openFixture(page, {
    me: ME,
    people: [ANNA, BORIS],
    ...rows,
    ...extra,
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

/** The header's «⋯», in whichever shape this width draws it. */
async function openHeaderMenu(page: Page) {
  await page.getByRole("button", { name: "Ещё" }).click();
  const menu = page.locator('[data-kub-menu="true"]');
  await expect(menu).toBeVisible();
  return menu;
}

/** The message menu, by the pointer this width has. */
async function openMessageMenu(page: Page, text: string) {
  const bubble = page.locator('[data-message-bubble="true"]').filter({ hasText: text });
  await expect(bubble).toBeVisible();
  return isPhone(page) ? openPhoneMenu(page, bubble) : openDesktopMenu(page, bubble);
}

/** Every POST the fixture saw against one table. */
const writes = (fixture: Fixture, resource: string) => fixture.restCalls(resource, "POST");

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test.describe("blocking somebody", () => {
  test("the question is asked first, says what happens, and writes nothing when refused", async ({ page }) => {
    const fixture = await boot(page);
    await openChat(page, ANNA.full_name, HERS);
    await openHeaderMenu(page);

    await page.getByRole("button", { name: "Заблокировать", exact: true }).click();

    const question = page.getByRole("dialog").filter({ hasText: "Заблокировать пользователя?" });
    await expect(question).toBeVisible();
    const body = (await question.textContent()) ?? "";
    // The three facts of the migration, and the one thing the row does not do.
    expect(body).toContain(ANNA.full_name);
    expect(body).toMatch(/не сможет писать/iu);
    expect(body).toMatch(/не узнает/iu);
    expect(body).toMatch(/останутся/iu);
    expect(body).toMatch(/групп/iu);

    await question.getByRole("button", { name: "Отмена" }).click();
    await expect(question).toBeHidden();
    expect(writes(fixture, "user_blocks")).toEqual([]);
  });

  test("confirming writes the row, and both surfaces of the chat agree afterwards", async ({ page }) => {
    const fixture = await boot(page);
    await openChat(page, ANNA.full_name, HERS);

    await openHeaderMenu(page);
    await page.getByRole("button", { name: "Заблокировать", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Заблокировать", exact: true }).click();

    await expect.poll(() => writes(fixture, "user_blocks").length).toBe(1);
    const sent = writes(fixture, "user_blocks")[0].body as Record<string, unknown>;
    expect(sent.blocker_id).toBe(ME.id);
    expect(sent.blocked_id).toBe(ANNA.id);

    // The contact card reads the same store as the header, so it must already
    // be offering the way back rather than offering to block again.
    await page.getByTestId("chat-header-info-button").click();
    await expect(page.getByTestId("chat-info-panel")).toBeVisible();
    await expect(page.getByTestId("chat-info-block-user")).toHaveText(/Разблокировать/u);
  });

  test("a group has no block control, because the policy has no group branch", async ({ page }) => {
    await boot(page);
    await openChat(page, "Команда проекта", IN_GROUP);
    const menu = await openHeaderMenu(page);
    await expect(menu.getByRole("button", { name: "Заблокировать", exact: true })).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Пожаловаться", exact: true })).toHaveCount(0);
  });

  test("the list in settings finds the block again and lifts it", async ({ page }) => {
    const fixture = await boot(page, { blocks: [ANNA.id] });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item").first()).toBeVisible();

    if (isPhone(page)) {
      await page.getByRole("button", { name: "Меню" }).first().click();
      await page.getByRole("button", { name: "Настройки" }).first().click();
    } else {
      await page.getByTestId("side-menu-button").click();
      await page.getByTestId("side-menu-layer").getByRole("button", { name: "Настройки", exact: true }).click();
    }
    await expect(page.getByRole("heading", { name: "Профиль", exact: true })).toBeVisible();

    await page.getByTestId("settings-open-blocked").click();
    const row = page.getByTestId("blocked-person").filter({ hasText: ANNA.full_name });
    await expect(row).toBeVisible();

    await row.getByTestId("blocked-person-unblock").click();
    // Below `md` the settings screen is itself a dialog, so the question has to
    // be named rather than found as «the dialog».
    const question = page.getByRole("dialog").filter({ hasText: "Разблокировать пользователя?" });
    await expect(question).toBeVisible();
    await question.getByRole("button", { name: "Разблокировать", exact: true }).click();

    await expect.poll(() => fixture.restCalls("user_blocks", "DELETE").length).toBe(1);
    await expect(page.getByTestId("blocked-person")).toHaveCount(0);
  });
});

test.describe("reporting", () => {
  test("a message is reported with no RETURNING, and the confirmation names the administration", async ({ page }) => {
    const fixture = await boot(page);
    await openChat(page, ANNA.full_name, HERS);
    const menu = await openMessageMenu(page, HERS);

    await menu.locator('[data-message-action="report"]').click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Жалоба на сообщение" });
    await expect(dialog).toBeVisible();
    // Where it goes, said out loud.
    await expect(dialog.getByTestId("report-staff-notice")).toContainText("администрация");

    // Nothing can be sent before a reason is chosen.
    await expect(dialog.getByTestId("report-send")).toBeDisabled();
    await dialog.locator('[data-report-reason="spam"] input').check();
    await dialog.getByTestId("report-note").fill("Присылает одно и то же третий день");
    await dialog.getByTestId("report-send").click();

    await expect.poll(() => writes(fixture, "content_reports").length).toBe(1);
    const call = writes(fixture, "content_reports")[0];
    const sent = call.body as Record<string, unknown>;
    expect(sent.reporter_id).toBe(ME.id);
    expect(sent.kind).toBe("message");
    expect(sent.target_user_id).toBe(ANNA.id);
    expect(sent.message_id).toBe(HER_MESSAGE);
    expect(sent.chat_id).toBe(CHAT_ANNA);
    expect(sent.reason).toBe("spam");
    expect(sent.note).toBe("Присылает одно и то же третий день");
    // The insert policy requires status 'new' with both handled columns null;
    // sending them would be a second place for that to be wrong.
    expect(sent).not.toHaveProperty("status");
    expect(sent).not.toHaveProperty("handled_by");

    // **The contract that only the wire shows.** A chained `.select()` asks
    // PostgREST for the row back, and on this table that is refused.
    expect(call.prefer).not.toContain("return=representation");

    await expect(page.getByTestId("kub-feedback-viewport")).toContainText("Жалоба отправлена");
    await expect(dialog).toBeHidden();
  });

  test("a second report about the same message says so, rather than failing generically", async ({ page }) => {
    const fixture = await boot(page, {
      rest: ({ resource, method }) =>
        resource === "content_reports" && method === "POST"
          ? {
              status: 409,
              body: {
                code: "23505",
                details: null,
                hint: null,
                message:
                  'duplicate key value violates unique constraint "content_reports_one_per_message_idx"',
              },
            }
          : undefined,
    });
    await openChat(page, ANNA.full_name, HERS);
    const menu = await openMessageMenu(page, HERS);
    await menu.locator('[data-message-action="report"]').click();

    const dialog = page.getByRole("dialog").filter({ hasText: "Жалоба на сообщение" });
    await dialog.locator('[data-report-reason="abuse"] input').check();
    await dialog.getByTestId("report-send").click();

    await expect(dialog.getByTestId("report-refusal")).toHaveText("Вы уже пожаловались на это сообщение.");
    // The dialog stays, so the sentence can be read; and it did try exactly once.
    await expect(dialog).toBeVisible();
    expect(writes(fixture, "content_reports")).toHaveLength(1);
  });

  test("my own message offers no way to report me", async ({ page }) => {
    await boot(page);
    await openChat(page, ANNA.full_name, HERS);
    const menu = await openMessageMenu(page, MINE);
    await expect(menu.locator('[data-message-action="report"]')).toHaveCount(0);
  });

  test("a person is reported from the contact card, with no message named", async ({ page }) => {
    const fixture = await boot(page);
    await openChat(page, ANNA.full_name, HERS);
    await page.getByTestId("chat-header-info-button").click();
    await page.getByTestId("chat-info-report-user").click();

    const dialog = page.getByRole("dialog").filter({ hasText: "Жалоба на пользователя" });
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-report-reason="child_safety"] input').check();
    await dialog.getByTestId("report-send").click();

    await expect.poll(() => writes(fixture, "content_reports").length).toBe(1);
    const sent = writes(fixture, "content_reports")[0].body as Record<string, unknown>;
    expect(sent.kind).toBe("user");
    expect(sent.target_user_id).toBe(ANNA.id);
    expect(sent.reason).toBe("child_safety");
    // `content_reports_message_present` refuses a report about a person that
    // carries a message id.
    expect(sent.message_id).toBeNull();
  });
});

test.describe("the refusal a blocked sender gets", () => {
  test("it is one sentence beside the composer, and the message is not lost", async ({ page }) => {
    await boot(page, {
      rest: ({ resource, method }) =>
        resource === "messages" && method === "POST"
          ? {
              status: 403,
              body: {
                code: "42501",
                details: null,
                hint: null,
                message: 'new row violates row-level security policy for table "messages"',
              },
            }
          : undefined,
    });
    await openChat(page, ANNA.full_name, HERS);

    const text = "Ещё раз здравствуйте";
    await page.getByPlaceholder("Сообщение…").fill(text);
    await page.getByPlaceholder("Сообщение…").press("Enter");

    const refusal = page.getByTestId("composer-refusal");
    await expect(refusal).toBeVisible({ timeout: 20_000 });
    await expect(refusal).toContainText("Пользователь ограничил переписку.");
    // Never the Postgres text, and never the ack mapper's «Недостаточно прав».
    const said = (await refusal.textContent()) ?? "";
    expect(said).not.toMatch(/row-level|policy|42501|Недостаточно прав/iu);

    // The message stays in the conversation with its words, so nothing a person
    // typed is silently thrown away.
    await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: text })).toBeVisible();

    // And the sentence is readable, not merely present.
    //
    // Looking at the pixels on 2026-09-14 found the recorder-mode hint hanging
    // over this exact strip and covering everything of the banner but its icon
    // and one letter, while `toBeVisible()` stayed green throughout: Playwright
    // asks whether an element is laid out, not whether something is drawn on
    // top of it.
    //
    // `document.elementFromPoint` is the wrong instrument for this, which cost
    // two cycles to find out. The hint stopped taking presses when D-186 was
    // fixed, so hit-testing walks straight through it and answers «the banner»
    // while the hint sits over the whole of it — measured, with the rule below
    // removed: banner 12,718 366x62 and hint 54,696 320x80, overlapping almost
    // exactly, and the point test still said the banner. Two boxes overlapping
    // is what «covered» means here.
    //
    // The wait is not padding: the hint is offered a beat after the composer
    // settles, and an immediate assertion measures a screen it has not reached.
    await page.waitForTimeout(1000);
    const boxes = await page.evaluate(() => {
      const rect = (el: Element | null | undefined) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, right: b.right, bottom: b.bottom };
      };
      const hint = [...document.querySelectorAll("*")].find(
        (el) => el.children.length === 0 && (el.textContent ?? "").includes("Коротко нажмите на микрофон"),
      );
      return {
        banner: rect(document.querySelector('[data-testid="composer-refusal"]')),
        hint: rect(hint?.closest("div") ?? hint),
      };
    });
    expect(boxes.banner, "the refusal has no box to measure").not.toBeNull();
    if (boxes.hint) {
      const b = boxes.banner!;
      const h = boxes.hint;
      const overlaps = h.x < b.right && h.right > b.x && h.y < b.bottom && h.bottom > b.y;
      expect(overlaps, "the recorder hint is drawn over the refusal banner").toBe(false);
    }
  });
});
