import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * Opening a chat a second time should cost nothing for pictures already seen.
 *
 * Every object was uploaded without a cache lifetime, so the storage service
 * served its own `max-age=3600`. Measured before the change: inside the hour a
 * repeat visit was free, and after it every avatar and every preview cost a
 * conditional request answered 304 — nothing re-downloaded, but a chat with
 * fifty pictures was fifty round trips on every visit.
 *
 * Uploads now declare a lifetime, and the paths are what justify it: a name
 * unique to one upload can be kept forever, while a profile's variant — the one
 * path that is overwritten in place — gets a month plus a version token in the
 * URL, so a changed picture is a different address.
 *
 * What this asserts is the outcome rather than the header: after a first load,
 * a second entry produces no network traffic for media and, in particular, no
 * revalidation. A 304 here would mean the browser still had to ask.
 */
const CHAT_WITH_MEDIA = "/?chat=02a3f32e-0973-4fb0-9001-5d270cb22cca";

test("a second visit to a chat asks the network for nothing", async ({ page, context }) => {
  const role = findFirstAvailableQaRole(["client", "owner", "tech_admin"], { includeDefault: true });
  test.skip(!role, "QA credentials are not configured");

  const media: Array<{ url: string; bytes: number; status: number }> = [];
  page.on("requestfinished", async (request) => {
    if (!/storage\/v1\/object/.test(request.url())) return;
    const sizes = await request.sizes().catch(() => null);
    const response = await request.response().catch(() => null);
    media.push({
      url: request.url(),
      // Playwright reports a negative body size for a response the browser
      // served from its own cache without going to the network.
      bytes: sizes?.responseBodySize ?? 0,
      status: response?.status() ?? 0,
    });
  });

  await gotoOrSkip(page, "/");
  await loginAsRoleOrSkip(page, role);

  // A warm cache from an earlier run would make this prove nothing.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.clearBrowserCache");

  const visit = async () => {
    media.length = 0;
    await page.goto(CHAT_WITH_MEDIA);
    await expect(page.locator('img[src*="/storage/"]').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(4000);
    const snapshot = [...media];
    await page.goto("/");
    await page.waitForTimeout(1000);
    return snapshot;
  };

  const cold = await visit();
  expect(cold.length, "the first visit should actually fetch something").toBeGreaterThan(0);
  expect(
    cold.reduce((sum, entry) => sum + Math.max(0, entry.bytes), 0),
    "the first visit downloads the pictures",
  ).toBeGreaterThan(0);

  const warm = await visit();
  expect(warm.length, "the same pictures should be requested again").toBeGreaterThan(0);
  const downloaded = warm.filter((entry) => entry.bytes > 0);
  expect(
    downloaded.map((entry) => `${Math.round(entry.bytes / 1024)}KB ${entry.url.split("/").pop()}`),
    "a picture was fetched over the network on a repeat visit",
  ).toEqual([]);
  expect(
    warm.filter((entry) => entry.status === 304).length,
    "a repeat visit should not even revalidate",
  ).toBe(0);
});
