import { chromium, expect, test } from "@playwright/test";
import { findFirstAvailableQaRole, loginAsRoleOrSkip } from "./helpers/auth";

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
    await expect(page.getByTestId("startup-titlebar")).toBeVisible();
    await expect(page.getByTestId("startup-window-minimize")).toBeVisible();
    await expect(page.getByTestId("startup-window-maximize")).toBeVisible();
    await expect(page.getByTestId("startup-window-close")).toBeVisible();
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
        endpointTextClearance: true,
        fingerprintLineClearance: true,
        statusStageLabelClearance: true,
        retryLabelClearance: true,
        textPairwiseClear: true,
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
      await expect(retry).toHaveText("Повторить");
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await expect(measureStartupGeometry(page)).resolves.toMatchObject({
          endpointTextClearance: true,
          fingerprintLineClearance: true,
          statusStageLabelClearance: true,
          retryLabelClearance: true,
        });
        await page.screenshot({
          path: testInfo.outputPath(`startup-offline-retry-${viewport.width}x${viewport.height}.png`),
        });
      }
      await retry.click();
    }

    await page.waitForURL(
      (url) => url.origin === PRODUCTION_ORIGIN,
      { timeout: 35_000, waitUntil: "domcontentloaded" },
    );
    expect(new URL(page.url()).origin).toBe(PRODUCTION_ORIGIN);
    expect(browser.contexts().flatMap((context) => context.pages())).toHaveLength(1);
    await expect(page).toHaveTitle("LETSCUBE");
    const applicationRoot = page.locator("#root");
    await expect(applicationRoot).toHaveAttribute("data-kub-boot-id", /.+/, { timeout: 20_000 });
    await expect
      .poll(() => applicationRoot.evaluate((node) => node.childElementCount), {
        message: "production handoff must mount the LETSCUBE application instead of leaving a blank WebView",
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
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
    await assertNativeInjectedUpdateUi(page, mode, testInfo);
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

async function assertNativeInjectedUpdateUi(
  page: import("@playwright/test").Page,
  mode: string,
  testInfo: import("@playwright/test").TestInfo,
) {
  if (mode !== "normal_update" && mode !== "critical_update") return;

  const role = findFirstAvailableQaRole(["owner", "tech_admin", "location_admin"], {
    includeDefault: true,
  });
  expect(role, "Native updater UI requires a configured QA authenticated state or credentials.").not.toBeNull();
  if (!role) throw new Error("native_updater_ui_auth_missing");
  await loginAsRoleOrSkip(page, role);
  const appTopBar = page.getByTestId("app-top-bar");
  await expect(
    page.locator('[data-testid="app-top-bar"], [data-testid="sidebar-brand-strip"]'),
  ).toBeVisible({ timeout: 20_000 });
  if (await appTopBar.isVisible().catch(() => false)) {
    await expect(page.getByTestId("desktop-window-controls")).toBeVisible();
  }

  if (mode === "normal_update") {
    const pill = page.getByTestId("desktop-update-pill");
    await expect(pill).toHaveAttribute("data-phase", "available");
    const pillBox = await pill.boundingBox();
    expect(pillBox, "native normal-update pill must have a stable compact box").toBeTruthy();
    expect(pillBox!.width).toBeLessThanOrEqual(300);
    expect(pillBox!.height).toBeLessThanOrEqual(80);
    await expect(page.getByTestId("desktop-app-shell")).not.toHaveAttribute("inert", "");
    await page.screenshot({ path: testInfo.outputPath("native-normal-update-pill.png") });
    return;
  }

  const gate = page.getByTestId("desktop-critical-update-gate");
  await expect(gate).toBeVisible();
  await expect(page.getByTestId("desktop-app-shell")).toHaveAttribute("inert", "");
  await expect(page.getByTestId("desktop-critical-update-install")).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("native-critical-update-gate.png") });
}

async function measureStartupGeometry(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const box = (selector: string) =>
      document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null;
    const boxes = (selector: string) =>
      [...document.querySelectorAll<HTMLElement>(selector)].map((element) => element.getBoundingClientRect());
    const leftRail = box(".rail-left");
    const rightRail = box(".rail-right");
    const seal = box('[data-testid="startup-center-seal"]');
    const status = box("#startup-status");
    const stages = box(".stages");
    const stageLabels = boxes(".stages li");
    const versionPill = box(".version-pill");
    const client = box(".endpoint-client");
    const server = box(".endpoint-server");
    const clientFingerprint = box('[data-testid="startup-client-fingerprint"]');
    const serverFingerprint = box('[data-testid="startup-server-fingerprint"]');
    const computer = box(".computer");
    const serverRack = box(".server");
    const clientHeading = box(".endpoint-client h2");
    const clientSubtitle = box(".endpoint-client p");
    const serverHeading = box(".endpoint-server h2");
    const serverSubtitle = box(".endpoint-server p");
    const clientFingerprintLines = boxes('[data-testid="startup-client-fingerprint"] span');
    const serverFingerprintLines = boxes('[data-testid="startup-server-fingerprint"] span');
    const retry = box("#startup-retry");
    const failureText = box("#startup-error");
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
      !serverRack ||
      !clientHeading ||
      !clientSubtitle ||
      !serverHeading ||
      !serverSubtitle ||
      stageLabels.length !== 4 ||
      clientFingerprintLines.length !== 4 ||
      serverFingerprintLines.length !== 4
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
    const visible = (entry: DOMRect | null): entry is DOMRect =>
      Boolean(entry && entry.width > 0 && entry.height > 0);
    const pairwiseClear = (entries: Array<DOMRect | null>) => {
      const visibleEntries = entries.filter(visible);
      return visibleEntries.every((entry, index) =>
        visibleEntries.slice(index + 1).every((other) => !overlaps(entry, other)));
    };
    const textEntries = [
      ...clientFingerprintLines,
      clientHeading,
      clientSubtitle,
      ...serverFingerprintLines,
      serverHeading,
      serverSubtitle,
      status,
      ...stageLabels,
      retry,
      failureText,
    ];
    const endpointTextEntries = [
      ...clientFingerprintLines,
      clientHeading,
      clientSubtitle,
      ...serverFingerprintLines,
      serverHeading,
      serverSubtitle,
    ];

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
      endpointTextClearance:
        pairwiseClear(endpointTextEntries) &&
        !overlaps(clientHeading, computer) &&
        !overlaps(clientSubtitle, computer) &&
        !overlaps(serverHeading, serverRack) &&
        !overlaps(serverSubtitle, serverRack),
      fingerprintLineClearance:
        pairwiseClear([...clientFingerprintLines, ...serverFingerprintLines]) &&
        clientFingerprintLines.every((line) => !overlaps(line, computer)) &&
        serverFingerprintLines.every((line) => !overlaps(line, serverRack)),
      statusStageLabelClearance:
        pairwiseClear([status, ...stageLabels]) &&
        stageLabels.every((label) => !overlaps(label, versionPill)),
      retryLabelClearance:
        !visible(retry) ||
        pairwiseClear([retry, failureText, status, ...stageLabels, ...endpointTextEntries]),
      textPairwiseClear: pairwiseClear(textEntries),
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
