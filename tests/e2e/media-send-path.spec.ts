import { createHash } from "node:crypto";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import sharp from "sharp";

/**
 * How photos and videos leave the composer, in the browser (D-113, D-114).
 *
 * Testers, 2026-09-11: a video did not send, a 300 KB photo took forever, and
 * nothing on the screen said why. The send went one attachment at a time and
 * stopped at the first failure; its error lost the server's status; a small
 * upload's bar sat at «0%» until it was over; and every message waited for an
 * update of the chat that nothing needed first.
 *
 * What is pinned here, on each shape: a refused attachment does not strand the
 * ones after it and keeps its reason — naming the file, never guessing a limit
 * — and «Повторить»; uploads run side by side while the messages still arrive
 * in pick order, with rising `client_sent_at`; a small upload's bar claims no
 * number; and a chat update that never answers holds nothing.
 *
 * And the iPhone photo path, with the canvas answering a request for WebP with
 * a PNG, as WebKit on Apple platforms does: a compressed photo goes as a JPEG
 * named and typed as one, an original's preview is a JPEG at its own address,
 * a small JPEG that needs no resize goes as picked with no encode, and a HEIC
 * this engine cannot decode goes as picked. The real iPhone is not here —
 * Playwright's WebKit on Windows writes WebP and decodes no HEIC.
 *
 * The decisions themselves are unit-tested in
 * `tests/unit/attachment-send-queue.test.mts`, `tests/unit/upload-failure.test.mts`
 * and `tests/unit/photo-encoding.test.mts`.
 *
 * The backend is a route mock on the fixture host, storage included, and the
 * spec refuses any other configuration and aborts every request to a host that
 * is not this machine. Start the dev server with
 * VITE_SUPABASE_URL=http://127.0.0.1:54321.
 */

const FIXTURE_HOST = "http://127.0.0.1:54321";
const USER_ID = "11111111-1111-4111-8111-1111111111e1";
const OTHER_ID = "11111111-1111-4111-8111-1111111111e2";
const CHAT_ID = "22222222-2222-4222-8222-2222222222e1";
const NOW = "2026-09-11T12:00:00.000Z";
const CHAT_NAME = "Площадка на Лесной";
const GREETING = "Пришлите фото и видео с площадки";
const PUBLIC_MEDIA = `${FIXTURE_HOST}/storage/v1/object/public/media/`;
const STORAGE_TOO_LARGE = {
  statusCode: "413",
  error: "Payload too large",
  message: "The object exceeded the maximum allowed size",
};

type PickedFile = { name: string; mimeType: string; buffer: Buffer };
type StorageAnswer = { status: number; body: unknown };
type Upload = {
  path: string;
  /** The name of the file the page handed to storage: compressed photos carry their encoder's extension. */
  name: string;
  type: string;
  size: number;
  arrivedAt: number;
  answeredAt: number | null;
};
type Backend = {
  uploads: Upload[];
  /** What storage kept, by object path, for uploads the page kept the bytes of. */
  stored: Map<string, { type: string; bytes: Buffer }>;
  inserts: Array<Record<string, unknown>>;
  insertedAt: number[];
  chatUpdates: number;
  /** How storage answers an upload: null is the default success. */
  answer: (upload: Upload) => StorageAnswer | null | Promise<StorageAnswer | null>;
  holdChatUpdates: boolean;
  release: () => Promise<void>;
};

