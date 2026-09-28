import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * Tracker item 36 b — the depth of a chat row's menu, against Discord's direct-
 * message menu (reference-clients §15.2), taking the mechanics we already have
 * the machinery for:
 *
 *  - «Пометить как прочитанное», which Discord's web and desktop menu leads
 *    with, and only while there is something unread;
 *  - «Позвонить» beside the profile, offered by the header's own rule;
 *  - «Заблокировать», asked first, before the notification entries.
 *
 * The conversations are fictional and served by the fixture.
 */

test.use({ screenshot: "off", trace: "off", video: "off" });

const EARLY = "2026-09-27T08:00:00.000Z";
const AT = "2026-09-27T09:00:00.000Z";
const LATER = "2026-09-27T10:00:00.000Z";
const ME = person("91111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("91111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const PRIVATE = "92222222-2222-4222-8222-000000000001";
const GROUP = "92222222-2222-4222-8222-000000000002";
const ANNA_LINE = "Подпишешь акт сегодня?";

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

async function boot(page: Page, options: { unread?: boolean } = {}) {
  const unread = options.unread ?? true;
  return openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [chat(PRIVATE, "private", null, AT), chat(GROUP, "group", "Бригада", EARLY)],
    memberships: [
      // Read before Anna wrote, so her line is unread.
      membership(PRIVATE, ME, "owner", unread ? EARLY : LATER),
      membership(PRIVATE, ANNA, "member", AT),
      membership(GROUP, ME, "owner", AT),
      membership(GROUP, ANNA, "member", AT),
    ],
    // Nothing unread is a conversation with nothing in it: the fixture counts
    // a chat's unread without reading `last_read_at`, so a read mark alone
    // would not make the count zero here.
    messages: [
      ...(unread ? [message("93333333-3333-4333-8333-000000000001", PRIVATE, ANNA, ANNA_LINE, AT)] : []),
      message("93333333-3333-4333-8333-000000000002", GROUP, ANNA, "Бетон завтра", EARLY),
    ],
  });
}

const row = (page: Page, name: string) => page.getByTestId("chat-list-item").filter({ hasText: name });

/**
 * The row's menu, as a pointer opens it on a computer — a right click — and as
 * a thumb does on a phone: a press held past the row's 520 ms, told to the row
 * as touch pointer events, because a phone's coarse pointer ignores the
 * context menu on purpose.
 */
async function openRowMenu(page: Page, name: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const target = row(page, name);
  await expect(target).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) >= 768) {
    await target.click({ button: "right" });
  } else {
    const box = (await target.boundingBox())!;
    const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerType: "touch", pointerId: 7, isPrimary: true, button: 0 };
    await target.dispatchEvent("pointerdown", at);
    await page.waitForTimeout(700);
    await target.dispatchEvent("pointerup", at);
  }
  const menu = page.locator("[data-chat-context-menu]").first();
  await expect(menu).toBeVisible();
  return menu;
}

const entries = (menu: ReturnType<Page["locator"]>) =>
  menu.getByRole("menuitem").or(menu.getByRole("button")).allInnerTexts();

test("an unread conversation offers «Пометить как прочитанное» right after «Открыть», and it reads", async ({ page }) => {
  const fixture = await boot(page);
  const menu = await openRowMenu(page, "Анна Смирнова");
  const labels = (await entries(menu)).map((label) => label.trim()).filter(Boolean);
  expect(labels[0]).toBe("Открыть");
  expect(labels[1]).toBe("Пометить как прочитанное");

  await menu.getByText("Пометить как прочитанное", { exact: true }).click();
  // The conversation was not opened to do it.
  await expect(page.locator('[data-message-bubble="true"]')).toHaveCount(0);
  await expect(row(page, "Анна Смирнова")).toHaveAttribute("data-unread-count", "0");
  await expect.poll(() => fixture.rpcBodies("mark_chat_read_through").length).toBeGreaterThan(0);
  expect(fixture.rpcBodies("mark_chat_read_through")[0]).toMatchObject({ p_chat_id: PRIVATE });
});

test("a conversation with nothing unread has no such entry", async ({ page }) => {
  await boot(page, { unread: false });
  const menu = await openRowMenu(page, "Анна Смирнова");
  await expect(menu.getByText("Пометить как прочитанное", { exact: true })).toHaveCount(0);
});

test("a person's conversation offers «Позвонить» beside the profile; a group's does not", async ({ page }) => {
  const fixture = await boot(page);
  let menu = await openRowMenu(page, "Анна Смирнова");
  const labels = (await entries(menu)).map((label) => label.trim()).filter(Boolean);
  expect(labels.indexOf("Позвонить"), labels.join(" · ")).toBe(labels.indexOf("Открыть профиль") + 1);

  await menu.getByText("Позвонить", { exact: true }).click();
  // The call opens its conversation, as the header's does, and asks the ring.
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: ANNA_LINE })).toBeVisible();
  await expect.poll(() => fixture.rpcBodies("voice_call_ring").length).toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  menu = await openRowMenu(page, "Бригада");
  await expect(menu.getByText("Позвонить", { exact: true })).toHaveCount(0);
});

test("«Заблокировать» asks first, blocks, and then the row offers neither a call nor a second block", async ({ page }) => {
  const fixture = await boot(page);
  let menu = await openRowMenu(page, "Анна Смирнова");
  const labels = (await entries(menu)).map((label) => label.trim()).filter(Boolean);
  // Before the notification entries, as in Discord's menu.
  expect(labels.indexOf("Заблокировать")).toBeGreaterThan(-1);
  expect(labels.indexOf("Заблокировать")).toBeLessThan(labels.findIndex((label) => label.startsWith("Отключить уведомления")));

  await menu.getByText("Заблокировать", { exact: true }).click();
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog")).filter({ hasText: "Заблокировать пользователя?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Заблокировать" }).click();
  await expect.poll(() => fixture.restCalls("user_blocks", "POST").length).toBe(1);

  menu = await openRowMenu(page, "Анна Смирнова");
  await expect(menu.getByText("Разблокировать", { exact: true })).toBeVisible();
  await expect(menu.getByText("Позвонить", { exact: true })).toHaveCount(0);
});
