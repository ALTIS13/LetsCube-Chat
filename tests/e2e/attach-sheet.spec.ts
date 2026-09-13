import { createHash } from "node:crypto";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import sharp from "sharp";

/**
 * D-122: the attach sheet does its job in place, as Telegram's does.
 *
 * It is the composer's attach flow on every shell — the owner chose «Стеклянная
 * капсула» on 2026-09-12 — so there is nothing to switch on here, no second look
 * to answer for, and no menu of buttons beside it.
 *
 * What is pinned, through the real conversation rather than the preview page:
 * the sheet opens on «Галерея» and its tabs switch in place; opening it asks for
 * no camera and no position, and only «Геопозиция» asks for the position; a
 * gallery pick is sent from the sheet compressed, with its caption; «Отправить
 * без сжатия» under «…» and «Файл» → «Выбрать из Галереи» send the picked bytes;
 * a location leaves only from its own row, as the message it always was.
 *
 * And the row itself: six tabs, scrolling sideways to «Контакт», with the keys
 * walking all of them; each of the three placeholders says it is coming, holds
 * no control and sends nothing; the sheet is as tall as what it holds, grows
 * with picks, and closes by its handle on a phone and by its dim everywhere.
 *
 * The backend is a route mock on the fixture host, storage included, as in
 * `media-send-without-compression.spec.ts`; the spec refuses any other
 * configuration and aborts every request off this machine. Start the dev server
 * with VITE_SUPABASE_URL=http://127.0.0.1:54321.
 */

const FIXTURE_HOST = "http://127.0.0.1:54321";
const USER_ID = "11111111-1111-4111-8111-1111111111d1";
const OTHER_ID = "11111111-1111-4111-8111-1111111111d2";
const CHAT_ID = "22222222-2222-4222-8222-2222222222d1";
const NOW = "2026-09-03T12:00:00.000Z";
const CHAT_NAME = "Витрина на Садовой";
const GREETING = "Пришлите фото витрины, пожалуйста";
/** A public square, not anyone's address. */
const PLACE = { latitude: 55.75222, longitude: 37.61556, accuracy: 18 };

const TAB_NAMES = ["Галерея", "Файл", "Геопозиция", "Опрос", "Список", "Контакт"];

/** The placeholders the owner kept, in his order, with the line each says. «Музыка» he did not want. */
const PLACEHOLDERS = [
  ["Опрос", "Скоро здесь можно будет создать опрос"],
  ["Список", "Скоро здесь можно будет создать список"],
  ["Контакт", "Скоро здесь можно будет отправить контакт"],
] as const;

type Upload = { path: string; contentType: string; bytes: Buffer };
type Backend = { uploads: Upload[]; inserts: Array<Record<string, unknown>> };
type PickedFile = { name: string; mimeType: string; buffer: Buffer };

