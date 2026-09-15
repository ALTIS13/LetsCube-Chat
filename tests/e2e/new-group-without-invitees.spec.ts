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
 * A group can be made by somebody who has nobody to invite yet.
 *
 * Reported by the owner of this deployment on 2026-09-15: «я сейчас не могу
 * создать группу как тех админ, чего уж говорить об обычных пользователях».
 *
 * The database was measured first and is not the blocker — as an account whose
 * staff standing comes from a global role only, inside a rolled-back
 * transaction, the whole flow ran: the chat inserted, the
 * `trg_add_chat_creator_as_owner` trigger made the creator an owner, and a
 * member could then be added. The dead end was entirely in this modal:
 *
 *   - the invitee list answered an empty array until something was typed, so
 *     the step opened as a blank box;
 *   - «Далее» was `disabled={selected.length === 0}` under that blank box;
 *   - and `handleCreate` returned silently on `selected.length === 0` even if
 *     you got past it.
 *
 * So a person with nobody to invite could not reach the name field at all, and
 * nothing on screen said why. Discord creates a server with just you in it; the
 * invite control already exists on the group's own information screen.
 *
 * Everything is fictional and mocked. No production screen is rendered.
 */

const AT = "2026-09-14T09:00:00.000Z";
const ME = person("79999999-9999-4999-8999-000000000001", "Зоя Яблокова", "zoya");
const ANNA = person("79999999-9999-4999-8999-000000000002", "Анна Тихая", "anna");
const BORIS = person("79999999-9999-4999-8999-000000000003", "Борис Ильин", "boris");
const EXISTING = "7aaaaaaa-aaaa-4aaa-8aaa-000000000001";

type Seen = { chatInserts: number };

async function openNewGroup(page: Page): Promise<Seen> {
  const seen: Seen = { chatInserts: 0 };

  await openFixture(page, {
    me: ME,
    people: [ANNA, BORIS],
    chats: [chat(EXISTING, "group", "Команда проекта", AT)],
    memberships: [membership(EXISTING, ME, "owner", AT)] as Row[],
    messages: [],
  });

  // The invitee picker reads `profiles` straight through PostgREST, and the
  // fixture's own handler answers only what it was seeded with — so this
  // answers the picker's read specifically, by the absence of a chat filter.
  await page.route("**/rest/v1/profiles*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([ANNA, BORIS]),
    });
  });

  await page.route("**/rest/v1/chats*", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    seen.chatInserts += 1;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: "7bbbbbbb-bbbb-4bbb-8bbb-000000000001" }),
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  const phone = (page.viewportSize()?.width ?? 0) < 768;
  if (phone) {
    await page.getByRole("button", { name: "Меню" }).first().click();
  } else {
    await page.getByTestId("side-menu-button").click();
  }
  await page.getByRole("button", { name: "Новая группа" }).first().click();
  return seen;
}

function shotPath(info: TestInfo, name: string): string {
  return `output/new-group/${name}-${info.project.name}.png`;
}

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("the invitee step is not a blank box", async ({ page }) => {
  await openNewGroup(page);
  // People are offered before anything is typed. This is the half that made the
  // disabled button below look like the product being broken rather than the
  // person having missed a step.
  await expect(page.getByText("Анна Тихая")).toBeVisible();
  await expect(page.getByText("Борис Ильин")).toBeVisible();
});

test("a person with nobody to invite can still reach the name field", async ({ page }) => {
  await openNewGroup(page);
  const next = page.getByRole("button", { name: /Пропустить и назвать группу/ });
  await expect(next).toBeVisible();
  await expect(next).toBeEnabled();
  await next.click();
  // The step really changed: the modal's own title is the naming one, and the
  // create button is the one now on offer.
  await expect(page.getByText("Название группы", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Создать группу" })).toBeVisible();
});

test("and the group is actually created, with nobody invited", async ({ page }) => {
  const seen = await openNewGroup(page);
  await page.getByRole("button", { name: /Пропустить и назвать группу/ }).click();

  await page.getByRole("textbox").last().fill("Команда без приглашений");
  const create = page.getByRole("button", { name: "Создать группу" });
  await expect(create).toBeEnabled();
  await create.click();

  // The insert reached the database rather than the handler returning silently,
  // which is what it used to do on `selected.length === 0`.
  await expect.poll(() => seen.chatInserts, { timeout: 5_000 }).toBe(1);

  // And nothing claims invitations that were never sent.
  await expect(page.getByText(/Пригласить участников можно в информации о группе/)).toBeVisible();
  await expect(page.getByText("Приглашения отправлены.")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`the invitee step holds in the ${theme} theme`, async ({ page }, info) => {
    await page.addInitScript((value) => localStorage.setItem("kub-theme", value as string), theme);
    await openNewGroup(page);
    await expect(page.getByText("Анна Тихая")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: shotPath(info, `pick-${theme}`), fullPage: false });
  });
}
