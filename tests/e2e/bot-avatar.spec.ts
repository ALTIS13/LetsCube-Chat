import { expect, test, type Route } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

/**
 * A bot could never be given a picture: the column existed, nothing wrote it,
 * and the URL check forbade every storage address anyway.
 *
 * The management API is served from another origin that does not trust a local
 * page, so the surface is exercised against a stub of it. What that proves is
 * the half that lives here — that an owner is offered the controls, that the
 * picture is shown once set, and that removing it sends `null` to the avatar
 * route rather than, say, an empty string the database would reject. The other
 * half, that the database accepts exactly this URL and no other, is covered by
 * the migration's own rehearsal and by the route's unit tests.
 */
const BOT_ID = "a09d11eb-a5c4-4487-b100-d912326c7f75";
const AVATAR = `https://core.letscube.ru/storage/v1/object/public/media/bot-avatars/${BOT_ID}/avatar-1.webp`;

function stubManagement(page: import("@playwright/test").Page, initialAvatar: string | null) {
  const patches: Array<{ avatar_url: string | null }> = [];
  let avatar = initialAvatar;

  const handler = async (route: Route) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });

    const url = route.request().url();
    if (url.endsWith("/avatar")) {
      const body = JSON.parse(route.request().postData() ?? "{}") as { avatar_url: string | null };
      patches.push(body);
      avatar = body.avatar_url;
      return route.fulfill({
        status: 200, headers: cors, contentType: "application/json",
        body: JSON.stringify({ ok: true, result: { success: true } }),
      });
    }

    const bot = {
      id: BOT_ID, username: "cube_helper", display_name: "Cube Helper", description: "",
      avatar_url: avatar, state: "active", delete_after: null, role: "owner", token: null,
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };
    const eligibility = {
      email_verified: true, phone_verified: true, account_age_met: true, not_banned: true,
      under_limit: true, active_bot_count: 1, max_bots: 3, can_create: true,
    };
    const diagnostics = {
      delivery_mode: "polling", pending_update_count: 0, failure_count: 0,
      last_error_code: null, refreshed_at: "2026-01-01T00:00:00.000Z",
    };
    const result = url.endsWith("/bots")
      ? { bots: [bot], eligibility }
      : { bot, commands: [], developers: [], privacy: [], webhook: { configured: false, url: null }, diagnostics };
    return route.fulfill({
      status: 200, headers: cors, contentType: "application/json",
      body: JSON.stringify({ ok: true, result }),
    });
  };

  return { patches, install: () => page.route("**/bot/manage/v1/**", handler) };
}

async function openBot(page: import("@playwright/test").Page) {
  await gotoOrSkip(page, "/");
  await page.goto("/bots");
  await page.locator('button:has-text("@cube_helper")').first().click();
  await expect(page.getByText("Профиль", { exact: true })).toBeVisible();
}

test.describe("bot avatar", () => {
  test("an owner is offered a picture for a bot that has none", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin", "client"], { includeDefault: true });
    test.skip(!role, "QA credentials are not configured");

    const stub = stubManagement(page, null);
    await stub.install();
    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openBot(page);

    await expect(page.getByRole("button", { name: "Загрузить картинку" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Убрать" })).toHaveCount(0);
  });

  test("a picture is shown, and removing it clears the reference", async ({ page }) => {
    const role = findFirstAvailableQaRole(["owner", "tech_admin", "client"], { includeDefault: true });
    test.skip(!role, "QA credentials are not configured");

    const stub = stubManagement(page, AVATAR);
    await stub.install();
    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await openBot(page);

    await expect(page.locator(`img[src="${AVATAR}"]`).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Заменить картинку" })).toBeVisible();

    await page.getByRole("button", { name: "Убрать" }).click();
    await expect.poll(() => stub.patches.length).toBeGreaterThan(0);
    // Null, not "" — the database treats an empty string as an invalid URL and
    // would refuse the removal.
    expect(stub.patches.at(-1)).toEqual({ avatar_url: null });
  });
});
