import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  findFirstAvailableQaRole,
  gotoOrSkip,
  loginAsRoleOrSkip,
} from "./helpers/auth";

test.describe("LETSCUBE visual style and layout", () => {
  test("brand assets render on auth shell", async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page);

    await gotoOrSkip(page, "/login");
    await expect(page.locator('img[src*="letscube-wordmark-vertical-"]').first()).toBeVisible();

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

    await expect(page.getByTestId("authenticated-shell-brand").locator("img")).toHaveCount(1);

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

  test("folder editor keeps one reachable vertical scroll surface", async ({ page }) => {
    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff", "client"],
      { includeDefault: true },
    );
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    const openEditor = page.getByRole("button", { name: "Новая папка" }).first();
    test.skip((await openEditor.count()) === 0, "Folder controls are unavailable for this QA role");
    await openEditor.click();

    const dialog = page.getByRole("dialog").filter({ hasText: "Новая папка" });
    await expect(dialog).toBeVisible();

    const scrollSurfaces = await dialog.locator("*").evaluateAll((nodes) =>
      nodes
        .filter((node): node is HTMLElement => node instanceof HTMLElement)
        .filter((node) => {
          const overflowY = getComputedStyle(node).overflowY;
          return overflowY === "auto" || overflowY === "scroll";
        })
        .map((node) => ({
          className: node.className,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
        })),
    );

    expect(scrollSurfaces, `folder editor has nested vertical scrolling: ${JSON.stringify(scrollSurfaces)}`)
      .toHaveLength(1);
  });

  test("authenticated shell brand stays readable in light theme", async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page);
    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff", "client"],
      { includeDefault: true },
    );
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await page.evaluate(() => window.localStorage.setItem("kub-theme", "light"));
    await page.reload({ waitUntil: "domcontentloaded" });

    const viewport = testInfo.project.use.viewport;
    const isMobile = Boolean(viewport && "width" in viewport && viewport.width < 768);
    const brand = isMobile
      ? page.getByTestId("sidebar-control-row").locator('img[src*="letscube-mark"]')
      : page.getByTestId("authenticated-shell-brand");
    await expect(brand).toBeVisible();
    if (!isMobile) {
      await expect(brand.locator('img[src*="letscube-wordmark-horizontal-dark"]')).toBeVisible();
    }
    await assertNoHorizontalOverflow(brand, "light theme sidebar brand has horizontal overflow");

    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("composer keeps video quality out of the generic attachment menu", async ({ page }) => {
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

    await page.getByRole("button", { name: "Прикрепить" }).click();
    await expect(page.getByTestId("media-quality-selector")).toHaveCount(0);

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
    await expect(scrollContainer).toHaveAttribute("data-loading-older", "false");
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
    const firstRenderedMessageId = await firstRenderedMessageIdOrNull(scrollContainer);

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
    await expect(scrollContainer).toHaveAttribute("data-loading-older", "false");
    if (firstRenderedMessageId) {
      await expect
        .poll(() => firstRenderedMessageIdOrNull(scrollContainer), {
          message: "read chat open should not auto-prepend older messages before user scrolls",
        })
        .toBe(firstRenderedMessageId);
    }

    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("fast upward scroll after opening a read chat is not pulled back to bottom", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff", "client"],
      { includeDefault: true },
    );
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    const scrollContainer = await openScrollableReadChatOrSkip(page);

    const firstUnread = page.getByTestId("first-unread-separator");
    test.skip(await firstUnread.isVisible().catch(() => false), "Selected chat has an unread boundary");

    await simulateFastUpwardScroll(scrollContainer, 720);
    const afterUserScroll = await distanceFromBottom(scrollContainer);
    expect(afterUserScroll).toBeGreaterThan(120);

    await page.waitForTimeout(2400);
    const settledAfterUserScroll = await distanceFromBottom(scrollContainer);
    expect(settledAfterUserScroll).toBeGreaterThan(120);

    expect(unexpectedConsoleErrors(consoleErrors)).toEqual([]);
  });

  test("loading older messages preserves the visible history anchor", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff", "client"],
      { includeDefault: true },
    );
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    const scrollContainer = await openPagedScrollableReadChatOrSkip(page);

    const before = await scrollContainer.evaluate((node) => {
      const el = node as HTMLElement;
      el.scrollTop = 120;
      const containerTop = el.getBoundingClientRect().top;
      const visible = [...el.querySelectorAll<HTMLElement>("[data-message-id]")]
        .find((message) => message.getBoundingClientRect().bottom > containerTop + 1);
      if (!visible?.dataset.messageId) return null;
      return {
        messageId: visible.dataset.messageId,
        offset: visible.getBoundingClientRect().top - containerTop,
      };
    });
    test.skip(!before, "Could not capture a visible message anchor");

    await scrollContainer.evaluate((node) => {
      node.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(scrollContainer).toHaveAttribute("data-loading-older", "true", { timeout: 5_000 });
    await expect(scrollContainer).toHaveAttribute("data-loading-older", "false", { timeout: 15_000 });

    const after = await scrollContainer.evaluate((node, messageId) => {
      const el = node as HTMLElement;
      const target = [...el.querySelectorAll<HTMLElement>("[data-message-id]")]
        .find((message) => message.dataset.messageId === messageId);
      if (!target) return null;
      return target.getBoundingClientRect().top - el.getBoundingClientRect().top;
    }, before!.messageId);

    expect(after, "The previously visible message must remain rendered after prepend").not.toBeNull();
    expect(Math.abs(after! - before!.offset)).toBeLessThanOrEqual(3);
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

async function openScrollableReadChatOrSkip(page: Page): Promise<Locator> {
  const readChats = page.locator('[data-testid="chat-list-item"][data-unread-count="0"][data-has-messages="true"]');
  const count = await readChats.count();
  test.skip(count === 0, "QA account has no fully read visible chats with messages");

  const scrollContainer = page.getByTestId("message-scroll-container");
  for (let index = 0; index < Math.min(count, 12); index += 1) {
    const candidate = readChats.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) break;
    await candidate.click();
    await expect(scrollContainer).toBeVisible();
    await page.waitForTimeout(500);
    const canScroll = await scrollContainer.evaluate((node) => {
      const el = node as HTMLElement;
      return el.scrollHeight > el.clientHeight + 420;
    });
    if (canScroll) return scrollContainer;
  }

  test.skip(true, "QA account has no fully read chat with enough history for scroll anchoring regression");
  return scrollContainer;
}

async function openPagedScrollableReadChatOrSkip(page: Page): Promise<Locator> {
  const readChats = page.locator('[data-testid="chat-list-item"][data-unread-count="0"][data-has-messages="true"]');
  const count = await readChats.count();
  test.skip(count === 0, "QA account has no fully read visible chats with messages");

  const scrollContainer = page.getByTestId("message-scroll-container");
  for (let index = 0; index < Math.min(count, 24); index += 1) {
    const candidate = readChats.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) break;
    await candidate.click();
    await expect(scrollContainer).toBeVisible();
    await expect(scrollContainer).toHaveAttribute("data-loading-older", "false");
    if (await scrollContainer.getAttribute("data-has-more-older") === "true") return scrollContainer;
  }

  test.skip(true, "QA account has no additional history page for prepend anchoring");
  return scrollContainer;
}

async function distanceFromBottom(locator: Locator): Promise<number> {
  return locator.evaluate((node) => {
    const el = node as HTMLElement;
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  });
}

async function firstRenderedMessageIdOrNull(locator: Locator): Promise<string | null> {
  return locator.evaluate((node) => {
    const el = node as HTMLElement;
    return el.querySelector<HTMLElement>("[data-message-id]")?.dataset.messageId ?? null;
  });
}

async function simulateFastUpwardScroll(locator: Locator, delta: number) {
  await locator.evaluate((node, amount) => {
    const el = node as HTMLElement;
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -amount, bubbles: true, cancelable: true }));
    el.scrollTop = Math.max(0, el.scrollTop - amount);
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, delta);
}