test.describe("the attach sheet (D-122)", () => {
  test.use({ geolocation: PLACE, permissions: ["geolocation"] });

  test.beforeEach(async ({ page, request }) => {
    const client = await request
      .get("/src/lib/supabase/client.ts")
      .then((response) => response.text())
      .catch(() => "");
    if (!client.includes(FIXTURE_HOST)) {
      throw new Error(
        `This spec mocks the backend at ${FIXTURE_HOST}. Start the dev server with VITE_SUPABASE_URL=${FIXTURE_HOST} and VITE_SUPABASE_ANON_KEY=playwright-public-fixture.`,
      );
    }
    await page.route(
      (url) => (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "127.0.0.1" && url.hostname !== "localhost",
      (route) => route.abort("blockedbyclient"),
    );
    await page.addInitScript(() => {
      // What the sheet must not do on its own: every camera stream and every
      // position asked for is counted.
      const probe = { media: 0, geo: 0 };
      (window as unknown as { __attachProbe: typeof probe }).__attachProbe = probe;
      if (navigator.mediaDevices?.getUserMedia) {
        const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (constraints) => {
          probe.media += 1;
          return getUserMedia(constraints);
        };
      }
      if (navigator.geolocation) {
        const getCurrentPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
        navigator.geolocation.getCurrentPosition = (...args: Parameters<Geolocation["getCurrentPosition"]>) => {
          probe.geo += 1;
          return getCurrentPosition(...args);
        };
      }
    });
    await installSession(page);
    await installUploadProbe(page);
  });

  test("opens on the gallery, switches tabs in place, and asks for nothing a tab does not need", async ({ page }) => {
    await installBackend(page);
    await openChat(page);

    await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
    const sheet = page.getByTestId("attach-sheet");
    await expect(sheet).toBeVisible();
    // The menu of buttons the sheet replaces is gone from the product, not hidden.
    await expect(page.getByTestId("composer-attach-menu"), "the attach menu is drawn again").toHaveCount(0);
    await expect(sheet.getByRole("tab", { name: "Галерея" })).toHaveAttribute("aria-selected", "true");
    await expect(sheet.locator('[data-attach-entry="library"]')).toBeVisible();
    expect(await attachProbe(page), "opening the sheet asked for a camera or a position").toEqual({ media: 0, geo: 0 });

    await sheet.getByRole("tab", { name: "Файл" }).click();
    await expect(sheet.getByRole("tab", { name: "Файл" })).toHaveAttribute("aria-selected", "true");
    await expect(sheet.getByRole("button", { name: "Выбрать из Галереи" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Выбрать из файлов" })).toBeVisible();
    expect((await attachProbe(page)).geo).toBe(0);

    await sheet.getByRole("tab", { name: "Геопозиция" }).click();
    await expect(sheet.getByTestId("attach-location-send")).toBeEnabled();
    await expect(sheet.getByTestId("attach-location-send")).toContainText("С точностью до 18");
    const asked = await attachProbe(page);
    expect(asked.geo, "«Геопозиция» did not ask for the position").toBeGreaterThan(0);
    expect(asked.media).toBe(0);

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  test("a pick from the gallery goes from the sheet compressed, with its caption, and asks nothing", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);

    await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
    const sheet = page.getByTestId("attach-sheet");
    const facade = await testPhoto("facade.png", 30);
    await pick(page, '[data-attach-entry="library"]', [facade]);
    await expect(sheet.getByRole("checkbox", { name: "Фото 1" })).toHaveAttribute("aria-checked", "true");
    // «Стеклянная капсула» says how many go in the sheet's title, and the send
    // button carries the count in its own accessible name.
    await expect(sheet.getByRole("heading", { name: "Выбрано 1" })).toBeVisible();
    await expect(sheet.getByTestId("attach-send")).toHaveAccessibleName("Отправить фото");
    expect(backend.uploads, "nothing is uploaded before the send").toHaveLength(0);

    await sheet.getByTestId("attach-caption").fill("Витрина после монтажа");
    await sheet.getByTestId("attach-send").click();
    await expect(sheet).toHaveCount(0);

    await expect.poll(() => backend.inserts.length).toBe(1);
    await expectCompressedUpload(page, backend, facade);
    expect(backend.inserts[0]).toMatchObject({
      type: "image",
      content: "Витрина после монтажа",
      media_metadata: { uncompressed: false, optimized: true },
    });
    expect((await attachProbe(page)).media).toBe(0);
  });

  test("«Отправить без сжатия» under «…» sends the picked bytes", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);

    await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
    const sheet = page.getByTestId("attach-sheet");
    const facade = await testPhoto("facade.png", 205);
    await pick(page, '[data-attach-entry="library"]', [facade]);
    await sheet.getByTestId("attach-more").click();
    await page.getByTestId("attach-send-original").click();
    await expect(sheet).toHaveCount(0);

    await expect.poll(() => backend.inserts.length).toBe(1);
    await expectOriginalUpload(page, backend, facade);
    expect(backend.inserts[0]).toMatchObject({ type: "image", media_metadata: { uncompressed: true, optimized: false } });
  });

  test("«Файл» → «Выбрать из Галереи» sends the original, with no «…» to ask again", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);

    await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
    const sheet = page.getByTestId("attach-sheet");
    await sheet.getByRole("tab", { name: "Файл" }).click();
    const north = await testPhoto("north.png", 250);
    await pick(page, '[data-attach-entry="library-original"]', [north]);
    await expect(sheet.getByRole("checkbox", { name: "north.png" })).toHaveAttribute("aria-checked", "true");
    await expect(sheet.getByTestId("attach-more"), "«Файл» already sends the original").toHaveCount(0);
    await sheet.getByTestId("attach-send").click();

    await expect.poll(() => backend.inserts.length).toBe(1);
    await expectOriginalUpload(page, backend, north);
    expect(backend.inserts[0]).toMatchObject({ media_metadata: { uncompressed: true, optimized: false } });
  });

  /**
   * D-174. The owner asked on 2026-09-13 for SD by default with HD available,
   * which supersedes the photo half of D-119 — that entry recorded no quality
   * choice at all. What D-119 objected to is kept: the default needs no
   * thought, nothing is remembered between sends, and the composer asks
   * nothing. The control lives here, on the sheet that already holds the send.
   *
   * This test measures the bytes rather than the button. A control that
   * toggles and changes nothing downstream would pass any assertion about its
   * own state, and the wiring it depends on runs through four files.
   */
  test("HD leaves the device larger than SD, and the message records which it was (D-174)", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);
    const facade = await testPhoto("facade.png", 30);

    // First send: nothing is touched, which is what SD means.
    const first = await openSheet(page);
    await pick(page, '[data-attach-entry="library"]', [facade]);
    await expect(first.getByTestId("attach-hd")).toHaveAttribute("aria-pressed", "false");
    await first.getByTestId("attach-send").click();
    await expect(first).toHaveCount(0);
    await expect.poll(() => backend.inserts.length).toBe(1);

    // Second send: HD, chosen for this send only.
    const second = await openSheet(page);
    await pick(page, '[data-attach-entry="library"]', [facade]);
    const hd = second.getByTestId("attach-hd");
    await expect(hd, "a quality chosen once must not be remembered for the next send").toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await hd.click();
    await expect(hd).toHaveAttribute("aria-pressed", "true");
    await second.getByTestId("attach-send").click();
    await expect(second).toHaveCount(0);
    await expect.poll(() => backend.inserts.length).toBe(2);

    const handed = await probedUploads(page);
    expect(handed, "two compressed photographs, no previews").toHaveLength(2);
    const sdBytes = await probedBytes(page, handed[0].path);
    const hdBytes = await probedBytes(page, handed[1].path);
    expect(sdBytes, "the SD upload was not captured").not.toBeNull();
    expect(hdBytes, "the HD upload was not captured").not.toBeNull();
    const sd = await sharp(sdBytes as Buffer).metadata();
    const high = await sharp(hdBytes as Buffer).metadata();

    // The assertion that fails if the choice reaches nothing. Not a fixed
    // number: the short side has a floor of its own, so the exact result of
    // 2400x1800 at each profile is arithmetic this test has no business
    // restating. What must hold is that HD is the larger encode.
    expect(high.width ?? 0, "HD did not reach the encoder: both sends left the device the same size").toBeGreaterThan(
      sd.width ?? 0,
    );
    expect(handed[1].size).toBeGreaterThan(handed[0].size);

    // And what was sent stays readable afterwards, without a migration.
    expect(backend.inserts[0]).toMatchObject({ media_metadata: { media_quality: "compact", uncompressed: false } });
    expect(backend.inserts[1]).toMatchObject({ media_metadata: { media_quality: "original", uncompressed: false } });
  });

  test("HD is not offered until a photograph is selected (D-174)", async ({ page }) => {
    await installBackend(page);
    await openChat(page);

    const sheet = await openSheet(page);
    await expect(sheet.getByTestId("attach-hd"), "nothing is selected, so there is nothing to encode").toHaveCount(0);

    await pick(page, '[data-attach-entry="library"]', [await testPhoto("facade.png", 30)]);
    await expect(sheet.getByTestId("attach-hd"), "a gallery photograph is re-encoded, so the choice is real").toBeVisible();
  });

  /**
   * Its own page rather than a second act of the test above: with something
   * selected, Escape does not close the sheet — it asks whether to discard the
   * selection. That is the sheet behaving correctly and the first draft of this
   * test behaving badly.
   */
  test("«Файл» hands over the picked bytes, so HD is not offered there (D-174)", async ({ page }) => {
    await installBackend(page);
    await openChat(page);

    const sheet = await openSheet(page);
    await sheet.getByRole("tab", { name: "Файл" }).click();
    await pick(page, '[data-attach-entry="library-original"]', [await testPhoto("north.png", 250)]);
    await expect(sheet.getByRole("checkbox", { name: "north.png" })).toHaveAttribute("aria-checked", "true");
    // A control that changes nothing teaches people to distrust the ones that do.
    await expect(sheet.getByTestId("attach-hd"), "«Файл» sends the original, so HD would mean nothing").toHaveCount(0);
  });

  test("«Геопозиция» sends nothing until its row is tapped, then the message a location always was", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);

    await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
    const sheet = page.getByTestId("attach-sheet");
    await sheet.getByRole("tab", { name: "Геопозиция" }).click();
    const send = sheet.getByTestId("attach-location-send");
    await expect(send).toBeEnabled();
    await expect(sheet.locator("[data-attach-location-coordinates]")).toHaveText("55.75222, 37.61556");
    // No third party draws the place: the preview is ours, and empty until it is (the owner, 2026-09-12).
    await expect(sheet.locator("[data-attach-location-preview] img")).toHaveCount(0);
    expect(backend.inserts, "the place left before anyone asked it to").toHaveLength(0);

    await send.click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => backend.inserts.length).toBe(1);
    expect(String(backend.inserts[0].content)).toContain(`maps.google.com/?q=${PLACE.latitude},${PLACE.longitude}`);
  });

  test("the gallery opens on two even tiles and becomes a grid once something is picked", async ({ page }) => {
    await installBackend(page);
    await openChat(page);
    const sheet = await openSheet(page);
    const arrangement = sheet.locator("[data-attach-arrangement]");
    const camera = sheet.locator('[data-attach-entry="camera"]');
    const library = sheet.locator('[data-attach-entry="library"]');

    await expect(arrangement).toHaveAttribute("data-attach-arrangement", "tiles");
    const [cameraBox, libraryBox] = await Promise.all([camera.boundingBox(), library.boundingBox()]);
    expect(Math.abs(cameraBox!.width - libraryBox!.width), "the pair is not even").toBeLessThanOrEqual(1);
    expect(Math.abs(cameraBox!.height - libraryBox!.height), "the pair is not even").toBeLessThanOrEqual(1);
    expect(Math.abs(cameraBox!.y - libraryBox!.y), "the pair is not one row").toBeLessThanOrEqual(1);

    await pick(page, '[data-attach-entry="library"]', [await smallPhoto("one.png", 30)]);
    await expect(arrangement).toHaveAttribute("data-attach-arrangement", "grid");
    await expect(sheet.locator("[data-attach-pick]")).toHaveCount(1);
  });

  test("the tab row scrolls sideways to «Контакт», and the keys walk all six tabs", async ({ page, isMobile }) => {
    await installBackend(page);
    await openChat(page);
    const sheet = await openSheet(page);
    const row = sheet.getByRole("tablist", { name: "Вложения" });
    const gallery = row.getByRole("tab", { name: "Галерея", exact: true });
    const last = row.getByRole("tab", { name: "Контакт", exact: true });

    await expect(row.getByRole("tab")).toHaveText(TAB_NAMES);
    // Six tabs do not fit a phone, nor a desktop panel as narrow as one.
    const start = await tabRow(row, last);
    expect(start.scrollWidth, "the row fits, so there is nothing to scroll").toBeGreaterThan(start.clientWidth + 40);
    expect(start.overflowX).toMatch(/^(auto|scroll)$/);
    expect(start.tabInView, "«Контакт» was in view before the row was scrolled").toBe(false);
    await expect(row).toHaveAttribute("data-attach-tabs-overflow", "end");

    if (isMobile) {
      // Playwright has no touch swipe in either engine; this scrolls the row the
      // way a swipe ends, and the renders photograph a real one.
      await row.evaluate((node) => node.scrollTo({ left: node.scrollWidth, behavior: "auto" }));
    } else {
      const box = (await row.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 1200);
    }
    await expect.poll(async () => (await tabRow(row, last)).tabInView, { message: "«Контакт» did not come into view" }).toBe(true);
    await expect(row, "the fade stayed at the end the row was scrolled to").toHaveAttribute("data-attach-tabs-overflow", "start");
    await expect(gallery, "scrolling the row selected a tab").toHaveAttribute("aria-selected", "true");
    await row.evaluate((node) => node.scrollTo({ left: 0, behavior: "auto" }));
    await expect(row).toHaveAttribute("data-attach-tabs-overflow", "end");

    // The keys, from «Галерея», where the focus lands as the sheet opens.
    await expect(gallery).toBeFocused();
    await page.keyboard.press("End");
    await expect(last).toHaveAttribute("aria-selected", "true");
    await expect(last).toBeFocused();
    await expect.poll(async () => (await tabRow(row, last)).tabInView, { message: "End left «Контакт» out of view" }).toBe(true);
    await page.keyboard.press("Home");
    await expect(gallery).toHaveAttribute("aria-selected", "true");
    await expect(gallery).toBeFocused();
    await expect.poll(async () => (await tabRow(row, gallery)).scrollLeft, { message: "Home did not bring the row back" }).toBe(0);
    await page.keyboard.press("ArrowLeft");
    await expect(last, "ArrowLeft from the first tab did not wrap to the last").toHaveAttribute("aria-selected", "true");
    await expect(last).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(gallery).toHaveAttribute("aria-selected", "true");
    await expect(row.locator('[role="tab"][tabindex="0"]'), "more than one tab in the Tab order").toHaveCount(1);
    expect(await attachProbe(page), "walking the row asked for a camera or a position").toEqual({ media: 0, geo: 0 });
  });

  test("each placeholder tab says it is coming, holds no control, and sends nothing", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);
    const sheet = await openSheet(page);

    // «Музыка» was rendered beside these and the owner did not want it at all.
    await expect(sheet.getByRole("tab", { name: "Музыка", exact: true })).toHaveCount(0);

    for (const [name, line] of PLACEHOLDERS) {
      const tab = sheet.getByRole("tab", { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      const panel = sheet.getByRole("tabpanel");
      await expect(panel).toHaveAttribute("aria-labelledby", (await tab.getAttribute("id"))!);
      await expect(panel.getByRole("heading", { name, exact: true })).toBeVisible();
      await expect(panel.getByText(line, { exact: true })).toBeVisible();
      await expect(panel.locator("svg"), `«${name}» has no glyph, or more than one`).toHaveCount(1);
      await expect(
        panel.locator("button, input, textarea, select, a, [tabindex], [role='button'], [role='checkbox'], [role='link']"),
        `«${name}» holds a control`,
      ).toHaveCount(0);
      await expect(sheet.getByTestId("attach-send")).toHaveCount(0);
      await expect(sheet.getByTestId("attach-caption")).toHaveCount(0);
      await expect(sheet.getByTestId("attach-more")).toHaveCount(0);
      // A tap on it, or Enter on its tab, does nothing either.
      await panel.click();
      await tab.press("Enter");
      await expect(sheet).toBeVisible();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }

    expect(backend.inserts, "a placeholder sent a message").toHaveLength(0);
    expect(backend.uploads, "a placeholder uploaded something").toHaveLength(0);
    expect(await attachProbe(page), "a placeholder asked for a camera or a position").toEqual({ media: 0, geo: 0 });
  });

  test("the sheet is as tall as what it holds, grows with picks, and still closes by its handle and its dim", async ({ page, isMobile }) => {
    await installBackend(page);
    await openChat(page);
    const viewport = page.viewportSize()!;
    const dim = page.getByTestId("attach-sheet-backdrop");
    // Over the conversation, clear of the sheet: above it on a phone, beside the panel on a desktop.
    const dimPoint = isMobile ? { x: Math.round(viewport.width / 2), y: 120 } : { x: viewport.width - 300, y: 300 };
    let sheet = await openSheet(page);
    await expect(sheet.locator('[data-attach-entry="library"]')).toBeVisible();

    const empty = await settlesToFit(sheet, "«Галерея» before picking");
    expect(empty.height / viewport.height, "two actions keep more than half the screen").toBeLessThan(0.5);
    for (const [name, content] of [
      ["Файл", "[data-attach-file-sources]"],
      ["Опрос", '[data-attach-placeholder="poll"]'],
    ] as const) {
      await sheet.getByRole("tab", { name, exact: true }).click();
      // The tab's own content first: in WebKit the tap resolves before the panel is swapped.
      await expect(sheet.locator(content)).toBeVisible();
      const fit = await settlesToFit(sheet, `«${name}»`);
      expect(fit.height / viewport.height, `«${name}» keeps more than half the screen`).toBeLessThan(0.5);
    }

    // Nothing is selected, so the handle and the dim close it at once.
    if (isMobile) {
      await swipeDown(page, sheet);
      await expect(sheet, "a swipe down the handle did not close the sheet").toHaveCount(0);
      sheet = await openSheet(page);
    }
    await dim.click({ position: dimPoint });
    await expect(sheet, "a tap on the dim did not close the sheet").toHaveCount(0);

    sheet = await openSheet(page);
    await pick(page, '[data-attach-entry="library"]', [
      await smallPhoto("one.png", 30),
      await smallPhoto("two.png", 140),
      await smallPhoto("three.png", 250),
    ]);
    await expect(sheet.locator("[data-attach-pick]")).toHaveCount(3);
    const picked = await settlesToFit(sheet, "three picks");
    expect(picked.height, "three picks did not grow the sheet").toBeGreaterThan(empty.height + 60);

    // With picks selected the dim asks first, and only then closes.
    await dim.click({ position: dimPoint });
    const confirm = page.getByRole("button", { name: "Отменить выбор", exact: true });
    await expect(confirm).toBeVisible();
    await expect(sheet, "the sheet threw the picks away without asking").toBeVisible();
    await confirm.click();
    await expect(sheet).toHaveCount(0);
  });
});

