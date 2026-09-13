import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * D-175: the video ladder, on a real file, in the real sheet.
 *
 * Everything here runs against a clip this spec records in the browser with
 * `MediaRecorder` — 1920x1080, about eight seconds, content a camera could
 * plausibly have produced. A fixture checked into the repository would have
 * been a few megabytes of binary; a synthetic descriptor would have proved
 * nothing, because the whole question is whether `readVideoSource` can read a
 * container the phone wrote and whether the estimate beside a rung resembles
 * the file the encoder then produces.
 *
 * Measured while this spec was written, on the same clip: the ladder offered
 * 480p and 720p, said «≈ 1,8 МБ» at 720p, and the encoder produced 1 898 279
 * bytes. Inside one per cent. That is why the number is shown at all — and the
 * «≈» is why it is shown honestly, because the same encoder asked for the same
 * bitrate over incompressible noise produced six times the estimate.
 *
 * The capture route is DEV-only and its data is fictional, which is what makes
 * it the right place for this: no production screen, no real conversation, and
 * the components are the shipping ones.
 */

const CAPTURE_PATH = "/__qa/public-preview";
const WINDOW_KEY = "__letscubePublicPreviewFixture";
const READY = "data-public-preview-ready";

const FIXTURE = {
  currentUser: { name: "Максим", username: "maksim" },
  activeChat: { name: "Команда проекта", memberCount: 4 },
  chats: [{ name: "Команда проекта", preview: "Готово", time: "09:59", unread: 0 }],
  messages: [{ sender: "Аня", text: "Скинь видео со вчера", time: "09:58", own: false }],
};

/** Long enough that the encoding takes visible seconds; short enough to record. */
const CLIP_SECONDS = 8;

let clip: Buffer | null = null;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("about:blank");
  const base64 = await page.evaluate(async (seconds) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const stream = canvas.captureStream(30);
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm", videoBitsPerSecond: 24_000_000 });
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    recorder.start();
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const t = performance.now() - started;
        const sky = ctx.createLinearGradient(0, 0, 0, 1080);
        sky.addColorStop(0, `hsl(${200 + Math.sin(t / 2000) * 20} 60% 60%)`);
        sky.addColorStop(1, `hsl(${30 + Math.sin(t / 3000) * 10} 50% 40%)`);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, 1920, 1080);
        for (let i = 0; i < 6; i += 1) {
          ctx.fillStyle = `hsl(${(i * 60 + t / 30) % 360} 70% 55%)`;
          ctx.beginPath();
          ctx.arc(300 + i * 260 + Math.sin(t / 700 + i) * 120, 540 + Math.cos(t / 900 + i) * 220, 90 + i * 8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 96px sans-serif";
        ctx.fillText(String(Math.round(t / 100) / 10), 120, 980);
        if (t >= seconds * 1000) {
          clearInterval(timer);
          resolve();
        }
      }, 33);
    });
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: "video/webm" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }, CLIP_SECONDS);
  clip = Buffer.from(base64, "base64");
  await page.close();
  // A clip the recorder never filled would make every assertion below vacuous.
  expect(clip.byteLength).toBeGreaterThan(512 * 1024);
});

/** One file per viewport: the same name under two projects overwrites one of them. */
function shotPath(info: TestInfo, name: string): string {
  return `output/${name}-${info.project.name}.png`;
}

async function openSheetWithClip(page: Page, theme: "light" | "dark" = "light") {
  // The fixture refuses a message stamped later than «now», as the sibling
  // capture specs record. Only Date is pinned; timers and performance.now keep
  // running, which the encoding below depends on.
  await page.clock.setFixedTime(new Date("2026-09-03T18:00:00"));
  await page.addInitScript(
    ([key, fixture]) => {
      (window as unknown as Record<string, unknown>)[key as string] = fixture;
    },
    [WINDOW_KEY, FIXTURE] as const,
  );
  // The theme the product itself stores, rather than the media query, because
  // that is what a person's choice sets.
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem("kub-theme", value as string);
    } catch {
      // A browser refusing storage still renders the light theme, which the
      // other tests cover.
    }
  }, theme);
  const response = await page.goto(CAPTURE_PATH, { waitUntil: "domcontentloaded" }).catch(() => null);
  const ready = response
    ? await page
        .locator(`[${READY}="true"]`)
        .waitFor({ state: "attached", timeout: 15_000 })
        .then(() => true)
        .catch(() => false)
    : false;
  if (!ready) {
    throw new Error(
      "The DEV preview capture route is not served. Start the dev server with VITE_PUBLIC_PREVIEW_FIXTURE=1.",
    );
  }

  await page.getByLabel("Прикрепить").click();
  await expect(page.getByTestId("attach-sheet")).toBeVisible();
  await page
    .locator('[data-attach-picker="library"]')
    .setInputFiles({ name: "снято-вчера.webm", mimeType: "video/webm", buffer: clip as Buffer });
  // The ladder appears only once the container has been read and the rungs
  // asked about, which is a round trip through WebCodecs.
  await expect(page.getByTestId("attach-video-quality")).toBeVisible({ timeout: 20_000 });
}