test.describe("the send path of photos and videos", () => {
  test.beforeEach(async ({ page, request }) => {
    const client = await request
      .get("/src/lib/supabase/client.ts")
      .then((response) => response.text())
      .catch(() => "");
    if (!client.includes(FIXTURE_HOST)) {
      throw new Error(
        `This spec mocks the backend at ${FIXTURE_HOST}. Start the dev server with VITE_SUPABASE_URL=${FIXTURE_HOST} and VITE_SUPABASE_ANON_KEY=playwright-public-fixture; it will not run against any other configuration.`,
      );
    }
    // Only the network: WebKit routes a `blob:` load as well, and a picked photo is decoded from one.
    await page.route(
      (url) => (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "127.0.0.1" && url.hostname !== "localhost",
      (route) => route.abort("blockedbyclient"),
    );
    await installErrorWatch(page);
    await installSession(page);
    await installUploadProbe(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    const errors = await page
      .evaluate(() => (window as unknown as { __pageErrors?: string[] }).__pageErrors ?? [])
      .catch(() => [] as string[]);
    if (errors.length) testInfo.annotations.push({ type: "page errors", description: errors.join(" | ") });
    expect(errors.filter((error) => !isResizeObserverLoop(error)), "the page raised no error while sending").toEqual([]);
  });

  test("a refused video does not strand the photo picked after it, and says why, naming the file", async ({ page }) => {
    const backend = await installBackend(page);
    let refuse = true;
    backend.answer = (upload) => (refuse && upload.name === "clip.mp4" ? { status: 413, body: STORAGE_TOO_LARGE } : null);
    await openChat(page);

    await pickPhotosOrVideos(page, [fakeVideo("clip.mp4"), await testPhoto("facade.png", 30)]);
    await sendPicked(page, 2);

    // Before, the loop returned at the refusal and the photo stayed «Готово к отправке».
    await expect.poll(() => backend.inserts.length).toBe(1);
    expect(uploadOf(backend, backend.inserts[0])?.name).toMatch(/^facade-image[.]/);

    const tile = page.getByTestId("staged-attachment-item").filter({ hasText: "clip.mp4" });
    await expect(tile).toHaveCount(1);
    // The file, what the server said, and no limit it did not state: a 413 used
    // to read «Максимум 250 МБ», the client's own limit.
    await expect(tile).toContainText("clip.mp4 — файл больше, чем принимает сервер.");
    await expect(tile).not.toContainText("МБ после");
    expect(await tile.innerText()).not.toMatch(/250|Максимум/);
    await expect(tile.getByRole("button", { name: "Повторить отправку" })).toBeVisible();
    // The tile's one line is beside the size and shows next to nothing of a
    // sentence, so the reason is said where it can be read as well.
    const notice = page.getByRole("alert").filter({ hasText: "Вложение не отправлено" });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("clip.mp4");

    refuse = false;
    await tile.getByRole("button", { name: "Повторить отправку" }).click();
    await expect.poll(() => backend.inserts.length).toBe(2);
    expect(uploadOf(backend, backend.inserts[1])?.name).toBe("clip.mp4");
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(0);
  });

  test("uploads run side by side, and the messages arrive in the order the files were picked", async ({ page }) => {
    const backend = await installBackend(page);
    let sideBySide = false;
    backend.answer = async (upload) => {
      if (!upload.name.startsWith("first")) return null;
      // Held until the two picked after it have reached storage as well, which
      // one upload at a time never lets happen, and then a little longer, so
      // that they are done before it is.
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && backend.uploads.length < 3) await delay(50);
      sideBySide = backend.uploads.length >= 3;
      await delay(800);
      return null;
    };
    await openChat(page);

    const picked = [await testPhoto("first.png", 10), await testPhoto("second.png", 130), await testPhoto("third.png", 250)];
    await pickPhotosOrVideos(page, picked);
    await sendPicked(page, 3);

    await expect.poll(() => backend.inserts.length, { timeout: 30_000 }).toBe(3);
    expect(sideBySide, "the second and the third upload started while the first was still going").toBe(true);
    expect(backend.inserts.map((row) => uploadOf(backend, row)?.name.split("-")[0])).toEqual(["first", "second", "third"]);

    const sentAt = backend.inserts.map((row) => Date.parse(String(row.client_sent_at)));
    expect(sentAt[0], "client_sent_at rises in pick order").toBeLessThan(sentAt[1]);
    expect(sentAt[1]).toBeLessThan(sentAt[2]);
    const first = backend.uploads.find((upload) => upload.name.startsWith("first"));
    expect(first?.answeredAt, "the first upload was answered").toBeTruthy();
    expect(backend.insertedAt[1], "nothing picked later was inserted before the first").toBeGreaterThanOrEqual(first?.answeredAt ?? Infinity);

    // And the conversation draws them in that order.
    await expect
      .poll(() => conversationPhotoPaths(page))
      .toEqual(backend.inserts.map((row) => String(row.media_path)));
  });

  test("a small upload shows a working bar and never a frozen «0%»", async ({ page }) => {
    const backend = await installBackend(page);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    backend.answer = async () => {
      await held;
      return null;
    };
    await openChat(page);

    await pickPhotosOrVideos(page, [await testPhoto("porch.png", 200)]);
    await sendPicked(page, 1);
    await expect.poll(() => backend.uploads.length).toBe(1);

    const tile = page.getByTestId("staged-attachment-item");
    const bar = tile.getByTestId("staged-attachment-upload-progress");
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("role", "progressbar");
    await expect(bar, "a multipart upload reports no bytes, so no number is claimed").not.toHaveAttribute("aria-valuenow");
    await expect(tile).not.toContainText("%");

    release();
    await expect.poll(() => backend.inserts.length).toBe(1);
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(0);
  });

  test("an update of the chat that never answers does not hold the send", async ({ page }) => {
    const backend = await installBackend(page);
    backend.holdChatUpdates = true;
    await openChat(page);

    await pickPhotosOrVideos(page, [await testPhoto("left.png", 40), await testPhoto("right.png", 160)]);
    await sendPicked(page, 2);

    // Before, each confirmed message awaited this update, so the first held the second.
    await expect.poll(() => backend.inserts.length).toBe(2);
    await expect.poll(() => backend.chatUpdates, "the update is still sent").toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(0);
    await backend.release();
  });

  test("where the canvas cannot write WebP, a photo goes as a JPEG, named and typed as one", async ({ page }) => {
    await answerWebpWithPng(page);
    const backend = await installBackend(page);
    await openChat(page);

    const facade = await testPhoto("facade.png", 30);
    await pickPhotosOrVideos(page, [facade]);
    await sendPicked(page, 1);
    await expect.poll(() => backend.inserts.length).toBe(1);

    // Before, these were PNG bytes typed image/webp under «facade-image.webp».
    expect(backend.uploads.map(({ name, type }) => ({ name, type }))).toEqual([{ name: "facade-image.jpg", type: "image/jpeg" }]);
    const [upload] = backend.uploads;
    expect(upload.path.endsWith(".jpg"), upload.path).toBe(true);
    const stored = backend.stored.get(upload.path);
    expect(stored, "storage kept the upload").toBeTruthy();
    const picture = await sharp(stored?.bytes).metadata();
    expect({ format: picture.format, width: picture.width, height: picture.height }).toEqual({ format: "jpeg", width: 1600, height: 1200 });
    expect(backend.inserts[0]).toMatchObject({
      type: "image",
      media_path: upload.path,
      media_metadata: { mime_type: "image/jpeg", optimized: true, uncompressed: false, width: 1600, height: 1200, original_mime_type: "image/png" },
    });
  });

  test("where the canvas cannot write WebP, an original's preview is a JPEG at its own address", async ({ page }) => {
    await answerWebpWithPng(page);
    const backend = await installBackend(page);
    await openChat(page);

    const facade = await testPhoto("facade.png", 205, 2400, 1800);
    await pickFiles(page, [facade]);
    await sendPickedFiles(page, 1);
    await expect.poll(() => backend.inserts.length).toBe(1);

    const original = backend.uploads.find((upload) => upload.name === "facade.png");
    expect(original, `uploads: ${backend.uploads.map((upload) => upload.name).join(", ")}`).toBeTruthy();
    const previewPath = `${original?.path.slice(0, original.path.lastIndexOf("."))}.preview.jpg`;
    const preview = backend.uploads.find((upload) => upload.path === previewPath);
    expect(preview, `no JPEG preview beside ${original?.path}`).toMatchObject({ name: "facade-preview.jpg", type: "image/jpeg" });
    const picture = await sharp(backend.stored.get(previewPath)?.bytes).metadata();
    expect({ format: picture.format, width: picture.width, height: picture.height }).toEqual({ format: "jpeg", width: 1280, height: 960 });
    expect(backend.inserts[0]).toMatchObject({
      media_path: original?.path,
      media_metadata: {
        uncompressed: true,
        mime_type: "image/png",
        preview: { path: previewPath, width: 1280, height: 960, mime_type: "image/jpeg", size_bytes: preview?.size },
      },
    });
    await expect(
      page.locator('[data-message-bubble="true"] button[aria-label="Открыть фото"] img').last(),
      "the conversation draws the JPEG preview",
    ).toHaveAttribute("src", `${PUBLIC_MEDIA}${previewPath}`);
  });

  test("where the canvas writes only JPEG, a small JPEG that needs no resize goes as picked, with no encode", async ({ page }) => {
    await answerWebpWithPng(page);
    const backend = await installBackend(page);
    await openChat(page);

    const site = await smallJpeg("site.jpg");
    await pickPhotosOrVideos(page, [site]);
    await sendPicked(page, 1);
    await expect.poll(() => backend.inserts.length).toBe(1);

    const [upload] = backend.uploads;
    expect({ name: upload.name, type: upload.type, size: upload.size }).toEqual({ name: "site.jpg", type: "image/jpeg", size: site.buffer.length });
    expect(sha256(backend.stored.get(upload.path)?.bytes ?? Buffer.alloc(0)), "the picked bytes, not a second generation").toBe(sha256(site.buffer));
    expect(await photoEncodes(page), "no photo was drawn to a canvas and encoded").toBe(0);
    expect(backend.inserts[0]).toMatchObject({
      media_metadata: { mime_type: "image/jpeg", optimized: false, uncompressed: false, width: 1280, height: 960 },
    });
  });

  test("a tall screenshot keeps 1080 px across instead of coming out 886 wide", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);

    await pickPhotosOrVideos(page, [await tallScreenshot("screenshot.png")]);
    await sendPicked(page, 1);
    await expect.poll(() => backend.inserts.length).toBe(1);

    const [upload] = backend.uploads;
    const picture = await sharp(backend.stored.get(upload.path)?.bytes).metadata();
    expect({ width: picture.width, height: picture.height }, "1290x2796 used to come out 886x1920").toEqual({ width: 1080, height: 2341 });
    expect(backend.inserts[0]).toMatchObject({ media_metadata: { optimized: true, uncompressed: false, width: 1080, height: 2341 } });
  });

  test("where the canvas cannot write WebP, a tall screenshot goes as a 1080x2341 JPEG", async ({ page }) => {
    await answerWebpWithPng(page);
    const backend = await installBackend(page);
    await openChat(page);

    await pickPhotosOrVideos(page, [await tallScreenshot("screenshot.png")]);
    await sendPicked(page, 1);
    await expect.poll(() => backend.inserts.length).toBe(1);

    // Before, an iPhone sent this PNG as picked, or a PNG of 886x1920 labelled WebP.
    const [upload] = backend.uploads;
    expect({ name: upload.name, type: upload.type }).toEqual({ name: "screenshot-image.jpg", type: "image/jpeg" });
    const picture = await sharp(backend.stored.get(upload.path)?.bytes).metadata();
    expect({ format: picture.format, width: picture.width, height: picture.height }).toEqual({ format: "jpeg", width: 1080, height: 2341 });
    expect(backend.inserts[0]).toMatchObject({ media_metadata: { mime_type: "image/jpeg", width: 1080, height: 2341 } });
  });

  test("a HEIC this engine cannot decode goes as it was picked", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);

    // Safari decodes HEIC and sends it through the canvas; Chromium and
    // Playwright's WebKit cannot, and keep what happened before.
    const heic = fakeHeic("IMG_0042.HEIC");
    await pickPhotosOrVideos(page, [heic]);
    await sendPicked(page, 1);
    await expect.poll(() => backend.inserts.length).toBe(1);

    const [upload] = backend.uploads;
    expect({ name: upload.name, type: upload.type, size: upload.size }).toEqual({ name: "IMG_0042.HEIC", type: "image/heic", size: heic.buffer.length });
    expect(upload.path.endsWith(".heic"), upload.path).toBe(true);
    expect(backend.inserts[0]).toMatchObject({ media_metadata: { mime_type: "image/heic", optimized: false, width: null, height: null } });
  });
});

