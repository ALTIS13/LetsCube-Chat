import { mkdirSync } from "node:fs";
import { expect, test, type Locator, type Page, type Route, type TestInfo } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openChat,
  openFixture,
  person,
  type Row,
} from "./helpers/messageActionsFixture";

/**
 * D-171: the shared-media surface tells a person where they are.
 *
 * Three mechanics, and each is measured here on rendered pixels rather than on
 * the source that produces them:
 *
 *   1. the viewer is a place in a sequence — «3 из 30», arrows, arrow keys, and
 *      a step past the last loaded item that loads the next page and lands on
 *      it rather than stopping;
 *   2. the grid is divided by month, with the month the reader is in shown
 *      while they scroll and faded when they stop;
 *   3. the end of the list is not a button pretending to be a sentinel, and a
 *      page that did not arrive says so instead of looking like the end.
 *
 * Everything runs on the message-actions fixture — a mocked backend on
 * `127.0.0.1:54321` with invented people and invented pictures, every request
 * to any other host aborted. **No production chat, no real person, no real
 * media is ever rendered.** The pictures are generated SVG squares; the names
 * are made up; the captions describe nothing that exists.
 */

const ME = person("11111111-1111-4111-8111-0000000000a1", "Максим Орлов");
const ANNA = person("11111111-1111-4111-8111-0000000000a2", "Анна Смирнова");
const CHAT = "22222222-2222-4222-8222-0000000000b1";
const CHAT_NAME = "Мастерская";
const FIRST_LINE = "Разложил снимки по месяцам";
const BUCKET = "chat-media";

/** The year the run happens in, which is what decides whether a month shows its year. */
const THIS_YEAR = new Date().getFullYear();
const monthLabel = (name: string, year: number) => (year === THIS_YEAR ? name : `${name} ${year}`);

/**
 * The three months this chat's photos fall in, with the number in each.
 *
 * Sixty in total against a page of twenty-four, so the list really has to be
 * paged and the automatic loader stops with a third of it still unfetched —
 * which is the only way to measure mechanics 1 and 3 at all.
 */
const MONTHS = [
  { year: 2026, month: 9, count: 25, label: monthLabel("Сентябрь", 2026) },
  { year: 2026, month: 8, count: 20, label: monthLabel("Август", 2026) },
  { year: 2025, month: 12, count: 15, label: monthLabel("Декабрь", 2025) },
] as const;
const TOTAL_PHOTOS = MONTHS.reduce((sum, month) => sum + month.count, 0);
const FIRST_PAGE = 24;
/**
 * How many pictures are on screen once the automatic loader has stopped.
 *
 * Deliberately not a constant. The loader stops when the end of the list falls
 * more than 200px below the scroller, and how many rows of tiles that takes
 * depends on the width of the panel and the height of the viewport — 48 at
 * 1440x900, and a different number on a phone. A spec that wrote one of those
 * numbers down would be asserting the geometry of one project rather than the
 * behaviour, so it is read instead.
 */
async function settledCount(page: Page): Promise<number> {
  let held = -1;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const now = await tiles(page).count();
    if (now === held && now >= FIRST_PAGE) return now;
    held = now;
    await page.waitForTimeout(300);
  }
  throw new Error(`the grid never settled; it holds ${held} tiles`);
}

/** A flat square with a number on it. Generated, so it depicts nothing and nobody. */
function squareSvg(index: number): string {
  const hue = (index * 37) % 360;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">',
    `<rect width="240" height="240" fill="hsl(${hue} 46% 38%)"/>`,
    `<circle cx="120" cy="96" r="44" fill="hsl(${hue} 52% 62%)"/>`,
    `<text x="120" y="196" font-family="sans-serif" font-size="56" font-weight="700" fill="rgba(255,255,255,0.9)" text-anchor="middle">${index + 1}</text>`,
    "</svg>",
  ].join("");
}

/**
 * The chat's photos, newest first, invented down to the caption.
 *
 * Each carries a `media_variants` thumbnail so the grid draws a picture rather
 * than the placeholder it falls back to, and a `data:` address for the viewer,
 * which cannot reach a network by construction.
 */
