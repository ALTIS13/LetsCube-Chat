import { expect, test } from "@playwright/test";
import { gotoOrSkip } from "./helpers/auth";

test.describe("LETSCUBE PWA baseline", () => {
  test("exposes installable manifest, safe service worker and offline banner", async ({
    page,
    context,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    await gotoOrSkip(page, "/");

    const manifest = await page.evaluate(async () => {
      const response = await fetch("/manifest.json", { cache: "no-store" });
      return {
        ok: response.ok,
        contentType: response.headers.get("content-type") ?? "",
        body: await response.json(),
      };
    });

    expect(manifest.ok).toBe(true);
    expect(manifest.contentType).toContain("json");
    expect(manifest.body).toMatchObject({
      name: "LETSCUBE",
      short_name: "LETSCUBE",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
    });
    expect(manifest.body.description).toContain("LETSCUBE");
    expect(manifest.body.display_override).toEqual(
      expect.arrayContaining(["standalone", "minimal-ui"]),
    );
    await expect(page).toHaveTitle(/LETSCUBE/);
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/icons/apple-touch-icon.png",
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "sizes",
      "180x180",
    );
    expect(manifest.body.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/icons/apple-touch-icon.png",
          sizes: "180x180",
          type: "image/png",
        }),
        expect.objectContaining({ sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png" }),
        expect.objectContaining({ sizes: "512x512", purpose: expect.stringContaining("maskable") }),
      ]),
    );

    for (const icon of manifest.body.icons as Array<{ src: string }>) {
      const status = await page.evaluate(async (src) => {
        const response = await fetch(src, { cache: "no-store" });
        return response.status;
      }, icon.src);
      expect(status, `manifest icon should be fetchable: ${icon.src}`).toBe(200);
    }

    const swSource = await page.evaluate(async () => {
      const response = await fetch("/sw.js", { cache: "no-store" });
      return response.ok ? response.text() : "";
    });
    const beforeMessageHandler = swSource.split('self.addEventListener("message"')[0] ?? swSource;
    expect(beforeMessageHandler).not.toMatch(/skipWaiting/);
    expect(swSource).toContain("KUB_SKIP_WAITING");
    expect(swSource).toContain("/icons/apple-touch-icon.png");
    expect(swSource).not.toMatch(/clients\.claim\(\)/);

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            if (!("serviceWorker" in navigator)) return "unsupported";
            const registration = await navigator.serviceWorker.getRegistration("/sw.js");
            return registration ? "registered" : "missing";
          }),
        { timeout: 10_000 },
      )
      .toBe("registered");

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    const banner = page.getByTestId("connection-status-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-state", "offline");

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(banner).toHaveAttribute("data-state", "online");

    for (const route of ["/tasks", "/admin"]) {
      const directResponse = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(directResponse?.status(), `direct route should serve app shell: ${route}`).toBeLessThan(400);
      await expect(page.locator("body")).toBeVisible();
    }

    const unexpectedConsoleErrors = consoleErrors.filter(
      (message) =>
        !message.includes("Failed to load resource") &&
        !message.includes("Missing Supabase environment variables"),
    );
    expect(unexpectedConsoleErrors, `Unexpected console errors:\n${unexpectedConsoleErrors.join("\n")}`).toEqual([]);
  });

  test("injects the install manifest only for iPhone and iPad", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        get: () =>
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) " +
          "AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
      });
      Object.defineProperty(navigator, "platform", {
        configurable: true,
        get: () => "iPhone",
      });
      Object.defineProperty(navigator, "maxTouchPoints", {
        configurable: true,
        get: () => 5,
      });
    });

    await gotoOrSkip(page, "/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.json");
  });
});
