import { expect, test } from "@playwright/test";
import { requireFixtureServer } from "./helpers/messageActionsFixture";
import { openSettingsScreen, setSettingsMeasure } from "./helpers/settingsColumnFixture";

for (const theme of ["dark", "light"] as const) {
  test(`message text size has a readable percentage scale and persists (${theme})`, async ({
    page,
    request,
    browserName,
  }, info) => {
    await requireFixtureServer(request);
    await openSettingsScreen(page, { theme });

    const existingSlider = page.getByRole("slider", { name: "Размер текста сообщений" });
    await existingSlider.scrollIntoViewIfNeeded();
    await expect(existingSlider).toHaveValue("16");
    await expect(page.getByText("100% — по умолчанию")).toBeVisible();
    const row = page.getByTestId("message-text-size-setting");
    const slider = row.getByRole("slider", { name: "Размер текста сообщений" });
    await expect(slider).toHaveValue("16");
    await expect(row.getByText("100% — по умолчанию")).toBeVisible();
    await expect(row.getByText("100%", { exact: true })).toBeVisible();
    await expect(row.getByText("81%", { exact: true })).toBeVisible();
    await expect(row.getByText("138%", { exact: true })).toBeVisible();
    await expect(slider).toHaveAttribute("aria-valuetext", "100% (16 px, по умолчанию)");
    const alignment = await row.evaluate((node) => {
      const track = node.querySelector("input[type='range']")!.getBoundingClientRect();
      const mark = node
        .querySelector("[data-testid='message-text-size-default-mark']")!
        .getBoundingClientRect();
      const thumbCenter = track.left + 6 + (track.width - 12) / 3;
      return Math.abs(mark.left + mark.width / 2 - thumbCenter);
    });
    expect(alignment).toBeLessThan(5);
    await row.screenshot({ path: info.outputPath("default.png") });

    await slider.focus();
    await slider.press("End");
    await expect(slider).toHaveValue("22");
    await expect(row.getByText("138%", { exact: true })).toHaveCount(2);
    await slider.press("Home");
    await expect(slider).toHaveValue("13");
    await slider.press("ArrowRight");
    await expect(slider).toHaveValue("14");
    await slider.press("End");
    await slider.press("ArrowLeft");
    await slider.press("ArrowLeft");
    await expect(row.getByText("125%", { exact: true })).toBeVisible();
    await expect(slider).toHaveAttribute("aria-valuetext", /125%.*20 px/);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("letscube:message-text-size")))
      .toBe("20");
    await row.screenshot({ path: info.outputPath("125-percent.png") });

    await page.reload();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("letscube:message-text-size")))
      .toBe("20");
    // The WebKit fixture can remain on its startup screen after a reload; the
    // setting's stored value is still readable, and Chromium checks restored UI.
    if (browserName === "webkit") return;
    if ((page.viewportSize()?.width ?? 0) < 768) {
      await page.getByRole("button", { name: "Меню" }).first().click();
      await page.getByRole("button", { name: "Настройки" }).first().click();
    } else {
      await page.getByTestId("side-menu-button").click();
      await page
        .getByTestId("side-menu-layer")
        .getByRole("button", { name: "Настройки", exact: true })
        .click();
    }
    await expect(page.getByRole("slider", { name: "Размер текста сообщений" })).toHaveValue("20");
    await expect(page.getByText("125%", { exact: true })).toBeVisible();
  });
}

test("the size setting fits a narrow settings measure and phone sheet", async ({
  page,
  request,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) < 768, "the measure override is desktop-only");
  await requireFixtureServer(request);
  await openSettingsScreen(page);

  const row = page.getByTestId("message-text-size-setting");
  for (const width of [260, 360]) {
    await setSettingsMeasure(page, width);
    const boxes = await row.evaluate((node) => {
      const label = node
        .querySelector("[data-testid='message-text-size-label']")!
        .getBoundingClientRect();
      const slider = node.querySelector("input[type='range']")!.getBoundingClientRect();
      const rowBox = node.getBoundingClientRect();
      return {
        labelBottom: label.bottom,
        sliderTop: slider.top,
        sliderRight: slider.right,
        rowRight: rowBox.right,
        sliderWidth: slider.width,
      };
    });
    expect(boxes.labelBottom).toBeLessThan(boxes.sliderTop);
    expect(boxes.sliderRight).toBeLessThanOrEqual(boxes.rowRight);
    expect(boxes.sliderWidth).toBeGreaterThan(150);
  }

  await page.setViewportSize({ width: 360, height: 800 });
  const phoneRow = page.getByTestId("message-text-size-setting");
  await expect(phoneRow).toBeVisible();
  const fits = await phoneRow.evaluate((node) => {
    const slider = node.querySelector("input[type='range']")!.getBoundingClientRect();
    const rowBox = node.getBoundingClientRect();
    return slider.right <= rowBox.right && slider.width > 150;
  });
  expect(fits).toBe(true);
});
