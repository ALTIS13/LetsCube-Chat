import { expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * Avatars used to be drawn from their originals.
 *
 * The pipeline has produced `avatar_128` and `avatar_256` all along, and the
 * picture component has always known how to use them — but only through a prop
 * that six of forty-two call sites passed, and `media_variants` would only let
 * you read your *own* profile's rows anyway, so somebody else's avatar could
 * not have used a variant even where the prop was passed.
 *
 * Measured on the administrator's user list, which is the densest avatar
 * surface in the product: 7 originals totalling 6,250 kB became 7 variants
 * totalling 20 kB.
 *
 * What this asserts is the part that matters and cannot be argued with: no
 * avatar original is fetched for a profile that has a variant.
 */
async function collectStorageRequests(page: import("@playwright/test").Page) {
  const requests: Array<{ url: string; bytes: number }> = [];
  page.on("requestfinished", async (request) => {
    if (!/storage\/v1\/object/.test(request.url())) return;
    const sizes = await request.sizes().catch(() => null);
    requests.push({ url: request.url(), bytes: sizes?.responseBodySize ?? 0 });
  });
  return requests;
}

test.describe("avatar preview sizing", () => {
  test("a dense avatar surface fetches variants and no originals", async ({ page, context }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "administrator QA credentials are not configured");

    // The saved auth state carries a warm cache; without this the page can
    // serve every avatar from it and the measurement proves nothing.
    const client = await context.newCDPSession(page);
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });

    const requests = await collectStorageRequests(page);
    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.goto("/admin/users");
    await expect(page.getByTestId("test-account-badge").first().or(page.locator("img"))).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(6000);

    const variants = requests.filter((entry) => /\/variants\/profiles\//.test(entry.url));
    const originals = requests.filter((entry) => /\/object\/public\/media\/avatars\//.test(entry.url));

    expect(variants.length, "the page should be drawing avatars from variants").toBeGreaterThan(0);
    expect(
      originals.map((entry) => `${Math.round(entry.bytes / 1024)}KB ${entry.url.split("/").pop()}`),
      "an avatar original was downloaded to draw a small circle",
    ).toEqual([]);

    // A variant is small by construction; this guards against the day someone
    // points the variant path at the original.
    for (const entry of variants) {
      expect(entry.bytes, `${entry.url} is not a small variant`).toBeLessThan(120_000);
    }
  });

  test("a person can read someone else's avatar variant", async ({ page }) => {
    // The policy used to restrict `media_variants` to your own profile, which
    // is why every avatar but your own fell back to the original. The files
    // live in a public bucket, so this exposes nothing that was not already
    // fetchable — only the address of it.
    const role = findFirstAvailableQaRole(["client", "owner", "tech_admin"], { includeDefault: true });
    test.skip(!role, "QA credentials are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    const captured = await page.waitForRequest(
      (request) => request.url().includes("/rest/v1/") && request.headers().apikey !== undefined,
      { timeout: 20_000 },
    );
    const headers = captured.headers();
    const origin = new URL(captured.url()).origin;

    const response = await page.request.get(
      `${origin}/rest/v1/media_variants?select=profile_id,variant_kind&variant_kind=in.(avatar_128,avatar_256)&limit=50`,
      { headers: { apikey: headers.apikey, authorization: headers.authorization } },
    );
    expect(response.status()).toBe(200);
    const rows = (await response.json()) as Array<{ profile_id: string | null }>;
    const mine = await page.evaluate(() => {
      const stored = localStorage.getItem("kub-auth");
      return stored ? (JSON.parse(stored)?.user?.id as string | undefined) : undefined;
    });
    expect(mine, "the probe needs a session to mean anything").toBeTruthy();
    expect(
      rows.some((row) => row.profile_id && row.profile_id !== mine),
      "only this person's own avatar variants were readable",
    ).toBe(true);
  });
});
