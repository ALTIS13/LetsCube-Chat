import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";

/**
 * A message under a finger, from the owner's Telegram decisions of 2026-09-11
 * (D-071): one tap opens the menu, a double tap puts ❤️, and a second double
 * tap takes it off again — one reaction per person. D-287 adds the horizontal
 * half decided on 2026-09-20: a swipe left replies, beside the long-press menu
 * rather than instead of it. Rightward is the platform's back gesture and does
 * nothing here, and a swipe refuses to begin inside the 30dp the system takes
 * at each edge — see `@/lib/messageSwipe` for the measurements.
 *
 * The swipe is why a photo is in this fixture. A tap on a photo belongs to the
 * viewer — the opener is a `<button>`, so `isContentControl` discards the tap
 * that would have opened the menu — and that is exactly what the tester of
 * 2026-09-20 met: «Нельзя зажать месседж и выбрать ответить.» A horizontal
 * swipe does not compete with that tap, which is the whole reason the gesture
 * is the answer to it.
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
const PHOTO_CAPTION = "Схема второго этажа";

/** A picture the fixture will accept: a `data:image/` address and nothing else. */
function testCard(hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">` +
    `<rect width="1200" height="900" fill="hsl(${hue} 45% 24%)"/>` +
    `<circle cx="600" cy="450" r="200" fill="none" stroke="white" stroke-width="12"/>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

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

/** The same conversation with the reader's own photo last, for the (f) case. */
const PHOTO_FIXTURE = {
  ...FIXTURE,
  messages: [
    ...FIXTURE.messages,
    {
      sender: "Максим",
      text: PHOTO_CAPTION,
      time: "09:42",
      own: true,
      image: { url: testCard(205), width: 1200, height: 900 },
    },
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

  test("a swipe left replies, and shows the arrow that says so before it does", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "the drag goes through Chromium's own input pipeline");
    await openFixture(page);
    const row = page.locator("[data-message-id]").filter({ hasText: LAST }).last();
    const cdp = await page.context().newCDPSession(page);
    const start = await textPoint(row);

    await drag(page, cdp, start, -70, { release: false });
    await expect(row.locator("[data-message-swipe-reply]"), "nothing told the finger the gesture exists").toBeVisible();
    await expect(row.locator("[data-message-swipe-forward]"), "the wrong arrow came out").toHaveCount(0);
    await release(page, cdp);

    await expect(page.locator(REPLY_BAR), "a swipe left did not reply").toBeVisible();
    await expect(page.locator(FORWARD_PICKER), "a reply opened the forward picker").toHaveCount(0);
  });

  test("a swipe right does nothing at all, because that direction is the platform's back", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "the drag goes through Chromium's own input pipeline");
    await openFixture(page);
    const row = page.locator("[data-message-id]").filter({ hasText: LAST }).last();
    const cdp = await page.context().newCDPSession(page);
    const start = await textPoint(row);

    // Far enough to have committed, had the direction been ours at all.
    await drag(page, cdp, start, 120, { release: false });
    await expect(row.locator("[data-message-swipe-forward]"), "a forward arrow came back").toHaveCount(0);
    await expect(row.locator("[data-message-swipe-reply]"), "the reply arrow answered the wrong way").toHaveCount(0);
    await release(page, cdp);

    await expect(page.locator(FORWARD_PICKER), "a rightward swipe opened the forward picker").toHaveCount(0);
    await expect(page.locator(REPLY_BAR), "a rightward swipe replied").toHaveCount(0);
  });

  test("a swipe refuses to begin inside the edge the system takes for its own gesture", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "the drag goes through Chromium's own input pipeline");
    await openFixture(page);
    const row = page.locator("[data-message-id]").filter({ hasText: LAST }).last();
    const cdp = await page.context().newCDPSession(page);
    const box = await row.boundingBox();
    expect(box, "the row has no box").not.toBeNull();
    const width = page.viewportSize()!.width;
    const y = Math.round(box!.y + box!.height / 2);

    // The strip this guards is narrower than it sounds, and the test has to be
    // inside it or it proves nothing: the system inset is 30 from each edge,
    // but a row only spans 12..378 of a 390 viewport, so the overlap is
    // 12..30 on the left and 360..378 on the right -- about 18 either side.
    // An earlier version of this test pressed at 382, which is off the row
    // entirely, and passed with the guard deleted.
    expect(box!.x, "the row starts clear of the left inset, so there is nothing to guard").toBeLessThan(30);
    expect(box!.x + box!.width, "the row stops clear of the right inset, so there is nothing to guard").toBeGreaterThan(width - 30);

    await drag(page, cdp, { x: width - 22, y }, -120);
    await expect(page.locator(REPLY_BAR), "a swipe begun in the right-hand system inset replied").toHaveCount(0);
    await drag(page, cdp, { x: 20, y }, -120);
    await expect(page.locator(REPLY_BAR), "a swipe begun in the left-hand system inset replied").toHaveCount(0);

    // And just clear of it the gesture still works, so the refusal is a
    // boundary rather than the gesture quietly dying.
    await drag(page, cdp, { x: 40, y }, -120);
    await expect(page.locator(REPLY_BAR), "a swipe begun just clear of the inset did not reply").toBeVisible();
  });

  test("the forward picker offers the conversation the message came from", async ({ page }) => {
    await openFixture(page);
    // Reached through the long-press menu, which is where forwarding lives:
    // D-287 took the gesture away again, not the action.
    const row = page.locator("[data-message-id]").filter({ hasText: LAST }).last();
    await row.click({ button: "right" });
    await page.getByText("Переслать", { exact: true }).first().click();

    const picker = page.locator(FORWARD_PICKER);
    await expect(picker, "the menu did not open the forward picker").toBeVisible();
    // The tester's own words: «И даже переслать тебе он не даёт. Только другим
    // людям.» In a private chat the chat with that person IS the source, and
    // the picker used to filter the source out of its own list.
    await expect(
      picker.getByText(FIXTURE.activeChat.name, { exact: true }),
      "the picker still refuses the conversation the message came from",
    ).toBeVisible();
  });

  test("a swipe that stops short does nothing", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "the drag goes through Chromium's own input pipeline");
    await openFixture(page);
    const row = page.locator("[data-message-id]").filter({ hasText: LAST }).last();
    const cdp = await page.context().newCDPSession(page);
    const start = await textPoint(row);

    // 12 of the 40 are spent starting the gesture, so the row travels 28 -- short of the 48 that acts.
    await drag(page, cdp, start, -40);
    await expect(page.locator(REPLY_BAR)).toHaveCount(0);
    await expect(row.locator("[data-message-swipe-reply]")).toHaveCount(0);
  });

  test("on a photo, where the tap belongs to the viewer, the swipe still reaches the reply", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "the drag goes through Chromium's own input pipeline");
    await openFixture(page, PHOTO_FIXTURE, PHOTO_CAPTION);
    const row = page.locator("[data-message-id]").filter({ hasText: PHOTO_CAPTION }).last();
    const cdp = await page.context().newCDPSession(page);

    const box = await row.locator("img").first().boundingBox();
    expect(box, "the photo has no box").not.toBeNull();
    const onPhoto = { x: Math.round(box!.x + box!.width / 2), y: Math.round(box!.y + box!.height / 2) };

    // The premise, and the tester's complaint: a tap there opens the viewer,
    // so the menu a tap would have opened is never scheduled.
    await page.touchscreen.tap(onPhoto.x, onPhoto.y);
    await expect(page.locator(VIEWER), "a tap on the photo did not open the viewer").toBeVisible();
    await expect(page.locator("[data-action-menu]"), "a tap on the photo opened the menu too").toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator(VIEWER)).toHaveCount(0);

    await drag(page, cdp, onPhoto, -70);
    await expect(page.locator(REPLY_BAR), "a swipe on a photo could not reply").toBeVisible();
  });

  test("inside the open viewer, left and right belong to the pictures and reach no message", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "the drag goes through Chromium's own input pipeline");
    await openFixture(page, PHOTO_FIXTURE, PHOTO_CAPTION);
    const row = page.locator("[data-message-id]").filter({ hasText: PHOTO_CAPTION }).last();
    const cdp = await page.context().newCDPSession(page);
    const box = await row.locator("img").first().boundingBox();
    expect(box, "the photo has no box").not.toBeNull();
    await page.touchscreen.tap(Math.round(box!.x + box!.width / 2), Math.round(box!.y + box!.height / 2));

    const viewer = page.locator(VIEWER);
    await expect(viewer).toBeVisible();
    const frame = await viewer.boundingBox();
    expect(frame, "the viewer has no box").not.toBeNull();
    const middle = { x: Math.round(frame!.x + frame!.width / 2), y: Math.round(frame!.y + frame!.height / 2) };

    // The boundary this test exists for. A swipe on a message row and a swipe
    // inside an open viewer are different surfaces: the viewer is a layer over
    // the conversation, so the row never sees this finger. That is what lets
    // the viewer keep left and right for moving between pictures while the row
    // uses the same two directions for reply and forward.
    await drag(page, cdp, middle, -160);
    await drag(page, cdp, middle, 160);
    await expect(page.locator(REPLY_BAR), "a swipe in the viewer replied to a message").toHaveCount(0);
  });
});

async function openFixture(page: Page, fixture: unknown = FIXTURE, lastText: string = LAST) {
  // The fixture refuses a message stamped later than "now", so the clock is
  // pinned exactly as the sibling fixture specs pin it.
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));
  await page.addInitScript(
    ([key, fixture]) => {
      (window as unknown as Record<string, unknown>)[key as string] = fixture;
    },
    [WINDOW_KEY, fixture] as const,
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
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: lastText })).toBeVisible();
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

/** The reply bar above the composer, the forward picker's list, and the viewer. */
const REPLY_BAR = '[data-testid="composer-reply-preview"]';
const FORWARD_PICKER = '[data-forward-picker="true"]';
const VIEWER = '[data-testid="media-viewer-stage"]';

/**
 * A finger that presses, drags horizontally in steps, and lets go.
 *
 * The steps matter: a single jump from press to release is not a drag at all,
 * and the row would never see the movement that starts the gesture.
 */
async function drag(
  page: Page,
  cdp: CDPSession,
  from: { x: number; y: number },
  dx: number,
  options: { release?: boolean } = {},
) {
  const move = (x: number, type: "touchStart" | "touchMove") =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: [{ x, y: from.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
    });
  await move(from.x, "touchStart");
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    await move(Math.round(from.x + (dx * i) / steps), "touchMove");
    await page.waitForTimeout(16);
  }
  if (options.release === false) return;
  await release(page, cdp);
}

async function release(page: Page, cdp: CDPSession) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
}
