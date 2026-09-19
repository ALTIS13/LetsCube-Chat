import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * D-208 step one: the conversation still draws its pictures.
 *
 * Every address a bubble, a tile or an avatar puts in a `src` now comes out of
 * one resolver instead of seven `getPublicUrl` calls, and `useMediaVariants`
 * gained a subscription that can re-derive a chat's addresses without a poll.
 * That is a change inside the rendering path of every photograph in the
 * product, so «the string is identical» is necessary and not sufficient: what
 * has to be true is that nothing came off the screen.
 *
 * The DEV fixture route is the only surface that can be looked at. Its pictures
 * are inline `data:` URIs written here, so a screenshot of it carries no
 * production chat, no user data and nobody's photograph — which is the rule
 * this work is being done under, and would be a strange rule to break while
 * fixing a media-privacy defect.
 *
 * Needs a dev server started with `VITE_PUBLIC_PREVIEW_FIXTURE=1`, and fails
 * loudly rather than skipping when it is missing, as its sibling fixture specs
 * do.
 */

test.use({ screenshot: "off", trace: "off", video: "off" });

/**
 * `PUBLIC_PREVIEW_CAPTURE_PATH`, the fixture window key and the ready
 * attribute, copied rather than imported: the fixture module reaches for `@/`
 * aliases the Playwright process cannot resolve. The first case below reads the
 * source so the copies cannot drift.
 */
const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";

const SHOT_DIR = process.env.KUB_MEDIA_SHOT_DIR ?? "";
/** The projects carry no `colorScheme`, so the theme is asked for here. */
const THEME = process.env.KUB_MEDIA_SHOT_THEME === "dark" ? "dark" : "light";

/** An invented picture, drawn here. Two, so the bubbles are distinguishable. */
function picture(a: string, b: string, label: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
    `<rect width="640" height="420" fill="url(#g)"/>` +
    `<circle cx="470" cy="120" r="70" fill="#ffffff" fill-opacity="0.35"/>` +
    `<text x="40" y="380" font-family="sans-serif" font-size="44" fill="#ffffff">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [
    { name: "Команда проекта", preview: "Фотография", time: "09:09", unread: 0 },
    { name: "Синтетический чат", preview: "Текст последнего сообщения", time: "08:41", unread: 2 },
  ],
  messages: [
    { sender: "Аня", text: "Смотри, что получилось", time: "09:01", own: false },
    {
      sender: "Аня",
      text: "Первый вариант",
      time: "09:02",
      own: false,
      image: { url: picture("#2f6fed", "#7b4bd8", "1"), width: 640, height: 420 },
    },
    {
      sender: "Максим",
      text: "А вот второй, без сжатия",
      time: "09:04",
      own: true,
      image: {
        url: picture("#0f9d58", "#f4b400", "2"),
        width: 640,
        height: 420,
        uncompressed: true,
        sizeBytes: 2_400_000,
      },
    },
    { sender: "Максим", text: "Оба годятся", time: "09:05", own: true },
  ],
};

test("the constants this file copies are the ones the application uses", () => {
  const source = readFileSync(resolve("artifacts/kub/src/lib/publicPreviewFixture.ts"), "utf8");
  expect(source).toContain(`PUBLIC_PREVIEW_CAPTURE_PATH = "${CAPTURE_PATH}"`);
  expect(source).toContain(`"${WINDOW_KEY}"`);
  expect(source).toContain(`"${READY}"`);
});

async function openFixture(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));
  await page.emulateMedia({ colorScheme: THEME });
  await page.addInitScript(
    ([key, fixture]) => {
      (window as unknown as Record<string, unknown>)[key as string] = fixture;
    },
    [WINDOW_KEY, FIXTURE] as const,
  );
  const response = await page
    .goto(CAPTURE_PATH, { waitUntil: "domcontentloaded" })
    .catch(() => null);
  const ready = response
    ? await page
        .locator(`[${READY}="true"]`)
        .waitFor({ state: "attached", timeout: 15_000 })
        .then(() => true)
        .catch(() => false)
    : false;
  if (!ready) {
    throw new Error(
      "The DEV preview capture route did not report ready. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1.",
    );
  }
  await page.waitForTimeout(1_200);
}

test("every picture on the conversation surface loads", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await openFixture(page);

  const media = await page.evaluate(() =>
    [...document.querySelectorAll("img")].map((img) => ({
      scheme: (img.currentSrc || img.src || "").split(":")[0],
      complete: img.complete,
      width: img.naturalWidth,
      height: img.naturalHeight,
      alt: img.alt || null,
    })),
  );

  // Two photographs in bubbles. Fewer means the fixture stopped rendering them
  // and this case has quietly stopped measuring anything.
  expect(media.length, `images on the page: ${JSON.stringify(media)}`).toBeGreaterThanOrEqual(2);

  const broken = media.filter((entry) => !entry.complete || entry.width === 0);
  expect(broken, `broken images: ${JSON.stringify(broken)}`).toEqual([]);

  if (SHOT_DIR) {
    mkdirSync(SHOT_DIR, { recursive: true });
    const width = testInfo.project.use.viewport?.width ?? "auto";
    await page.screenshot({ path: `${SHOT_DIR}/preview-${width}-${THEME}.png` });
  }

  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});