function photos(): { rows: Row[]; variants: Row[] } {
  const rows: Row[] = [];
  const variants: Row[] = [];
  let index = 0;
  for (const month of MONTHS) {
    for (let nth = 0; nth < month.count; nth += 1) {
      // Spread backwards from the 27th at 20:00, two hours apart, so every
      // stamp is strictly older than the one before it and the whole run stays
      // inside its own month whatever the machine's time zone.
      const stamp = new Date(
        new Date(month.year, month.month - 1, 27, 20, 0, 0).getTime() - nth * 2 * 60 * 60 * 1000,
      ).toISOString();
      const id = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
      const path = `${CHAT}/${id}.png`;
      rows.push(message(id, CHAT, nth % 3 === 0 ? ME : ANNA, `Снимок ${index + 1}`, stamp, {
        type: "image",
        media_bucket: BUCKET,
        media_path: path,
        media_url: `data:image/svg+xml,${encodeURIComponent(squareSvg(index))}`,
        media_metadata: { kind: "image", width: 240, height: 240 },
      }));
      variants.push({
        id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
        message_id: id,
        variant_kind: "image_thumb",
        variant_bucket: BUCKET,
        variant_path: `${path}.thumb.webp`,
        width: 240,
        height: 240,
        status: "ready",
        error_code: null,
        updated_at: stamp,
      });
      index += 1;
    }
  }
  return { rows, variants };
}

type FailMode = "none" | "second-page" | "first-page";

interface OpenOptions {
  theme?: "light" | "dark";
  /** Whether the server has counted this chat's media, or has to be guessed at. */
  counted?: boolean;
  fail?: FailMode;
}

/**
 * The theme, stamped the way the product's own runtime stamps it.
 *
 * Not through `localStorage`: the fixture writes «dark» in its own init script,
 * which runs after anything this file could add. These are the same three
 * things `applyResolvedTheme` does. Taken from `channel-card.spec.ts`.
 */
async function stampTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.classList.toggle("dark", value === "dark");
    root.classList.toggle("light", value === "light");
    root.setAttribute("data-theme", value as string);
    root.style.colorScheme = value as string;
  }, theme);
}

/** Until the card's layers have finished sliding. From `channel-card.spec.ts`. */
async function settled(page: Page) {
  await page.waitForFunction(() => {
    const layers = document.querySelectorAll<HTMLElement>(".kub-subview");
    return Array.from(layers).every((layer) => {
      const opacity = Number.parseFloat(getComputedStyle(layer).opacity);
      return layer.dataset.state === "current" ? opacity === 1 : opacity === 0;
    });
  });
}

async function openPhotos(page: Page, options: OpenOptions = {}) {
  const { theme = "dark", counted = true, fail = "none" } = options;
  const { rows, variants } = photos();
  await openFixture(page, {
    me: ME,
    chats: [chat(CHAT, "group", CHAT_NAME, "2026-09-14T09:00:00.000Z")],
    memberships: [
      membership(CHAT, ME, "owner", "2026-09-14T09:00:00.000Z"),
      membership(CHAT, ANNA, "member", "2026-09-14T09:00:00.000Z"),
    ],
    messages: [
      message("55555555-5555-4555-8555-000000000001", CHAT, ANNA, FIRST_LINE, "2026-09-14T09:00:00.000Z"),
      ...rows,
    ],
    rpc: (name) => {
      // The exact totals, counted where the rows are. Without them the card
      // falls back to «what the loaded page holds», hedged with a `+`, which is
      // the second half of the position label's contract.
      if (name === "chat_media_counts") {
        return counted ? { body: [{ kind: "photo", total: TOTAL_PHOTOS }] } : { status: 404, body: { code: "PGRST202", message: "" } };
      }
      return undefined;
    },
  });

  // The variants, so a tile is a picture rather than the gradient placeholder.
  // Registered after `openFixture`, whose handler covers the whole host:
  // Playwright matches newest first, so this wins for this resource alone.
  await page.route("**/rest/v1/media_variants*", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(variants) }));

  // …and the bytes those rows point at. Generated here; nothing is fetched.
  await page.route("**/storage/v1/object/public/**", (route: Route) => {
    // The index is the tail of the message id, which is what makes every tile
    // a different square: a regex that missed it drew the same picture sixty
    // times, and the grid looked convincingly wrong in the first screenshots.
    const match = /-(\d{12})\.png\.thumb\.webp/.exec(route.request().url());
    const index = match ? Number(match[1]) : 0;
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: squareSvg(index) });
  });

  if (fail !== "none") {
    // A refusal aimed at the media query alone, so the conversation itself
    // still loads: the shared-media page is the one query that carries
    // `media_url=not.is.null`.
    await page.route("**/rest/v1/messages*", async (route: Route) => {
      const url = new URL(route.request().url());
      const isMediaPage = url.searchParams.get("media_url") === "not.is.null";
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const refuse = isMediaPage && (fail === "first-page" || offset > 0);
      if (!refuse) return route.fallback();
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "53300", details: null, hint: null, message: "no connection to the server" }),
      });
    });
  }

  await openChat(page, CHAT_NAME, FIRST_LINE);
  await page.getByTestId("chat-header-info-button").click();
  await expect(page.getByTestId("chat-info-panel")).toBeVisible();
  await stampTheme(page, theme);
  // The placeholder going is what says the counts are known; a row read before
  // then is a race against the network.
  await expect(page.getByTestId("chat-info-media-loading")).toHaveCount(0);
  const row = page.getByTestId("chat-info-media-row").filter({ hasText: "фотограф" });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByTestId("chat-info-gallery-view")).toBeVisible();
  await settled(page);
}

