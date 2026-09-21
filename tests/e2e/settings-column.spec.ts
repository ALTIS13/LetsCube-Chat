import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * Settings, after it stopped being the list column's body (D-285).
 *
 * **This file was written for D-160 and its premise is gone.** D-160's numbers
 * and its complaint are quoted below unchanged because they were right and the
 * rules they produced are still the rules; what moved is where the screen is
 * drawn. The column is dragged by hand and floors at 260, and at 260 the «Имя»
 * field was 66px with 58px of «Максим Орлов» cut off — a decision about how
 * much room conversations get, applied to a screen that has nothing to do with
 * them. So the screen is a surface over the application now, and this file
 * asserts that **it is not in the column** rather than that it is.
 *
 * Three of its four facts survive verbatim on the new surface and are kept
 * here rather than deleted: a label within a readable distance of its value,
 * the search narrowing the screen and giving it back, and the phone's sheet
 * untouched. The fourth — «the column's body, covering and blurring nothing» —
 * is the one D-285 reverses, and it is replaced by its opposite with the
 * reason, not quietly relaxed. The geometry of the new surface is
 * `settings-overlay-geometry.spec.ts`.
 *
 * What D-160 recorded, and what is still being prevented:
 *
 * What was wrong, measured on this fixture at 1440 before the change: the
 * screen opened at `KubModal`'s `xl` size — 896px — on every width, which is
 * 62.2% of a 1440 and 46.7% of a 1920, leaving 272px and then 512px of dead
 * margin each side while `backdrop-blur-sm` frosted the whole application
 * behind it. Its rows were 822px wide and 44px tall, so «Статус «в сети»» stood
 * 570px from the word «Виден» that is its own value. And there was no search
 * over the settings at all.
 *
 * So the contract here is four facts, each of which fails on its own if the
 * defect returns by a different road:
 *
 *  1. from `md` the screen is the column's body — no dialog, nothing covered,
 *     nothing blurred, and the row no wider than the column;
 *  2. a label and its value are on the same row within a readable distance,
 *     which is the half a width assertion alone would not notice;
 *  3. the search narrows the screen, and clearing it gives the screen back;
 *  4. below `md` the dialog stays, because there is no column on screen there —
 *     so «moved to the column» can never quietly become «taken off the phone».
 *
 * And saving still saves, because a settings screen that looks better and saves
 * worse is a worse settings screen.
 *
 * Needs the dev server on the fixture host; it mocks the backend and refuses
 * any other configuration.
 */

const AT = "2026-09-13T09:00:00.000Z";

const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова");

const CHAT_COUNT = 4;

