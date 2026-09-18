import { expect, type TestInfo, test } from "@playwright/test";

import { requireFixtureServer } from "./helpers/messageActionsFixture";
import { openDisclosure, openSettingsScreen } from "./helpers/settingsColumnFixture";

/**
 * Slice E: the sentence the product owes an iPhone, and owes nobody else.
 *
 * The rule is `lib/callReachability.ts` and `tests/unit/call-reachability.test.mts`
 * holds it. What cannot be asserted there is that the sentence **reaches a
 * screen** — that the component is mounted, that its shell guard resolves the
 * way the unit test says it does, and that the other shells really get nothing.
 * A declaration is not a surface.
 *
 * **The shell is emulated by the two things the product actually reads.**
 * `detectDistributionTarget` classifies by `navigator.userAgent`, and the
 * installed-app case by `display-mode: standalone` or Safari's older
 * `navigator.standalone`. Chromium cannot emulate the display mode, so the
 * second is set directly — which is not a workaround: it is the API an iPhone
 * answers, and the one the component reads first on older iOS.
 *
 * Deliberately Chromium rather than the `webkit-ios-standalone` project. That
 * project exists for safe-area insets, which WebKit reports as 0 here; this
 * spec needs a user agent and a boolean, and both are exact under Chromium.
 */

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const notice = (page: import("@playwright/test").Page) => page.getByTestId("ios-calls-notice");

async function openApplicationSettings(
  page: import("@playwright/test").Page,
  theme: "dark" | "light" = "dark",
) {
  await openSettingsScreen(page, { theme });
  await openDisclosure(page, "application");
}

test.describe("on an iPhone", () => {
  test.use({ userAgent: IPHONE });

  test("the installed app is told what a call cannot do, and what still works", async ({
    page,
    request,
  }) => {
    await requireFixtureServer(request);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => true, configurable: true });
    });
    await openApplicationSettings(page);

    await expect(notice(page)).toBeVisible();
    const text = (await notice(page).textContent()) ?? "";
    // The three things the sentence has to carry: the condition, that it cannot
    // be changed, and the half that keeps it from being only bad news.
    expect(text).toContain("приложение LETSCUBE открыто");
    expect(text).toContain("обойти это нельзя");
    expect(text).toContain("Пропущенный звонок всё равно появится в переписке");
    // iPad is inside this shell too, so the heading may not name only the phone.
    expect(text).toContain("iPad");

    // And there is nothing to press. A control here would be one that cannot
    // change its outcome, which is the defect this register spends most of its
    // pages on.
    expect(await notice(page).locator("button, input, a").count()).toBe(0);
  });

  test("a Safari tab is told the same thing about the tab", async ({ page, request }) => {
    await requireFixtureServer(request);
    await openApplicationSettings(page);

    await expect(notice(page)).toBeVisible();
    const text = (await notice(page).textContent()) ?? "";
    expect(text).toContain("эта вкладка открыта");
    expect(text).not.toContain("приложение LETSCUBE открыто");
  });

  test("photographed", async ({ page, request }, info: TestInfo) => {
    await requireFixtureServer(request);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => true, configurable: true });
    });
    for (const theme of ["dark", "light"] as const) {
      await openApplicationSettings(page, theme);
      await expect(notice(page)).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await notice(page).scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await notice(page).screenshot({
        path: `output/ios-calls/notice-${theme}-${info.project.name}.png`,
      });
    }
    info.annotations.push({
      type: "capture",
      description: `output/ios-calls/notice-{dark,light}-${info.project.name}.png`,
    });
  });
});

test("every other shell is told nothing at all", async ({ page, request }) => {
  // The default user agent here is a desktop or Android Chromium, depending on
  // the project — neither is `ios_pwa`, and neither may be given a sentence
  // about Safari. This is the half that would go green on a component mounted
  // without its guard, which is why it is a test rather than a comment.
  await requireFixtureServer(request);
  await openApplicationSettings(page);
  await expect(page.getByTestId("release-distribution-card")).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
});