const tiles = (page: Page) => page.getByTestId("chat-info-media-tile");
const months = (page: Page) => page.getByTestId("chat-info-media-month");
const marker = (page: Page) => page.getByTestId("chat-info-media-month-marker");
const position = (page: Page) => page.getByTestId("media-viewer-position");

function shotPath(info: TestInfo, name: string): string {
  mkdirSync("output/shared-media", { recursive: true });
  return `output/shared-media/${name}-${info.project.name}.png`;
}

/** The media scroller, scrolled by the wheel so the listener really fires. */
async function scrollGrid(page: Page, by: number) {
  await page.getByTestId("chat-info-gallery-view").hover({ position: { x: 120, y: 200 } });
  await page.mouse.wheel(0, by);
}

/** Scroll until the automatic loader has brought the whole run in. */
async function loadEverything(page: Page) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if ((await tiles(page).count()) >= TOTAL_PHOTOS) return;
    await scrollGrid(page, 2000);
    await page.waitForTimeout(250);
  }
  await expect(tiles(page)).toHaveCount(TOTAL_PHOTOS);
}

// ---------------------------------------------------------------------------
// Mechanic 2: the grid is divided by month
// ---------------------------------------------------------------------------

test("the grid is divided by month, newest first", async ({ page }) => {
  await openPhotos(page);
  // The loader stops with part of the run still unfetched, which is what says
  // the paging is real; the rest arrives as the reader goes down.
  const settledTiles = await settledCount(page);
  expect(settledTiles, "the loader fetched the whole chat with nobody scrolling").toBeLessThan(TOTAL_PHOTOS);
  await loadEverything(page);
  await expect(months(page)).toHaveText([MONTHS[0].label, MONTHS[1].label, MONTHS[2].label]);
  const perMonth = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-media-month]"), (node) => ({
      key: (node as HTMLElement).dataset.mediaMonth,
      tiles: node.querySelectorAll('[data-testid="chat-info-media-tile"]').length,
    })));
  expect(perMonth).toEqual([
    { key: "2026-09", tiles: MONTHS[0].count },
    { key: "2026-08", tiles: MONTHS[1].count },
    { key: "2025-12", tiles: MONTHS[2].count },
  ]);
});

test("the month the reader is in appears with the scroll and fades when it stops", async ({ page }) => {
  await openPhotos(page);
  await loadEverything(page);
  // Back to the top, and still nothing: a marker standing over a grid nobody
  // is moving is chrome asserting itself.
  await scrollGrid(page, -6000);
  await expect(marker(page)).toHaveAttribute("data-shown", "false", { timeout: 4_000 });

  await scrollGrid(page, 60);
  await expect(marker(page)).toHaveAttribute("data-shown", "true");
  await expect(marker(page)).toHaveText(MONTHS[0].label);

  // Far enough that September's heading has gone past the top of the scroller —
  // which is the moment a sticky heading can no longer answer the question and
  // this marker can.
  await scrollGrid(page, 1300);
  await expect(marker(page)).toHaveText(MONTHS[1].label);
  await expect(marker(page)).toHaveAttribute("data-shown", "true");

  // And it goes on its own, without another event.
  await expect(marker(page)).toHaveAttribute("data-shown", "false", { timeout: 4_000 });
});

// ---------------------------------------------------------------------------
// Mechanic 1: the viewer is a place in a sequence
// ---------------------------------------------------------------------------

