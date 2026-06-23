import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  findFirstAvailableQaRole,
  gotoOrSkip,
  loginAsRoleOrSkip,
} from "./helpers/auth";

test("chat info media gallery uses generated variants instead of original image files", () => {
  const source = readFileSync(
    resolve("artifacts/kub/src/components/chat/ChatInfoPanel.tsx"),
    "utf8",
  );

  expect(source).toContain("selectMediaGalleryPreviewUrl");
  expect(source).toContain("useMessageMediaVariantUrls(mediaGridItems");
  expect(source).not.toContain("src={message.media_url}");
});

test("chat info media tab opens in real UI without horizontal overflow", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  const role = findFirstAvailableQaRole(
    ["owner", "tech_admin", "location_admin", "location_staff", "client"],
    { includeDefault: true },
  );
  test.skip(!role, "QA credentials or auth state are not configured");

  await gotoOrSkip(page, "/");
  await loginAsRoleOrSkip(page, role);

  const firstChat = page.getByTestId("chat-list-item").first();
  test.skip((await firstChat.count()) === 0, "QA account has no visible chats");
  await firstChat.click();

  const infoButton = page.getByTestId("chat-header-info-button");
  await expect(infoButton).toBeVisible();
  await infoButton.click();

  const panel = page.getByTestId("chat-info-panel");
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Медиа" }).click();
  await expect(page.getByText(/Медиа пока нет|Показать ещё|Фото|Видео|GIF/).first()).toBeVisible();
  await assertNoHorizontalOverflow(panel, "chat info media panel has horizontal overflow");

  expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
});

function collectConsoleErrors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  return consoleErrors;
}

function unexpectedConsoleErrors(messages: string[]): string[] {
  return messages.filter(
    (message) =>
      !message.includes("Failed to load resource") &&
      !message.includes("Missing Supabase environment variables") &&
      !(message.includes("TypeError: Failed to fetch") && message.includes("@supabase_supabase-js") && message.includes("_refreshAccessToken")),
  );
}

async function assertNoHorizontalOverflow(locator: Locator, message: string) {
  const metrics = await locator.evaluate((node) => {
    const el = node as HTMLElement;
    return {
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
    };
  });
  expect(metrics.scrollWidth, message).toBeLessThanOrEqual(metrics.clientWidth + 1);
}
