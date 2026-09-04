import { expect, test, type Page, type Route } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * A picture in a chat must survive one failed request.
 *
 * The owner reported media that would not load until the page was reloaded.
 * Everything behind it measured clean — the objects are served, the variant
 * rows are `ready`, and a whole session of chat switching renders every picture
 * from its variant. What was not clean is what a bubble does after a single
 * failure: `MediaImage` latched an error box and never rendered an `<img>`
 * again, so the preview variant that arrived a moment later had nothing to load
 * into. Measured before the fix, one aborted request left the bubble reading
 * "Не удалось загрузить изображение" 28 seconds later in the same chat, and only
 * F5 cleared it.
 *
 * Two recoveries are asserted here, the two the video bubbles in the same file
 * already had:
 *
 *   1. a failed *variant* hands the bubble back to the original;
 *   2. a failed *original* — which is what every bubble starts with, before its
 *      variants are known — is recovered when the variant arrives.
 *
 * Both are asserted on rendered pixels (`naturalWidth`), not on the absence of
 * the error text, so a bubble that quietly renders a broken image cannot pass.
 */

// Chats whose pictures all have a `ready` preview and thumb, so the recovery
// under test is never waiting on a variant that does not exist.
const IMAGE_CHATS: ReadonlyArray<{ role: "tech_admin" | "client"; chatId: string }> = [
  { role: "tech_admin", chatId: "4a342924-bd00-42cb-ab89-e6b95a4abadd" },
  { role: "client", chatId: "02a3f32e-0973-4fb0-9001-5d270cb22cca" },
];

/**
 * Anything served out of the media bucket.
 *
 * Deliberately wider than a message's own objects: a variant does not live
 * under the owner's id at all — it is `media/variants/messages/...` — so a
 * pattern shaped like the original's path matches no variant and quietly
 * intercepts nothing. Each test narrows this itself.
 */
const MEDIA_OBJECT = /\/storage\/v1\/object\/public\/media\//;
/** Only a message's own variants. An avatar's are another surface's business. */
const MESSAGE_VARIANT = /variants\/messages\//;
const IMAGE_ERROR_TEXT = "Не удалось загрузить изображение";

// Signing in, opening a chat twice and then waiting out the variant refresh does
// not fit the suite's default budget. The waits are the assertion here.
test.describe.configure({ timeout: 150_000 });

/**
 * The pictures in the message stream, and whether they actually have pixels.
 *
 * Scoped by the bubble's own control rather than by URL, so avatars — which
 * live in the same bucket and have their own fallback rules — cannot decide
 * the result either way.
 */
async function readMessagePictures(page: Page) {
  return await page.evaluate(() => {
    const images = [...document.querySelectorAll('button[aria-label="Открыть фото"] img')] as HTMLImageElement[];
    return {
      total: images.length,
      painted: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      // Asked for and answered with nothing. A picture still below the fold is
      // not complete at all and is neither painted nor broken.
      broken: images.filter((image) => image.complete && image.naturalWidth === 0).length,
      fromVariant: images.filter((image) => /variants\//.test(image.currentSrc || image.src)).length,
    };
  });
}

async function signIn(page: Page) {
  const role = findFirstAvailableQaRole(IMAGE_CHATS.map((entry) => entry.role));
  test.skip(!role, "QA credentials are not configured");
  await gotoOrSkip(page, "/");
  await loginAsRoleOrSkip(page, role!);
  return IMAGE_CHATS.find((entry) => entry.role === role)!;
}

async function openChat(page: Page, chatId: string) {
  await page.goto(`/?chat=${chatId}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('button[aria-label="Открыть фото"] img').first()).toBeVisible({
    timeout: 20_000,
  });
}

test("a picture whose variant fails falls back to the original", async ({ page, context }) => {
  const target = await signIn(page);
  await openChat(page, target.chatId);
  await page.waitForTimeout(5000);

  const before = await readMessagePictures(page);
  test.skip(
    before.fromVariant === 0,
    "no picture in this chat resolved to a variant, so there is no fallback to exercise",
  );

  // Variants are uploaded `immutable` for a year, so a second visit takes them
  // from the browser's own caches and never asks the network — which a route
  // cannot intercept. Clearing the HTTP cache is not enough on its own: the
  // pictures survive a same-origin navigation in the renderer's memory cache,
  // and the interception below was measured to catch nothing until the cache
  // was disabled outright.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.clearBrowserCache");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  // Break every message preview and thumb, leave the originals alone. A bubble
  // that gives up here is the defect; a bubble that falls back still shows the
  // picture it was already showing a moment earlier.
  let abortedVariants = 0;
  await page.route(MEDIA_OBJECT, async (route: Route) => {
    if (MESSAGE_VARIANT.test(route.request().url())) {
      abortedVariants += 1;
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });

  await openChat(page, target.chatId);
  await page.waitForTimeout(9000);

  expect(abortedVariants, "no variant request was intercepted, so nothing was tested")
    .toBeGreaterThan(0);
  const after = await readMessagePictures(page);
  expect(await page.getByText(IMAGE_ERROR_TEXT).count()).toBe(0);
  expect(after.total).toBeGreaterThan(0);
  expect(after, "a picture was asked for and came back with no pixels").toMatchObject({ broken: 0 });
  expect(after.painted).toBeGreaterThan(0);
});

test("a picture whose first request fails recovers when its variant arrives", async ({ page }) => {
  const target = await signIn(page);

  // The bubble paints before its variants are known, so its first request is
  // for the original. Kill exactly one of those — a blip, a dropped connection,
  // a rate limit — and leave everything else alone.
  let killed = false;
  await page.route(MEDIA_OBJECT, async (route: Route) => {
    const request = route.request();
    const url = request.url();
    // A message's own upload carries the chat id in its name, which is what
    // separates it from an avatar living in the same bucket. Without that the
    // first image request this catches could be somebody's profile picture,
    // and the test would depend on the order the browser happened to use.
    const isThisChatsPicture = url.includes(target.chatId) && !/variants\//.test(url);
    if (!killed && request.resourceType() === "image" && isThisChatsPicture) {
      killed = true;
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });

  await openChat(page, target.chatId);
  // Long enough that the variant query has answered many times over. What this
  // pins is permanent, not slow: the error box outlived 28 seconds of waiting
  // in the same chat with no reload.
  await page.waitForTimeout(12_000);

  expect(killed, "no original request was intercepted, so nothing was tested").toBe(true);
  const after = await readMessagePictures(page);
  expect(await page.getByText(IMAGE_ERROR_TEXT).count()).toBe(0);
  expect(after.total).toBeGreaterThan(0);
  expect(after, "a picture was asked for and came back with no pixels").toMatchObject({ broken: 0 });
  expect(after.painted).toBeGreaterThan(0);
});
