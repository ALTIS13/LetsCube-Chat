import { expect, test, type Page } from "@playwright/test";

test.use({ screenshot: "off", trace: "off", video: "off", serviceWorkers: "block" });

const FIXTURE = {
  currentUser: { name: "Тестовый участник", username: "recording_qa" },
  activeChat: { name: "Проверка записи", memberCount: 2 },
  chats: [{ name: "Проверка записи", preview: "Тестовое сообщение", time: "09:00", unread: 0 }],
  messages: [{ sender: "Другой участник", text: "Тестовое сообщение", time: "09:00", own: false }],
};

async function openRecordingFixture(page: Page, theme: "dark" | "light") {
  expect(process.env.KUB_QA_ALLOW_MUTATIONS).toBe("0");
  const origin = new URL(process.env.KUB_BASE_URL ?? "http://127.0.0.1:5173").origin;
  expect(new URL(origin).hostname).toBe("127.0.0.1");
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.origin === "http://127.0.0.1:54321") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return route.abort();
  });
  await page.addInitScript(({ fixture, theme }) => {
    const wire = window as unknown as Record<string, unknown>;
    wire.__letscubePublicPreviewFixture = fixture;
    localStorage.setItem("kub-theme", theme);
    const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
    const stops: Record<number, number> = {};
    const pendingStops: (() => void)[] = [];
    let delayStop = false;
    let calls = 0;
    const getUserMedia = () => new Promise((resolve, reject) => {
      calls++;
      pending.set(calls, { resolve, reject });
    });
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
    }
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: getUserMedia });
    class Recorder {
      static isTypeSupported() { return true; }
      state = "inactive";
      mimeType = "audio/webm";
      onstop: (() => void) | null = null;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        const finish = () => {
          this.ondataavailable?.({ data: new Blob(["fixture"], { type: this.mimeType }) });
          this.onstop?.();
        };
        if (delayStop) pendingStops.push(finish);
        else finish();
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Recorder });
    wire.__recordingQa = {
      calls: () => calls,
      stops: (id: number) => stops[id] ?? 0,
      stopPending: () => pendingStops.length,
      delayStops() { delayStop = true; },
      releaseStops() {
        delayStop = false;
        for (const finish of pendingStops.splice(0)) finish();
      },
      resolve(id: number) {
        const entry = pending.get(id);
        if (!entry) throw Error("missing synthetic microphone request");
        pending.delete(id);
        const track = { kind: "audio", stop: () => { stops[id] = (stops[id] ?? 0) + 1; } };
        entry.resolve({ getTracks: () => [track], getAudioTracks: () => [track] });
      },
      reject(id: number) {
        const entry = pending.get(id);
        if (!entry) throw Error("missing synthetic microphone request");
        pending.delete(id);
        const error = new Error("synthetic expired constraints");
        error.name = "OverconstrainedError";
        entry.reject(error);
      },
    };
  }, { fixture: FIXTURE, theme });
  await page.goto("/__qa/public-preview", { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => typeof (window as unknown as Record<string, unknown>).__recordingQa)).toBe("object");
  await expect(page.locator('[data-public-preview-ready="true"]')).toBeVisible();
  await expect(page.getByTestId("composer-recorder-button")).toBeVisible();
}

async function hold(page: Page, expectedCalls: number) {
  const button = await page.getByTestId("composer-recorder-button").boundingBox();
  expect(button).not.toBeNull();
  await page.mouse.move(button!.x + button!.width / 2, button!.y + button!.height / 2);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __recordingQa: { calls(): number } }).__recordingQa.calls(),
  )).toBe(expectedCalls);
  await expect(page.getByTestId("composer-recording-cancel")).toBeVisible();
}

async function cancelHeldRecording(page: Page) {
  const cancel = await page.getByTestId("composer-recording-cancel").boundingBox();
  expect(cancel).not.toBeNull();
  await page.mouse.move(cancel!.x + cancel!.width / 2, cancel!.y + cancel!.height / 2);
  await page.mouse.up();
  await expect(page.getByTestId("composer-recording-state")).toHaveCount(0);
}