function fixtureRows() {
  const chats: Row[] = [];
  const memberships: Row[] = [];
  const messages: Row[] = [];
  for (let index = 0; index < CHAT_COUNT; index += 1) {
    const id = `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`;
    const at = new Date(Date.UTC(2026, 8, 13, 14, 55 - index)).toISOString();
    chats.push(chat(id, "group", `Группа ${index + 1}`, at));
    memberships.push(membership(id, ME, "owner", AT), membership(id, ANNA, "member", at));
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

async function boot(page: Page) {
  const fixture = await openFixture(page, { me: ME, ...fixtureRows() });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(CHAT_COUNT);
  return fixture;
}

/**
 * The product's own way in on each shell, unchanged by this work: the side list
 * on a computer, the avatar menu on a phone.
 */
async function openSettings(page: Page, phone: boolean) {
  if (phone) {
    await page.getByRole("button", { name: "Меню" }).first().click();
    await page.getByRole("button", { name: "Настройки" }).first().click();
  } else {
    await page.getByTestId("side-menu-button").click();
    await expect(page.getByTestId("side-menu-layer")).toBeVisible();
    await page.getByTestId("side-menu-layer").getByRole("button", { name: "Настройки", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Профиль", exact: true })).toBeVisible();
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

/** Every row's label, its value, and the gap between them on a shared line. */
function rowGaps(page: Page, surface: string) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return [];
    const rows = [...root.querySelectorAll("*")].filter(
      (el) => typeof el.className === "string" && el.className.includes("min-h-11"),
    );
    const out: { label: string; gap: number; rowWidth: number; wrapped: boolean }[] = [];
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (r.width === 0) continue;
      const line = [...row.querySelectorAll("span")].find(
        (el) => typeof el.className === "string"
          && el.className.includes("justify-between")
          && el.className.includes("flex-wrap"),
      );
      if (!line || line.children.length < 2) continue;
      const a = line.children[0].getBoundingClientRect();
      const b = line.children[1].getBoundingClientRect();
      if (a.width === 0 || b.width === 0) continue;
      const sameLine = Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < 12;
      out.push({
        label: (line.children[0].textContent ?? "").trim(),
        gap: sameLine ? Math.round(b.left - a.right) : 0,
        rowWidth: Math.round(r.width),
        wrapped: !sameLine,
      });
    }
    return out;
  }, surface);
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test.describe("settings is a surface over the application, not a state of the list", () => {
  test("from md it leaves the column alone, and is not sized by it", async ({ page }) => {
    test.skip(isPhone(page), "below md there is no column; the sheet is asserted separately");

    await boot(page);
    await openSettings(page, false);

    // **The inversion of D-160's first fact, and the reason it is not a
    // relaxation.** D-160 required no dialog at this width because the dialog
    // it was removing was a constant 896 on every screen. What stands here is
    // not that dialog: it is sized from the window, it carries a rail, and the
    // margin it leaves is the dismissal the owner asked for by name. The
    // numbers that make it a different thing are held in
    // `settings-overlay-geometry.spec.ts`; what this file still owns is that
    // the **chat list is not what the settings are made of**.
    await expect(page.getByTestId("settings-overlay")).toBeVisible();

    // **Not «the old test id is absent».** A test id nothing renders any more
    // is an assertion that can never fail, which is not a contract. What can
    // fail is the geometry: the screen has to be a surface the left region
    // does not contain, so putting it back into the column by any road — a
    // panel in the column's body, or an overlay clamped to the region's box —
    // turns this red.
    const panel = (await page.getByTestId("settings-overlay").boundingBox())!;
    const region = (await page.locator("[data-kub-left-region]").boundingBox())!;
    expect(panel, "the settings surface has no box").not.toBeNull();
    expect(region, "the left region is gone while the settings are open").not.toBeNull();
    expect(
      Math.round(panel.x + panel.width),
      "the settings surface still ends inside the chat-list region",
    ).toBeGreaterThan(Math.round(region.x + region.width));

    // The list is still on screen and still holding its chats. That is the
    // half D-160 was buying with the column, and it is kept: the settings do
    // not take the person's conversations away to be read.
    await expect(page.getByTestId("chat-list-item")).toHaveCount(CHAT_COUNT);
  });

  test("a value sits beside its label rather than at the far end of the row", async ({ page }) => {
    test.skip(isPhone(page), "the column is the subject of this test");

    await boot(page);
    await openSettings(page, false);
    await expect(page.getByTestId("settings-overlay")).toBeVisible();

    const gaps = await rowGaps(page, "[data-testid='settings-overlay']");
    expect(gaps.length, "no label/value rows were measured").toBeGreaterThan(0);

    // 822px rows stranded «Виден» 570px from «Статус «в сети»». Unchanged by
    // D-285, and it is the contract the new surface had to buy its width
    // *without* breaking: the content keeps a 560px measure whatever the panel
    // does, because the gap is `rowWidth - 231` and 360 puts the ceiling at
    // 591. Raise `SETTINGS_CONTENT_MEASURE` past it and this goes red.
    for (const row of gaps) {
      expect(
        row.gap,
        `«${row.label}» is ${row.gap}px from its value on a ${row.rowWidth}px row`,
      ).toBeLessThan(360);
    }
  });

  test("the search narrows the screen, and clearing it gives the screen back", async ({ page }) => {
    test.skip(isPhone(page), "the search belongs to the column");

    await boot(page);
    await openSettings(page, false);

    const panel = page.getByTestId("settings-overlay");
    const sections = panel.locator("[data-settings-section]");
    await expect(sections).toHaveCount(4);

    // «тема» is one row in one section. The phone row is in another, so its
    // disappearance is what proves the filter rather than a re-render.
    await page.getByTestId("settings-search-input").fill("тема");
    await expect(sections).toHaveCount(1);
    await expect(panel.locator("[data-settings-section='application']")).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Выбор темы" })).toBeVisible();
    await expect(page.getByTestId("settings-open-phone")).toHaveCount(0);

    // A word nobody named anything after leaves the screen empty and says so,
    // rather than leaving four headings over nothing.
    await page.getByTestId("settings-search-input").fill("кибер-арена");
    await expect(sections).toHaveCount(0);
    await expect(page.getByTestId("settings-search-counter")).toHaveText("ничего не найдено");

    await page.getByTestId("settings-search-input").fill("");
    await expect(sections).toHaveCount(4);
    await expect(page.getByTestId("settings-open-phone")).toBeVisible();
  });

  test("closing puts the application back", async ({ page }) => {
    test.skip(isPhone(page), "the overlay is the subject of this test");

    await boot(page);
    await openSettings(page, false);
    await expect(page.getByTestId("settings-overlay")).toBeVisible();

    await page.getByTestId("settings-close").click();
    await expect(page.getByTestId("settings-overlay")).toHaveCount(0);
    await expect(page.getByTestId("chat-list-item")).toHaveCount(CHAT_COUNT);
  });

  test("the profile still saves, from the overlay", async ({ page }) => {
    test.skip(isPhone(page), "the overlay is the subject of this test");

    const fixture = await boot(page);
    await openSettings(page, false);

    await page.getByTestId("settings-field-name").fill("Максим Орлов-Тестов");
    await page.getByRole("button", { name: "Сохранить" }).click();

    // The write reached the backend with the typed value — a screen that looks
    // better and saves worse is a worse screen.
    //
    // `profiles` takes more than one kind of PATCH: presence clears `online_at`
    // through the same table on its own schedule, so "the last write" is not
    // necessarily the save. The one under test is the one carrying a name.
    const namedWrites = () =>
      fixture
        .restCalls("profiles", "PATCH")
        .filter((call) => (call.body as Record<string, unknown> | null)?.full_name !== undefined);
    await expect.poll(() => namedWrites().length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(
      (namedWrites().at(-1)!.body as Record<string, unknown>).full_name,
    ).toBe("Максим Орлов-Тестов");
  });

  test("below md the settings screen stays a full-screen sheet", async ({ page }) => {
    test.skip(!isPhone(page), "from md the column has the room and takes it");

    await boot(page);
    await openSettings(page, true);

    // The phone's form, where it has always been.
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);
    await expect(page.getByTestId("settings-field-name")).toBeVisible();
    // And no overlay, which is not merely hidden here: below `md` the column is
    // `display:none` rather than unmounted, so a second form mounted there
    // would be a second live copy of the settings state behind the sheet. The
    // single SettingsSurface chooses one presentation while keeping its draft
    // alive across a resize; mounting both presentations would fail this check.
    await expect(page.getByTestId("settings-overlay")).toHaveCount(0);
    await expect(page.getByTestId("settings-search-input")).toHaveCount(0);
  });
});
