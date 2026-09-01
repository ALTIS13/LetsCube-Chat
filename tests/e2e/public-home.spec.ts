import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Responsive and accessibility contract for the public home.
 *
 * The page makes availability claims to people who are not logged in, so the
 * assertions here are about what a visitor can actually see and reach: nothing
 * scrolls sideways, no action is cut off, the imagery really loaded, the
 * platform sections are reachable from the first viewport, and a platform with
 * no release offers nothing to press and claims nothing about a store.
 */

// Step 7 of the plan names these four; the 3840 project is a scaling check that
// this contract does not add anything to.
const COVERED_PROJECTS = [
  "chromium-desktop-1920",
  "chromium-desktop-1440",
  "chromium-mobile-390",
  "chromium-mobile-412",
];

const SCROLL_ROOT = '[data-testid="public-scroll-root"]';
const CATALOG = "https://api.letscube.ru/releases/v1/**";

// Positioning that the product has moved away from and must not reappear on a
// public surface. The legal entity name in the footer is deliberately not here.
const RETIRED_POSITIONING = [/компьютерн\w* клуб/i, /кибер[- ]?арена/i, /киберклуб/i, /игров\w* клуб/i];

const STORE_CLAIMS = [/app\s*store/i, /google\s*play/i, /установить из/i, /доступно в/i];

function manifest(platform: string, available: boolean) {
  return {
    schemaVersion: 1,
    platform,
    channel: "stable",
    available,
    version: platform === "android" ? "0.1.3" : "0.2.10",
    build: 14,
    publishedAt: "2026-08-31T09:00:00.000Z",
    minimumSupportedVersion: null,
    mandatory: false,
    notes: "Плановое обновление.",
    highlights: ["Быстрее открывается чат", "Уведомления группируются по чату"],
    artifact: available
      ? {
        url: `https://api.letscube.ru/releases/files/${platform}/${platform === "android" ? "0.1.3" : "0.2.10"}/build.bin`,
        size: 2_322_508,
        sha256: "697f345bd544281e27b7ab6f4293abebd6c024c10bf60ca6a6e513c5df2e7bfd",
      }
      : null,
  };
}

async function installCatalog(page: Page) {
  await page.route(CATALOG, async (route: Route) => {
    const platform = new URL(route.request().url()).pathname.split("/")[3] ?? "windows";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(manifest(platform, platform === "windows" || platform === "android")),
    });
  });
}

