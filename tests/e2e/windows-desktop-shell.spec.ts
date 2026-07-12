import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { findFirstAvailableQaRole, loginAsRoleOrSkip } from "./helpers/auth";

const QA_ROLES = ["owner", "tech_admin", "location_admin", "location_staff", "client"] as const;

test.describe("LETSCUBE Windows desktop shell", () => {
  test.describe.configure({ mode: "serial" });
  let desktopApp: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    desktopApp = await electron.launch({
      executablePath: resolve("desktop/node_modules/electron/dist/electron.exe"),
      args: [resolve("desktop")],
    });
    page = await desktopApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await desktopApp?.close();
  });

  test("loads only the production app with an isolated version bridge", async () => {
    expect(new URL(page.url()).origin).toBe("https://app.letscube.ru");
    await expect(page).toHaveTitle("LETSCUBE");

    const contract = await page.evaluate(async () => ({
      requireType: typeof (globalThis as typeof globalThis & { require?: unknown }).require,
      platform: window.letscubeDesktop?.platform ?? null,
      runtime: await window.letscubeDesktop?.getRuntimeInfo(),
      manifestCount: document.querySelectorAll('link[rel="manifest"]').length,
    }));

    expect(contract.requireType).toBe("undefined");
    expect(contract.platform).toBe("windows");
    expect(contract.runtime).toEqual({ platform: "windows", version: "0.1.2", build: 3 });
    expect(contract.manifestCount).toBe(0);
  });

  test("shows installed Windows version instead of browser installation controls", async () => {
    const role = findFirstAvailableQaRole([...QA_ROLES], { includeDefault: true });
    test.skip(!role, "QA credentials or auth state are not configured");
    await loginAsRoleOrSkip(page, role!);

    await page.getByRole("button", { name: "Меню" }).click();
    await page.getByRole("button", { name: "Настройки" }).click();
    const section = page.getByTestId("release-distribution-card");
    await section.scrollIntoViewIfNeeded();

    await expect(section).toContainText("Windows-приложение LETSCUBE");
    await expect(section.getByTestId("pwa-install-variant")).toContainText("Windows EXE");
    await expect(section.getByTestId("pwa-install-mode")).toContainText("Приложение");
    await expect(section.getByTestId("release-catalog-state")).toHaveAttribute("data-state", "current");
    await expect(section.getByTestId("release-download-button")).toHaveCount(0);
    await expect(page.getByText("Браузер не поддерживает", { exact: true })).toHaveCount(0);
  });
});