// ── the flows ────────────────────────────────────────────────────────────────

async function openChat(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("chat-list-item").filter({ hasText: CHAT_NAME });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: GREETING })).toBeVisible();
}

async function openSheet(page: Page) {
  await page.getByRole("button", { name: "Прикрепить", exact: true }).click();
  const sheet = page.getByTestId("attach-sheet");
  await expect(sheet).toBeVisible();
  return sheet;
}

async function pick(page: Page, entry: string, files: PickedFile[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator(entry).click();
  await (await chooser).setFiles(files);
}

async function attachProbe(page: Page): Promise<{ media: number; geo: number }> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __attachProbe?: { media: number; geo: number } }).__attachProbe;
    return probe ? { media: probe.media, geo: probe.geo } : { media: -1, geo: -1 };
  });
}

/** Where the tab row stands, and whether `tab` is wholly inside what it shows. */
async function tabRow(row: Locator, tab: Locator) {
  const edges = await tab.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { left: box.left, right: box.right };
  });
  return row.evaluate((node, tabEdges) => {
    const box = node.getBoundingClientRect();
    return {
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      scrollLeft: Math.round(node.scrollLeft),
      overflowX: getComputedStyle(node).overflowX,
      tabInView: tabEdges.left >= box.left - 1 && tabEdges.right <= box.right + 1,
    };
  }, edges);
}

