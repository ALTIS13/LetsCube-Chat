import { expect, test } from "@playwright/test";
// Imported statically, as `resumable-media-upload.spec.ts` imports the module
// that uses it: in one worker a dynamic import of a module the loader already
// compiled for a static one fails with «exports is not defined».
import { describeUploadFailure, uploadFailureMessage } from "../../artifacts/kub/src/lib/uploadFailure";
import { gotoOrSkip, loadQaCredentials, loginIfNeeded } from "./helpers/auth";

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test.describe("KUB video recorders", () => {
  test("a refused video names the file and never guesses the server's limit", async () => {
    // The 413 copy used to read «Максимум 250 МБ» — the client's own limit —
    // whatever limit had refused the file (D-113). The limit is printed now only
    // when the server states one; `tests/unit/upload-failure.test.mts` holds the rest.
    const circle = uploadFailureMessage("Видео-сообщение", describeUploadFailure({ status: 413 }));
    expect(circle.startsWith("Видео-сообщение")).toBe(true);
    expect(circle).toContain("больше, чем принимает сервер");
    expect(circle).not.toContain("250");

    const video = uploadFailureMessage("trip.mp4", describeUploadFailure(new Error("payload too large")));
    expect(video.startsWith("trip.mp4")).toBe(true);
    expect(video).not.toContain("МБ");
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

  // Two cases that drove the rectangular recorder stood here, skipped since
  // D-122 retired «Записать видео» — the only way into it. They are gone rather
  // than skipped: `videoRecorderVariant` is set to "round" at every call site,
  // so there is nothing left for them to reach, and a permanently skipped test
  // is a reminder rather than coverage. Where a rectangular recording belongs,
  // if anywhere, is decided in D-130.

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
    // A phone's own keys set how loud it plays, so under a finger the bar has
    // no slider (D-118).
    const finger = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
    if (finger) await expect(page.getByTestId("chat-media-playback-volume")).toBeHidden();
    else await expect(page.getByTestId("chat-media-playback-volume")).toBeVisible();
    await page.getByTestId("chat-media-playback-speed").selectOption("1.5");
    await expect(page.getByTestId("chat-media-playback-speed")).toHaveValue("1.5");
    if (!finger) {
      await page.getByTestId("chat-media-playback-volume").evaluate((node) => {
        const input = node as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "0.6");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    const playbackSettings = await page.evaluate(() => {
      const raw = window.localStorage.getItem("kub.mediaPlayback.v1");
      return raw ? JSON.parse(raw) as { playbackRate?: number; volume?: number } : {};
    });
    expect(playbackSettings.playbackRate).toBe(1.5);
    // `finger` is the coarse-pointer check above; the volume is only set when
    // there is a slider, which is when the pointer is fine (D-118).
    if (!finger) expect(playbackSettings.volume).toBeCloseTo(0.6, 1);
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
    // The row says what it is doing, and «Отмена» in the middle of it says the
    // way out — the same one for a mouse and a thumb since the owner's ruling
    // of 2026-09-12 (D-130). There is no «release outside the field» left.
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Идёт запись голосового");
    await expect(page.getByTestId("composer-recording-cancel")).toBeVisible();
    await expect(page.getByTestId("composer-recording-lock-rail")).toBeVisible();
    await expect(page.getByTestId("composer-recording-lock-progress")).toHaveAttribute("data-lock-progress", /0\.\d+|1/);
    await page.mouse.move(box!.x + box!.width / 2, box!.y - 96, { steps: 4 });
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Запись закреплена");
    await page.mouse.up();
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Запись закреплена");

    await page.waitForTimeout(1_200);
    // The stop no longer means «put it in the tray»: it ends the recording so it
    // can be heard first, which is the only preview there is now (D-130, R5).
    await page.getByTestId("composer-locked-recording-stop").click();
    await expect(page.getByTestId("composer-recording-preview")).toBeVisible();
    await expect(page.getByTestId("composer-recording-preview-toggle")).toBeVisible();
    // And nothing has been staged or sent by any of it.
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(0);

    await page.getByTestId("composer-recording-cancel").click();
    await expect(page.getByTestId("composer-recording-lock-indicator")).toHaveCount(0);
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
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Запись закреплена");
    await page.mouse.up();

    const switchCamera = page.getByTestId("video-recorder-switch-camera");
    await expect(switchCamera).toHaveAttribute("data-switch-placement", "outside-preview");
    await switchCamera.click();
    await expect(modal).toHaveAttribute("data-facing-mode", "environment");
    await page.waitForTimeout(1_200);
    // A round video's stop ends and sends it now (D-130, R6), and this spec runs
    // against a real account, so it must not. The lock and the camera switch are
    // what it is here to prove; the recording is thrown away instead.
    await page.getByTestId("composer-recording-cancel").click();

    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId("composer-recording-lock-indicator")).toHaveCount(0);
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
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Идёт запись голосового");
    await recorder.dispatchEvent("pointermove", {
      pointerId: 41,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y - 96,
    });
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Запись закреплена");
    await recorder.dispatchEvent("pointerup", {
      pointerId: 41,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: x,
      clientY: y - 96,
    });
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Запись закреплена");

    await page.waitForTimeout(1_200);
    // As above: the stop ends the recording for a listen, and the delete beside
    // it is what leaves without sending.
    await page.getByTestId("composer-locked-recording-stop").click();
    await expect(page.getByTestId("composer-recording-preview")).toBeVisible();
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(0);

    await page.getByTestId("composer-recording-cancel").click();
    await expect(page.getByTestId("composer-recording-lock-indicator")).toHaveCount(0);
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
    await expect(page.getByTestId("composer-recording-lock-indicator")).toContainText("Идёт запись голосового");
    await expect(recorder).toHaveAttribute("data-recorder-mode", "voice");
    await page.waitForTimeout(1_100);
    // Releasing sends now (D-130, R6) and this spec signs in to a real account,
    // so the recording leaves the way a person's own slip leaves: the thumb
    // slides onto «Отмена» in the middle of the row and lets go there. Nothing
    // is discarded on the way — the button arms, and the release acts.
    const cancel = page.getByTestId("composer-recording-cancel");
    const cancelBox = await cancel.boundingBox();
    expect(cancelBox).not.toBeNull();
    const cancelX = cancelBox!.x + cancelBox!.width / 2;
    const cancelY = cancelBox!.y + cancelBox!.height / 2;
    await recorder.dispatchEvent("pointermove", {
      pointerId: 52,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: cancelX,
      clientY: cancelY,
    });
    await expect(page.getByTestId("composer-recording-lock-indicator")).toHaveAttribute("data-cancel-armed", "true");
    await recorder.dispatchEvent("pointerup", {
      pointerId: 52,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: cancelX,
      clientY: cancelY,
    });
    await expect(page.getByTestId("composer-recording-lock-indicator")).toHaveCount(0);
    await expect(recorder).toHaveAttribute("data-recorder-mode", "voice");
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(0);
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
