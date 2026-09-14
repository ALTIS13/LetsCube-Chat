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
import {
  CHAT_OPEN_FAILED,
  PROFILE_SAVE_FAILED,
  SEARCH_HISTORY_UNAVAILABLE,
  USERNAME_TAKEN,
} from "../../artifacts/kub/src/lib/plainMessages";

/**
 * D-132, the half outside the administration: what the chat, the profile save
 * and the search actually put on screen when the thing behind them fails.
 *
 * The unit suite pins the words and the wiring. It cannot say whether the
 * sentence reaches a person, or where it lands — and «where» is half the
 * defect: a taken никнейм was reported in a banner under the screen's header,
 * two sections above the field somebody had typed into. So these three run on
 * the mocked fixture, with the failure forced rather than waited for.
 *
 * Nothing here signs in. The settings and search specs that need a production
 * session are a different matter; these use `messageActionsFixture`, which
 * refuses any configuration but the local one.
 */

const AT = "2026-09-14T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT_ID = "22222222-2222-4222-8222-000000000001";

function rows(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  return {
    chats: [chat(CHAT_ID, "group", "Группа 1", AT)],
    memberships: [membership(CHAT_ID, ME, "owner", AT), membership(CHAT_ID, ANNA, "member", AT)],
    messages: [message("55555555-5555-4555-8555-000000000001", CHAT_ID, ANNA, "Привет", AT)],
  };
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test.describe("a failure says what failed, in Russian, beside the control", () => {
  test("starting a chat that fails shows a sentence, not the server's English", async ({ page }) => {
    // The shape a failing `open_or_create_private_chat` really has: a Postgres
    // error whose message is English. It used to be printed as it arrived, and
    // anything thrown that was not an `Error` was printed as a JSON dump.
    await openFixture(page, {
      me: ME,
      ...rows(),
      rpc: (name) =>
        name === "open_or_create_private_chat"
          ? { status: 400, body: { code: "P0002", message: "no such user", details: null, hint: null } }
          : undefined,
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item")).toHaveCount(1);

    await page.getByRole("button", { name: "Новый чат" }).click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await modal.getByPlaceholder("Поиск по имени или @никнейму…").fill("Максим");

    const candidate = modal.getByRole("button").filter({ hasText: "Максим Орлов" }).first();
    await expect(candidate).toBeVisible();
    await candidate.click();

    const alert = modal.getByRole("alert");
    await expect(alert).toHaveText(CHAT_OPEN_FAILED);
    await expect(modal.getByText(/no such user|P0002|\{/)).toHaveCount(0);
  });

  test("a никнейм that breaks a rule is answered while it is typed", async ({ page }) => {
    await openFixture(page, { me: ME, ...rows() });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item")).toHaveCount(1);
    await openSettings(page);

    const field = page.getByTestId("settings-field-username");
    const shown = page.getByTestId("settings-field-username-error");
    await field.scrollIntoViewIfNeeded();
    await expect(shown).toHaveCount(0);

    // Reserved: decidable here, needing nobody's permission, and until now only
    // reported after «Сохранить».
    await field.fill("support");
    await expect(shown).toHaveText("Этот никнейм зарезервирован для администраторов.");
    // And the field itself says so, rather than a banner two sections up.
    await expect(field).toHaveAttribute("aria-invalid", "true");

    await field.fill("maksim_2");
    await expect(shown).toHaveCount(0);
  });

  test("a никнейм is answered while it is typed, not only after «Сохранить»", async ({ page }) => {
    // D-132, settings-profile C4. The note here used to say a live lookup was
    // impossible because `profiles` hides a banned account's row. Read again on
    // production on 2026-09-14, that restrictive policy limits what a **banned
    // caller** reads, not what anybody reads about a banned account — so the
    // lookup is possible, and this is it.
    await openFixture(page, {
      me: ME,
      ...rows(),
      people: [person("11111111-1111-4111-8111-0000000000aa", "Анна Смирнова", "anna")],
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item")).toHaveCount(1);
    await openSettings(page);

    const field = page.getByTestId("settings-field-username");
    const note = page.getByTestId("settings-field-username-note");

    // The name this person already holds is theirs, not «занято», and nothing
    // is asked about it.
    await expect(note).toHaveCount(0);

    // Somebody else's name is refused before «Сохранить» is anywhere near it.
    await field.fill("anna");
    await expect(note).toHaveText(USERNAME_TAKEN, { timeout: 5000 });

    // A free one says so.
    await field.fill("anna_2");
    await expect(note).toHaveText("Свободно", { timeout: 5000 });

    // And a name that breaks its own rules is not looked up at all: the field's
    // own refusal stands and no note appears beside it. A reserved name is the
    // reachable case — the field normalises away anything outside its alphabet
    // as it is typed, so «привет!» never reaches the rule at all.
    await field.fill("support");
    await expect(page.getByTestId("settings-field-username-error")).toBeVisible();
    await expect(note).toHaveCount(0);
  });

  test("a taken никнейм is named, and is named under the никнейм", async ({ page }) => {
    await openFixture(page, { me: ME, ...rows() });
    // Registered after the fixture, so it wins: Playwright matches the most
    // recently added route first. The profile save is the only PATCH here.
    await page.route("**/rest/v1/profiles**", async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "23505",
          message: 'duplicate key value violates unique constraint "profiles_username_key"',
          details: "Key (username)=(anna) already exists.",
          hint: null,
        }),
      });
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item")).toHaveCount(1);
    await openSettings(page);

    await page.getByTestId("settings-field-username").fill("anna");
    await page.getByRole("button", { name: /Сохранить/ }).first().click();

    const shown = page.getByTestId("settings-field-username-error");
    await expect(shown).toHaveText(USERNAME_TAKEN);
    // The mapper's answer, which is what this used to say, and which described
    // a row rather than the name somebody typed.
    await expect(page.getByText("Такая запись уже существует.")).toHaveCount(0);
    await expect(page.getByText(PROFILE_SAVE_FAILED)).toHaveCount(0);

    // It belongs to the name that was sent, so editing the field takes it away.
    await page.getByTestId("settings-field-username").fill("anna_2");
    await expect(shown).toHaveCount(0);
  });

  test("search without the whole history says so without naming a repair", async ({ page }) => {
    await openFixture(page, {
      me: ME,
      ...rows(),
      rpc: (name) =>
        name === "global_search_v2" || name === "global_search" ? missingFunction(name) : undefined,
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chat-list-item")).toHaveCount(1);

    await page.getByPlaceholder("Поиск людей, чатов, сообщений или +номера…").fill("Привет");
    await expect(page.getByText(SEARCH_HISTORY_UNAVAILABLE)).toBeVisible();
    await expect(page.getByText(/обновления базы данных|migration|SQL/i)).toHaveCount(0);
    // What the person can still do is the half worth keeping.
    await expect(page.getByText(/Сейчас доступны видимые чаты/)).toBeVisible();
  });
});

/** The product's own way in: the side list on a computer, the menu on a phone. */
async function openSettings(page: Page) {
  if (isPhone(page)) {
    await page.getByRole("button", { name: "Меню" }).first().click();
    await page.getByRole("button", { name: "Настройки" }).first().click();
  } else {
    await page.getByTestId("side-menu-button").click();
    await expect(page.getByTestId("side-menu-layer")).toBeVisible();
    await page.getByTestId("side-menu-layer").getByRole("button", { name: "Настройки", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Профиль", exact: true })).toBeVisible();
}
