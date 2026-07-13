import { chromium, expect, test } from "@playwright/test";

const PRODUCTION_ORIGIN = "https://app.letscube.ru";
const QA_MODES = new Set([
  "success",
  "offline",
  "catalog_failure",
  "normal_update",
  "critical_update",
]);
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 960, height: 640 },
] as const;

test("covers the injected Windows startup and updater lifecycle", async ({}, testInfo) => {
  test.skip(process.platform !== "win32", "Tauri WebView2 QA is Windows-only");
  test.skip(
    testInfo.project.name !== "chromium-desktop-1440",
    "the native shell owns its viewport and runs once",
  );

  const mode = process.env.LETSCUBE_TAURI_QA_STARTUP_MODE ?? "";
  expect(QA_MODES.has(mode), "wrapper must provide a bounded startup QA mode").toBe(true);
  const cdpUrl = validateCdpUrl(process.env.LETSCUBE_TAURI_CDP_URL ?? "");
  const browser = await connectToTauri(cdpUrl);

  try {
    const pages = browser.contexts().flatMap((context) => context.pages());
    expect(pages, "each scenario must expose exactly one native WebView").toHaveLength(1);
    const page = pages[0];
    await page.waitForURL("http://tauri.localhost/startup.html");
    await expect(page).toHaveTitle("LETSCUBE");
    await page.emulateMedia({ reducedMotion: "reduce" });

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      const geometry = await measureStartupGeometry(page);
      await page.screenshot({
        path: testInfo.outputPath(`startup-${mode}-${viewport.width}x${viewport.height}.png`),
      });
      expect(geometry, `startup geometry at ${viewport.width}x${viewport.height}`).toEqual({
        horizontalOverflow: false,
        statusBelowRail: true,
        halvesStopAtCenter: true,
        halvesSymmetric: true,
        endpointClearance: true,
        fingerprintClearance: true,
        fingerprintStylesMatch: true,
        statusClearance: true,
      });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const stages: string[] = [];
    await page.exposeFunction("__recordLifecycleStage", (stage: string | undefined) => {
      if (stage) stages.push(stage);
    });
    await page.evaluate(() => {
      const record = Reflect.get(window, "__recordLifecycleStage") as (stage?: string) => void;
      record(document.body.dataset.stage);
      new MutationObserver(() => record(document.body.dataset.stage)).observe(document.body, {
        attributes: true,
        attributeFilter: ["data-stage"],
      });
    });

    await page.evaluate(async () => {
      await window.__TAURI_INTERNALS__?.invoke("begin_startup_qa");
    });

    if (mode === "offline") {
      await expect(page.locator("body")).toHaveAttribute("data-stage", "recoverable_error");
      await expect(page.getByText("Сервер LETSCUBE недоступен")).toBeVisible();
      const retry = page.getByRole("button", { name: "Повторить" });
      await expect(retry).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("startup-offline-retry.png") });
      await retry.click();
    }

    await page.waitForURL(
      (url) => url.origin === PRODUCTION_ORIGIN,
      { timeout: 35_000, waitUntil: "domcontentloaded" },
    );
    expect(new URL(page.url()).origin).toBe(PRODUCTION_ORIGIN);
    expect(browser.contexts().flatMap((context) => context.pages())).toHaveLength(1);
    await expect(page).toHaveTitle("LETSCUBE");
    await expect
      .poll(() => page.evaluate(() => window.letscubeDesktop?.getUpdateState()), {
        timeout: 10_000,
      })
      .toMatchObject(expectedUpdateState(mode));

    if (mode === "offline") {
      expect(stages).toEqual(expect.arrayContaining(["recoverable_error", "network_check"]));
    } else {
      expect(stages).toEqual(
        expect.arrayContaining([
          "network_check",
          "tls_origin_check",
          "update_check",
          "production_navigation",
        ]),
      );
    }
    await page.screenshot({ path: testInfo.outputPath(`production-handoff-${mode}.png`) });
  } finally {
    await browser.close();
  }
});

function expectedUpdateState(mode: string) {
  switch (mode) {
    case "success":
      return { channel: "stable", phase: "current", mandatory: false };
    case "catalog_failure":
      return {
        channel: "stable",
        phase: "failed",
        mandatory: false,
        errorCode: "update_check_failed",
      };
    case "normal_update":
      return {
        channel: "stable",
        phase: "available",
        availableVersion: "0.2.1",
        mandatory: false,
      };
    case "critical_update":
      return {
        channel: "stable",
        phase: "critical_update_required",
        availableVersion: "0.3.0",
        mandatory: true,
      };
    default:
      return { channel: "stable", phase: "idle", mandatory: false };
  }
}

async function measureStartupGeometry(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const box = (selector: string) =>
      document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null;
    const leftRail = box(".rail-left");
    const rightRail = box(".rail-right");
    const seal = box('[data-testid="startup-center-seal"]');
    const status = box("#startup-status");
    const stages = box(".stages");
    const versionPill = box(".version-pill");
    const client = box(".endpoint-client");
    const server = box(".endpoint-server");
    const clientFingerprint = box('[data-testid="startup-client-fingerprint"]');
    const serverFingerprint = box('[data-testid="startup-server-fingerprint"]');
    const computer = box(".computer");
    const serverRack = box(".server");
    if (
      !leftRail ||
      !rightRail ||
      !seal ||
      !status ||
      !stages ||
      !versionPill ||
      !client ||
      !server ||
      !clientFingerprint ||
      !serverFingerprint ||
      !computer ||
      !serverRack
    ) {
      throw new Error("startup_geometry_missing");
    }
    const clientStyles = [...document.querySelectorAll<HTMLElement>(
      '[data-testid="startup-client-fingerprint"] span',
    )].map((element) => {
      const style = getComputedStyle(element);
      return [style.color, style.opacity];
    });
    const serverStyles = [...document.querySelectorAll<HTMLElement>(
      '[data-testid="startup-server-fingerprint"] span',
    )].map((element) => {
      const style = getComputedStyle(element);
      return [style.color, style.opacity];
    });
    const overlaps = (first: DOMRect, second: DOMRect) =>
      first.left < second.right &&
      first.right > second.left &&
      first.top < second.bottom &&
      first.bottom > second.top;

    return {
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      statusBelowRail: status.top > seal.bottom,
      halvesStopAtCenter: leftRail.right <= seal.left + 0.5 && rightRail.left >= seal.right - 0.5,
      halvesSymmetric:
        Math.abs((seal.left - leftRail.right) - (rightRail.left - seal.right)) <= 1,
      endpointClearance: !overlaps(computer, seal) && !overlaps(serverRack, seal),
      fingerprintClearance:
        clientFingerprint.bottom <= computer.top && serverFingerprint.bottom <= serverRack.top,
      fingerprintStylesMatch:
        JSON.stringify(clientStyles) === JSON.stringify(serverStyles),
      statusClearance:
        !overlaps(status, stages) &&
        !overlaps(status, versionPill) &&
        !overlaps(status, computer) &&
        !overlaps(status, serverRack),
    };
  });
}

function validateCdpUrl(value: string) {
  const url = new URL(value);
  const port = Number(url.port);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65_535
  ) {
    throw new Error("LETSCUBE_TAURI_CDP_URL must be an uncredentialed loopback HTTP origin.");
  }
  return url.origin;
}

async function connectToTauri(cdpUrl: string) {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(cdpUrl);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}
