import { expect, test, type Page } from "@playwright/test";

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });

const FIXTURE = {
  currentUser: { name: "Тестовый участник", username: "recorder_feedback_qa" },
  activeChat: { name: "Проверка интерфейса", memberCount: 2 },
  chats: [{ name: "Проверка интерфейса", preview: "Синтетическое сообщение", time: "09:00", unread: 0 }],
  messages: Array.from({ length: 36 }, (_, index) => ({
    sender: "Участник", text: `Синтетическая строка ${index + 1}`, time: "09:00", own: false,
  })),
};

async function openFixture(page: Page, theme: "dark" | "light") {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  const origin = new URL(process.env.KUB_BASE_URL ?? "http://127.0.0.1:5173").origin;
  expect(new URL(origin).hostname).toBe("127.0.0.1");
  await page.routeWebSocket("**/*", socket => {
    if (new URL(socket.url()).host === new URL(origin).host) socket.connectToServer();
    else socket.close();
  });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.origin === "http://127.0.0.1:54321") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return route.abort();
  });
  await page.addInitScript(({ fixture, theme }) => {
    const wire = window as unknown as Record<string, unknown>;
    wire.__letscubePublicPreviewFixture = fixture;
    localStorage.setItem("kub-theme", theme);
    let acquisitions = 0;
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
    }
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => { acquisitions++; throw new Error("Mode changes must not acquire media"); },
    });
    wire.__modeFeedbackQa = { acquisitions: () => acquisitions };
  }, { fixture: FIXTURE, theme });
  await page.goto("/__qa/public-preview", { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => typeof (window as unknown as Record<string, unknown>).__modeFeedbackQa)).toBe("object");
  await expect(page.locator('[data-public-preview-ready="true"]')).toBeVisible();
  await expect(page.getByTestId("composer-recorder-button")).toBeVisible();
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (id: string) => {
      const node = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (!node) throw new Error(`Missing measured element: ${id}`);
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    };
    const list = document.querySelector<HTMLElement>('[data-testid="message-scroll-container"]')!;
    return {
      dock: box("chat-composer-dock"), button: box("composer-recorder-button"),
      listPadding: getComputedStyle(list).paddingBottom,
    };
  });
}

