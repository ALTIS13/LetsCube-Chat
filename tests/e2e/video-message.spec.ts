import { expect, test } from "@playwright/test";
import { gotoOrSkip, loadQaCredentials, loginIfNeeded } from "./helpers/auth";

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test.describe("KUB round video messages", () => {
  test("records a video message into staged attachments without sending immediately", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    const credentials = loadQaCredentials();
    test.skip(!credentials, "QA credentials are not configured in env or ~/.kub-messenger-qa.env");

    await gotoOrSkip(page, "/");
    await loginIfNeeded(page, credentials);
    await openAnyChat(page);

    await page.getByRole("button", { name: "Прикрепить" }).click();
    await page.getByRole("button", { name: "Записать видео" }).click();

    const modal = page.getByTestId("video-message-recorder-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByText("Камера готова")).toBeVisible();

    await page.getByTestId("video-message-record-start").click();
    await expect(modal.getByText("Идёт запись")).toBeVisible();
    await page.waitForTimeout(1_200);
    await page.getByTestId("video-message-record-stop").click();
    await expect(modal.getByText("Видео готово")).toBeVisible();

    await page.getByRole("button", { name: "Добавить" }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId("staged-attachment-tray")).toBeVisible();
    await expect(page.getByTestId("staged-attachment-item").first()).toContainText(
      "Видео-сообщение",
    );
    await expect(page.getByTestId("staged-video-message-preview")).toBeVisible();

    await page.getByRole("button", { name: "Убрать вложение" }).first().click();
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(0);
    await expect(page.getByText("Произошла ошибка интерфейса")).toHaveCount(0);
    expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
  });

  test("shows a friendly state when video recording is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        value: undefined,
      });
    });

    const credentials = loadQaCredentials();
    test.skip(!credentials, "QA credentials are not configured in env or ~/.kub-messenger-qa.env");

    await gotoOrSkip(page, "/");
    await loginIfNeeded(page, credentials);
    await openAnyChat(page);

    await page.getByRole("button", { name: "Прикрепить" }).click();
    await page.getByRole("button", { name: "Записать видео" }).click();

    const modal = page.getByTestId("video-message-recorder-modal");
    await expect(modal).toBeVisible();
    await expect(
      modal.getByText("Видео-сообщения не поддерживаются этим браузером.").first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Начать запись" })).toBeDisabled();
  });
});

async function openAnyChat(page: import("@playwright/test").Page) {
  const composer = page.getByPlaceholder(/Сообщение/i).first();
  if (await composer.isVisible().catch(() => false)) return;

  const chatPreview = page
    .locator("button")
    .filter({
      hasText:
        /Сохранённые сообщения|Сообщений пока нет|История очищена|Фото|Видео|Файл|Голосовое|Местоположение/i,
    })
    .first();

  await expect(chatPreview).toBeVisible();
  await chatPreview.click();
  await expect(composer).toBeVisible();
}