test.describe("public home presentation", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      !COVERED_PROJECTS.includes(testInfo.project.name),
      "This contract covers the four release viewports named by the plan.",
    );
    await installCatalog(page);
  });

  test("nothing scrolls sideways and no action is cut off", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const overflow = await page.evaluate((selector) => {
      const root = document.querySelector(selector);
      return {
        document: document.documentElement.scrollWidth - window.innerWidth,
        root: root ? root.scrollWidth - root.clientWidth : 0,
      };
    }, SCROLL_ROOT);

    expect(overflow.document, "the document scrolls sideways").toBeLessThanOrEqual(0);
    expect(overflow.root, "the page container scrolls sideways").toBeLessThanOrEqual(0);

    const viewport = page.viewportSize();
    const links = page.locator("main a, main button");
    for (let index = 0; index < (await links.count()); index += 1) {
      const control = links.nth(index);
      if (!(await control.isVisible())) continue;
      const box = await control.boundingBox();
      if (!box) continue;
      expect(box.x, `${await control.innerText()} starts off-screen`).toBeGreaterThanOrEqual(-1);
      expect(
        box.x + box.width,
        `${await control.innerText()} is cut off on the right`,
      ).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
    }
  });

  test("the platform sections are reachable from the first viewport", async ({ page }) => {
    await page.goto("/");
    const platforms = page.getByRole("heading", { name: "Приложения LETSCUBE" });
    await expect(platforms).toBeVisible();

    const viewport = page.viewportSize();
    const box = await platforms.boundingBox();
    // Visible without scrolling: the hero deliberately clips its product band so
    // a visitor can see there is more than a headline.
    expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(viewport?.height ?? 0);
  });

  test("the product imagery actually loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.evaluate((selector) => {
      const root = document.querySelector(selector);
      if (root) root.scrollTop = root.scrollHeight;
    }, SCROLL_ROOT);

    const images = page.locator("main img");
    const count = await images.count();
    expect(count, "the page shows no product imagery at all").toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const image = images.nth(index);
      await expect(image).toHaveJSProperty("complete", true);
      // A broken source still reports complete, so the decoded size is what
      // proves the file was really served.
      const natural = await image.evaluate((node: HTMLImageElement) => node.naturalWidth);
      expect(natural, `${await image.getAttribute("src")} did not decode`).toBeGreaterThan(0);
      await expect(image).toHaveAttribute("alt", /\S/);
    }
  });

  for (const scheme of ["dark", "light"] as const) {
    test(`the ${scheme} theme uses its own screenshots`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript((value) => localStorage.setItem("kub-theme", value), scheme);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);

      const sources = await page.locator("main img").evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLImageElement).getAttribute("src") ?? ""),
      );
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(source, `${source} is not the ${scheme} asset`).toContain(`-${scheme}.webp`);
      }
    });
  }

  test("platforms without a release offer nothing to press and claim no store", async ({ page }) => {
    await page.goto("/");

    for (const [platform, heading] of [["macos", "macOS"], ["ios", "iPhone и iPad"]] as const) {
      // Scoped by the section's own label id: filtering by a heading would also
      // match the wrapping section that contains every platform.
      const section = page.locator(`section[aria-labelledby="platform-${platform}"]`);
      await expect(section).toHaveCount(1);
      await expect(section.getByRole("heading", { name: heading })).toBeVisible();

      await expect(section.getByText("В разработке")).toBeVisible();
      await expect(section.locator('a[href*="/releases/files/"]')).toHaveCount(0);
      await expect(section.locator("a, button")).toHaveCount(0);

      const text = (await section.innerText()).toLowerCase();
      for (const claim of STORE_CLAIMS) {
        expect(text, `${heading} makes a store availability claim`).not.toMatch(claim);
      }
    }
  });

  test("released platforms link only at the validated catalog artifact", async ({ page }) => {
    await page.goto("/");

    // The catalog is fetched after paint, so the control only becomes a link
    // once a manifest has been parsed.
    const downloads = page.locator('main a[href^="https://api.letscube.ru/"]');
    await expect(downloads.first()).toBeVisible();

    const count = await downloads.count();
    expect(count, "no download is offered even though the catalog says available").toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const href = await downloads.nth(index).getAttribute("href");
      expect(href).toMatch(/^https:\/\/api\.letscube\.ru\/releases\/files\//);
    }
  });

  test("the retired club positioning is absent", async ({ page }) => {
    await page.goto("/");
    await page.evaluate((selector) => {
      const root = document.querySelector(selector);
      if (root) root.scrollTop = root.scrollHeight;
    }, SCROLL_ROOT);

    const text = await page.locator("body").innerText();
    for (const pattern of RETIRED_POSITIONING) {
      expect(text, `the page still carries ${pattern}`).not.toMatch(pattern);
    }
  });

  test("the primary actions are reachable and visible from the keyboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The catalog resolves after paint and re-renders the hero actions. Tabbing
    // through a tree that is still changing loses focus, so settle first.
    await expect(page.getByRole("link", { name: /Открыть веб-версию/ }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");

    const reached: string[] = [];
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body) return "";
        return (active.innerText || active.getAttribute("aria-label") || "").trim();
      });
      if (label) reached.push(label);
      if (reached.some((entry) => entry.includes("Открыть веб-версию"))) break;
    }

    expect(reached.join(" | "), "the web client action is not reachable by keyboard").toContain(
      "Открыть веб-версию",
    );

    const outline = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return null;
      const style = getComputedStyle(active);
      return { outline: style.outlineStyle, shadow: style.boxShadow };
    });
    // Either a real outline or a ring shadow counts; an invisible focus does not.
    expect(
      outline?.outline !== "none" || (outline?.shadow ?? "none") !== "none",
      "the focused control shows no focus indicator",
    ).toBeTruthy();
  });

  test("the page renders with reduced motion requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Приложения LETSCUBE" })).toBeVisible();

    const animated = await page.evaluate(() =>
      [...document.querySelectorAll("main *")].filter((node) => {
        const style = getComputedStyle(node);
        return style.animationName !== "none" && style.animationIterationCount === "infinite";
      }).length,
    );
    expect(animated, "an endless animation runs while reduced motion is requested").toBe(0);
  });
});
