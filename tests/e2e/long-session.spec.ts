import { expect, type Page, test } from "@playwright/test";
import { findFirstAvailableQaRole, gotoOrSkip, loginAsRoleOrSkip } from "./helpers/auth";

type KubDevInstrumentationSnapshot = {
  activeRealtimeChannels?: Record<string, number>;
  duplicateRealtimeChannels?: Record<string, number>;
  cumulativeFetches?: Record<string, number>;
  heartbeat?: {
    activeRunners: number;
    cumulativePings: number;
  };
};

test.describe("KUB long-session reliability", () => {
  test("keeps state stable across idle, tab return and reconnect", async ({ context, page }) => {
    test.setTimeout(210_000);

    const role = findFirstAvailableQaRole(
      ["owner", "tech_admin", "location_admin", "location_staff", "client"],
      { includeDefault: true },
    );
    test.skip(!role, "QA credentials or auth state are not configured");

    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    let offlinePhase = false;
    let setupComplete = false;
    let requestCount = 0;
    let mainFrameNavigations = 0;

    page.on("console", (message) => {
      if (setupComplete && message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      if (setupComplete) consoleErrors.push(error.message);
    });
    page.on("request", () => {
      if (setupComplete) requestCount += 1;
    });
    page.on("requestfailed", (request) => {
      if (!setupComplete || offlinePhase) return;
      failedRequests.push(
        `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`.trim(),
      );
    });
    page.on("framenavigated", (frame) => {
      if (setupComplete && frame === page.mainFrame()) mainFrameNavigations += 1;
    });

    await gotoOrSkip(page, "/");
    await loginAsRoleOrSkip(page, role);
    await expect(page.locator("body")).toBeVisible();
    await page.locator("button.w-full").first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);

    const composer = page.locator("textarea").first();
    const chatRows = page.locator("button.w-full");
    const chatCount = Math.min(await chatRows.count(), 8);
    for (let index = 0; index < chatCount; index += 1) {
      if (await composer.isVisible().catch(() => false)) break;
      await chatRows.nth(index).click();
      await page.waitForTimeout(700);
    }
    test.skip(
      !(await composer.isVisible().catch(() => false)),
      "No chat composer is available for long-session QA",
    );

    const marker = `LONG_SESSION_${Date.now()}`;
    await composer.fill(marker);
    await page.evaluate((value) => {
      window.localStorage.setItem("__kubLongSessionMarker", value);
      (window as typeof window & { __kubLongSessionMarker?: string }).__kubLongSessionMarker =
        value;
    }, marker);

    const initialSnapshot = await readInstrumentation(page);
    expect(
      initialSnapshot,
      "Dev instrumentation snapshot should be exposed for long-session QA",
    ).toBeTruthy();

    setupComplete = true;

    await page.waitForTimeout(125_000);

    const helperPage = await context.newPage();
    await helperPage.goto("about:blank");
    await helperPage.bringToFront();
    await page.waitForTimeout(1_000);
    await page.bringToFront();
    await helperPage.close();
    await page.waitForTimeout(5_000);

    offlinePhase = true;
    await context.setOffline(true);
    await page.waitForTimeout(2_000);
    await context.setOffline(false);
    offlinePhase = false;
    await page.waitForTimeout(5_000);

    await expect(composer).toHaveValue(marker);
    await expect(page.getByText("Произошла ошибка интерфейса")).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    const markerAfterReturn = await page.evaluate(() => {
      return (
        (window as typeof window & { __kubLongSessionMarker?: string }).__kubLongSessionMarker ??
        null
      );
    });
    expect(markerAfterReturn).toBe(marker);

    const finalSnapshot = await readInstrumentation(page);
    expect(
      finalSnapshot,
      "Dev instrumentation snapshot should survive tab return/reconnect",
    ).toBeTruthy();

    const duplicateChannels = Object.entries(finalSnapshot?.duplicateRealtimeChannels ?? {});
    expect(
      duplicateChannels,
      `Duplicate realtime channels:\n${JSON.stringify(duplicateChannels, null, 2)}`,
    ).toEqual([]);

    expect(mainFrameNavigations, "Main frame should not reload after setup").toBe(0);
    expect(requestCount, "Long-session request volume should stay bounded").toBeLessThan(300);
    expect(failedRequests, `Unexpected failed requests:\n${failedRequests.join("\n")}`).toEqual([]);
    expect(consoleErrors, `Unexpected console/page errors:\n${consoleErrors.join("\n")}`).toEqual(
      [],
    );
  });
});

async function readInstrumentation(page: Page) {
  return page.evaluate(() => {
    return (
      (window as typeof window & { __kubDevInstrumentation?: KubDevInstrumentationSnapshot })
        .__kubDevInstrumentation ?? null
    );
  });
}
