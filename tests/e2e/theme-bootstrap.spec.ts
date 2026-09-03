import { expect, test } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

/**
 * The pre-paint theme script shipped unparseable.
 *
 * Inside the template literal that emits it, `/letscube-night\/([01])/` lost
 * its backslash, so the emitted regex closed early on the inner slash and the
 * whole bootstrap threw `SyntaxError: Unexpected token '.'` on every page load
 * in production. Nothing caught it: the parity test compared the two copies and
 * they matched, being identically broken.
 *
 * With the bootstrap dead there is no pre-paint theme at all — every load
 * flashes — and the Android shell's night marker is never read, which is what
 * left a phone in night mode opening the application in light.
 */
test.describe("pre-paint theme bootstrap", () => {
  test("runs without throwing and settles the theme before the app mounts", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (event) => errors.push(String(event)));

    await gotoOrSkip(page, "/login");
    const state = await page.evaluate(() => ({
      theme: document.documentElement.getAttribute("data-theme"),
      scheme: document.documentElement.style.colorScheme,
      classes: document.documentElement.className,
    }));

    expect(errors, "the bootstrap must parse").toEqual([]);
    expect(state.theme, "a theme is chosen before paint").toMatch(/^(dark|light)$/);
    expect(state.scheme).toBe(state.theme);
    expect(state.classes).toContain(state.theme ?? "");
  });

  test("the Android night marker outranks the system preference", async ({ browser }) => {
    // The WebView does not pass night mode through to the media query, so the
    // shell writes it into the user agent. Here the system says light and the
    // marker says night: the marker has to win, or a phone in night mode opens
    // the application in light.
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 letscube-night/1 Chrome/140.0.0.0 Mobile Safari/537.36",
      colorScheme: "light",
    });
    const page = await context.newPage();
    try {
      await gotoOrSkip(page, "/login");
      await expect
        .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
        .toBe("dark");
    } finally {
      await context.close();
    }
  });

  test("a marker of 0 keeps the application light on a light phone", async ({ browser }) => {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 letscube-night/0 Chrome/140.0.0.0 Mobile Safari/537.36",
      colorScheme: "dark",
    });
    const page = await context.newPage();
    try {
      await gotoOrSkip(page, "/login");
      await expect
        .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
        .toBe("light");
    } finally {
      await context.close();
    }
  });
});