// ── the flows ────────────────────────────────────────────────────────────────

async function openChat(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.getByTestId("chat-list-item").filter({ hasText: CHAT_NAME });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('[data-message-bubble="true"]').filter({ hasText: GREETING })).toBeVisible();
}

/** «Прикрепить» opens the attach sheet, on every shell and with nothing to switch on (D-122). */
async function openAttachSheet(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Прикрепить" }).click();
  const sheet = page.getByTestId("attach-sheet");
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The sheet's «Галерея» → «Фото и видео»: picked into its grid, sent compressed. */
async function pickPhotosOrVideos(page: Page, files: PickedFile[]) {
  await openAttachSheet(page);
  await pickInto(page, '[data-attach-entry="library"]', files);
}

/** The sheet's «Файл» tab: originals, without compression, on every device (D-119). */
async function pickFiles(page: Page, files: PickedFile[]) {
  const sheet = await openAttachSheet(page);
  await sheet.getByRole("tab", { name: "Файл", exact: true }).click();
  await pickInto(page, '[data-attach-entry="file"]', files);
}

async function pickInto(page: Page, entry: string, files: PickedFile[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator(entry).click();
  await (await chooser).setFiles(files);
}

/**
 * The canvas as WebKit on Apple platforms has it: asked for WebP, it answers
 * with a PNG. Every photo drawn larger than the 1x1 encoder probe is counted.
 */
async function answerWebpWithPng(page: Page) {
  await page.addInitScript(() => {
    const scope = window as unknown as { __photoEncodes: number };
    scope.__photoEncodes = 0;
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, callback: BlobCallback, type?: string, quality?: number) {
      if (this.width > 1 || this.height > 1) scope.__photoEncodes += 1;
      return toBlob.call(this, callback, type === "image/webp" ? "image/png" : type, quality);
    };
  });
}

async function photoEncodes(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __photoEncodes: number }).__photoEncodes);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Sends what the sheet holds, compressed as it defaults to. One path on every
 * shell now: the desktop send dialog went with D-122, and a desktop presses the
 * same button a phone does.
 */