test("the viewer says which of how many, and the arrows move through the run", async ({ page }) => {
  await openPhotos(page);
  await tiles(page).nth(2).click();
  await expect(position(page)).toHaveText(new RegExp(`^3 из ${TOTAL_PHOTOS}`));

  await page.getByTestId("media-viewer-next").click();
  await expect(position(page)).toHaveText(new RegExp(`^4 из ${TOTAL_PHOTOS}`));
  await page.getByTestId("media-viewer-prev").click();
  await expect(position(page)).toHaveText(new RegExp(`^3 из ${TOTAL_PHOTOS}`));

  // The keys do exactly what the controls do.
  await page.keyboard.press("ArrowRight");
  await expect(position(page)).toHaveText(new RegExp(`^4 из ${TOTAL_PHOTOS}`));
  await page.keyboard.press("ArrowLeft");
  await expect(position(page)).toHaveText(new RegExp(`^3 из ${TOTAL_PHOTOS}`));

  // The first of the run has no previous; nothing disabled stands in its place.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(position(page)).toHaveText(new RegExp(`^1 из ${TOTAL_PHOTOS}`));
  await expect(page.getByTestId("media-viewer-prev")).toHaveCount(0);
  await expect(page.getByTestId("media-viewer-next")).toBeVisible();
});

test("a total nobody counted is hedged, exactly as the row that opened it is", async ({ page }) => {
  await openPhotos(page, { counted: false });
  const loaded = await settledCount(page);
  await tiles(page).nth(1).click();
  // «2 из 48+» — at least forty-eight, which is all loaded pages can say. The
  // row that opened this sub-view printed «48+ фотографий» from the same rule,
  // in a different module, and the unit test pins the two equal.
  await expect(position(page)).toHaveText(new RegExp(`^2 из ${loaded}\\+`));
  await expect(page.getByTestId("chat-info-gallery-view")).toHaveAttribute("data-state", "current");
});

test("stepping past the last loaded picture loads the next page and lands on it", async ({ page }) => {
  await openPhotos(page);
  const loaded = await settledCount(page);
  expect(loaded).toBeLessThan(TOTAL_PHOTOS);
  // Opened on the **first** tile and walked to the end with the keys, which is
  // the only way to reach the last loaded picture without the grid fetching
  // the next page underneath the test: `click()` scrolls its target into view,
  // and a click on the last tile carries the sentinel into the observer's
  // margin, so the step that follows would be an ordinary move through rows
  // that had already arrived. Measured: with the viewer's own «load the next
  // page» gutted, the click-on-the-last-tile version of this test still passed.
  await tiles(page).first().click();
  await expect(position(page)).toHaveText(new RegExp(`^1 из ${TOTAL_PHOTOS}`));
  for (let step = 1; step < loaded; step += 1) await page.keyboard.press("ArrowRight");
  await expect(position(page)).toHaveText(new RegExp(`^${loaded} из ${TOTAL_PHOTOS}`));
  // Nothing arrived on its own while the viewer was open, so what happens next
  // is the viewer's doing and nothing else's.
  expect(await tiles(page).count(), "the grid loaded a page by itself").toBe(loaded);

  // There is a next and it is not loaded: the control is still offered and the
  // press asks for the page rather than doing nothing.
  await page.getByTestId("media-viewer-next").click();
  await expect(position(page)).toHaveText(new RegExp(`^${loaded + 1} из ${TOTAL_PHOTOS}`), { timeout: 15_000 });
  // The grid behind it grew with the viewer, so closing lands on a list that
  // holds what was just looked at.
  await page.getByRole("button", { name: "Закрыть" }).click();
  expect(await tiles(page).count()).toBeGreaterThan(loaded);
});

