import { expect, test, type Locator, type Page } from "@playwright/test";
import { emulateSafeAreaWithCdp, expectClearOfHardware, type Insets } from "./helpers/ios-standalone";

/**
 * Complaint 7: «эмодзи мелкие, трудно попасть».
 *
 * Measured on this fixture before the fix, in CSS pixels. A composer emoji cell
 * was 39.5x28 at 390 and 35.8x28 at 360; the reaction catalog's 40.5x28 and
 * 36.8x28, with category tabs 28 tall and a search field 32 tall. The action
 * menu's quick reactions reached 44 on a phone at 390 but were 42 wide at 360,
 * and wherever the menu keeps its desktop shape under a finger — a phone held
 * sideways, a tablet — they were 30.6x40, while the hover bar's quick picker
 * offered 32x32. A finger needs 44.
 *
 * Both halves are asserted, for the reason D-015 gives: a check of the finger
 * alone would pass as well if the whole scale had been inflated, and the dense
 * picker a cursor sees is the design, kept exactly as it was.
 *
 * Runs on the DEV preview fixture: start the dev server with
 * `VITE_PUBLIC_PREVIEW_FIXTURE=1`. Every viewport and pointer is set here, so a
 * single project is enough — `chromium-desktop-1440` is the one it is run on.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";
const TARGET = 44;

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [
    { name: "Команда проекта", preview: "Тогда отправляю на согласование", time: "09:30", unread: 0 },
    { name: "Аня", preview: "Посмотрю вечером", time: "09:10", unread: 2 },
  ],
  messages: [
    { sender: "Аня", text: "Привет! Макет главной готов, посмотришь?", time: "09:20", own: false },
    { sender: "Максим", text: "Да, открываю", time: "09:21", own: true },
    { sender: "Аня", text: "Особенно блок с загрузками — там поменялись кнопки", time: "09:22", own: false },
    { sender: "Максим", text: "Отлично выглядит", time: "09:25", own: true },
    { sender: "Аня", text: "Тогда отправляю на согласование", time: "09:30", own: false },
  ],
};

type Box = { x: number; y: number; width: number; height: number; label: string };

const FINGERS: Array<{ name: string; viewport: { width: number; height: number }; insets: Insets | null }> = [
  { name: "a phone at 390x844", viewport: { width: 390, height: 844 }, insets: { top: 47, right: 0, bottom: 34, left: 0 } },
  { name: "a phone at 360x800", viewport: { width: 360, height: 800 }, insets: null },
  { name: "a phone held sideways at 844x390", viewport: { width: 844, height: 390 }, insets: { top: 0, right: 47, bottom: 21, left: 47 } },
  { name: "a tablet at 820x1180", viewport: { width: 820, height: 1180 }, insets: null },
];

for (const device of FINGERS) {
  test.describe(`emoji under a finger — ${device.name}`, () => {
    test.use({ hasTouch: true, isMobile: true, viewport: device.viewport });

    test("the composer's emoji are finger-sized, and a tap off-centre still picks the emoji aimed at", async ({ page }) => {
      await openFixture(page);
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "the context is not a coarse pointer").toBe(true);
      const surface = await openComposerPicker(page);
      const grid = page.getByTestId("message-emoji-grid");

      expectFingerSized(await boxesOf(grid.getByRole("button")), "composer emoji cell");
      expectFingerTall(await boxesOf(page.getByTestId("message-emoji-categories").getByRole("button")), "composer emoji category");
      expectFingerTall(await boxesOf(page.locator('label:has([data-testid="message-emoji-search"])')), "composer emoji search");
      await expectNoHorizontalOverflow(grid, "composer emoji grid");
      expectOnScreen(await requiredBox(surface, "composer emoji surface"), device.viewport, "composer emoji surface");

      // A finger lands off-centre. 18px above and below the middle of a cell is
      // inside a 44px target and was outside the 28px one: the second tap went
      // into the gap, or onto the row below.
      const aimed = grid.getByRole("button", { name: "Выбрать 😂" });
      const box = await requiredBox(aimed, "the aimed-at emoji");
      const centreX = box.x + box.width / 2;
      const centreY = box.y + box.height / 2;
      await page.touchscreen.tap(centreX, centreY - 18);
      await page.touchscreen.tap(centreX, centreY + 18);
      await expect(page.getByPlaceholder("Сообщение…")).toHaveValue("😂😂");
    });

    test("the action menu's quick reactions are finger-sized and fit inside the menu", async ({ page }) => {
      await openFixture(page);
      const menu = await openActionMenu(page);
      const quick = quickReactions(menu);
      await expect(quick).toHaveCount(7);
      const menuBox = await requiredBox(menu, "action menu");
      const boxes = await boxesOf(quick);
      expectFingerSized(boxes, "action menu quick reaction");
      expectInside(boxes, menuBox, "action menu quick reaction");
      expectOnScreen(menuBox, device.viewport, "action menu");
    });

    test("the full reaction catalog is finger-sized, on screen, and reaches its last emoji", async ({ page }) => {
      await openFixture(page);
      const menu = await openCatalogFromActionMenu(page);
      const grid = page.getByTestId("reaction-emoji-grid");
      const cells = grid.getByRole("button");

      expectFingerSized(await boxesOf(cells), "reaction catalog emoji cell");
      expectFingerTall(await boxesOf(page.getByTestId("reaction-emoji-categories").getByRole("button")), "reaction catalog category");
      expectFingerTall(await boxesOf(page.locator('label:has([data-testid="reaction-emoji-search"])')), "reaction catalog search");
      await expectNoHorizontalOverflow(grid, "reaction catalog grid");

      const menuBox = await requiredBox(menu, "reaction catalog");
      expectOnScreen(menuBox, device.viewport, "reaction catalog");
      // The catalog clips what does not fit, so a picker taller than its box
      // loses its bottom rows without any sign that they exist.
      expectInside([await labelledBox(page.getByTestId("reaction-emoji-picker"), "picker")], menuBox, "reaction catalog picker");

      await grid.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await page.waitForTimeout(150);
      const gridBox = await requiredBox(grid, "reaction catalog grid");
      const lastBox = await labelledBox(cells.last(), "last emoji");
      expectInside([lastBox], gridBox, "the last emoji, scrolled to");
      expectInside([lastBox], menuBox, "the last emoji, scrolled to");
    });

    if (device.viewport.width >= 640) {
      test("the hover bar's quick reactions are finger-sized and fit inside their picker", async ({ page }) => {
        await openFixture(page);
        const bubble = page.locator('[data-message-bubble="true"]').nth(2);
        await bubble.hover();
        const trigger = bubble.getByRole("button", { name: "Реакция" });
        const pressedAt = await requiredBox(trigger, "reaction trigger before the press");
        await trigger.click();
        const picker = page.locator("[data-reaction-menu]");
        await expect(picker).toBeVisible();
        const quick = quickReactions(picker);
        await expect(quick).toHaveCount(7);
        const pickerBox = await requiredBox(picker, "quick reaction picker");
        const boxes = await boxesOf(quick);
        expectFingerSized(boxes, "hover quick reaction");
        expectInside(boxes, pickerBox, "hover quick reaction");
        expectOnScreen(pickerBox, device.viewport, "quick reaction picker");

        // The taller picker has to lift further. At the pointer's lift it would
        // sit on the button that opened it. The trigger is measured again once
        // the picker is open, which is the geometry a person sees; the box from
        // before the press is only there to explain a failure.
        const triggerBox = await requiredBox(trigger, "reaction trigger");
        const where = describeBoxes([pickerBox, triggerBox, pressedAt]);
        if (pickerBox.y < triggerBox.y) {
          expect(pickerBox.y + pickerBox.height, `the quick picker covers its trigger:\n${where}`)
            .toBeLessThanOrEqual(triggerBox.y + 0.5);
        } else {
          expect(pickerBox.y, `the quick picker covers its trigger:\n${where}`)
            .toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height - 0.5);
        }
      });
    }

    if (device.insets) {
      const insets = device.insets;
      test("with the hardware's insets, every emoji surface stays clear of them", async ({ page, browserName }) => {
        test.skip(browserName !== "chromium", "the insets are overridden inside Chromium's own engine");
        await emulateSafeAreaWithCdp(page, insets);
        await openFixture(page);

        await openComposerPicker(page);
        await expectClearOfHardware(page, insets, `${device.name}, composer emoji picker`);
        await page.getByRole("button", { name: "Эмодзи", exact: true }).click();
        await expect(page.getByTestId("message-emoji-surface")).toHaveCount(0);

        await openActionMenu(page);
        await expectClearOfHardware(page, insets, `${device.name}, action menu`);
        await page.locator("[data-action-menu]").getByRole("button", { name: "Больше реакций" }).click();
        await expect(page.getByTestId("reaction-emoji-grid")).toBeVisible();
        await expectClearOfHardware(page, insets, `${device.name}, reaction catalog`);
      });
    }
  });
}

test.describe("emoji under a cursor — 1440x900", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1440, height: 900 } });

  test("the pickers keep the dense sizes they were designed with", async ({ page }) => {
    await openFixture(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "the context is a coarse pointer").toBe(false);

    await openComposerPicker(page);
    const composerGrid = page.getByTestId("message-emoji-grid");
    expectHeights(await boxesOf(composerGrid.getByRole("button")), 28, "composer emoji cell");
    expect(await columnsOf(composerGrid), "composer emoji columns").toBe(8);
    expectHeights(await boxesOf(page.getByTestId("message-emoji-categories").getByRole("button")), 28, "composer emoji category");
    await page.getByRole("button", { name: "Эмодзи", exact: true }).click();

    const menu = await openActionMenu(page);
    expectHeights(await boxesOf(quickReactions(menu)), 40, "action menu quick reaction");
    expect((await requiredBox(menu, "action menu")).width, "action menu width").toBe(256);

    await menu.getByRole("button", { name: "Больше реакций" }).click();
    const catalogGrid = page.getByTestId("reaction-emoji-grid");
    await expect(catalogGrid).toBeVisible();
    expectHeights(await boxesOf(catalogGrid.getByRole("button")), 28, "reaction catalog emoji cell");
    expect(await columnsOf(catalogGrid), "reaction catalog columns").toBe(8);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-reaction-menu]")).toHaveCount(0);

    const bubble = page.locator('[data-message-bubble="true"]').nth(2);
    await bubble.hover();
    await bubble.getByRole("button", { name: "Реакция" }).click();
    const picker = page.locator("[data-reaction-menu]");
    await expect(picker).toBeVisible();
    const quick = await boxesOf(quickReactions(picker));
    expectHeights(quick, 32, "hover quick reaction");
    expect(quick.every((box) => box.width === 32), `hover quick reaction widths: ${JSON.stringify(quick)}`).toBe(true);
    expect((await requiredBox(picker, "quick reaction picker")).width, "quick reaction picker width").toBe(284);
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
  await expect(page.locator('[data-message-bubble="true"]').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function openComposerPicker(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Эмодзи", exact: true }).click();
  const surface = page.getByTestId("message-emoji-surface");
  await expect(surface).toBeVisible();
  await expect(page.getByTestId("message-emoji-grid").getByRole("button")).toHaveCount(40);
  return surface;
}

async function openActionMenu(page: Page): Promise<Locator> {
  await page.locator('[data-message-bubble="true"]').nth(2).click({ button: "right" });
  const menu = page.locator("[data-action-menu]");
  await expect(menu).toBeVisible();
  return menu;
}

async function openCatalogFromActionMenu(page: Page): Promise<Locator> {
  const menu = await openActionMenu(page);
  await menu.getByRole("button", { name: "Больше реакций" }).click();
  const catalog = page.locator("[data-reaction-menu]");
  await expect(page.getByTestId("reaction-emoji-grid")).toBeVisible();
  await expect(page.getByTestId("reaction-emoji-grid").getByRole("button")).toHaveCount(40);
  return catalog;
}

function quickReactions(container: Locator): Locator {
  return container.locator('button[aria-label^="Поставить реакцию"], button[aria-label="Больше реакций"]');
}

async function boxesOf(locator: Locator): Promise<Box[]> {
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        label: node.getAttribute("aria-label") ?? (node.textContent ?? "").trim().slice(0, 24),
      };
    }),
  );
}

async function requiredBox(locator: Locator, what: string): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, `${what} has no box`).not.toBeNull();
  return { ...box!, label: what };
}

async function labelledBox(locator: Locator, what: string): Promise<Box> {
  return requiredBox(locator, what);
}

async function columnsOf(grid: Locator): Promise<number> {
  return grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).length);
}

function describeBoxes(boxes: Box[]): string {
  return boxes
    .map((box) => `  ${box.label}: ${box.width.toFixed(1)}x${box.height.toFixed(1)} at ${box.x.toFixed(1)},${box.y.toFixed(1)}`)
    .join("\n");
}

function expectFingerSized(boxes: Box[], what: string) {
  expect(boxes.length, `${what}: nothing was measured`).toBeGreaterThan(0);
  const under = boxes.filter((box) => box.width < TARGET - 0.01 || box.height < TARGET - 0.01);
  expect(under, `${what}: under the ${TARGET}px touch target\n${describeBoxes(under)}`).toEqual([]);
}

function expectFingerTall(boxes: Box[], what: string) {
  expect(boxes.length, `${what}: nothing was measured`).toBeGreaterThan(0);
  const under = boxes.filter((box) => box.height < TARGET - 0.01);
  expect(under, `${what}: under the ${TARGET}px touch target\n${describeBoxes(under)}`).toEqual([]);
}

function expectHeights(boxes: Box[], height: number, what: string) {
  expect(boxes.length, `${what}: nothing was measured`).toBeGreaterThan(0);
  const other = boxes.filter((box) => Math.abs(box.height - height) > 0.01);
  expect(other, `${what}: a cursor gets the designed ${height}px, not a finger's size\n${describeBoxes(other)}`).toEqual([]);
}

function expectInside(boxes: Box[], outer: Box, what: string) {
  const outside = boxes.filter((box) =>
    box.x < outer.x - 0.5 ||
    box.y < outer.y - 0.5 ||
    box.x + box.width > outer.x + outer.width + 0.5 ||
    box.y + box.height > outer.y + outer.height + 0.5,
  );
  expect(outside, `${what}: outside ${outer.label} (${outer.width.toFixed(1)}x${outer.height.toFixed(1)} at ${outer.x.toFixed(1)},${outer.y.toFixed(1)})\n${describeBoxes(outside)}`).toEqual([]);
}

function expectOnScreen(box: Box, viewport: { width: number; height: number }, what: string) {
  expect(
    box.x >= -0.5 && box.y >= -0.5 && box.x + box.width <= viewport.width + 0.5 && box.y + box.height <= viewport.height + 0.5,
    `${what} is not on screen: ${describeBoxes([box])} in ${viewport.width}x${viewport.height}`,
  ).toBe(true);
}

async function expectNoHorizontalOverflow(locator: Locator, what: string) {
  const overflow = await locator.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(overflow, `${what} overflows sideways by ${overflow}px`).toBeLessThanOrEqual(0);
}
