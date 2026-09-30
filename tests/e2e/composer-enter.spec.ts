import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
  type Fixture,
} from "./helpers/messageActionsFixture";

/**
 * Tracker item 71, the owner on 2026-09-28: «по кнопке enter в клавиатуре
 * телефона не отправку сообщения, а перенос по строке как в telegram».
 *
 * Telegram Web A decides it in `MessageInput.tsx`: on its phone layout under
 * iOS or Android, Enter is never the send shortcut, so the keyboard's Enter
 * starts a line and the arrow sends; anywhere else Enter sends and Shift+Enter
 * starts the line. The phone here is the Pixel 7 of `chromium-mobile-390`.
 */

test.use({ screenshot: "off", trace: "off", video: "off" });

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("75111111-1111-4111-8111-000000000001", "Максим Орлов", "maksim");
const ANNA = person("75111111-1111-4111-8111-000000000002", "Анна Смирнова", "anna");
const CHAT_ID = "75222222-2222-4222-8222-000000000001";

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

async function boot(page: Page): Promise<Fixture> {
  const fixture = await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [chat(CHAT_ID, "private", null, AT)],
    memberships: [membership(CHAT_ID, ME, "owner", AT), membership(CHAT_ID, ANNA, "member", AT)],
    messages: [message("75333333-3333-4333-8333-000000000001", CHAT_ID, ANNA, "Пришли адрес склада", AT)],
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("chat-list-item").filter({ hasText: ANNA.full_name }).click();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: "Пришли адрес склада" })).toBeVisible();
  return fixture;
}

const sends = (fixture: Fixture) => fixture.restCalls("messages", "POST").length;

test("on a phone Enter starts a new line and the arrow sends; on a computer Enter sends", async ({ page }) => {
  const fixture = await boot(page);
  const composer = page.getByPlaceholder("Сообщение…").first();
  const phone = (page.viewportSize()?.width ?? 0) < 768;

  await composer.click();
  await page.keyboard.type("Лесная, 12");
  await page.keyboard.press("Enter");
  if (phone) {
    await page.keyboard.type("второй подъезд");
    await expect(composer, "Enter on a phone's keyboard sent the message").toHaveValue("Лесная, 12\nвторой подъезд");
    await page.waitForTimeout(500);
    expect(sends(fixture), "nothing goes until the arrow is pressed").toBe(0);
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect.poll(() => sends(fixture)).toBe(1);
    expect((fixture.restCalls("messages", "POST")[0]?.body as { content?: string } | null)?.content).toBe("Лесная, 12\nвторой подъезд");
    return;
  }
  await expect.poll(() => sends(fixture), { message: "Enter on a computer did not send" }).toBe(1);
  await expect(composer).toHaveValue("");
  // Shift+Enter is still the computer's line break.
  await page.keyboard.type("Лесная, 12");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("второй подъезд");
  await expect(composer).toHaveValue("Лесная, 12\nвторой подъезд");
  expect(sends(fixture)).toBe(1);
});

test.describe("a phone held sideways", () => {
  // An iPhone 14 Pro Max in landscape: 932 by 430, above `md`, so the wide
  // layout — and the same keyboard. Telegram Web A sends here only because its
  // landscape media query is malformed; the native apps do not (2026-09-30).
  test.use({
    viewport: { width: 932, height: 430 },
    screen: { width: 932, height: 430 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    hasTouch: true,
    isMobile: true,
  });

  test("keeps Enter as a line break", async ({ page }) => {
    const fixture = await boot(page);
    const composer = page.getByPlaceholder("Сообщение…").first();
    await composer.click();
    await page.keyboard.type("Лесная, 12");
    await page.keyboard.press("Enter");
    await page.keyboard.type("второй подъезд");
    await expect(composer, "Enter on a sideways phone sent the message").toHaveValue("Лесная, 12\nвторой подъезд");
    await page.waitForTimeout(500);
    expect(sends(fixture), "nothing goes until the arrow is pressed").toBe(0);
  });
});