async function sendPicked(page: Page, count: number) {
  const sheet = page.getByTestId("attach-sheet");
  await expect(sheet.locator("[data-attach-pick]")).toHaveCount(count);
  await sheet.getByTestId("attach-send").click();
  await expect(sheet, "the sheet stayed open after its send").toHaveCount(0);
}

/** Sends what «Файл» holds: the picked bytes, with no question about compression. */
async function sendPickedFiles(page: Page, count: number) {
  const sheet = page.getByTestId("attach-sheet");
  await expect(sheet.locator("[data-attach-file-picks] [role='checkbox']")).toHaveCount(count);
  await expect(sheet.getByTestId("attach-more"), "«Файл» asked about compression").toHaveCount(0);
  await sheet.getByTestId("attach-send").click();
  await expect(sheet).toHaveCount(0);
}

function uploadOf(backend: Backend, insert: Record<string, unknown> | undefined): Upload | undefined {
  return backend.uploads.find((upload) => upload.path === insert?.media_path);
}

async function conversationPhotoPaths(page: Page): Promise<string[]> {
  const sources = await page
    .locator('[data-message-bubble="true"] button[aria-label="Открыть фото"] img')
    .evaluateAll((images) => images.map((image) => image.getAttribute("src") ?? ""));
  return sources.filter((source) => source.startsWith(PUBLIC_MEDIA)).map((source) => decodeURIComponent(source.slice(PUBLIC_MEDIA.length)));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every error the page raises, by message, for the test to judge afterwards.
 *
 * The dev server's runtime-error overlay covers the page on any window error,
 * and once, on chromium-mobile-390, it came up over the composer mid-test with
 * «(unknown runtime error)» — an error event carrying no error object, which is
 * how Chromium reports «ResizeObserver loop completed with undelivered
 * notifications». That notice is benign by the specification and exists only
 * in development tooling's eyes, so it is recorded and kept from the overlay.
 * Anything else still reaches the overlay, and fails the test by name.
 */
async function installErrorWatch(page: Page) {
  await page.addInitScript(() => {
    const errors: string[] = [];
    (window as unknown as { __pageErrors: string[] }).__pageErrors = errors;
    // Registered before any page script, so it runs before the overlay's own listener.
    window.addEventListener("error", (event) => {
      const message = event.message || String(event.error ?? "error without a message");
      errors.push(`error: ${message}`);
      if (/ResizeObserver loop/i.test(message)) event.stopImmediatePropagation();
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason as { message?: unknown } | undefined;
      errors.push(`unhandled rejection: ${String(reason?.message ?? reason)}`);
    });
  });
}

function isResizeObserverLoop(error: string): boolean {
  return /ResizeObserver loop/i.test(error);
}

// ── what the page handed to storage ─────────────────────────────────────────

/**
 * The name, type and size of each storage upload, recorded in the page before
 * it is sent. The route sees the request too, but neither engine gives an
 * intercepted request the bytes of a file-backed blob; the file part's name is
 * what tells one attachment from another. Bytes are kept below the resumable
 * threshold, so the mock can serve what was stored.
 */
async function installUploadProbe(page: Page) {
  await page.addInitScript(() => {
    const handed: Array<{ path: string; name: string; type: string; size: number; base64: string | null }> = [];
    (window as unknown as { __mediaSendProbe: typeof handed }).__mediaSendProbe = handed;
    const send = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const marker = "/storage/v1/object/media/";
      const body = init?.body;
      if (url.includes(marker) && body instanceof FormData) {
        const file = body.get("");
        if (file instanceof Blob) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const kept = bytes.length <= 6 * 1024 * 1024;
          let binary = "";
          for (let at = 0; kept && at < bytes.length; at += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
          }
          const pathname = new URL(url).pathname;
          handed.push({
            path: decodeURIComponent(pathname.slice(pathname.indexOf(marker) + marker.length)),
            name: file instanceof File ? file.name : "",
            type: file.type,
            size: bytes.length,
            base64: kept ? btoa(binary) : null,
          });
        }
      }
      return send(input, init);
    };
  });
}