type Fit = { height: number; gap: number; overflow: number };

/** The sheet's height against what it holds: room nothing fills, and what is out of sight. */
async function readFit(sheet: Locator): Promise<Fit> {
  return sheet.evaluate((node) => {
    const scroller = node.querySelector<HTMLElement>("[data-attach-scroll]");
    const content = node.querySelector<HTMLElement>("[data-attach-content]");
    if (!scroller || !content) return { height: -1, gap: 999, overflow: 999 };
    return {
      height: Math.round(node.getBoundingClientRect().height),
      gap: Math.round(scroller.clientHeight - content.getBoundingClientRect().height),
      overflow: Math.round(scroller.scrollHeight - scroller.clientHeight),
    };
  });
}

/**
 * The sheet once it has come to rest around what it holds: no room in its
 * scrolling part that nothing fills, nothing of it out of sight, and the same
 * height 100ms apart. Polled rather than timed, because the height animates and
 * WebKit starts later: measured there, the tap resolves about 190ms before the
 * panel is swapped, and the resize begins some 60ms after that. A sheet that
 * never fits fails here, naming what it measured.
 */
async function settlesToFit(sheet: Locator, what: string): Promise<Fit> {
  const deadline = Date.now() + 5_000;
  let previous = await readFit(sheet);
  for (;;) {
    await sheet.page().waitForTimeout(100);
    const current = await readFit(sheet);
    if (current.height === previous.height && current.gap <= 2 && current.overflow <= 2) return current;
    if (Date.now() > deadline) {
      expect(current.gap, `${what}: the sheet is taller than what it holds`).toBeLessThanOrEqual(2);
      expect(current.overflow, `${what}: what it holds is cut off under a sheet that could still grow`).toBeLessThanOrEqual(2);
      throw new Error(`${what}: the sheet's height did not come to rest (${previous.height}, then ${current.height})`);
    }
    previous = current;
  }
}