for (const width of [1440, 390]) for (const theme of ["dark", "light"] as const) {
  test(`retired acquisition cannot hide a replacement hold ${width} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openRecordingFixture(page, theme);
    await hold(page, 1);
    await cancelHeldRecording(page);
    await hold(page, 2);
    await page.evaluate(() => (window as unknown as { __recordingQa: { resolve(id: number): void } }).__recordingQa.resolve(1));
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __recordingQa: { stops(id: number): number } }).__recordingQa.stops(1),
    )).toBeGreaterThan(0);
    await expect(page.getByTestId("composer-recording-state")).toHaveCount(1);
    await expect(page.getByTestId("composer-recording-cancel")).toBeVisible();
    await page.evaluate(() => (window as unknown as { __recordingQa: { resolve(id: number): void } }).__recordingQa.resolve(2));
    await expect(page.getByTestId("composer-recording-state")).toHaveCount(1);
    await page.screenshot({ path: info.outputPath("replacement-hold.png") });
    await cancelHeldRecording(page);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __recordingQa: { stops(id: number): number } }).__recordingQa.stops(2),
    )).toBeGreaterThan(0);
  });
}

test("cancelled constraint failure cannot request a fallback microphone", async ({ page }) => {
  await openRecordingFixture(page, "dark");
  await hold(page, 1);
  await cancelHeldRecording(page);
  const calls = await page.evaluate(async () => {
    const qa = (window as unknown as { __recordingQa: { reject(id: number): void; calls(): number } }).__recordingQa;
    qa.reject(1);
    await new Promise(resolve => setTimeout(resolve, 50));
    return qa.calls();
  });
  expect(calls).toBe(1);
  await expect(page.getByTestId("composer-recording-state")).toHaveCount(0);
});

test("a normal stop keeps its ownership until the recorder settles", async ({ page }) => {
  await openRecordingFixture(page, "dark");
  await hold(page, 1);
  await page.evaluate(() => {
    const qa = (window as unknown as { __recordingQa: { resolve(id: number): void; delayStops(): void } }).__recordingQa;
    qa.resolve(1);
    qa.delayStops();
  });
  await page.waitForTimeout(1200);
  await page.mouse.up();
  await expect(page.getByTestId("composer-recording-state")).toHaveCount(0);
  const button = await page.getByTestId("composer-recorder-button").boundingBox();
  expect(button).not.toBeNull();
  await page.mouse.move(button!.x + button!.width / 2, button!.y + button!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await expect(page.getByTestId("composer-recording-state")).toHaveCount(0);
  expect(await page.evaluate(() =>
    (window as unknown as { __recordingQa: { calls(): number } }).__recordingQa.calls(),
  )).toBe(1);
  await page.mouse.up();
  await page.evaluate(() =>
    (window as unknown as { __recordingQa: { releaseStops(): void } }).__recordingQa.releaseStops(),
  );
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __recordingQa: { stops(id: number): number } }).__recordingQa.stops(1),
  )).toBeGreaterThan(0);
  await hold(page, 2);
  await page.evaluate(() =>
    (window as unknown as { __recordingQa: { resolve(id: number): void } }).__recordingQa.resolve(2),
  );
  await cancelHeldRecording(page);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __recordingQa: { stops(id: number): number } }).__recordingQa.stops(2),
  )).toBeGreaterThan(0);
});

test("Send during a delayed Pause does not restore the already-sent preview", async ({ page }) => {
  await openRecordingFixture(page, "dark");
  await hold(page, 1);
  await page.evaluate(() => {
    const qa = (window as unknown as { __recordingQa: { resolve(id: number): void; delayStops(): void } }).__recordingQa;
    qa.resolve(1);
    qa.delayStops();
  });
  await page.waitForTimeout(1200);
  const button = await page.getByTestId("composer-recorder-button").boundingBox();
  expect(button).not.toBeNull();
  await page.mouse.move(button!.x + button!.width / 2, button!.y + button!.height / 2 - 96);
  await expect(page.getByTestId("composer-recording-lock-indicator")).toHaveAttribute("data-recording-phase", "locked");
  await page.mouse.up();
  await page.getByTestId("composer-locked-recording-stop").click();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __recordingQa: { stopPending(): number } }).__recordingQa.stopPending(),
  )).toBe(1);
  await page.getByTestId("composer-recording-send").click();
  await expect(page.getByTestId("composer-recording-state")).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { __recordingQa: { releaseStops(): void } }).__recordingQa.releaseStops(),
  );
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __recordingQa: { stops(id: number): number } }).__recordingQa.stops(1),
  )).toBeGreaterThan(0);
  await expect(page.getByTestId("composer-recording-state")).toHaveCount(0);
  await expect(page.getByTestId("composer-recording-trash")).toHaveCount(0);
});
