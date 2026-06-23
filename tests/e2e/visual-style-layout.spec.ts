import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  findFirstAvailableQaRole,
  gotoOrSkip,
  loginAsRoleOrSkip,
} from "./helpers/auth";

test.describe("KUB visual style and layout", () => {
  test("brand assets render on auth shell", async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page);

    await gotoOrSkip(page, "/login");
    await expect(page.locator('img[src*="letscube-logo-vertical-light"]').first()).toBeVisible();

    const viewport = testInfo.project.use.viewport;
    const viewportWidth = viewport && typeof viewport === "object" && "width" in viewport ? viewport.width : 0;
    const mascot = page.locator('img[src*="letscube-mascot-primary"]').first();
    await expect(mascot).toBeVisible();
    if (viewportWidth < 1024) {
      const opacity = Number(await mascot.evaluate((node) => getComputedStyle(node).opacity));
      expect(opacity).toBeLessThanOrEqual(0.2);
    }

    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("notification tabs stay above the scrollable list", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff", "client"],
      { includeDefault: true },
    );
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    await expect(page.getByTestId("sidebar-brand-strip").locator("img")).toHaveCount(1);

    await page.getByTestId("notification-bell-button").click();
    const panel = page.getByTestId("notification-panel");
    const tabs = page.getByTestId("notification-tabs");
    const list = page.getByTestId("notification-list");
    await expect(panel).toBeVisible();
    await expect(tabs).toBeVisible();
    await expect(list).toBeVisible();
    await assertNoHorizontalOverflow(panel, "notification panel has horizontal overflow");
    await assertNoHorizontalOverflow(list, "notification list has horizontal overflow");

    for (const tab of ["all", "tasks", "messages", "system"]) {
      await page.getByTestId(`notification-tab-${tab}`).click();
      await expect(page.getByTestId(`notification-tab-${tab}`)).toHaveAttribute("data-state", "active");
      await assertNoHorizontalOverflow(panel, `notification panel has horizontal overflow in ${tab}`);
      await assertNoHorizontalOverflow(list, `notification list has horizontal overflow in ${tab}`);
      await assertBelow(tabs, list, `notification list overlaps tabs in ${tab}`);
      const firstItem = page.locator('[data-testid="notification-item"], [data-testid="notification-message-group"]').first();
      if (await firstItem.isVisible().catch(() => false)) {
        await assertBelow(tabs, firstItem, `notification item overlaps tabs in ${tab}`);
        await assertNoHorizontalOverflow(firstItem, `notification item has horizontal overflow in ${tab}`);
      }
    }

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("chat profile panel header and summary are aligned", async ({ page }) => {
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
    const header = page.getByTestId("chat-info-header");
    const summary = page.getByTestId("chat-info-summary");
    await expect(panel).toBeVisible();
    await expect(header).toBeVisible();
    await expect(summary).toBeVisible();
    await assertBelow(header, summary, "chat profile summary overlaps header");

    const panelBox = await requiredBox(panel, "chat info panel");
    const headerBox = await requiredBox(header, "chat info header");
    const summaryBox = await requiredBox(summary, "chat info summary");
    expect(headerBox.x).toBeGreaterThanOrEqual(panelBox.x - 1);
    expect(headerBox.x + headerBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
    expect(summaryBox.x).toBeGreaterThanOrEqual(panelBox.x - 1);
    expect(summaryBox.x + summaryBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);

    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("fully read chat opens anchored to latest messages", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff", "client"],
      { includeDefault: true },
    );
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    const readChat = page.locator('[data-testid="chat-list-item"][data-unread-count="0"][data-has-messages="true"]').first();
    test.skip((await readChat.count()) === 0, "QA account has no fully read visible chats with messages");
    await readChat.click();

    const scrollContainer = page.getByTestId("message-scroll-container");
    await expect(scrollContainer).toBeVisible();
    await page.waitForTimeout(900);

    const firstUnread = page.getByTestId("first-unread-separator");
    test.skip(await firstUnread.isVisible().catch(() => false), "Selected chat has an unread boundary");

    const metrics = await scrollContainer.evaluate((node) => {
      const el = node as HTMLElement;
      return {
        distanceFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
    });
    expect(metrics.distanceFromBottom).toBeLessThanOrEqual(32);

    await page.waitForTimeout(2200);
    const settledMetrics = await scrollContainer.evaluate((node) => {
      const el = node as HTMLElement;
      return {
        distanceFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
    });
    expect(settledMetrics.distanceFromBottom).toBeLessThanOrEqual(32);

    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });
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

async function assertBelow(top: Locator, bottom: Locator, message: string) {
  const topBox = await requiredBox(top, "top element");
  const bottomBox = await requiredBox(bottom, "bottom element");
  expect(bottomBox.y, message).toBeGreaterThanOrEqual(topBox.y + topBox.height - 1);
}

async function requiredBox(locator: Locator, name: string) {
  const box = await locator.boundingBox();
  expect(box, `${name} should have a bounding box`).not.toBeNull();
  return box!;
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
