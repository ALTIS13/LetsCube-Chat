import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { requireFixtureServer } from "./helpers/messageActionsFixture";
import { ME, openDisclosure, openSettingsScreen } from "./helpers/settingsColumnFixture";

const settings = (page: Page) =>
  page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Настройки", exact: true }),
  });

// Only invented users and intercepted localhost requests. Exercise the real
// responsive shell, not the preview page (which does not mount Settings).
for (const theme of ["dark", "light"] as const) {
  test(`settings keeps an unsaved draft across the layout boundary (${theme})`, async ({
    page,
    request,
  }, info) => {
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    const savedNames: unknown[] = [];
    page.on("request", (request) => {
      if (request.method() !== "PATCH" || new URL(request.url()).pathname !== "/rest/v1/profiles")
        return;
      const body = request.postDataJSON();
      if (body?.full_name !== undefined) savedNames.push(body.full_name);
    });
    await requireFixtureServer(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSettingsScreen(page, { theme });
    // The shared read fixture returns the original profile even to a PATCH.
    // Model the update response here so clean-close checks the saved baseline.
    await page.route("**/rest/v1/profiles?**", async (route) => {
      const request = route.request();
      if (request.method() === "PATCH" && request.postDataJSON()?.full_name !== undefined) {
        return route.fulfill({ json: { ...ME, ...request.postDataJSON() } });
      }
      return route.fallback();
    });
    const name = page.getByTestId("settings-field-name");
    await name.fill("Несохранённое имя");
    for (const width of [360, 390, 412, 844, 767, 768, 1440]) {
      await page.setViewportSize({
        width,
        height: width === 844 ? 390 : width === 390 ? 844 : 900,
      });
      await expect(settings(page)).toBeVisible();
      await expect(name, `draft was lost at ${width}px`).toHaveValue("Несохранённое имя");
      const close = settings(page).getByRole("button", { name: "Закрыть", exact: true }).first();
      await expect(close).toBeInViewport();
      await close.click({ trial: true });
      if (process.env.KUB_UI_STABILITY_CAPTURE_DIR && [390, 1440].includes(width)) {
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() =>
          [...document.querySelectorAll(".kub-modal-overlay, .kub-modal-panel")].every((node) =>
            node.getAnimations().every((animation) => animation.playState !== "running"),
          ),
        );
        await page.screenshot({
          path: path.join(
            process.env.KUB_UI_STABILITY_CAPTURE_DIR,
            `${info.project.name}-${theme}-${width}.png`,
          ),
        });
      }
    }
    await page.getByTestId("settings-close").click();
    await expect(page.getByRole("dialog").filter({ hasText: "Отменить изменения?" })).toBeVisible();
    await page.getByRole("button", { name: "Продолжить", exact: true }).click();
    await expect(name).toHaveValue("Несохранённое имя");
    expect(savedNames).toEqual([]);
    await settings(page).getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect.poll(() => savedNames).toEqual(["Несохранённое имя"]);
    await expect(
      settings(page).getByRole("button", { name: "Сохранено", exact: true }),
    ).toBeVisible();
    await page.getByTestId("settings-close").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`the phone profile tab stays open after widening (${theme})`, async ({ page, request }) => {
    await requireFixtureServer(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await openSettingsScreen(page, { theme });
    await page.getByRole("button", { name: "Закрыть", exact: true }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Навигация" })
      .getByRole("button", { name: "Профиль" })
      .click();
    await expect(page.getByTestId("settings-profile-tab")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByTestId("settings-field-name").fill("Synthetic profile draft");
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(settings(page), "profile disappeared after rotation").toBeVisible();
    await expect(page.getByTestId("settings-field-name")).toHaveValue("Synthetic profile draft");
    await page.getByTestId("settings-close").click();
    await expect(page.getByRole("dialog").filter({ hasText: "Отменить изменения?" })).toBeVisible();
    await page.getByRole("button", { name: "Отменить", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Навигация" }).getByRole("button", { name: "Чаты" }),
    ).toHaveAttribute("aria-current", "page");
  });

  for (const width of [360, 412]) {
    test(`an open discard confirmation stays above settings after resizing to ${width} (${theme})`, async ({
      page,
      request,
    }) => {
      await requireFixtureServer(request);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openSettingsScreen(page, { theme, desktopShell: true });
      const name = page.getByTestId("settings-field-name");
      await name.fill("Synthetic profile draft");
      const close = settings(page).getByRole("button", { name: "Закрыть", exact: true }).first();
      // WebKit pointer clicks do not focus buttons. Establish the keyboard
      // origin whose focus the confirmation must restore on every engine.
      await close.focus();
      await expect(close).toBeFocused();
      await close.press("Enter");
      const confirmation = page.getByRole("dialog").filter({
        has: page.getByRole("heading", { name: "Отменить изменения?", exact: true }),
      });
      const keep = confirmation.getByRole("button", { name: "Продолжить", exact: true });
      await expect(keep).toBeFocused();
      await keep.click({ trial: true });

      await page.setViewportSize({ width, height: 844 });
      await expect(page.getByTestId("settings-overlay")).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(2);
      await expect(keep).toBeFocused();
      // Visibility alone accepts a confirmation painted beneath the new modal.
      await keep.click({ trial: true });
      await page.keyboard.press("Escape");
      await expect(confirmation).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(name).toHaveValue("Synthetic profile draft");
      await expect(close).toBeFocused();

      // Exercise the pointer path too, and the reverse presentation change.
      await close.press("Enter");
      await expect(keep).toBeFocused();
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByTestId("settings-overlay")).toHaveCount(1);
      await expect(keep).toBeFocused();
      await keep.click();
      await expect(confirmation).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(name).toHaveValue("Synthetic profile draft");
      await expect(close).toBeFocused();
    });
  }

  test(`the phone draft retains focus and selection across settings presentations (${theme})`, async ({
    page,
    request,
  }) => {
    await requireFixtureServer(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSettingsScreen(page, { theme });
    const name = page.getByTestId("settings-field-name");
    await name.fill("Synthetic profile draft");
    await page.getByTestId("settings-open-phone").click();
    const phone = page.getByPlaceholder("+7 999 123 45 67", { exact: true });
    // Invented number; no request-code or save action is performed.
    await phone.fill("+12025550123");
    await phone.evaluate((input: HTMLInputElement) => input.setSelectionRange(3, 6));
    await expect(phone).toBeFocused();
    await expect(phone).toHaveJSProperty("selectionStart", 3);
    await expect(phone).toHaveJSProperty("selectionEnd", 6);

    for (const viewport of [
      { width: 360, height: 800 },
      { width: 412, height: 915 },
      { width: 844, height: 390 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.getByTestId("settings-overlay")).toHaveCount(viewport.width < 768 ? 0 : 1);
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(page.getByTestId("settings-section-phone")).toBeVisible();
      await expect(name).toHaveValue("Synthetic profile draft");
      await expect(phone).toHaveValue("+12025550123");
      await expect(phone).toBeFocused();
      await expect(phone).toHaveJSProperty("selectionStart", 3);
      await expect(phone).toHaveJSProperty("selectionEnd", 6);
    }
  });

  test(`the Windows storage draft retains its editor focus and selection across settings presentations (${theme})`, async ({
    page,
    request,
  }) => {
    await requireFixtureServer(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    // Browser bridge fixture only; no real native window or storage mutation.
    await openSettingsScreen(page, { theme, desktopShell: true });
    await openDisclosure(page, "application");
    await page.getByTestId("desktop-storage-location-edit").click();
    const field = page.getByTestId("desktop-storage-location-input");
    await field.fill("D:\\SyntheticAuditOnly");
    await field.evaluate((input: HTMLInputElement) => input.setSelectionRange(3, 7));
    await expect(field).toBeFocused();
    await expect(field).toHaveJSProperty("selectionStart", 3);
    await expect(field).toHaveJSProperty("selectionEnd", 7);

    for (const viewport of [
      { width: 412, height: 915 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.getByTestId("settings-overlay")).toHaveCount(viewport.width < 768 ? 0 : 1);
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(page.getByTestId("settings-section-application")).toBeVisible();
      await expect(page.getByTestId("desktop-storage-location-editor")).toHaveCount(1);
      await expect(field).toHaveValue("D:\\SyntheticAuditOnly");
      await expect(field).toBeFocused();
      await expect(field).toHaveJSProperty("selectionStart", 3);
      await expect(field).toHaveJSProperty("selectionEnd", 7);
    }
  });
}
