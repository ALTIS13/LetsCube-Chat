import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  chat,
  membership,
  openFixture,
  person,
  type Row,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * D-133, the last two rows: the settings ask before removing the person's own
 * things.
 *
 * The entry's administration and bot halves closed on 2026-09-14; «Удалить
 * фото» in the profile header and «Удалить» on a verified telephone number were
 * left, and both acted on the press.
 *
 * The dialog itself is not new — `requestAppConfirm` already serves thirteen
 * administration actions — so what is measured here is that the question is
 * actually raised, that it can be refused, and that the new sentences fit the
 * box they are drawn in. Only the last of those needs a browser, and it is the
 * reason this file exists: the words were written against a shape nobody had
 * seen them in.
 *
 * Everything is fictional and mocked. No production screen is rendered.
 */

const AT = "2026-09-14T09:00:00.000Z";
const TEAM = "77777777-7777-4777-8777-000000000001";
const ANNA = person("78888888-8888-4888-8888-000000000002", "Анна Тихая", "anna");

/** A person who has a photograph, so the header offers to remove it. */
const ME = {
  ...person("78888888-8888-4888-8888-000000000001", "Зоя Яблокова", "zoya"),
  // The fixture aborts every off-origin request, so this never loads and the
  // avatar falls back to initials. The control is gated on the column being
  // set, not on the picture arriving, which is exactly the state being tested.
  avatar_url: "https://example.invalid/zoya.webp",
};

async function openSettings(page: Page, theme: "dark" | "light") {
  await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [chat(TEAM, "group", "Команда проекта", AT)],
    memberships: [membership(TEAM, ME, "owner", AT), membership(TEAM, ANNA, "member", AT)] as Row[],
    messages: [],
  });
  // `openFixture` seeds the dark theme; a later init script wins.
  await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), theme);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const phone = (page.viewportSize()?.width ?? 0) < 768;
  if (phone) {
    await page.getByRole("button", { name: "Меню" }).first().click();
    await page.getByRole("button", { name: "Настройки" }).first().click();
  } else {
    await page.getByTestId("side-menu-button").click();
    await page.getByTestId("side-menu-layer").getByRole("button", { name: "Настройки", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Профиль", exact: true })).toBeVisible();
}

function shotPath(info: TestInfo, name: string): string {
  return `output/settings-confirm/${name}-${info.project.name}.png`;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("removing the photograph asks first, and «Отмена» keeps it", async ({ page }) => {
  await openSettings(page, "dark");

  const remove = page.getByRole("button", { name: "Удалить фото" });
  await expect(remove).toBeVisible();
  await remove.click();

  // The question, in the shape the entry asked for: the title is the question,
  // one line says what changes, and the confirming button names the act.
  await expect(page.getByText("Удалить фото профиля?")).toBeVisible();
  await expect(page.getByText("В чатах и в профиле вместо него будут показаны ваши инициалы.")).toBeVisible();

  await page.getByRole("button", { name: "Отмена" }).click();

  // Refused: the control is still there, which it would not be if the column
  // had been cleared.
  await expect(remove).toBeVisible();
});

test("the question can be dismissed without removing anything", async ({ page }) => {
  await openSettings(page, "dark");
  await page.getByRole("button", { name: "Удалить фото" }).click();
  await expect(page.getByText("Удалить фото профиля?")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByText("Удалить фото профиля?")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Удалить фото" })).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`the question holds in the ${theme} theme`, async ({ page }, info) => {
    await openSettings(page, theme);
    await page.getByRole("button", { name: "Удалить фото" }).click();
    await expect(page.getByText("Удалить фото профиля?")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // The dialog animates in; let it land before the shutter.
    await page.waitForTimeout(400);
    await page.screenshot({ path: shotPath(info, `avatar-${theme}`), fullPage: false });
  });
}

/**
 * D-133's fourth clause, which the entry proposed and nobody built: «a title,
 * one line saying what will stop working, a red confirm, and focus on
 * «Отмена»». The first three shipped on 2026-09-14 and 2026-09-15; the fourth
 * decides whether the other three can be answered at all.
 *
 * Measured here rather than read off the source, because the source has always
 * looked right: `requestAppConfirm` raises a `role="dialog"` with two buttons
 * in it, and none of that says where the keyboard is.
 */
test("the question takes focus, so Enter answers it instead of the control behind it", async ({ page }) => {
  await openSettings(page, "dark");

  const remove = page.getByRole("button", { name: "Удалить фото" });
  await remove.click();
  await expect(page.getByText("Удалить фото профиля?")).toBeVisible();

  // Before this, focus stayed on the button that raised the question — outside
  // the dialog, and nineteen Tab presses from its first control, because the
  // modal is portalled to the end of the body while focus sat mid-page.
  await expect(page.getByRole("button", { name: "Отмена" })).toBeFocused();
  const inDialog = await page.evaluate(() =>
    !!(document.activeElement as HTMLElement | null)?.closest('[role="dialog"]'));
  expect(inDialog, "focus must be inside the dialog, not on the page behind it").toBe(true);

  // The reflex answer to a box that has just appeared. It used to re-fire
  // «Удалить фото» and queue the same question again.
  await page.keyboard.press("Enter");
  await expect(page.getByText("Удалить фото профиля?")).toHaveCount(0);

  // Refused, and the photograph is still there to remove.
  await expect(remove).toBeVisible();
  // And focus is handed back to where it came from, so the next Tab carries on
  // from the control rather than from the top of the document.
  await expect(remove).toBeFocused();
});

for (const theme of ["light", "dark"] as const) {
  test(`«Отмена» shows the keyboard where it is in the ${theme} theme`, async ({ page }, info) => {
    await openSettings(page, theme);
    const remove = page.getByRole("button", { name: "Удалить фото" });
    // Reached by key, so the focus ring is the product's own `:focus-visible`
    // outline and not the browser's — and so the screenshot shows what a person
    // navigating by keyboard actually sees.
    await remove.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Удалить фото профиля?")).toBeVisible();
    const cancel = page.getByRole("button", { name: "Отмена" });
    await expect(cancel).toBeFocused();
    const outline = await cancel.evaluate((node) => getComputedStyle(node).outlineStyle);
    expect(outline, "the focused way out must be visible, not only focused").not.toBe("none");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: shotPath(info, `avatar-focus-${theme}`), fullPage: false });
  });
}
