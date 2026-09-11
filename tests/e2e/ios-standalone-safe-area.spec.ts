import { expect, test, type Page, type Route } from "@playwright/test";
import sharp from "sharp";

import {
  IPHONE_14_PRO,
  emulateInstalledIosApp,
  emulateSafeAreaWithCdp,
  expectClearOfHardware,
  findSafeAreaViolations,
  formatViolations,
  resolvedSafeAreaTokens,
  type Insets,
  type Orientation,
} from "./helpers/ios-standalone";

/**
 * The installed iPhone app, laid out around its hardware.
 *
 * `index.html` asks for `viewport-fit=cover`, so on an iPhone the page is drawn
 * from edge to edge — under the status bar, the Dynamic Island and the home
 * indicator — and every surface pinned to an edge has to read how much of that
 * edge the hardware takes. Without `cover` iOS decides on its own where the page
 * goes, that decision is not documented for an installed app, and the owner's
 * two screenshots of it did not agree with each other. With `cover` it is
 * documented, and this file is what holds the product to its half.
 *
 * Two engines, because each can prove something the other cannot:
 *
 *  - **WebKit** (`webkit-ios-standalone`) is Safari's layout engine at the
 *    iPhone's size, and the only place a WebKit-specific paint or layout rule
 *    shows up. It cannot report the insets, so they are injected through the
 *    four tokens the application reads — see the helper for why that is the
 *    one channel that can be overridden.
 *  - **Chromium** (`chromium-mobile-390`) can override the insets at the source,
 *    so `env()` itself reports them. It proves the tokens really are `env()`
 *    and not a constant that only the WebKit override ever filled in, and that
 *    on a device with no insets nothing moves at all.
 *
 * The assertion is the same everywhere: no control and no text a person can
 * see is inside an unsafe area. Backgrounds may go there — that is the point of
 * `cover` — and the conversation behind the glass header may too, because the
 * header covers it.
 */

const STAND_PROJECT = "webkit-ios-standalone";
const CDP_PROJECT = "chromium-mobile-390";

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";
const CATALOG = "https://api.letscube.ru/releases/v1/**";

/** Several screens of history, and enough chats to reach the bottom of a phone
 *  held sideways, so both ends of both lists have something to put there. */
const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [
    { name: "Команда проекта", preview: "Строка 48", time: "09:09", unread: 0 },
    ...Array.from({ length: 11 }, (_, index) => ({
      name: `Синтетический чат ${index + 2}`,
      preview: "Текст последнего сообщения для проверки строки списка",
      time: "08:4" + (index % 10),
      unread: index % 3,
    })),
  ],
  messages: Array.from({ length: 48 }, (_, index) => ({
    sender: index % 3 === 0 ? "Максим" : "Аня",
    text:
      `Строка ${String(index + 1).padStart(2, "0")} — синтетический текст, ` +
      "достаточно длинный, чтобы занять несколько строк пузыря.",
    time: "09:0" + (index % 10),
    own: index % 3 === 0,
  })),
};

async function openFixtureChat(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));
  await page.addInitScript(
    ([key, fixture]) => {
      (window as unknown as Record<string, unknown>)[key as string] = fixture;
    },
    [WINDOW_KEY, FIXTURE] as const,
  );
  const response = await page.goto(CAPTURE_PATH, { waitUntil: "domcontentloaded" }).catch(() => null);
  const ready = response
    ? await page
        .locator(`[${READY}="true"]`)
        .waitFor({ state: "attached", timeout: 15_000 })
        .then(() => true)
        .catch(() => false)
    : false;
  // A missing prerequisite fails loudly and says which one, as the sibling
  // fixture specs do. A check that skips itself is a check nobody ran.
  if (!ready) {
    throw new Error(
      "The DEV preview capture route did not report ready. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1.",
    );
  }
  await expect(page.getByTestId("chat-control-row")).toBeVisible();
  await page.waitForTimeout(1_200);
}

async function installCatalog(page: Page) {
  await page.route(CATALOG, async (route: Route) => {
    const platform = new URL(route.request().url()).pathname.split("/")[3] ?? "windows";
    const published = platform === "windows" || platform === "android";
    const version = platform === "android" ? "0.1.3" : "0.2.10";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: 1,
        platform,
        channel: "stable",
        available: published,
        version,
        build: 14,
        publishedAt: "2026-08-31T09:00:00.000Z",
        minimumSupportedVersion: null,
        mandatory: false,
        notes: "Плановое обновление.",
        highlights: ["Быстрее открывается чат", "Уведомления группируются по чату"],
        artifact: published
          ? {
              url: `https://api.letscube.ru/releases/files/${platform}/${version}/build.bin`,
              size: 2_322_508,
              sha256: "697f345bd544281e27b7ab6f4293abebd6c024c10bf60ca6a6e513c5df2e7bfd",
            }
          : null,
      }),
    });
  });
}