/** Drags the sheet down by its handle, far and fast enough that a finger doing it closes the sheet. */
async function swipeDown(page: Page, sheet: Locator) {
  const handle = sheet.locator("[data-attach-drag-handle]");
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(x, y + step * 30);
  await page.mouse.up();
}

// ── what reached storage ─────────────────────────────────────────────────────

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type HandedUpload = { path: string; type: string; size: number; sha256: string };

/**
 * What the application handed to `fetch` for each storage upload, hashed in the
 * page — the bytes it chose to send, which is the property under test. The
 * reason it is hashed there rather than at the route is set out in
 * `media-send-without-compression.spec.ts`.
 */
async function installUploadProbe(page: Page) {
  await page.addInitScript(() => {
    const handed: Array<{ path: string; type: string; size: number; sha256: string; base64: string | null }> = [];
    (window as unknown as { __letscubeUploadProbe: typeof handed }).__letscubeUploadProbe = handed;
    const send = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const marker = "/storage/v1/object/media/";
      const body = init?.body;
      if (url.includes(marker) && body instanceof FormData) {
        const file = body.get("");
        if (file instanceof Blob) {
          const bytes = await file.arrayBuffer();
          const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
          const view = new Uint8Array(bytes);
          const kept = view.length <= 6 * 1024 * 1024;
          let binary = "";
          for (let at = 0; kept && at < view.length; at += 0x8000) {
            binary += String.fromCharCode(...view.subarray(at, at + 0x8000));
          }
          handed.push({
            path: decodeURIComponent(new URL(url).pathname.slice(new URL(url).pathname.indexOf(marker) + marker.length)),
            type: file.type,
            size: bytes.byteLength,
            sha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
            base64: kept ? btoa(binary) : null,
          });
        }
      }
      return send(input, init);
    };
  });
}

