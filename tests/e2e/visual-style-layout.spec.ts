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

  test("folder editor keeps fields fixed and scrolls the searchable chat list", async ({ page }) => {
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

    const modalBody = dialog.getByTestId("kub-modal-body");
    const chatSearch = dialog.getByTestId("folder-chat-search");
    const chatList = dialog.getByTestId("folder-chat-list");
    await expect(chatSearch).toBeVisible();
    await expect(chatList).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Создать" })).toBeVisible();

    const modalBodyOverflow = await modalBody.evaluate((node) => getComputedStyle(node).overflowY);
    const chatListOverflow = await chatList.evaluate((node) => getComputedStyle(node).overflowY);
    expect(modalBodyOverflow).toBe("hidden");
    expect(chatListOverflow).toBe("auto");

    const chatRows = chatList.getByRole("button");
    if ((await chatRows.count()) > 1) {
      const firstChatName = (await chatRows.first().innerText()).trim();
      await chatSearch.fill(firstChatName.slice(0, Math.max(2, Math.min(firstChatName.length, 6))));
      await expect(chatRows).toHaveCount(1);
      await chatSearch.fill("");
    }

    const iconCategories = dialog.getByTestId("folder-icon-categories");
    const iconGrid = dialog.getByTestId("folder-icon-grid");
    await expect(iconCategories).toBeVisible();
    await expect(iconCategories.getByRole("button")).toHaveCount(4);
    await expect(iconGrid.getByRole("button")).toHaveCount(13);
    await assertNoHorizontalOverflow(iconCategories, "folder icon categories have horizontal overflow");
    await assertNoHorizontalOverflow(iconGrid, "folder icon grid has horizontal overflow");

    await iconCategories.getByRole("button", { name: "Работа" }).click();
    await expect(iconCategories.getByRole("button", { name: "Работа" })).toHaveAttribute("data-state", "active");
    await expect(iconGrid.getByRole("button")).toHaveCount(13);

    const scrollSurfaces = await dialog.locator("*").evaluateAll((nodes) =>
      nodes
        .filter((node): node is HTMLElement => node instanceof HTMLElement)
        .filter((node) => {
          const overflowY = getComputedStyle(node).overflowY;
          return overflowY === "auto" || overflowY === "scroll";
        })
        .map((node) => ({
          testId: node.dataset.testid ?? null,
          className: node.className,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
        })),
    );

    expect(scrollSurfaces, `folder editor has nested vertical scrolling: ${JSON.stringify(scrollSurfaces)}`)
      .toHaveLength(1);
    expect(scrollSurfaces[0]?.testId).toBe("folder-chat-list");
  });

  test("message emoji picker is one coherent searchable catalog", async ({ page }, testInfo) => {
    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff", "client"],
      { includeDefault: true },
    );
    test.skip(!role, "QA credentials or auth state are not configured");

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);

    const firstChat = page.locator('[data-testid="chat-list-item"]').first();
    test.skip((await firstChat.count()) === 0, "QA account has no visible chats");
    await firstChat.click();

    await page.getByRole("button", { name: "Эмодзи", exact: true }).click();
    const surface = page.getByTestId("message-emoji-surface");
    const picker = page.getByTestId("message-emoji-picker");
    const categories = page.getByTestId("message-emoji-categories");
    const grid = page.getByTestId("message-emoji-grid");
    const search = page.getByTestId("message-emoji-search");
    await expect(surface).toBeVisible();
    await expect(picker).toBeVisible();
    await expect(search).toBeVisible();
    await expect(categories).toBeVisible();
    await expect(categories.getByRole("button")).toHaveCount(8);
    await expect(grid.getByRole("button")).toHaveCount(40);
    await assertNoHorizontalOverflow(categories, "message emoji categories have horizontal overflow");
    await assertNoHorizontalOverflow(grid, "message emoji grid has horizontal overflow");
    const surfaceBox = await requiredBox(surface, "message emoji surface");
    const pickerBox = await requiredBox(picker, "message emoji picker");
    expect(surfaceBox.width - pickerBox.width).toBeLessThanOrEqual(32);
    expect(surfaceBox.width).toBeLessThanOrEqual(500);
    expect(surfaceBox.height).toBeLessThanOrEqual(320);
    const viewport = testInfo.project.use.viewport;
    if (viewport && "width" in viewport && viewport.width >= 768) {
      expect(surfaceBox.width).toBeGreaterThanOrEqual(440);
    }

    await categories.getByRole("button", { name: "Жесты" }).click();
    await expect(categories.getByRole("button", { name: "Жесты" })).toHaveAttribute("data-state", "active");
    await expect(grid.getByRole("button")).toHaveCount(40);
    await grid.getByRole("button", { name: "Выбрать 👍" }).click();
    await expect(page.getByPlaceholder("Сообщение…")).toHaveValue("👍");

    await search.fill("единорог");
    await expect(grid.getByRole("button", { name: "Выбрать 🦄" })).toBeVisible();
    await grid.getByRole("button", { name: "Выбрать 🦄" }).click();
    await expect(page.getByPlaceholder("Сообщение…")).toHaveValue("👍🦄");
    await page.getByRole("button", { name: "Эмодзи", exact: true }).click();

    const messageBubble = page.locator('[data-message-bubble="true"]').last();
    test.skip((await messageBubble.count()) === 0, "QA chat has no messages for reaction picker");
    if (viewport && "width" in viewport && viewport.width < 640) {
      await messageBubble.click({ button: "right" });
    } else {
      await messageBubble.hover();
      const reactionTrigger = messageBubble.getByRole("button", { name: "Реакция" });
      await expect(reactionTrigger).toBeVisible();
      await reactionTrigger.click();
    }
    await page.getByRole("button", { name: "Больше реакций" }).click();
    const reactionSearch = page.getByTestId("reaction-emoji-search");
    await expect(reactionSearch).toBeVisible();
    const reactionPickerBox = await requiredBox(page.getByTestId("reaction-emoji-picker"), "reaction emoji picker");
    expect(reactionPickerBox.width).toBeLessThanOrEqual(480);
    expect(reactionPickerBox.height).toBeLessThanOrEqual(300);
    await reactionSearch.fill("единорог");
    await expect(page.getByTestId("reaction-emoji-grid").getByRole("button", { name: "Выбрать 🦄" })).toBeVisible();
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

  test("chat profile panel header and summary are aligned", async ({ page }, testInfo) => {
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
    const chatHeader = page.getByTestId("chat-header-shell");
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
    const viewport = testInfo.project.use.viewport;
    if (viewport && "width" in viewport && viewport.width >= 768) {
      await expect(chatHeader).toBeVisible();
      const chatHeaderBox = await requiredBox(chatHeader, "chat header shell");
      expect(Math.abs(chatHeaderBox.y - headerBox.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(chatHeaderBox.y + chatHeaderBox.height - (headerBox.y + headerBox.height))).toBeLessThanOrEqual(1);
    }

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

    await page.route("**/rest/v1/messages**", async (route) => {
      const createdAtFilter = new URL(route.request().url()).searchParams.get("created_at");
      if (createdAtFilter?.startsWith("lt.")) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      await route.continue();
    });
    await scrollContainer.evaluate((node) => {
      node.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true }));
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
      !(message.includes("TypeError: Failed to fetch") && message.includes("@supabase_supabase-js") && message.includes("_refreshAccessToken")) &&
      // The same network noise from the sign-out path. It reaches the console
      // only when the auth host is already unreachable — the exact precondition
      // of the refresh failure exempted above — and it is produced by the test
      // helper escaping a stalled boot, not by anything under test. Kept as
      // narrow as its neighbour: a `Failed to fetch` from anywhere else in the
      // client still fails the run.
      !(message.includes("TypeError: Failed to fetch") && message.includes("@supabase_supabase-js") && message.includes("signOut")),
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
  // Wait for the list before counting it. `count()` is a snapshot, not a wait,
  // so calling it the instant after sign-in read zero rows and skipped — which
  // is why both scroll-anchoring contracts, listed as critical in the handoff,
  // had been reporting "skipped" on every run instead of protecting anything.
  // The skip is still real when the account genuinely has no such chat; it is
  // no longer a race.
  const readChats = page.locator('[data-testid="chat-list-item"][data-unread-count="0"][data-has-messages="true"]');
  await readChats
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => {});
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
  // Wait for the list before counting it. `count()` is a snapshot, not a wait,
  // so calling it the instant after sign-in read zero rows and skipped — which
  // is why both scroll-anchoring contracts, listed as critical in the handoff,
  // had been reporting "skipped" on every run instead of protecting anything.
  // The skip is still real when the account genuinely has no such chat; it is
  // no longer a race.
  const readChats = page.locator('[data-testid="chat-list-item"][data-unread-count="0"][data-has-messages="true"]');
  await readChats
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => {});
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