/** The auth forms render a captcha; a stand-in keeps the network out of it. */
async function installAuthStandIns(page: Page) {
  await page.addInitScript(() => {
    let issued = 0;
    const render = (_container: HTMLElement, options: { callback?: (token: string) => void }) => {
      issued += 1;
      const token = `ios-stand-captcha-${issued}`;
      window.setTimeout(() => options.callback?.(token), 0);
      return `ios-stand-widget-${issued}`;
    };
    const widget = { render, reset() {}, remove() {}, destroy() {} };
    Object.defineProperty(window, "turnstile", { configurable: true, value: widget });
    Object.defineProperty(window, "smartCaptcha", { configurable: true, value: widget });
  });
  await page.route("**/rest/v1/rpc/registration_invite_mode", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ invite_only_enabled: false }]),
    }),
  );
}

async function scrollToEnd(page: Page, selector: string, end: "start" | "end") {
  await page.evaluate(
    ({ selector, end }) => {
      const scroller = document.querySelector<HTMLElement>(selector);
      if (!scroller) throw new Error(`no scroller at ${selector}`);
      scroller.scrollTop = end === "start" ? 0 : scroller.scrollHeight;
    },
    { selector, end },
  );
  await page.waitForTimeout(400);
}

test.describe("installed iPhone app — WebKit, insets through the tokens", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== STAND_PROJECT, `the installed-app layout is checked on ${STAND_PROJECT}`);
  });

  test("the check itself can fail, and does not report what is covered", async ({ page }) => {
    const { viewport, insets } = IPHONE_14_PRO.portrait;
    await page.setViewportSize(viewport);
    await emulateInstalledIosApp(page, insets);
    await page.goto("/privacy", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const planted = await page.evaluate(() => {
      const exposed = document.createElement("button");
      exposed.textContent = "Под островом";
      exposed.style.cssText = "position:fixed;top:4px;left:120px;width:150px;height:40px;z-index:2147483646";
      const hidden = document.createElement("span");
      hidden.textContent = "Закрытый текст";
      hidden.style.cssText = "position:fixed;top:8px;left:8px;z-index:2147483640";
      const cover = document.createElement("div");
      cover.style.cssText = "position:fixed;top:0;left:0;width:110px;height:59px;z-index:2147483645;background:#000";
      document.body.append(exposed, hidden, cover);
      return true;
    });
    expect(planted).toBe(true);

    const violations = await findSafeAreaViolations(page, insets, { revealText: true });
    expect(
      violations.some((violation) => violation.zone === "top" && violation.what.includes("Под островом")),
      `a button planted under the Dynamic Island was not reported:\n${formatViolations(violations)}`,
    ).toBe(true);
    expect(
      violations.some((violation) => violation.what.includes("Закрытый текст")),
      "text covered by an opaque sheet was reported as visible",
    ).toBe(false);

    // The scroll allowance, from both ends. A strip of content at the bottom
    // of the screen that scrolls: at rest its text runs under the home
    // indicator and can still be carried away, so it is not reported; at the
    // end its last button stays on the indicator for good, because the strip
    // has no end padding, and it is.
    await page.evaluate(() => {
      const strip = document.createElement("div");
      strip.id = "planted-strip";
      strip.style.cssText =
        "position:fixed;left:0;right:0;bottom:0;height:200px;overflow-y:auto;z-index:2147483646;background:#123";
      strip.innerHTML =
        '<div style="position:relative;height:600px">' +
        '<p style="position:absolute;top:176px;left:16px;margin:0;color:#fff">Уходит при прокрутке</p>' +
        '<button style="position:absolute;bottom:0;left:16px;height:24px">Остаётся на полоске</button>' +
        "</div>";
      document.body.append(strip);
    });
    const atRest = await findSafeAreaViolations(page, insets, { revealText: true });
    expect(
      atRest.some((violation) => violation.what.includes("Уходит при прокрутке")),
      `text that its own scroll container can still carry away was reported at rest:\n${formatViolations(atRest)}`,
    ).toBe(false);

    await page.evaluate(() => {
      const strip = document.getElementById("planted-strip");
      if (strip) strip.scrollTop = strip.scrollHeight;
    });
    const atEnd = await findSafeAreaViolations(page, insets, { revealText: true });
    expect(
      atEnd.some((violation) => violation.zone === "bottom" && violation.what.includes("Остаётся на полоске")),
      `a button that cannot be scrolled off the home indicator was not reported:\n${formatViolations(atEnd)}`,
    ).toBe(true);
  });

  for (const orientation of ["portrait", "landscape"] as Orientation[]) {
    const { viewport, insets } = IPHONE_14_PRO[orientation];

    test.describe(orientation, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(viewport);
        await emulateInstalledIosApp(page, insets);
      });

      test("the conversation, at the newest message and at the oldest", async ({ page }) => {
        await openFixtureChat(page);
        expect(await page.locator("[data-message-id]").count(), "the fixture rendered no history").toBeGreaterThan(10);
        await expectClearOfHardware(page, insets, `${orientation}, newest message`);

        await scrollToEnd(page, '[data-testid="message-scroll-container"]', "start");
        await expectClearOfHardware(page, insets, `${orientation}, oldest message`);
      });

      test("the chat header's menu", async ({ page }) => {
        await openFixtureChat(page);
        await page.getByRole("button", { name: "Ещё" }).click();
        await expect(page.getByRole("menu")).toBeVisible();
        await expectClearOfHardware(page, insets, `${orientation}, chat header menu`);
      });

      test("the update banner, which is the only way onto a new build", async ({ page }) => {
        await openFixtureChat(page);
        await page.evaluate(() => window.dispatchEvent(new CustomEvent("kub:sw-update-ready", { detail: {} })));
        await expect(page.getByRole("button", { name: "Обновить" })).toBeVisible();
        await expectClearOfHardware(page, insets, `${orientation}, update banner`);
      });

      test("a transient confirmation", async ({ page }) => {
        await openFixtureChat(page);
        // A string, not a function: the store has to be the application's own
        // module instance, and only the browser can resolve that URL to it.
        await page.evaluate(
          "import('/src/lib/actionFeedback.ts').then((m) => m.showActionFeedback({ kind: 'error', title: 'Не удалось отправить', detail: 'Проверьте соединение и попробуйте ещё раз.' }))",
        );
        await expect(page.getByTestId("kub-feedback-viewport")).toBeVisible();
        await expectClearOfHardware(page, insets, `${orientation}, feedback toast`);
      });

      test("the connection banner", async ({ page }) => {
        await openFixtureChat(page);
        await page.evaluate(() => window.dispatchEvent(new Event("offline")));
        await expect(page.getByTestId("connection-status-banner")).toBeVisible();
        await expectClearOfHardware(page, insets, `${orientation}, offline banner`);
      });

      test("a message's action menu", async ({ page }) => {
        // The menu is placed in script from the pointer, so it cannot inherit
        // the tokens through layout. It used to sit at `bottom: 12` on a phone,
        // which put its last actions on the home indicator, and to clamp at 8px
        // held sideways, which put a menu opened near the right edge under the
        // notch. It now reads the unsafe areas when it opens.
        await openFixtureChat(page);
        const own = page.locator("[data-message-id]").last();
        const box = await own.boundingBox();
        if (!box) throw new Error("the newest message has no box");
        await own.click({ button: "right", position: { x: box.width - 12, y: box.height / 2 } });
        await expect(page.locator('[data-action-menu="true"]')).toBeVisible();
        await expectClearOfHardware(page, insets, `${orientation}, message action menu`);
      });

      test("the public home, at the top and at the very end", async ({ page }) => {
        await installCatalog(page);
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.waitForTimeout(600);
        await expectClearOfHardware(page, insets, `${orientation}, public home top`);

        await scrollToEnd(page, '[data-testid="public-scroll-root"]', "end");
        await expect(page.getByRole("link", { name: "support@app.letscube.ru" })).toBeInViewport();
        await expectClearOfHardware(page, insets, `${orientation}, public home end`);
      });

      for (const route of ["/login", "/register"]) {
        test(`the ${route} form, at the top and at the very end`, async ({ page }) => {
          await installAuthStandIns(page);
          await page.goto(route, { waitUntil: "domcontentloaded" });
          await expect(page.locator('input[type="email"]')).toBeVisible();
          await page.waitForTimeout(600);
          await expectClearOfHardware(page, insets, `${orientation}, ${route} top`);

          await scrollToEnd(page, ".kub-auth-shell", "end");
          await expectClearOfHardware(page, insets, `${orientation}, ${route} end`);
        });
      }

      if (orientation === "portrait") {
        test("the status bar stays readable over the light theme", async ({ page }) => {
          // `black-translucent` draws the status bar over the page, in a colour
          // iOS chooses. The glyphs are iOS's and cannot be drawn here, so what
          // is measured is the band they sit in, photographed: white against its
          // lightest pixel and black against its darkest. The conversation is
          // left at rest, with the header's glass over light message bubbles
          // under the band.
          await page.addInitScript(() => {
            try {
              localStorage.setItem("kub-theme", "light");
            } catch {
              /* the theme then follows the light colour scheme the context has */
            }
          });
          await openFixtureChat(page);
          expect(await page.evaluate(() => document.documentElement.classList.contains("light"))).toBe(true);
          expect(
            await page.evaluate(() => document.documentElement.hasAttribute("data-ios-standalone")),
            "the installed app was not recognised, so the veil could not apply at all",
          ).toBe(true);

          const band = await page.screenshot({ clip: { x: 0, y: 0, width: viewport.width, height: insets.top } });
          const { data, info } = await sharp(band).raw().toBuffer({ resolveWithObject: true });
          const channel = (value: number) => {
            const c = value / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          let lightest = 0;
          let darkest = 1;
          for (let index = 0; index < data.length; index += info.channels) {
            const value =
              0.2126 * channel(data[index]) + 0.7152 * channel(data[index + 1]) + 0.0722 * channel(data[index + 2]);
            if (value > lightest) lightest = value;
            if (value < darkest) darkest = value;
          }
          const white = 1.05 / (lightest + 0.05);
          const dark = (darkest + 0.05) / 0.05;
          expect(
            white,
            `white status-bar glyphs would measure ${white.toFixed(2)}:1 against the lightest pixel under them`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            dark,
            `dark status-bar glyphs would measure ${dark.toFixed(2)}:1 against the darkest pixel under them`,
          ).toBeGreaterThanOrEqual(4.5);
        });

        test("the dark theme's status bar band is left as it is", async ({ page }) => {
          await page.addInitScript(() => {
            try {
              localStorage.setItem("kub-theme", "dark");
            } catch {
              /* without storage this test cannot choose the theme */
            }
          });
          await openFixtureChat(page);
          expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
          expect(await page.evaluate(() => getComputedStyle(document.body, "::before").content)).toBe("none");
        });
      }

      if (orientation === "landscape") {
        test("the sidebar's own menu and the notification panel", async ({ page }) => {
          await openFixtureChat(page);
          await expect(page.getByTestId("sidebar-control-row")).toBeVisible();

          await page.getByRole("button", { name: "Меню" }).click();
          await expect(page.getByRole("menu")).toBeVisible();
          await expectClearOfHardware(page, insets, "landscape, sidebar menu");
          await page.keyboard.press("Escape");

          await page.getByTestId("notification-bell-button").click();
          await expect(page.getByTestId("notification-panel")).toBeVisible();
          await page.waitForTimeout(400);
          await expectClearOfHardware(page, insets, "landscape, notification panel");
        });
      }
    });
  }
});

