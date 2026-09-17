import { expect, test, type Page } from "@playwright/test";
import {
  FIXTURE_HOST,
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * A photograph of the phone's folder navigation, not a contract.
 *
 * D-120: the bottom capsule carried «Папки» beside the folder strip already at
 * the top of the chat list, and the tab opened a second, full-screen folder
 * surface. The owner judges a visual change on rendered pixels, so this exists
 * to produce them at the two release widths in both themes, before and after.
 * Every row it seeds is invented.
 *
 * The contract for the same surface is the two folder-surface tests in
 * `tests/e2e/desktop-shell.spec.ts` and `tests/unit/bottom-nav-destinations.test.mjs`;
 * this file asserts nothing about the design beyond what it needs to reach the
 * screen, and is safe to delete once the audit closes.
 *
 * `KUB_CAPTURE_TAG=before` against the pre-fix source and `=after` against the
 * fixed one is how the pair is taken.
 */

const AT = "2026-09-17T09:00:00.000Z";
const ME = person("11111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("11111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const BORIS = person("11111111-1111-4111-8111-000000000003", "Борис Ковалёв", "boris");

const CHAT_TEAM = "22222222-2222-4222-8222-000000000001";
const CHAT_BORIS = "22222222-2222-4222-8222-000000000002";
const CHAT_SHOP = "22222222-2222-4222-8222-000000000003";
const FOLDER_PERSONAL = "44444444-4444-4444-8444-000000000001";
const FOLDER_WORK = "44444444-4444-4444-8444-000000000002";

function seed(): { chats: Row[]; memberships: Row[]; messages: Row[] } {
  const rows: { chats: Row[]; memberships: Row[]; messages: Row[] } = {
    chats: [],
    memberships: [],
    messages: [],
  };
  const add = (id: string, type: "private" | "group", name: string | null, who: typeof ANNA, text: string, minute: number) => {
    const at = new Date(Date.UTC(2026, 8, 17, 14, minute)).toISOString();
    rows.chats.push(chat(id, type, name, at));
    rows.memberships.push(membership(id, ME, "owner", AT), membership(id, who, "member", at));
    rows.messages.push(message(`55555555-5555-4555-8555-${id.slice(-12)}`, id, who, text, at));
  };
  add(CHAT_TEAM, "group", "Команда проекта", ANNA, "Смета на витрину готова, посмотри", 40);
  add(CHAT_BORIS, "private", null, BORIS, "Созвонимся вечером?", 25);
  add(CHAT_SHOP, "group", "Закупки", ANNA, "Привезли стеллажи", 10);
  return rows;
}

async function boot(page: Page, theme: "dark" | "light") {
  const fixture = await openFixture(page, { me: ME, people: [ANNA, BORIS], ...seed() });
  // `openFixture` seeds the dark theme; a later init script wins.
  await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), theme);
  // Registered after the fixture, so these answer first. Two folders, because
  // one folder and «Все» is a strip that barely reads as a strip.
  await page.route(`${FIXTURE_HOST}/rest/v1/folders*`, (route) =>
    route.fulfill({
      json: [
        { id: FOLDER_PERSONAL, user_id: ME.id, created_by: ME.id, scope: "personal", name: "Личные", emoji: null, position: 1, created_at: AT },
        { id: FOLDER_WORK, user_id: ME.id, created_by: ME.id, scope: "personal", name: "Работа", emoji: null, position: 2, created_at: AT },
      ],
    }),
  );
  await page.route(`${FIXTURE_HOST}/rest/v1/folder_chats*`, (route) =>
    route.fulfill({
      json: [
        { folder_id: FOLDER_PERSONAL, chat_id: CHAT_BORIS },
        { folder_id: FOLDER_WORK, chat_id: CHAT_TEAM },
        { folder_id: FOLDER_WORK, chat_id: CHAT_SHOP },
      ],
    }),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-list-item")).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  // The list and its chrome settle over several frames.
  await page.waitForTimeout(500);
  return fixture;
}

for (const theme of ["dark", "light"] as const) {
  test(`the chat list and its folder surfaces, photographed (${theme})`, async ({ page, request }, info) => {
    await requireFixtureServer(request);
    await boot(page, theme);
    const width = page.viewportSize()?.width ?? 0;
    const tag = `${process.env.KUB_CAPTURE_TAG || "after"}-${width}-${theme}`;
    const shots: string[] = [];

    const list = `output/folders/folders-${tag}-list.png`;
    await page.screenshot({ path: list });
    shots.push(list);

    // The second door, while it exists. On a computer there is no bottom
    // capsule at all, so this half is the phone's.
    const folders = page.getByRole("navigation", { name: "Навигация" }).getByRole("button", { name: "Папки" });
    if (await folders.count()) {
      await folders.click();
      // Whatever it opens, given a moment to land. Named rather than asserted:
      // after the fix there is nothing here to press and this branch is skipped.
      await page.waitForTimeout(600);
      const opened = `output/folders/folders-${tag}-tab.png`;
      await page.screenshot({ path: opened });
      shots.push(opened);
    }

    info.annotations.push({ type: "capture", description: shots.join(", ") });
  });
}
