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