for (const width of [1440, 390]) for (const theme of ["dark", "light"] as const) {
  test(`mode feedback keeps composer geometry ${width} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openFixture(page, theme);
    const before = await geometry(page);
    await page.getByTestId("composer-recorder-button").click({ button: "right" });
    await expect(page.getByTestId("composer-recorder-button")).toHaveAttribute("data-recorder-mode", "video");
    const feedback = page.getByTestId("recorder-mode-feedback");
    await expect(feedback).toBeVisible();
    await feedback.evaluate(async node => {
      await Promise.all(node.getAnimations().map(animation => animation.finished));
    });
    await page.screenshot({ path: info.outputPath("mode-feedback.png") });
    const after = await geometry(page);
    await info.attach("geometry", { body: JSON.stringify({ before, after }), contentType: "application/json" });
    expect(after.dock.height).toBeCloseTo(before.dock.height, 1);
    expect(after.button).toEqual(before.button);
    expect(after.listPadding).toBe(before.listPadding);
    await expect(feedback).toHaveText("Видеосообщение");
    await expect(feedback).toHaveAttribute("role", "status");
    expect(await page.evaluate(() =>
      (window as unknown as { __modeFeedbackQa: { acquisitions(): number } }).__modeFeedbackQa.acquisitions(),
    )).toBe(0);
    const bounds = await feedback.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(before.dock.top);
    await expect(feedback).toBeHidden({ timeout: 4000 });
    expect((await geometry(page)).dock.height).toBeCloseTo(before.dock.height, 1);
  });
}

test("fast switches replace feedback and do not discard a typed draft", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page, "dark");
  await page.clock.install();
  const button = page.getByTestId("composer-recorder-button");
  await button.click({ button: "right" });
  await page.clock.runFor(1200);
  await button.click({ button: "right" });
  const feedback = page.getByTestId("recorder-mode-feedback");
  await expect(feedback).toHaveText("Голосовое сообщение");
  await page.clock.runFor(1300);
  await expect(feedback).toBeVisible();
  await expect(page.getByTestId("composer-recording-state")).toHaveCount(0);
  const input = page.locator("textarea");
  await input.fill("Синтетический черновик");
  await page.clock.runFor(2000);
  await expect(feedback).toBeHidden();
  await expect(input).toHaveValue("Синтетический черновик");
});

test("feedback leaves the jump-to-latest control visible and tappable", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page, "dark");
  await page.getByTestId("message-scroll-container").hover();
  await expect.poll(async () => {
    if (browserName === "webkit") {
      // Playwright mobile WebKit has no wheel input. Release the real scroll
      // intent guard, then position synthetic history; this is not device QA.
      await page.getByTestId("message-scroll-container").evaluate(node => {
        node.dispatchEvent(new Event("touchstart", { bubbles: true }));
        node.scrollTop = 0;
      });
    } else await page.mouse.wheel(0, -900);
    return page.getByTestId("message-scroll-container").evaluate(node =>
      node.scrollHeight - node.clientHeight - node.scrollTop,
    );
  }).toBeGreaterThan(400);
  const jump = page.getByRole("button", { name: "К последним сообщениям", exact: true });
  await expect(jump).toBeVisible();
  await page.getByTestId("composer-recorder-button").click({ button: "right" });
  const feedback = page.getByTestId("recorder-mode-feedback");
  await expect(feedback).toBeVisible();
  await feedback.evaluate(async node => {
    await Promise.all(node.getAnimations().map(animation => animation.finished));
  });
  const a = (await feedback.boundingBox())!;
  const b = (await jump.boundingBox())!;
  const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  expect(overlap).toBe(0);
  await jump.click();
  await expect(jump).toBeHidden();
});

for (const scale of [1, 1.25, 1.5]) {
  test(`feedback fits narrow constrained viewport at ${scale * 100}% with reduced motion`, async ({ page }, info) => {
    await page.setViewportSize({ width: 360, height: 500 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openFixture(page, "light");
    await page.evaluate(scale => { document.documentElement.style.fontSize = `${16 * scale}px`; }, scale);
    const before = await geometry(page);
    await page.getByTestId("composer-recorder-button").click({ button: "right" });
    const feedback = page.getByTestId("recorder-mode-feedback");
    await expect(feedback).toBeVisible();
    await feedback.evaluate(async node => {
      await Promise.all(node.getAnimations().map(animation => animation.finished));
    });
    const layout = await feedback.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const icon = node.querySelector("svg")!.getBoundingClientRect();
      const label = node.querySelector("span")!.getBoundingClientRect();
      return { left: rect.left, right: rect.right, bottom: rect.bottom, client: node.clientWidth,
        scroll: node.scrollWidth, iconWidth: icon.width, centerGap: Math.abs(icon.y + icon.height / 2 - label.y - label.height / 2) };
    });
    await page.screenshot({ path: info.outputPath("narrow-feedback.png") });
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(360);
    expect(layout.scroll).toBeLessThanOrEqual(layout.client + 1);
    expect(layout.bottom).toBeLessThanOrEqual(before.dock.top);
    expect(layout.iconWidth).toBeGreaterThanOrEqual(14);
    expect(layout.centerGap).toBeLessThanOrEqual(1);
    expect((await geometry(page)).dock.height).toBeCloseTo(before.dock.height, 1);
  });
}

test.describe("touch recorder feedback", () => {
  test.use({ hasTouch: true });
  test("a real short touchscreen tap switches mode without acquiring media", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFixture(page, "dark");
    const button = page.getByTestId("composer-recorder-button");
    const before = await geometry(page);
    await button.tap();
    await expect(button).toHaveAttribute("data-recorder-mode", "video");
    await expect(page.getByTestId("recorder-mode-feedback")).toHaveText("Видеосообщение");
    await button.tap();
    await expect(button).toHaveAttribute("data-recorder-mode", "voice");
    await expect(page.getByTestId("recorder-mode-feedback")).toHaveText("Голосовое сообщение");
    expect(await page.evaluate(() =>
      (window as unknown as { __modeFeedbackQa: { acquisitions(): number } }).__modeFeedbackQa.acquisitions(),
    )).toBe(0);
    expect((await geometry(page)).dock).toEqual(before.dock);
  });
});