async function probedUploads(page: Page): Promise<HandedUpload[]> {
  return page.evaluate(() =>
    (window as unknown as { __letscubeUploadProbe: Array<HandedUpload & { base64: string | null }> }).__letscubeUploadProbe
      .map(({ base64: _bytes, ...upload }) => upload),
  );
}

async function probedBytes(page: Page, path: string): Promise<Buffer | null> {
  const base64 = await page.evaluate(
    (objectPath) =>
      (window as unknown as { __letscubeUploadProbe: Array<{ path: string; base64: string | null }> }).__letscubeUploadProbe
        .find((upload) => upload.path === objectPath)?.base64 ?? null,
    path,
  );
  return base64 === null ? null : Buffer.from(base64, "base64");
}

async function expectOriginalUpload(page: Page, backend: Backend, file: PickedFile) {
  const handed = await probedUploads(page);
  const upload = handed.find((candidate) => candidate.sha256 === sha256(file.buffer));
  expect(
    upload,
    `no upload hashes to ${file.name}; handed: ${handed.map((u) => `${u.path} ${u.type} ${u.size}`).join(", ")}`,
  ).toBeTruthy();
  expect(upload!.type).toBe(file.mimeType);
  expect(upload!.size).toBe(file.buffer.length);
  expect(backend.uploads.map((stored) => stored.path), "storage answered the upload").toContain(upload!.path);
}

