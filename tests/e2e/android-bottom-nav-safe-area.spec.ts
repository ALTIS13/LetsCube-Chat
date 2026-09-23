import { expect, test } from "@playwright/test";
import {
  chat,
  membership,
  message,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

const ME = person("11111111-1111-4111-8111-000000000001", "Тестовый пользователь", "qa-user");
const OTHER = person("11111111-1111-4111-8111-000000000002", "Собеседник", "qa-peer");
const AT = "2026-09-17T09:00:00.000Z";
const ROWS = Array.from({ length: 18 }, (_, index) => {
  const suffix = String(index + 1).padStart(12, "0");
  const chatId = `22222222-2222-4222-8222-${suffix}`;
  return {
    chat: chat(chatId, "private", null, AT),
    members: [membership(chatId, ME, "owner", AT), membership(chatId, OTHER, "member", AT)],
    message: message(
      `55555555-5555-4555-8555-${suffix}`,
      chatId,
      OTHER,
      `Проверка ${index + 1}`,
      AT,
    ),
  };
});

async function boot(
  page: import("@playwright/test").Page,
  nativeAndroid: boolean,
  theme: "dark" | "light" = "dark",
) {
  await page.addInitScript((native) => {
    if (native) {
      (window as unknown as Record<string, unknown>).androidBridge = {
        postMessage: () => undefined,
      };
    }
  }, nativeAndroid);
  await openFixture(page, {
    me: ME,
    people: [OTHER],
    chats: ROWS.map((row) => row.chat),
    memberships: ROWS.flatMap((row) => row.members),
    messages: ROWS.map((row) => row.message),
    rpc: (name, body) =>
      name === "has_permission" ? { body: body.p_permission_key === "tasks.view" } : undefined,
  });
  await page.addInitScript((value) => localStorage.setItem("kub-theme", value), theme);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("navigation", { name: "Навигация" })).toBeVisible();
  await expect(page.getByTestId("chat-list-item")).toHaveCount(ROWS.length);
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--kub-safe-bottom", "24px"),
  );
}

test.describe("Android floating navigation and system gesture area", () => {
  test.skip(({ isMobile }) => !isMobile, "The bottom navigation is mobile-only");

  for (const theme of ["dark", "light"] as const) {
    test(`native Android keeps its capsule and last row clear (${theme})`, async ({
      page,
      request,
    }, info) => {
      await requireFixtureServer(request);
      await boot(page, true, theme);
      expect(
        await page.evaluate(() =>
          (window as unknown as { Capacitor?: { getPlatform(): string } }).Capacitor?.getPlatform(),
        ),
      ).toBe("android");
      const nav = page.getByRole("navigation", { name: "Навигация" });
      await expect(nav).toHaveClass(/kub-glass-strong/);
      await expect(nav.getByRole("button", { name: "Задачи" })).toBeVisible();
      const box = await nav.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeCloseTo(56, 0);
      expect(page.viewportSize()!.height - box!.y - box!.height).toBeGreaterThanOrEqual(32);
      await page.screenshot({ path: info.outputPath(`android-list-${theme}.png`) });

      const scroller = page.getByTestId("chat-list-scroller");
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const lastRow = await page.getByTestId("chat-list-item").last().boundingBox();
      expect(lastRow).not.toBeNull();
      expect(lastRow!.y + lastRow!.height).toBeLessThanOrEqual(box!.y - 8);
      await page.screenshot({ path: info.outputPath(`android-list-end-${theme}.png`) });
    });
  }

  test("web keeps its existing safe-area padding", async ({ page, request }) => {
    await requireFixtureServer(request);
    await boot(page, false);
    const nav = page.getByRole("navigation", { name: "Навигация" });
    await expect(nav).toHaveClass(/\bkub-glass\b/);
    await expect(nav).not.toHaveClass(/kub-glass-strong/);
    const box = await nav.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeCloseTo(80, 0);
    expect(page.viewportSize()!.height - box!.y - box!.height).toBeCloseTo(8, 0);
  });
});