test.describe("installed iPhone app — Chromium, insets from env() itself", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== CDP_PROJECT, `the env() wiring is checked on ${CDP_PROJECT}`);
  });

  test("the tokens are env(), and the conversation clears a notch in portrait", async ({ page }) => {
    const insets = { top: 59, right: 0, bottom: 34, left: 0 };
    await emulateSafeAreaWithCdp(page, insets);
    await openFixtureChat(page);
    await expectClearOfHardware(page, insets, "chromium portrait");

    // And the chrome moved because of the inset, not by accident: the header's
    // row starts exactly where the status bar ends.
    const row = await page.getByTestId("chat-control-row").boundingBox();
    expect(row?.y).toBeCloseTo(insets.top, 0);
  });

  test("the tokens are env() on the long edges too", async ({ page }) => {
    const insets = { top: 0, right: 47, bottom: 21, left: 47 };
    await page.setViewportSize({ width: 844, height: 390 });
    await emulateSafeAreaWithCdp(page, insets);
    await openFixtureChat(page);
    await expectClearOfHardware(page, insets, "chromium landscape");
  });

  test("a device without insets keeps exactly the layout it had", async ({ page }) => {
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    await emulateSafeAreaWithCdp(page, none);
    await openFixtureChat(page);
    expect(await resolvedSafeAreaTokens(page)).toEqual(none);

    const geometry = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>('[data-testid="chat-control-row"]');
      const dock = document.querySelector<HTMLElement>('[data-testid="chat-composer-dock"]');
      if (!row || !dock) throw new Error("the conversation surfaces were not found");
      return {
        rowTop: row.getBoundingClientRect().top,
        dockBottom: dock.getBoundingClientRect().bottom,
        dockPadding: parseFloat(getComputedStyle(dock).paddingBottom),
        viewportHeight: window.innerHeight,
      };
    });
    expect(geometry.rowTop, "the chat header moved on a device that has no status bar inset").toBe(0);
    expect(geometry.dockPadding, "the composer gained padding on a device with no home indicator").toBe(0);
    expect(geometry.dockBottom).toBe(geometry.viewportHeight);

    // Not the installed iPhone app, so no status-bar veil, whatever the theme.
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-ios-standalone"))).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.body, "::before").content)).toBe("none");
  });
});
