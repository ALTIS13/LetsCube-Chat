import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Fixture,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * Two ways of leaving that took something with them.
 *
 * **D-135.** «Выйти», the last row of both account menus, ended the session on
 * the tap. It is the one irreversible item on a list whose every other item
 * opens a screen, it sits directly under «Помощь», and on a shared device the
 * session it ends is somebody's. It asks now, in the same words from either
 * menu — the phone's avatar menu below `md`, the computer's side list from it.
 *
 * **D-136.** The settings screen holds «Имя», «Никнейм» and «О себе» back for
 * its «Сохранить» button while every other control there writes as it is
 * flipped. ✕, «Закрыть», Escape and a click on the backdrop each threw the
 * typed text away without a word — on a screen where half of what a person did
 * really had been kept, which is why they could reasonably believe the rest had
 * been too. Every one of those doors asks now, and only when something has
 * really been typed.
 *
 * Both shells are covered by the two projects rather than by a flag: at 1440 the
 * screen is the list column and the menu is the side list; at 390 the screen is
 * a full-screen sheet and the menu hangs off the avatar. The defect was in both.
 *
 * Everything runs on the message-actions fixture — a mocked backend with
 * fictional people — so no production account is ever signed out.
 */

const AT = "2026-09-13T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT_COUNT = 3;

/** The account carries a никнейм, because the question prints it. */
const ME_WITH_HANDLE = { ...ME, username: "maks", bio: "Собираю интерфейсы" };

function fixtureRows() {
  const chats: Row[] = [];
  const memberships: Row[] = [];
  const messages: Row[] = [];
  for (let index = 0; index < CHAT_COUNT; index += 1) {
    const id = `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`;
    const at = new Date(Date.UTC(2026, 8, 13, 14, 55 - index)).toISOString();
    chats.push(chat(id, "group", `Группа ${index + 1}`, at));
    memberships.push(membership(id, ME_WITH_HANDLE, "owner", AT), membership(id, ANNA, "member", at));
    messages.push(
      message(
        `55555555-5555-4555-8555-${String(index + 1).padStart(12, "0")}`,
        id,
        ANNA,
        `Сообщение в группе ${index + 1}`,
        new Date(Date.UTC(2026, 8, 13, 10, index)).toISOString(),
      ),
    );
  }
  return { chats, memberships, messages };
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

/** The sign-out question's title, short enough to survive a phone's one line. */
const SIGN_OUT = "Выйти из аккаунта?";

function shotPath(info: TestInfo, name: string): string {
  return `output/settings-defects/${name}-${info.project.name}.png`;
}

/**
 * The theme, stamped the way the product's own runtime stamps it.
 *
 * Not through `localStorage`: the fixture writes «dark» in its own init script,
 * which runs after anything this file could add, so a theme set that way is
 * overwritten before the application reads it. These are the three things
 * `applyResolvedTheme` does, and nothing else decides the palette.
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

async function boot(page: Page): Promise<Fixture> {
  const fixture = await openFixture(page, { me: ME_WITH_HANDLE, ...fixtureRows() });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(CHAT_COUNT);
  return fixture;
}

/** The product's own account menu on each shell. */
async function openAccountMenu(page: Page) {
  if (isPhone(page)) {
    await page.getByRole("button", { name: "Меню" }).first().click();
  } else {
    await page.getByTestId("side-menu-button").click();
    await expect(page.getByTestId("side-menu-layer")).toBeVisible();
  }
}

async function openSettings(page: Page) {
  await openAccountMenu(page);
  if (isPhone(page)) {
    await page.getByRole("button", { name: "Настройки" }).first().click();
  } else {
    await page.getByTestId("side-menu-layer").getByRole("button", { name: "Настройки", exact: true }).click();
  }
  await expect(page.getByTestId("settings-field-name")).toBeVisible();
}

/** The confirmation, whichever question it is asking. */
const question = (page: Page, text: string) =>
  page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: text });

/**
 * Until the dialog has finished arriving.
 *
 * `.kub-modal-overlay` fades and `.kub-modal-panel` fades and lifts, and
 * Playwright's «visible» is true at an opacity of zero — so the first pass of
 * these screenshots caught the entrance: a confirmation at a tenth of its
 * contrast over an application that had not dimmed yet. The same trap the
 * group-settings spec records for its sliding layers, in a different surface.
 */
async function settledDialog(page: Page) {
  await page.waitForFunction(() => {
    // The last of each, not the first: on a phone the settings sheet is itself
    // a `KubModal`, its own entrance finished minutes ago, and waiting on that
    // one would answer «settled» while the confirmation is still fading in.
    // The confirmation is portalled after it, so it is last in the body.
    const last = (selector: string) => {
      const all = document.querySelectorAll(selector);
      return all.length ? all[all.length - 1] : null;
    };
    const parts = [last(".kub-modal-overlay"), last(".kub-modal-panel")];
    if (parts.some((part) => !part)) return false;
    // Scoped to the dialog rather than `document.getAnimations()`: a spinner
    // somewhere on the page runs for ever and would never let this return.
    return parts.every((part) =>
      part!.getAnimations().every((animation) => animation.playState !== "running"),
    );
  });
}

