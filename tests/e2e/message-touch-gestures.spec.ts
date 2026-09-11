import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";

/**
 * A message under a finger, from the owner's Telegram decisions of 2026-09-11
 * (D-071): one tap opens the menu, a double tap puts ❤️, and a second double
 * tap takes it off again — one reaction per person.
 *
 * The double tap is pinned where it failed: the last message of a conversation
 * held at its bottom. The reaction grows that bubble by a row of chips, and the
 * conversation moves up by the row to stay at its bottom — so the click the
 * browser sends after the second touch landed on the ❤️ chip that had just
 * moved under the finger, and took the reaction straight back off.
 *
 * The touches go through Chromium's own input pipeline rather than being
 * dispatched as DOM events, because the click that did the damage is the one
 * the browser itself synthesises after a touch. Every viewport and pointer is
 * set here, so any Chromium project runs it.
 *
 * Runs on the DEV preview fixture: start the dev server with
 * `VITE_PUBLIC_PREVIEW_FIXTURE=1`.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";
const LAST = "Тогда отправляю на согласование";

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [{ name: "Команда проекта", preview: LAST, time: "09:40", unread: 0 }],
  messages: [
    { sender: "Аня", text: "Доброе утро! Созвон сегодня в 11:00, ссылку пришлю ближе к делу.", time: "09:02", own: false },
    { sender: "Борис", text: "Я подключусь, но минут на десять позже.", time: "09:04", own: false },
    { sender: "Максим", text: "Отлично, тогда начнём с макета главной.", time: "09:06", own: true },
    { sender: "Аня", text: "Макет главной готов — посмотрите, пожалуйста, до созвона.", time: "09:10", own: false },
    { sender: "Борис", text: "Смета от подрядчика: итог 1,2 млн, сроки — две недели.", time: "09:14", own: false },
    { sender: "Максим", text: "Смету посмотрю после обеда и отпишусь.", time: "09:18", own: true },
    {
      sender: "Аня",
      text: "Напоминаю про созвон: в повестке макет главной, смета и сроки монтажа. Если что-то не успеваете посмотреть заранее, напишите сюда.",
      time: "09:22",
      own: false,
    },
    { sender: "Борис", text: "Посмотрел, по срокам вопросов нет.", time: "09:26", own: false },
    { sender: "Максим", text: "Особенно блок с загрузками — там поменялись кнопки.", time: "09:30", own: true },
    { sender: "Аня", text: "Кнопки вижу, выглядит аккуратно.", time: "09:34", own: false },
    { sender: "Борис", text: "Согласен, можно отправлять.", time: "09:37", own: false },
    { sender: "Аня", text: LAST, time: "09:40", own: false },
  ],
};

test.describe("a message under a finger", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("a double tap on the last message puts ❤️ on it, the ❤️ stays, and a second double tap takes it off", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "the touches go through Chromium's own input pipeline");
    await openFixture(page);

    const scroller = page.getByTestId("message-scroll-container");
    const held = await scroller.evaluate((node) => ({
      overflow: node.scrollHeight - node.clientHeight,
      gap: node.scrollHeight - node.clientHeight - node.scrollTop,
    }));
    // Both halves are the premise: a conversation that does not scroll grows
    // downwards, and nothing moves under the finger at all.
    expect(held.overflow, "the conversation does not scroll, so the case under test cannot happen").toBeGreaterThan(100);
    expect(held.gap, "the conversation is not held at its bottom").toBeLessThan(2);

    const bubble = page.locator('[data-message-bubble="true"]').filter({ hasText: LAST }).last();
    const heart = bubble.locator('[data-reaction-chip="❤️"]');
    const menu = page.locator("[data-action-menu]");
    await expect(heart).toHaveCount(0);
    const cdp = await page.context().newCDPSession(page);

    await doubleTap(page, cdp, await textPoint(bubble));
    // Past the double tap's window, and past the click a browser sends after a touch.
    await page.waitForTimeout(700);
    await expect(heart, "the ❤️ the double tap put was taken back off").toHaveCount(1);
    await expect(heart, "the ❤️ is not marked as the reader's own").toHaveAttribute("aria-pressed", "true");
    await expect(menu, "a double tap opened the menu as well").toHaveCount(0);

    await doubleTap(page, cdp, await textPoint(bubble));
    await page.waitForTimeout(700);
    await expect(heart, "a second double tap did not take the ❤️ off").toHaveCount(0);
    await expect(menu, "a double tap opened the menu as well").toHaveCount(0);
  });

  test("one tap opens the menu and puts no reaction", async ({ page }) => {
    await openFixture(page);
    const bubble = page.locator('[data-message-bubble="true"]').filter({ hasText: LAST }).last();
    const point = await textPoint(bubble);
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.locator("[data-action-menu]")).toBeVisible();
    await expect(bubble.locator("[data-reaction-chip]")).toHaveCount(0);
  });
});

async function openFixture(page: Page) {
  // The fixture refuses a message stamped later than "now", so the clock is
  // pinned exactly as the sibling fixture specs pin it.
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));
  await page.addInitScript(
    ([key, fixture]) => {
      (window as unknown as Record<string, unknown>)[key as string] = fixture;
    },
    [WINDOW_KEY, FIXTURE] as const,
  );
  const response = await page.goto(CAPTURE_PATH, { waitUntil: "domcontentloaded" }).catch(() => null);
  const ready = response
    ? await page
        .locator(`[${READY}="true"]`)
        .waitFor({ state: "attached", timeout: 15_000 })
        .then(() => true)
        .catch(() => false)
    : false;
  // A missing prerequisite fails loudly, as the sibling fixture specs do. A
  // check that skips itself is a check nobody ran.
  if (!ready) {
    throw new Error(
      "The DEV preview capture route did not report ready. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1.",
    );
  }
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: LAST })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // The conversation's entry settles over several frames; a tap lands after it.
  await page.waitForTimeout(1_000);
}

/** A point on the first line of a message's own text, where a thumb lands. */
async function textPoint(bubble: Locator): Promise<{ x: number; y: number }> {
  const box = await bubble.locator('[data-message-text-content="true"]').first().boundingBox();
  expect(box, "the message's text has no box").not.toBeNull();
  return { x: Math.round(box!.x + Math.min(20, box!.width / 2)), y: Math.round(box!.y + Math.min(12, box!.height / 2)) };
}

/** Two taps as a thumb makes them: each short, 60ms apart, on one spot. */
async function doubleTap(page: Page, cdp: CDPSession, point: { x: number; y: number }) {
  const touch = (type: "touchStart" | "touchEnd") =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: point.x, y: point.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
    });
  await touch("touchStart");
  await touch("touchEnd");
  await page.waitForTimeout(60);
  await touch("touchStart");
  await touch("touchEnd");
}
