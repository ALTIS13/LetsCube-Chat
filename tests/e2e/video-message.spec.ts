import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gotoOrSkip, loadQaCredentials, loginIfNeeded } from "./helpers/auth";

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test.describe("KUB video recorders", () => {
  test("uses the 250 MB payload-too-large copy for video circles", () => {
    const chatWindowSource = readFileSync(
      resolve(process.cwd(), "artifacts/kub/src/components/chat/ChatWindow.tsx"),
      "utf8",
    );

    expect(chatWindowSource).toContain(
      'kind === "video" || kind === "video_message" ? MAX_VIDEO_ATTACHMENT_SIZE_LABEL',
    );
  });

  test("switches the composer recorder mode with desktop context click", async ({ page }) => {
    const credentials = loadQaCredentials();
    test.skip(!credentials, "QA credentials are not configured in env or ~/.kub-messenger-qa.env");

    await gotoOrSkip(page, "/");
    await loginIfNeeded(page, credentials);
    await openAnyChat(page);

    const recorder = page.getByTestId("composer-recorder-button");
    await expect(recorder).toBeVisible();
    await expect(recorder).toHaveAttribute("data-recorder-mode", "voice");

    await recorder.click({ button: "right" });
    await expect(recorder).toHaveAttribute("data-recorder-mode", "video");
    await expect(page.getByText("Режим: видеосообщение")).toBeVisible();

    await recorder.click({ button: "right" });
    await expect(recorder).toHaveAttribute("data-recorder-mode", "voice");
    await expect(page.getByText("Режим: голосовое")).toBeVisible();
  });

  test("records a regular video from the attachment menu into rectangular staged attachments", async ({ page }) => {
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

    const modal = page.getByTestId("regular-video-recorder-modal");
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
    await expect(page.getByTestId("staged-regular-video-preview")).toBeVisible();
    await expect(page.getByTestId("staged-video-message-preview")).toHaveCount(0);

    await page.getByRole("button", { name: "Убрать вложение" }).first().click();
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(0);
    await expect(page.getByText("Произошла ошибка интерфейса")).toHaveCount(0);
    expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
  });

  test("records a round video message through the composer recorder mode", async ({ page }) => {
    const credentials = loadQaCredentials();
    test.skip(!credentials, "QA credentials are not configured in env or ~/.kub-messenger-qa.env");

    await gotoOrSkip(page, "/");
    await loginIfNeeded(page, credentials);
    await openAnyChat(page);

    const recorder = page.getByTestId("composer-recorder-button");
    await recorder.click({ button: "right" });
    await expect(recorder).toHaveAttribute("data-recorder-mode", "video");

    const box = await recorder.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    const modal = page.getByTestId("video-message-recorder-modal");
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("data-recorder-layout", "compact-round");
    await expect(modal).toHaveAttribute("data-recorder-shell", "composer-attached");
    await expect(page.getByRole("dialog", { name: "Видеосообщение" })).toHaveCount(0);
    await expect(modal.getByText("Идёт запись")).toBeVisible();
    await page.waitForTimeout(1_200);
    await page.mouse.up();

    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId("staged-attachment-tray")).toBeVisible();
    await expect(page.getByTestId("staged-video-message-preview")).toBeVisible();
    await expect(page.getByTestId("staged-video-message-large-preview")).toBeVisible();
    const stagedPreviewBox = await page.getByTestId("staged-video-message-large-preview").boundingBox();
    expect(stagedPreviewBox?.width ?? 0).toBeGreaterThanOrEqual(150);
    await expect(page.getByTestId("staged-video-message-progress-ring")).toBeVisible();
    const previewToggle = page.getByTestId("staged-video-message-playback-toggle");
    await expect(previewToggle).toBeVisible();
    await expect(previewToggle).toHaveAttribute("aria-label", "Просмотреть видеосообщение");
    await previewToggle.click();
    await expect(previewToggle).toHaveAttribute("aria-label", "Пауза предпросмотра");
    const playbackBar = page.getByTestId("chat-media-playback-bar");
    await expect(playbackBar).toBeVisible();
    await expect(page.getByTestId("chat-header-media-playback")).toBeVisible();
    await expect(playbackBar).toHaveAttribute("data-placement", "header");
    await expect(playbackBar).toHaveAttribute("data-current-kind", "video_message");
    await expect(page.getByTestId("chat-media-playback-progress")).toBeVisible();
    await expect(page.getByTestId("chat-media-playback-speed")).toBeVisible();
    await expect(page.getByTestId("chat-media-playback-volume")).toBeVisible();
    await page.getByTestId("chat-media-playback-speed").selectOption("1.5");
    await expect(page.getByTestId("chat-media-playback-speed")).toHaveValue("1.5");
    await page.getByTestId("chat-media-playback-volume").evaluate((node) => {
      const input = node as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "0.6");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const playbackSettings = await page.evaluate(() => {
      const raw = window.localStorage.getItem("kub.mediaPlayback.v1");
      return raw ? JSON.parse(raw) as { playbackRate?: number; volume?: number } : {};
    });
    expect(playbackSettings.playbackRate).toBe(1.5);
    expect(playbackSettings.volume).toBeCloseTo(0.6, 1);
    await page.getByTestId("chat-media-playback-close").click();
    await expect(playbackBar).toHaveCount(0);
    await previewToggle.click();
    await expect(previewToggle).toHaveAttribute("aria-label", "Просмотреть видеосообщение");
    await expect(page.getByTestId("staged-regular-video-preview")).toHaveCount(0);

    await page.getByRole("button", { name: "Убрать вложение" }).first().click();
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(0);
  });

  test("locks voice recording on drag up and stops only by explicit control", async ({ page }) => {
    const credentials = loadQaCredentials();
    test.skip(!credentials, "QA credentials are not configured in env or ~/.kub-messenger-qa.env");

    await gotoOrSkip(page, "/");
    await loginIfNeeded(page, credentials);
    await openAnyChat(page);

    const recorder = page.getByTestId("composer-recorder-button");
    await expect(recorder).toHaveAttribute("data-recorder-mode", "voice");
    const box = await recorder.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Проведите вверх");
    await expect(page.getByTestId("composer-recording-lock-rail")).toBeVisible();
    await expect(page.getByTestId("composer-recording-lock-progress")).toHaveAttribute("data-lock-progress", /0\.\d+|1/);
    await page.mouse.move(box!.x + box!.width / 2, box!.y - 96, { steps: 4 });
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Запись зафиксирована");
    await page.mouse.up();
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Запись зафиксирована");

    await page.waitForTimeout(1_200);
    await page.getByTestId("composer-locked-recording-stop").click();
    await expect(page.getByTestId("staged-attachment-tray").getByText("Голосовое")).toBeVisible();

    await page.getByRole("button", { name: "Убрать вложение" }).first().click();
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(0);
  });

  test("locks round video recording and allows camera switch while recording", async ({ page }) => {
    await page.addInitScript(() => {
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices) return;
      mediaDevices.enumerateDevices = async () => ([
        { kind: "videoinput", deviceId: "front", groupId: "front", label: "Front camera", toJSON: () => ({}) },
        { kind: "videoinput", deviceId: "back", groupId: "back", label: "Back camera", toJSON: () => ({}) },
        { kind: "audioinput", deviceId: "mic", groupId: "mic", label: "Microphone", toJSON: () => ({}) },
      ] as MediaDeviceInfo[]);
    });

    const credentials = loadQaCredentials();
    test.skip(!credentials, "QA credentials are not configured in env or ~/.kub-messenger-qa.env");

    await gotoOrSkip(page, "/");
    await loginIfNeeded(page, credentials);
    await openAnyChat(page);

    const recorder = page.getByTestId("composer-recorder-button");
    await recorder.click({ button: "right" });
    await expect(recorder).toHaveAttribute("data-recorder-mode", "video");
    const box = await recorder.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    const modal = page.getByTestId("video-message-recorder-modal");
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("data-recorder-layout", "compact-round");
    await expect(modal).toHaveAttribute("data-recorder-shell", "composer-attached");
    await expect(modal).toHaveAttribute("data-facing-mode", "user");
    await page.mouse.move(box!.x + box!.width / 2, box!.y - 96, { steps: 4 });
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Запись зафиксирована");
    await page.mouse.up();

    const switchCamera = page.getByTestId("video-recorder-switch-camera");
    await expect(switchCamera).toHaveAttribute("data-switch-placement", "outside-preview");
    await switchCamera.click();
    await expect(modal).toHaveAttribute("data-facing-mode", "environment");
    await page.waitForTimeout(1_200);
    await page.getByTestId("composer-locked-recording-stop").click();

    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId("staged-video-message-preview")).toBeVisible();

    await page.getByRole("button", { name: "Убрать вложение" }).first().click();
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(0);
  });

  test("uses tap mode switch and swipe-up lock on mobile", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "Touch recorder gestures are covered in mobile projects");
    const credentials = loadQaCredentials();
    test.skip(!credentials, "QA credentials are not configured in env or ~/.kub-messenger-qa.env");

    await gotoOrSkip(page, "/");
    await loginIfNeeded(page, credentials);
    await openAnyChat(page);

    const recorder = page.getByTestId("composer-recorder-button");
    await expect(recorder).toHaveAttribute("data-recorder-mode", "voice");
    await recorder.tap();
    await expect(recorder).toHaveAttribute("data-recorder-mode", "video");
    await expect(page.getByTestId("video-message-recorder-modal")).toHaveCount(0);
    await recorder.tap();
    await expect(recorder).toHaveAttribute("data-recorder-mode", "voice");

    const box = await recorder.boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await recorder.dispatchEvent("pointerdown", {
      pointerId: 41,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
    });
    await page.waitForTimeout(520);
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Проведите вверх");
    await recorder.dispatchEvent("pointermove", {
      pointerId: 41,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y - 96,
    });
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Запись зафиксирована");
    await recorder.dispatchEvent("pointerup", {
      pointerId: 41,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: x,
      clientY: y - 96,
    });
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Запись зафиксирована");

    await page.waitForTimeout(1_200);
    await page.getByTestId("composer-locked-recording-stop").click();
    await expect(page.getByTestId("staged-attachment-tray").getByText("Голосовое")).toBeVisible();

    await page.getByRole("button", { name: "Убрать вложение" }).first().click();
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(0);
  });

  test("does not toggle mode on mobile long press or moved tap", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "Touch recorder gestures are covered in mobile projects");
    const credentials = loadQaCredentials();
    test.skip(!credentials, "QA credentials are not configured in env or ~/.kub-messenger-qa.env");

    await gotoOrSkip(page, "/");
    await loginIfNeeded(page, credentials);
    await openAnyChat(page);

    const recorder = page.getByTestId("composer-recorder-button");
    await expect(recorder).toHaveAttribute("data-recorder-mode", "voice");
    const box = await recorder.boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;

    await recorder.dispatchEvent("pointerdown", {
      pointerId: 51,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
    });
    await recorder.dispatchEvent("pointermove", {
      pointerId: 51,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: x + 24,
      clientY: y + 2,
    });
    await recorder.dispatchEvent("pointerup", {
      pointerId: 51,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: x + 24,
      clientY: y + 2,
    });
    await expect(recorder).toHaveAttribute("data-recorder-mode", "voice");

    await recorder.dispatchEvent("pointerdown", {
      pointerId: 52,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
    });
    await page.waitForTimeout(360);
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Проведите вверх");
    await expect(recorder).toHaveAttribute("data-recorder-mode", "voice");
    await page.waitForTimeout(1_100);
    await recorder.dispatchEvent("pointerup", {
      pointerId: 52,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: x,
      clientY: y,
    });
    await expect(page.getByTestId("staged-attachment-tray").getByText("Голосовое")).toBeVisible();

    await page.getByRole("button", { name: "Убрать вложение" }).first().click();
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(0);
  });

  test("shows a friendly state when regular video recording is unavailable", async ({ page }) => {
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

    const modal = page.getByTestId("regular-video-recorder-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByText("Видео не поддерживается этим браузером.").first()).toBeVisible();
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