test("the last picture of everything has no next", async ({ page }) => {
  await openPhotos(page);
  await loadEverything(page);
  await tiles(page).nth(TOTAL_PHOTOS - 1).click();
  await expect(position(page)).toHaveText(new RegExp(`^${TOTAL_PHOTOS} из ${TOTAL_PHOTOS}`));
  await expect(page.getByTestId("media-viewer-next")).toHaveCount(0);
  await expect(page.getByTestId("media-viewer-prev")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Mechanic 3: paging is not a button pretending to be a sentinel
// ---------------------------------------------------------------------------

test("the end of the list offers no press, and loading happens because the reader arrived", async ({ page }) => {
  await openPhotos(page);
  const sentinel = page.getByTestId("chat-info-media-sentinel");
  await expect(sentinel).toHaveCount(1);
  // Nothing to press: it is a target for the observer, not a control.
  await expect(sentinel.locator("button")).toHaveCount(0);
  await expect(page.getByTestId("chat-info-gallery-view")).not.toContainText("Загрузить ещё");

  await loadEverything(page);
  // Complete: nothing at all at the end. No empty row, no disabled control, no
  // permanent spinner.
  await expect(sentinel).toHaveCount(0);
  await expect(page.getByTestId("chat-info-media-tail-failed")).toHaveCount(0);
  await expect(page.getByTestId("chat-info-media-tail-exhausted")).toHaveCount(0);
});

test("tabbing to the end of the grid loads the next page", async ({ page }) => {
  // The claim the old «Загрузить ещё» button existed for — «nothing scrolls
  // into view when a reader tabs» — measured rather than argued. Focusing an
  // element scrolls it into view, so tabbing through the loaded tiles carries
  // the sentinel into the observer's margin and the page loads with no control
  // to press.
  await openPhotos(page);
  const loaded = await settledCount(page);
  expect(loaded).toBeLessThan(TOTAL_PHOTOS);
  await tiles(page).first().focus();
  const moved = await page.evaluate(() => document.getElementById("chat-info-media-panel")!.scrollTop);
  expect(moved, "the grid starts at the top").toBe(0);
  for (let step = 0; step < loaded - 1; step += 1) await page.keyboard.press("Tab");
  await expect(tiles(page).nth(loaded - 1)).toBeFocused();
  // The tabbing really did move the grid, which is the half of the claim that
  // was wrong. Then the observer does the rest, with nothing pressed.
  expect(await page.evaluate(() => document.getElementById("chat-info-media-panel")!.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(() => tiles(page).count(), { timeout: 15_000 })
    .toBeGreaterThan(loaded);
});

test("a page that did not arrive says so rather than looking like the end", async ({ page }) => {
  await openPhotos(page, { fail: "second-page" });
  await expect(tiles(page)).toHaveCount(FIRST_PAGE);
  await scrollGrid(page, 3000);
  const failed = page.getByTestId("chat-info-media-tail-failed");
  await expect(failed).toBeVisible({ timeout: 15_000 });
  await expect(tiles(page)).toHaveCount(FIRST_PAGE);
  await expect(failed).toContainText("Не удалось загрузить дальше.");
  // A complete list draws nothing; this draws a sentence and a way to ask
  // again. The two must never look the same.
  await expect(failed.getByTestId("chat-info-media-retry")).toBeVisible();
  await expect(page.getByTestId("chat-info-media-sentinel")).toHaveCount(0);
  // And the automatic loader does not go on retrying a refusal on every scroll.
  await scrollGrid(page, 400);
  await expect(failed).toBeVisible();
});

test("a first page that could not be read is not drawn as a chat with no media", async ({ page }) => {
  await openPhotos(page, { fail: "first-page" });
  const empty = page.getByTestId("chat-info-media-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toHaveAttribute("data-failed", "true");
  await expect(empty).toContainText("Не удалось загрузить медиа этого чата.");
  await expect(empty).toContainText("Проверьте соединение и попробуйте ещё раз.");
  // The claim this surface used to make having read nothing.
  await expect(empty).not.toContainText("Медиа пока нет");
  await expect(empty.getByTestId("chat-info-media-retry")).toBeVisible();
});

// ---------------------------------------------------------------------------
// The pixels
// ---------------------------------------------------------------------------

for (const theme of ["dark", "light"] as const) {
  test(`shared media, photographed in the ${theme} theme`, async ({ page }, info) => {
    await openPhotos(page, { theme });
    const panel: Locator = page.getByTestId("chat-info-panel");
    await settledCount(page);
    await page.evaluate(() => document.fonts.ready);
    await panel.screenshot({ path: shotPath(info, `${theme}-grid`) });

    // The marker, caught while it is up.
    await scrollGrid(page, 900);
    await expect(marker(page)).toHaveAttribute("data-shown", "true");
    await panel.screenshot({ path: shotPath(info, `${theme}-marker`) });

    // The viewer, as a place in a sequence.
    await scrollGrid(page, -2000);
    await tiles(page).nth(2).click();
    await expect(position(page)).toBeVisible();
    await page.screenshot({ path: shotPath(info, `${theme}-viewer`) });
    await page.getByRole("button", { name: "Закрыть" }).click();
  });

  test(`a refused page, photographed in the ${theme} theme`, async ({ page }, info) => {
    await openPhotos(page, { theme, fail: "second-page" });
    await scrollGrid(page, 3000);
    await expect(page.getByTestId("chat-info-media-tail-failed")).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.getByTestId("chat-info-panel").screenshot({ path: shotPath(info, `${theme}-tail-failed`) });
  });
}
