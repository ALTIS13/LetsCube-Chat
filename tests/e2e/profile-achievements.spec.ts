import { expect, type Page, type TestInfo, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * D-180, slice 2: «за что получил медальку».
 *
 * The owner asked for badges «в которых написано кто такой, за что получил
 * медальку». Slice 1 answered the first half — the standing, as a chip. This is
 * the second: the medals, as a section with the sentence that says what each one
 * was for, because «Ветеран» alone says nothing and «В LETSCUBE больше года» is
 * the whole answer.
 *
 * **Where the full form actually renders.** `ProfileRoleSummary` is mounted
 * compact on a contact card and full in the administration panel's user dialog,
 * and nowhere else — so that dialog is where this section can be looked at. The
 * fixture backend is enough to reach it: the account it signs in as carries the
 * legacy `admin` role, which `useRoleAccess` honours without any of the
 * permission round trips a real session makes.
 *
 * **The collision, again, and the older half of it.** `tester` and
 * `alpha_tester` are both seeded with `shield`, and have been since the day the
 * second was added — they collide with each other inside the settings screen
 * today, before any role is involved. Two medals in one list drawing the same
 * picture is what the last assertion here refuses.
 *
 * Everything is fictional and mocked. No production screen is rendered.
 */

const AT = "2026-09-12T09:00:00.000Z";
/** Signed in as an administrator, because that is who can open the dialog. */
const ME = { ...person("11111111-1111-4111-8111-000000000001", "Максим Орлов"), role: "admin" };
const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";

const medal = (key: string, title: string, detail: string, icon: string, sortOrder: number) => ({
  user_id: ME.id,
  kind: "achievement",
  key,
  title,
  detail,
  icon,
  colour: null,
  rank: 100000 - sortOrder,
});

/** The icons are the ones the catalogue really holds, collisions included. */
const MEDALS = [
  medal("tester", "Тестировщик", "Был с LETSCUBE ещё до первых приложений", "shield", 10),
  medal("alpha_tester", "Альфа-тестер", "Был с LETSCUBE во время альфа-тестирования", "shield", 15),
  medal("veteran", "Ветеран", "В LETSCUBE больше года", "crown", 40),
];

const STANDING = {
  user_id: ME.id,
  kind: "global_role",
  key: "admin",
  title: "Администратор",
  detail: "Управление людьми",
  icon: "shield",
  colour: null,
  rank: 80,
};

async function openProfileDialog(page: Page, badges: unknown[]) {
  await openFixture(page, {
    me: ME,
    chats: [chat(CHAT_TEAM, "group", "Команда проекта", AT)],
    memberships: [membership(CHAT_TEAM, ME, "owner", AT)],
    messages: [message("55555555-5555-4555-8555-000000000001", CHAT_TEAM, ME, "Смета готова", AT)],
    rpc: (name) => {
      if (name === "profile_badges") return { body: badges };
      return missingFunction(name);
    },
  });
  await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("admin-user-row").first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Действия" }).click();
  await page.getByText("Открыть профиль", { exact: false }).click();
  await expect(page.getByText("Профиль пользователя", { exact: false }).first()).toBeVisible();
}

async function stampTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
}

function shotPath(info: TestInfo, name: string): string {
  return `output/member-badges/achievements-${name}-${info.project.name}.png`;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("the medals say what each one was for, in the catalogue's own order", async ({
  page,
}, info) => {
  await openProfileDialog(page, [STANDING, ...MEDALS]);

  const section = page.getByTestId("profile-achievements");
  await expect(section).toBeVisible();
  await expect(section).toContainText("Достижения");

  const rows = section.locator("[data-achievement-key]");
  await expect(rows).toHaveCount(3);
  // The catalogue's own order, which is what the settings screen uses too, not
  // the order the server happened to return them in.
  await expect(rows.nth(0)).toContainText("Тестировщик");
  await expect(rows.nth(1)).toContainText("Альфа-тестер");
  await expect(rows.nth(2)).toContainText("Ветеран");

  // «за что» — the half of the owner's request a chip alone cannot carry.
  await expect(rows.nth(2)).toContainText("В LETSCUBE больше года");

  await stampTheme(page, "light");
  await page.screenshot({ path: shotPath(info, "light") });
});

test("two medals in one list never draw the same picture", async ({ page }) => {
  await openProfileDialog(page, [STANDING, ...MEDALS]);

  // `tester` and `alpha_tester` are both seeded `shield`, and `veteran` is
  // seeded `crown` — the administrator's and the owner's glyphs. Unresolved,
  // this list would show the first two as the same icon.
  const drawn = await page.evaluate(() => {
    const section = document.querySelector('[data-testid="profile-achievements"]');
    return [...(section?.querySelectorAll("[data-achievement-key] svg") ?? [])].map(
      (svg) => svg.innerHTML,
    );
  });
  expect(drawn.length, "every medal carries a glyph").toBe(3);
  expect(
    new Set(drawn).size,
    "«Тестировщик» and «Альфа-тестер» are seeded with the same shield; two of these are the same drawing",
  ).toBe(3);
});

test("a person with no medals has no section, rather than an empty one", async ({ page }) => {
  await openProfileDialog(page, [STANDING]);
  // Not «Достижений нет». On your own settings screen an empty state is an
  // invitation; on somebody else's card it is a verdict on a person.
  await expect(page.getByTestId("profile-achievements")).toHaveCount(0);
  await expect(page.getByText("Глобальные роли", { exact: false }).first()).toBeVisible();
});

test("the section holds in the dark theme", async ({ page }, info) => {
  await openProfileDialog(page, [STANDING, ...MEDALS]);
  await stampTheme(page, "dark");
  await expect(page.getByTestId("profile-achievements")).toContainText("Ветеран");
  await page.screenshot({ path: shotPath(info, "dark") });
});