async function expectCompressedUpload(page: Page, backend: Backend, file: PickedFile) {
  const handed = await probedUploads(page);
  expect(handed, "one object: the compressed photo, and no preview").toHaveLength(1);
  const [upload] = handed;
  expect(upload.type).toBe("image/webp");
  expect(upload.sha256).not.toBe(sha256(file.buffer));
  expect(upload.size).toBeLessThan(file.buffer.length);
  expect(backend.uploads.map((stored) => stored.path), "storage answered the upload").toEqual([upload.path]);
}

// ── fixtures ─────────────────────────────────────────────────────────────────

/** A 2400x1800 PNG heavy enough that a WebP of it is smaller, so compression really applies. */
async function testPhoto(name: string, hue: number): Promise<PickedFile> {
  const lines = [
    ...Array.from({ length: 25 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100 + 300}" y2="1800"/>`),
    ...Array.from({ length: 19 }, (_, i) => `<line x1="0" y1="${i * 100}" x2="2400" y2="${i * 100 - 200}"/>`),
  ].join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1800" viewBox="0 0 2400 1800">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue} 55% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360} 60% 28%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="2400" height="1800" fill="url(#g)"/>` +
    `<g stroke="hsl(${(hue + 180) % 360} 70% 80%)" stroke-width="5" opacity="0.55">${lines}</g>` +
    `<circle cx="1200" cy="900" r="420" fill="none" stroke="white" stroke-width="28"/>` +
    `</svg>`;
  const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 6 }).toBuffer();
  expect(buffer.length, "the test photo must stay under the resumable threshold").toBeLessThan(6 * 1024 * 1024);
  return { name, mimeType: "image/png", buffer };
}

/** A small plain photo for the checks where only the layout matters, not the bytes. */
async function smallPhoto(name: string, hue: number): Promise<PickedFile> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450"><rect width="600" height="450" fill="hsl(${hue} 55% 55%)"/></svg>`;
  return { name, mimeType: "image/png", buffer: await sharp(Buffer.from(svg)).png().toBuffer() };
}

// ── the backend ──────────────────────────────────────────────────────────────

async function installSession(page: Page) {
  await page.addInitScript(({ userId, now }) => {
    localStorage.setItem("kub-theme", "light");
    localStorage.setItem(
      "kub-auth",
      JSON.stringify({
        access_token: "playwright.user.jwt",
        refresh_token: "playwright-refresh",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "attach-sheet-qa@example.invalid",
          user_metadata: { full_name: "Максим" },
          app_metadata: {},
          created_at: now,
        },
      }),
    );
  }, { userId: USER_ID, now: NOW });
}