async function handedUpload(page: Page, path: string) {
  try {
    return await page.evaluate(
      (objectPath) =>
        (window as unknown as { __mediaSendProbe: Array<{ path: string; name: string; type: string; size: number; base64: string | null }> })
          .__mediaSendProbe.find((upload) => upload.path === objectPath) ?? null,
      path,
    );
  } catch {
    return null;
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────────

/** A PNG, 1600x1200 unless asked, heavy enough that its compressed copy is smaller, so compression really applies. */
async function testPhoto(name: string, hue: number, width = 1600, height = 1200): Promise<PickedFile> {
  const lines = Array.from({ length: Math.ceil(width / 100) + 1 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100 + 240}" y2="${height}"/>`).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue} 55% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360} 60% 28%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="${width}" height="${height}" fill="url(#g)"/>` +
    `<g stroke="hsl(${(hue + 180) % 360} 70% 80%)" stroke-width="5" opacity="0.55">${lines}</g>` +
    `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.round(height / 4)}" fill="none" stroke="white" stroke-width="22"/>` +
    `</svg>`;
  const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 6 }).toBuffer();
  expect(buffer.length, "a test photo stays under the resumable threshold").toBeLessThan(6 * 1024 * 1024);
  return { name, mimeType: "image/png", buffer };
}

/** A 1280x960 JPEG of 2 bits per pixel or less: already as dense as the fallback encoder would write it. */
async function smallJpeg(name: string): Promise<PickedFile> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d8fb3"/><stop offset="1" stop-color="#c9a36b"/></linearGradient></defs>` +
    `<rect width="1280" height="960" fill="url(#g)"/><circle cx="640" cy="480" r="240" fill="#f4f6fa" opacity="0.6"/></svg>`;
  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  expect(buffer.length, "the fixture is within the keep rule").toBeLessThanOrEqual(1280 * 960 * 0.25);
  return { name, mimeType: "image/jpeg", buffer };
}

/**
 * A 1290x2796 PNG: an iPhone 15 Pro Max screenshot of a conversation, bubbles
 * and lines of text around a photograph, heavy enough that its compressed copy
 * is smaller.
 */
async function tallScreenshot(name: string): Promise<PickedFile> {
  const rows: string[] = [];
  for (let index = 0, y = 180; y < 2600; index += 1) {
    const own = index % 3 === 1;
    const width = 560 + ((index * 131) % 480);
    const x = own ? 1290 - width - 48 : 48;
    const lines = 1 + (index % 3);
    const height = 48 + lines * 54;
    rows.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="34" fill="${own ? "#3b5ccf" : "#ffffff"}"/>`);
    for (let line = 0; line < lines; line += 1) {
      const lineWidth = width - 72 - (((index + line) * 37) % 160);
      rows.push(`<rect x="${x + 36}" y="${y + 30 + line * 54}" width="${lineWidth}" height="26" rx="8" fill="${own ? "#dfe6fb" : "#3a4452"}"/>`);
    }
    y += height + 26;
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1290" height="2796">` +
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dfe7f2"/><stop offset="1" stop-color="#b9c8e0"/></linearGradient></defs>` +
    `<rect width="1290" height="2796" fill="url(#bg)"/>${rows.join("")}</svg>`;
  const photograph = await sharp({
    create: { width: 1100, height: 820, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 48 } },
  })
    .blur(1.2)
    .png()
    .toBuffer();
  const buffer = await sharp(Buffer.from(svg))
    .composite([{ input: photograph, left: 95, top: 1180 }])
    .png({ compressionLevel: 6 })
    .toBuffer();
  expect(buffer.length, "the screenshot stays under the resumable threshold").toBeLessThan(6 * 1024 * 1024);
  return { name, mimeType: "image/png", buffer };
}

/** Bytes typed as HEIC that neither Chromium nor Playwright's WebKit can decode. */
function fakeHeic(name: string): PickedFile {
  const buffer = Buffer.alloc(180 * 1024);
  for (let at = 0; at < buffer.length; at += 1) buffer[at] = (at * 17 + 3) % 239;
  return { name, mimeType: "image/heic", buffer };
}

/** Bytes typed as an MP4 that no engine can decode: staging reads no size from it, and it uploads as picked. */
function fakeVideo(name: string): PickedFile {
  const buffer = Buffer.alloc(256 * 1024);
  for (let at = 0; at < buffer.length; at += 1) buffer[at] = (at * 31 + 7) % 251;
  return { name, mimeType: "video/mp4", buffer };
}

// ── the backend ──────────────────────────────────────────────────────────────

async function installSession(page: Page) {
  await page.addInitScript(({ userId, now }) => {
    localStorage.setItem("kub-theme", "light");
    localStorage.setItem(
      "kub-auth",
      JSON.stringify({
        access_token: "playwright.user.jwt",
        refresh_token: "playwright-refresh",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "send-path-qa@example.invalid",
          user_metadata: { full_name: "Максим" },
          app_metadata: {},
          created_at: now,
        },
      }),
    );
  }, { userId: USER_ID, now: NOW });
}

