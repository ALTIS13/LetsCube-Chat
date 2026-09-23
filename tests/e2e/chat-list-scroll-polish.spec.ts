import { expect, type Page, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";
import {
  installRenderCounter,
  readRenderCounts,
  resetRenderCounts,
} from "./helpers/render-counter";

const ME = person("11111111-1111-4111-8111-111111111120", "Fixture User");
const AT = "2026-09-01T09:00:00.000Z";
const COUNT = 60;
const chats = Array.from({ length: COUNT }, (_, index) => {
  const id = `66666666-6666-4666-8666-${String(index + 1).padStart(12, "0")}`;
  return chat(id, "group", `Fixture chat ${index + 1}`, AT);
});

async function loadChatListFixture(page: Page) {
  await openFixture(page, {
    me: ME,
    chats,
    memberships: chats.map((item) => membership(String(item.id), ME, "member", AT)),
    messages: chats
      .slice(0, 6)
      .map((item, index) =>
        message(`fixture-message-${index}`, String(item.id), ME, `Fixture preview ${index}`, AT),
      ),
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/LETSCUBE/);
  await expect(page.getByTestId("chat-list-item")).toHaveCount(COUNT);
}

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((selectedTheme) => {
    const root = document.documentElement;
    root.classList.toggle("dark", selectedTheme === "dark");
    root.classList.toggle("light", selectedTheme === "light");
    root.dataset.theme = selectedTheme;
    root.style.colorScheme = selectedTheme;
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

for (const theme of ["dark", "light"] as const) {
  test(`Android-sized chat rows stay stable during touch scroll in ${theme}`, async ({
    page,
    request,
  }, info) => {
    test.skip(info.project.name !== "chromium-mobile-390", "390px touch fixture");
    await requireFixtureServer(request);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await installRenderCounter(page, ["Sidebar", "ChatList", "ChatListItem"], {
      ChatListItem: ["chat", "id"],
    });
    await loadChatListFixture(page);
    await setTheme(page, theme);
    const rows = page.getByTestId("chat-list-item");
    await expect(rows).toHaveCount(COUNT);
    const scroller = page.getByTestId("chat-list-scroller");
    await expect(scroller).toBeVisible();
    const box = await scroller.boundingBox();
    expect(box).not.toBeNull();
    await page.screenshot({ path: info.outputPath(`chat-list-before-${theme}.png`) });
    const before = await scroller.evaluate((node) => ({
      top: node.scrollTop,
      height: node.clientHeight,
      scrollHeight: node.scrollHeight,
      rowHeight: node.querySelector("button")?.getBoundingClientRect().height,
      rowFilter: getComputedStyle(node.querySelector("button")!).backdropFilter,
    }));
    expect(before.scrollHeight).toBeGreaterThan(before.height + 100);
    expect(before.rowHeight).toBeGreaterThanOrEqual(44);
    expect(before.rowFilter).toBe("none");
    const cdp = await page.context().newCDPSession(page);
    await resetRenderCounts(page);
    const x = Math.round(box!.x + box!.width / 2);
    const startY = Math.round(box!.y + box!.height - 90);
    const samples: Array<{
      step: number;
      top: number;
      scrollerY: number;
      chromeHeight: number;
      hovered: string[];
      animations: number;
    }> = [];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: startY }],
    });
    for (let step = 1; step <= 12; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: startY - step * 42 }],
      });
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))),
      );
      samples.push(
        await page.evaluate((step) => {
          const scroller = document.querySelector('[data-testid="chat-list-scroller"]')!;
          const chrome = document.querySelector("[data-kub-list-chrome]")!;
          const hovered = Array.from(
            scroller.querySelectorAll<HTMLElement>("[data-testid='chat-list-item']:hover"),
          );
          return {
            step,
            top: scroller.scrollTop,
            scrollerY: scroller.getBoundingClientRect().top,
            chromeHeight: chrome.getBoundingClientRect().height,
            hovered: hovered.map((row) => row.dataset.chatId ?? ""),
            animations: scroller.getAnimations({ subtree: true }).length,
          };
        }, step),
      );
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(100);
    const after = await scroller.evaluate((node) => ({
      top: node.scrollTop,
      rowHeight: node.querySelector("button")?.getBoundingClientRect().height,
    }));
    const renders = await readRenderCounts(page);
    const chromeShift =
      Math.max(...samples.map((sample) => sample.scrollerY)) -
      Math.min(...samples.map((sample) => sample.scrollerY));
    const chromeHeightShift =
      Math.max(...samples.map((sample) => sample.chromeHeight)) -
      Math.min(...samples.map((sample) => sample.chromeHeight));
    const anchor = samples[1];
    const anchorDrift = Math.max(
      ...samples
        .slice(2)
        .map((sample) =>
          Math.abs(
            sample.scrollerY -
              sample.top -
              (anchor.scrollerY - anchor.top) +
              (sample.step - anchor.step) * 42,
          ),
        ),
    );
    console.log(
      "[chat-list-scroll]",
      JSON.stringify({
        theme,
        scrollDelta: after.top - before.top,
        chromeShift,
        chromeHeightShift,
        anchorDrift,
        rowRenders: renders.counts.ChatListItem,
        activeRowAnimations: Math.max(...samples.map((sample) => sample.animations)),
      }),
    );
    expect(after.rowHeight).toBe(before.rowHeight);
    expect(anchorDrift).toBeLessThanOrEqual(2);
    expect(renders.counts.ChatListItem).toBe(0);
    expect(samples.every((sample) => sample.animations === 0 && sample.hovered.length === 0)).toBe(
      true,
    );
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: info.outputPath(`chat-list-after-${theme}.png`) });

    await expect(page.getByRole("button", { name: "Поиск", exact: true })).toBeVisible();
    await scroller.evaluate((node) => {
      node.scrollTop = 150;
    });
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(150);
    const upwardSamples: Array<{
      step: number;
      top: number;
      scrollerY: number;
      chromeHeight: number;
    }> = [];
    const upwardStartY = Math.round(box!.y + 170);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: upwardStartY }],
    });
    for (let step = 1; step <= 6; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: upwardStartY + step * 36 }],
      });
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))),
      );
      upwardSamples.push(
        await page.evaluate((step) => {
          const scroller = document.querySelector<HTMLElement>(
            '[data-testid="chat-list-scroller"]',
          )!;
          const chrome = document.querySelector<HTMLElement>("[data-kub-list-chrome]")!;
          return {
            step,
            top: scroller.scrollTop,
            scrollerY: scroller.getBoundingClientRect().top,
            chromeHeight: chrome.getBoundingClientRect().height,
          };
        }, step),
      );
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const firstNearTop = upwardSamples.findIndex((sample) => sample.top <= 8);
    expect(firstNearTop).toBeGreaterThanOrEqual(3);
    expect(upwardSamples[0].top).toBeGreaterThan(100);
    const upwardAnchor = upwardSamples[1];
    const upwardDrift = Math.max(
      ...upwardSamples
        .slice(2, firstNearTop)
        .map((sample) =>
          Math.abs(
            sample.scrollerY -
              sample.top -
              (upwardAnchor.scrollerY - upwardAnchor.top) -
              (sample.step - upwardAnchor.step) * 36,
          ),
        ),
    );
    expect(upwardDrift).toBeLessThanOrEqual(2);
    await expect
      .poll(() =>
        page
          .locator("[data-kub-list-chrome]")
          .evaluate((node) => node.getBoundingClientRect().height),
      )
      .toBe(146);
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(0);
    await expect(page.getByRole("button", { name: "Поиск", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("sidebar-search-input")).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByTestId("sidebar-search-input")
          .evaluate((node) => getComputedStyle(node.parentElement!.parentElement!).opacity),
      )
      .toBe("1");
    console.log(
      "[chat-list-upward]",
      JSON.stringify({
        theme,
        firstNearTop,
        upwardDrift,
        finalTop: await scroller.evaluate((node) => node.scrollTop),
      }),
    );
    await page.screenshot({ path: info.outputPath(`chat-list-return-${theme}.png`) });
  });
}

for (const theme of ["dark", "light"] as const) {
  test(`1440px chat list keeps its search and position in ${theme}`, async ({
    page,
    request,
  }, info) => {
    test.skip(info.project.name !== "chromium-desktop-1440", "1440px desktop fixture");
    await requireFixtureServer(request);
    await loadChatListFixture(page);
    await setTheme(page, theme);
    const scroller = page.getByTestId("chat-list-scroller");
    const beforeY = await scroller.evaluate((node) => node.getBoundingClientRect().top);
    await expect(page.getByTestId("sidebar-search-input")).toBeVisible();
    await page.screenshot({ path: info.outputPath(`chat-list-desktop-before-${theme}.png`) });
    const box = await scroller.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 360);
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(100);
    const afterY = await scroller.evaluate((node) => node.getBoundingClientRect().top);
    expect(Math.abs(afterY - beforeY)).toBeLessThanOrEqual(2);
    await expect(page.getByTestId("sidebar-search-input")).toBeVisible();
    await page.screenshot({ path: info.outputPath(`chat-list-desktop-after-${theme}.png`) });
  });
}