async function installBackend(page: Page): Promise<Backend> {
  const backend: Backend = { uploads: [], inserts: [] };
  const me = profile(USER_ID, "Максим", "maksim");
  const anya = profile(OTHER_ID, "Аня", null);
  const memberships = [membership(CHAT_ID, USER_ID, "owner", me), membership(CHAT_ID, OTHER_ID, "member", anya)];
  const chats = [chat(CHAT_ID, CHAT_NAME, "2026-09-03T11:30:00.000Z", memberships)];
  const messages: Array<ReturnType<typeof message>> = [
    message("55555555-5555-4555-8555-5555555555d1", CHAT_ID, OTHER_ID, GREETING, "2026-09-03T11:30:00.000Z", anya),
  ];

  await page.route(`${FIXTURE_HOST}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const single = (request.headers().accept ?? "").includes("application/vnd.pgrst.object");
    const eq = (name: string) => {
      const filter = url.searchParams.get(name);
      return filter?.startsWith("eq.") ? filter.slice(3) : null;
    };
    const one = <T,>(rows: T[]) => (single ? rows[0] ?? null : rows);

    if (url.pathname.startsWith("/storage/v1/object/public/media/")) {
      const objectPath = decodeURIComponent(url.pathname.slice("/storage/v1/object/public/media/".length));
      const stored = backend.uploads.find((upload) => upload.path === objectPath);
      if (!stored) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: stored.contentType, body: stored.bytes });
    }
    if (url.pathname.startsWith("/storage/v1/object/media/") && method === "POST") {
      const objectPath = decodeURIComponent(url.pathname.slice("/storage/v1/object/media/".length));
      const file = multipartFile(request.postDataBuffer(), request.headers()["content-type"] ?? "");
      if (!file) return json(route, { statusCode: "400", error: "Bad Request", message: "no file part" }, 400);
      const bytes = file.bytes.length ? file.bytes : (await probedBytes(page, objectPath)) ?? file.bytes;
      backend.uploads.push({ path: objectPath, contentType: file.contentType, bytes });
      return json(route, { Id: `object-${backend.uploads.length}`, Key: `media/${objectPath}` });
    }
    if (url.pathname === "/auth/v1/user") {
      return json(route, { id: USER_ID, aud: "authenticated", role: "authenticated", email: "attach-sheet-qa@example.invalid", user_metadata: { full_name: "Максим" }, app_metadata: {}, created_at: NOW });
    }
    if (url.pathname.includes("/rest/v1/profiles")) return json(route, one([me]));
    if (url.pathname.includes("/rest/v1/chat_members")) {
      const chatId = eq("chat_id");
      const userId = eq("user_id");
      return json(route, one(memberships.filter((row) => (!chatId || row.chat_id === chatId) && (!userId || row.user_id === userId))));
    }
    if (url.pathname.endsWith("/rpc/chat_list_summaries")) {
      return json(route, { code: "PGRST202", details: null, hint: null, message: "Could not find the function public.chat_list_summaries" }, 404);
    }
    if (url.pathname.includes("/rest/v1/chats")) {
      if (method !== "GET") return route.fulfill({ status: 204 });
      const id = eq("id");
      return json(route, one(chats.filter((row) => !id || row.id === id)));
    }
    if (url.pathname.includes("/rest/v1/media_variants")) return json(route, []);
    if (url.pathname.endsWith("/rest/v1/messages") && method === "POST") {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      backend.inserts.push(body);
      const row = {
        ...message(
          `55555555-5555-4555-8555-${String(5555555555 + backend.inserts.length).padStart(12, "0")}`,
          String(body.chat_id),
          USER_ID,
          String(body.content ?? ""),
          String(body.client_sent_at ?? NOW),
          me,
        ),
        type: body.type ?? "text",
        media_bucket: body.media_bucket ?? null,
        media_path: body.media_path ?? null,
        media_url: body.media_url ?? null,
        media_metadata: body.media_metadata ?? {},
        client_message_id: body.client_message_id ?? null,
        client_sent_at: body.client_sent_at ?? null,
      };
      messages.push(row);
      return json(route, row, 201);
    }
    if (url.pathname.includes("/rest/v1/messages")) {
      if (method !== "GET") return json(route, []);
      const chatId = eq("chat_id");
      const rows = messages.filter((row) => !chatId || row.chat_id === chatId);
      if ((request.headers().prefer ?? "").includes("count=exact")) {
        return json(route, [], 200, { "access-control-expose-headers": "Content-Range", "content-range": "*/0" });
      }
      const limit = Number(url.searchParams.get("limit") ?? rows.length);
      return json(route, one(rows.slice(0, Number.isFinite(limit) ? limit : rows.length)));
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(route, null);
    return json(route, single ? null : []);
  });

  return backend;
}

/** The file part of a `storage-js` upload: a multipart form whose file field has an empty name. */
function multipartFile(body: Buffer | null, contentType: string): { contentType: string; bytes: Buffer } | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!body || !boundary) return null;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    const headers = part.subarray(0, split).toString("utf8");
    if (/name=""/.test(headers) && /filename=/.test(headers)) {
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "application/octet-stream";
      return { contentType: type, bytes: Buffer.from(part.subarray(split + 4)) };
    }
    start = next;
  }
  return null;
}

function profile(id: string, fullName: string, username: string | null) {
  return { id, full_name: fullName, username, avatar_url: null, bio: null, role: "user", online_at: NOW, created_at: NOW, updated_at: NOW };
}

function membership(chatId: string, userId: string, role: string, person: ReturnType<typeof profile>) {
  return {
    chat_id: chatId,
    user_id: userId,
    role,
    joined_at: "2026-09-01T09:00:00.000Z",
    last_read_at: NOW,
    last_delivered_at: NOW,
    hidden_at: null,
    cleared_at: null,
    pinned: false,
    pinned_at: null,
    pinned_order: null,
    profile: person,
  };
}

function chat(id: string, name: string, updatedAt: string, memberships: Array<ReturnType<typeof membership>>) {
  return {
    id,
    type: "group",
    name,
    description: null,
    avatar_url: null,
    created_by: USER_ID,
    created_at: "2026-09-01T09:00:00.000Z",
    updated_at: updatedAt,
    is_forum: false,
    invite_policy: "owner_admin_only",
    members: memberships.filter((row) => row.chat_id === id),
  };
}

function message(id: string, chatId: string, userId: string, content: string, createdAt: string, sender: ReturnType<typeof profile>) {
  return {
    id,
    chat_id: chatId,
    topic_id: null,
    user_id: userId,
    bot_id: null,
    sender_deleted_at: null,
    content,
    type: "text" as unknown,
    media_bucket: null as unknown,
    media_path: null as unknown,
    media_url: null as unknown,
    media_metadata: {} as unknown,
    reply_to_id: null,
    reply_to: null,
    forwarded_from_id: null,
    forwarded_from: null,
    client_message_id: null as unknown,
    client_sent_at: null as unknown,
    bot_reply_markup: null,
    pinned: false,
    created_at: createdAt,
    edited_at: null,
    deleted_at: null,
    sender,
    bot: null,
    reactions: [],
  };
}

async function json(route: Route, body: unknown, status = 200, headers?: Record<string, string>) {
  await route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
}