async function installBackend(page: Page): Promise<Backend> {
  const held: Route[] = [];
  const stored = new Map<string, { type: string; bytes: Buffer }>();
  const backend: Backend = {
    uploads: [],
    stored,
    inserts: [],
    insertedAt: [],
    chatUpdates: 0,
    answer: () => null,
    holdChatUpdates: false,
    release: async () => {
      await Promise.all(held.splice(0).map((route) => route.fulfill({ status: 204 }).catch(() => undefined)));
    },
  };
  const me = profile(USER_ID, "Максим", "maksim");
  const anya = profile(OTHER_ID, "Аня", null);
  const memberships = [membership(CHAT_ID, USER_ID, "owner", me), membership(CHAT_ID, OTHER_ID, "member", anya)];
  const chats = [chat(CHAT_ID, CHAT_NAME, "2026-09-11T11:30:00.000Z", memberships)];
  const messages: Array<ReturnType<typeof message>> = [
    message("55555555-5555-4555-8555-5555555555e1", CHAT_ID, OTHER_ID, GREETING, "2026-09-11T11:30:00.000Z", anya),
  ];

  await page.route(`${FIXTURE_HOST}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const single = (request.headers().accept ?? "").includes("application/vnd.pgrst.object");
    const eq = (name: string) => {
      const filter = url.searchParams.get(name);
      return filter?.startsWith("eq.") ? filter.slice(3) : null;
    };
    const one = <T,>(rows: T[]) => (single ? rows[0] ?? null : rows);

    if (url.pathname.startsWith("/storage/v1/object/public/media/")) {
      const found = stored.get(decodeURIComponent(url.pathname.slice("/storage/v1/object/public/media/".length)));
      if (!found) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: found.type, body: found.bytes });
    }
    if (url.pathname.startsWith("/storage/v1/object/media/") && method === "POST") {
      const objectPath = decodeURIComponent(url.pathname.slice("/storage/v1/object/media/".length));
      const handed = await handedUpload(page, objectPath);
      const upload: Upload = {
        path: objectPath,
        name: handed?.name ?? "",
        type: handed?.type ?? "",
        size: handed?.size ?? 0,
        arrivedAt: Date.now(),
        answeredAt: null,
      };
      backend.uploads.push(upload);
      const answer = await backend.answer(upload);
      upload.answeredAt = Date.now();
      if (answer) return json(route, answer.body, answer.status);
      if (handed?.base64) stored.set(objectPath, { type: handed.type, bytes: Buffer.from(handed.base64, "base64") });
      return json(route, { Id: `object-${backend.uploads.length}`, Key: `media/${objectPath}` });
    }
    if (url.pathname === "/auth/v1/user") {
      return json(route, { id: USER_ID, aud: "authenticated", role: "authenticated", email: "send-path-qa@example.invalid", user_metadata: { full_name: "Максим" }, app_metadata: {}, created_at: NOW });
    }
    if (url.pathname.includes("/rest/v1/profiles")) return json(route, one([me]));
    if (url.pathname.includes("/rest/v1/chat_members")) {
      const chatId = eq("chat_id");
      const userId = eq("user_id");
      return json(route, one(memberships.filter((row) => (!chatId || row.chat_id === chatId) && (!userId || row.user_id === userId))));
    }
    if (url.pathname.endsWith("/rpc/chat_list_summaries")) {
      return json(route, { code: "PGRST202", details: null, hint: null, message: "Could not find the function public.chat_list_summaries" }, 404);
    }
    if (url.pathname.includes("/rest/v1/chats")) {
      if (method !== "GET") {
        backend.chatUpdates += 1;
        if (backend.holdChatUpdates) {
          held.push(route);
          return;
        }
        return route.fulfill({ status: 204 });
      }
      const id = eq("id");
      return json(route, one(chats.filter((row) => !id || row.id === id)));
    }
    if (url.pathname.includes("/rest/v1/media_variants")) return json(route, []);
    if (url.pathname.endsWith("/rest/v1/messages") && method === "POST") {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      backend.inserts.push(body);
      backend.insertedAt.push(Date.now());
      const row = {
        ...message(
          `55555555-5555-4555-8555-${String(5555555555 + backend.inserts.length).padStart(12, "0")}`,
          String(body.chat_id),
          USER_ID,
          String(body.content ?? ""),
          String(body.client_sent_at ?? NOW),
          me,
        ),
        type: body.type ?? "text",
        media_bucket: body.media_bucket ?? null,
        media_path: body.media_path ?? null,
        media_url: body.media_url ?? null,
        media_metadata: body.media_metadata ?? {},
        client_message_id: body.client_message_id ?? null,
        client_sent_at: body.client_sent_at ?? null,
      };
      messages.push(row);
      return json(route, row, 201);
    }
    if (url.pathname.includes("/rest/v1/messages")) {
      if (method !== "GET") return json(route, []);
      const chatId = eq("chat_id");
      const rows = messages.filter((row) => !chatId || row.chat_id === chatId);
      if ((request.headers().prefer ?? "").includes("count=exact")) {
        return json(route, [], 200, { "access-control-expose-headers": "Content-Range", "content-range": "*/0" });
      }
      const limit = Number(url.searchParams.get("limit") ?? rows.length);
      return json(route, one(rows.slice(0, Number.isFinite(limit) ? limit : rows.length)));
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(route, null);
    return json(route, single ? null : []);
  });

  return backend;
}

function profile(id: string, fullName: string, username: string | null) {
  return { id, full_name: fullName, username, avatar_url: null, bio: null, role: "user", online_at: NOW, created_at: NOW, updated_at: NOW };
}

function membership(chatId: string, userId: string, role: string, person: ReturnType<typeof profile>) {
  return {
    chat_id: chatId,
    user_id: userId,
    role,
    joined_at: "2026-09-01T09:00:00.000Z",
    last_read_at: NOW,
    last_delivered_at: NOW,
    hidden_at: null,
    cleared_at: null,
    pinned: false,
    pinned_at: null,
    pinned_order: null,
    profile: person,
  };
}

function chat(id: string, name: string, updatedAt: string, memberships: Array<ReturnType<typeof membership>>) {
  return {
    id,
    type: "group",
    name,
    description: null,
    avatar_url: null,
    created_by: USER_ID,
    created_at: "2026-09-01T09:00:00.000Z",
    updated_at: updatedAt,
    is_forum: false,
    invite_policy: "owner_admin_only",
    members: memberships.filter((row) => row.chat_id === id),
  };
}

function message(id: string, chatId: string, userId: string, content: string, createdAt: string, sender: ReturnType<typeof profile>) {
  return {
    id,
    chat_id: chatId,
    topic_id: null,
    user_id: userId,
    bot_id: null,
    sender_deleted_at: null,
    content,
    type: "text" as unknown,
    media_bucket: null as unknown,
    media_path: null as unknown,
    media_url: null as unknown,
    media_metadata: {} as unknown,
    reply_to_id: null,
    reply_to: null,
    forwarded_from_id: null,
    forwarded_from: null,
    client_message_id: null as unknown,
    client_sent_at: null as unknown,
    bot_reply_markup: null,
    pinned: false,
    created_at: createdAt,
    edited_at: null,
    deleted_at: null,
    sender,
    bot: null,
    reactions: [],
  };
}

async function json(route: Route, body: unknown, status = 200, headers?: Record<string, string>) {
  await route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) }).catch(() => undefined);
}