/** POSTs to the auth endpoint that ends a session. */
const logouts = (fixture: Fixture) => fixture.restCalls("/auth/v1/logout", "POST").length;

/**
 * Whether the confirming button is the thing a finger would actually hit.
 *
 * D-179's measurement, taken again here because this dialog is raised from
 * another `KubModal` — the settings sheet on a phone — and two overlays at the
 * same `z-[95]` are separated only by the order they were portalled in.
 */
async function topmostAt(page: Page, dialogText: string, label: string) {
  return page.evaluate(([text, name]) => {
    const dialog = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).find((node) =>
      (node.textContent ?? "").includes(text),
    );
    if (!dialog) return "no dialog";
    const button = Array.from(dialog.querySelectorAll("button")).find((item) => item.textContent?.trim() === name);
    if (!button) return "no button";
    const rect = button.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return top === button || button.contains(top) ? "the button" : "something else";
  }, [dialogText, label]);
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test.describe("D-135: signing out asks first", () => {
  test("the row raises the question instead of ending the session", async ({ page }, info) => {
    const fixture = await boot(page);
    await stampTheme(page, "light");
    await openAccountMenu(page);
    await page.getByRole("button", { name: "Выйти", exact: true }).first().click();

    const dialog = question(page, SIGN_OUT);
    await expect(dialog).toBeVisible();
    // It says whose session ends — the point of asking at all on a shared
    // device — and what it will take to come back.
    await expect(dialog).toContainText("@maks");
    await expect(dialog).toContainText("войти снова");
    expect(logouts(fixture), "the session ended before anybody answered").toBe(0);

    await settledDialog(page);
    await page.screenshot({ path: shotPath(info, "sign-out-light") });

    // And the button is reachable rather than merely present.
    expect(await topmostAt(page, SIGN_OUT, "Выйти")).toBe("the button");
  });

  test("«Отмена» leaves the session alone", async ({ page }) => {
    const fixture = await boot(page);
    await openAccountMenu(page);
    await page.getByRole("button", { name: "Выйти", exact: true }).first().click();

    const dialog = question(page, SIGN_OUT);
    await dialog.getByRole("button", { name: "Отмена" }).click();
    await expect(dialog).toHaveCount(0);

    // Still signed in, still on the list that was behind the menu.
    await expect(page.getByTestId("chat-list-item")).toHaveCount(CHAT_COUNT);
    await page.waitForTimeout(500);
    expect(logouts(fixture)).toBe(0);
  });

  test("«Выйти» in the dialog really signs out", async ({ page }) => {
    // A confirmation that swallows the action is worse than none: it teaches
    // people the row is broken and they press it twice.
    const fixture = await boot(page);
    await openAccountMenu(page);
    await page.getByRole("button", { name: "Выйти", exact: true }).first().click();

    const dialog = question(page, SIGN_OUT);
    await dialog.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect.poll(() => logouts(fixture), { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test("the question holds in the dark theme", async ({ page }, info) => {
    await boot(page);
    await stampTheme(page, "dark");
    await openAccountMenu(page);
    await page.getByRole("button", { name: "Выйти", exact: true }).first().click();
    await expect(question(page, SIGN_OUT)).toBeVisible();
    await settledDialog(page);
    await page.screenshot({ path: shotPath(info, "sign-out-dark") });
  });
});

test.describe("D-136: leaving settings with something typed", () => {
  test("every door this shell offers asks before dropping the text", async ({ page }) => {
    await boot(page);
    await openSettings(page);
    await page.getByTestId("settings-field-name").fill("Максим Орлов-Тестов");

    // The sheet below `md` has three of its own; the overlay from `md` has
    // four. Each is tried in turn, answered «Продолжить», and the text has to
    // still be there for the next one — a door that closed the screen would
    // fail on the door after it.
    const doors: (() => Promise<void>)[] = isPhone(page)
      ? [
          () => page.getByRole("button", { name: "Закрыть", exact: true }).first().click(),
          () => page.getByRole("button", { name: "Закрыть", exact: true }).last().click(),
          () => page.keyboard.press("Escape"),
        ]
      : [
          () => page.getByTestId("settings-close").click(),
          async () => {
            // Escape empties the search field first and leaves on the second
            // press, so a long query is not lost to one keystroke.
            await page.getByTestId("settings-search-input").click();
            await page.keyboard.press("Escape");
          },
          // **The dim, which is new with D-285 and is the door the owner named
          // second**: «либо по затемнению в любом месте сбоку от окна
          // настроек». A door that reaches `KubModal`'s own `onClose` instead
          // of the screen's `requestClose` drops the typed name exactly as the
          // other four used to, so it belongs in this list and not only in the
          // geometry spec.
          async () => {
            const box = (await page.getByTestId("settings-overlay").boundingBox())!;
            await page.mouse.click(Math.round(box.x / 2), Math.round(box.y + box.height / 2));
          },
          () => page.keyboard.press("Escape"),
        ];

    for (const [index, door] of doors.entries()) {
      await door();
      const dialog = question(page, "Отменить изменения?");
      await expect(dialog, `door ${index + 1} dropped the text without asking`).toBeVisible();
      // What it promises is what the screen does: three fields go back, the
      // rest was saved as it was flipped.
      await expect(dialog).toContainText("Имя, никнейм и «О себе»");
      await dialog.getByRole("button", { name: "Продолжить" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId("settings-field-name")).toHaveValue("Максим Орлов-Тестов");
    }
  });

  test("«Отменить» closes the screen and writes nothing", async ({ page }, info) => {
    const fixture = await boot(page);
    await stampTheme(page, "light");
    await openSettings(page);
    await page.getByTestId("settings-field-bio").fill("Новая строка о себе");

    if (isPhone(page)) await page.getByRole("button", { name: "Закрыть", exact: true }).last().click();
    else await page.getByTestId("settings-close").click();

    const dialog = question(page, "Отменить изменения?");
    await expect(dialog).toBeVisible();
    await settledDialog(page);
    await page.screenshot({ path: shotPath(info, "discard-light") });
    expect(await topmostAt(page, "Отменить изменения?", "Продолжить")).toBe("the button");

    await dialog.getByRole("button", { name: "Отменить", exact: true }).click();
    await expect(page.getByTestId("settings-field-name")).toHaveCount(0);

    // Discarded means discarded: nothing about the profile reached the backend.
    const namedWrites = fixture
      .restCalls("profiles", "PATCH")
      .filter((call) => (call.body as Record<string, unknown> | null)?.bio !== undefined);
    expect(namedWrites.length).toBe(0);

    // And reopening shows what is stored rather than what was typed.
    await openSettings(page);
    await expect(page.getByTestId("settings-field-bio")).toHaveValue("Собираю интерфейсы");
  });

  test("nothing typed is nothing to ask about", async ({ page }) => {
    await boot(page);
    await openSettings(page);

    if (isPhone(page)) await page.getByRole("button", { name: "Закрыть", exact: true }).last().click();
    else await page.getByTestId("settings-close").click();

    // A question that is always asked is a question people learn to dismiss.
    await expect(question(page, "Отменить изменения?")).toHaveCount(0);
    await expect(page.getByTestId("settings-field-name")).toHaveCount(0);
  });

  test("a control that saves itself is not unsaved text", async ({ page }) => {
    // The other half of the defect, from the safe side: the theme applies as it
    // is chosen, so leaving right after choosing one must not offer to undo
    // anything. Only the three fields «Сохранить» holds back can be lost.
    await boot(page);
    await openSettings(page);
    await page.getByRole("radio", { name: "Светлая" }).click();

    if (isPhone(page)) await page.getByRole("button", { name: "Закрыть", exact: true }).last().click();
    else await page.getByTestId("settings-close").click();

    await expect(question(page, "Отменить изменения?")).toHaveCount(0);
    await expect(page.getByTestId("settings-field-name")).toHaveCount(0);
  });

  test("a space typed after a name is not a change", async ({ page }) => {
    // The rule compares what the save would write. Without that, a stray space
    // — or a name retyped with a double one — raises a question about a change
    // the save itself would collapse.
    await boot(page);
    await openSettings(page);
    await page.getByTestId("settings-field-name").fill("Максим  Орлов ");

    if (isPhone(page)) await page.getByRole("button", { name: "Закрыть", exact: true }).last().click();
    else await page.getByTestId("settings-close").click();

    await expect(question(page, "Отменить изменения?")).toHaveCount(0);
    await expect(page.getByTestId("settings-field-name")).toHaveCount(0);
  });

  test("the question holds in the dark theme", async ({ page }, info) => {
    await boot(page);
    await stampTheme(page, "dark");
    await openSettings(page);
    await page.getByTestId("settings-field-name").fill("Максим Орлов-Тестов");

    if (isPhone(page)) await page.getByRole("button", { name: "Закрыть", exact: true }).last().click();
    else await page.getByTestId("settings-close").click();

    await expect(question(page, "Отменить изменения?")).toBeVisible();
    await settledDialog(page);
    await page.screenshot({ path: shotPath(info, "discard-dark") });
  });
});