test("the ladder opens at the picture the server would have made anyway, with the weight beside it", async ({ page }, info) => {
  await openSheetWithClip(page);

  const row = page.getByTestId("attach-video-quality");
  await expect(row).toHaveAttribute("data-attach-video-stop", "720");
  await expect(row).toContainText("720p");

  // An estimate, marked as one. A number shown as a promise would be a lie for
  // any footage the encoder cannot compress.
  const estimate = page.getByTestId("attach-video-estimate");
  await expect(estimate).toContainText("≈");
  await expect(estimate).toContainText("МБ");

  await page.getByTestId("attach-sheet").screenshot({ path: shotPath(info, "ladder-720p") });
});

test("the top of the ladder is the file itself, at its exact size", async ({ page }, info) => {
  await openSheetWithClip(page);

  const slider = page.getByTestId("attach-video-quality-slider");
  await slider.focus();
  await page.keyboard.press("End");

  const row = page.getByTestId("attach-video-quality");
  await expect(row).toHaveAttribute("data-attach-video-stop", "source");
  await expect(row).toContainText("Исходное");
  // Nothing is encoded here, so nothing is estimated, and the sign is absent.
  const estimate = page.getByTestId("attach-video-estimate");
  await expect(estimate).not.toContainText("≈");

  const shown = (await estimate.innerText()).trim();
  const megabytes = (clip as Buffer).byteLength / (1024 * 1024);
  const expected = megabytes >= 10 ? String(Math.round(megabytes)) : megabytes.toFixed(1).replace(".", ",");
  expect(shown).toContain(expected);

  await page.getByTestId("attach-sheet").screenshot({ path: shotPath(info, "ladder-source") });
});

test("a rung below the file is offered, and 4K is not", async ({ page }) => {
  await openSheetWithClip(page);

  const slider = page.getByTestId("attach-video-quality-slider");
  // 480p, 720p and the file itself: three stops, because a 1080p clip has
  // nothing above it to offer and upscaling is not a quality.
  await expect(slider).toHaveAttribute("max", "2");

  await slider.focus();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("attach-video-quality")).toHaveAttribute("data-attach-video-stop", "480");
  await expect(page.getByTestId("attach-video-quality")).toContainText("480p");
});

test("the send shows the wait rather than closing on it, and cancelling keeps the selection", async ({ page }, info) => {
  await openSheetWithClip(page);

  await page.getByTestId("attach-send").click();
  const progress = page.getByTestId("attach-video-progress");
  await expect(progress).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("attach-sheet").screenshot({ path: shotPath(info, "ladder-encoding") });

  await page.getByTestId("attach-video-cancel").click();
  // Cancelling cancels the send. The sheet is still open, the clip is still
  // selected, and the ladder is back where it was.
  await expect(page.getByTestId("attach-sheet")).toBeVisible();
  await expect(page.getByTestId("attach-video-quality")).toBeVisible();
  await expect(progress).toBeHidden();
});

test("the send completes on its own and closes the sheet", async ({ page }) => {
  await openSheetWithClip(page);

  await page.getByTestId("attach-send").click();
  // The encoding runs at roughly realtime, so an eight-second clip is a few
  // seconds of waiting; the sheet closes only when it is done.
  await expect(page.getByTestId("attach-sheet")).toBeHidden({ timeout: 60_000 });
});

test("the ladder holds its own in the dark theme", async ({ page }, info) => {
  // Both themes, because the row is glass over a photograph: the material rules
  // in docs/operations/interface-material.md were written after a plate that
  // read correctly in one theme vanished into the other.
  await openSheetWithClip(page, "dark");
  await expect(page.getByTestId("attach-video-quality")).toHaveAttribute("data-attach-video-stop", "720");
  await page.getByTestId("attach-sheet").screenshot({ path: shotPath(info, "ladder-dark") });
});

test("a photograph gets no ladder, and a video gets no HD button", async ({ page }) => {
  // The two controls answer different questions and must not both appear for
  // one file. HD is what a photograph is re-encoded at (D-174); the ladder is
  // what a video is re-encoded to (D-175). A control that does nothing for the
  // file in front of a person teaches them to distrust the ones that do.
  await openSheetWithClip(page);
  await expect(page.getByTestId("attach-video-quality")).toBeVisible();
  await expect(page.getByTestId("attach-hd")).toBeHidden();

  await page.reload();
  await page.getByLabel("Прикрепить").click();
  const png = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 900;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#3b6ea5";
    ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = "#f2c14e";
    ctx.beginPath();
    ctx.arc(600, 450, 220, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page
    .locator('[data-attach-picker="library"]')
    .setInputFiles({ name: "снимок.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });

  await expect(page.getByTestId("attach-hd")).toBeVisible();
  await expect(page.getByTestId("attach-video-quality")).toBeHidden();
});
