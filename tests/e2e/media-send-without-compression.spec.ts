import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import sharp from "sharp";

/**
 * Testers' complaint 2: «фото и видео отправляются только сжатыми».
 *
 * Approved by the owner, as in Telegram: compressed stays the default and no
 * quality is asked for (D-119). «Файл» in the attach menu sends as it is on
 * every device and says «Без сжатия»; on a desktop «Фото или видео» lists the
 * files in a send dialog with «Сжать изображение», checked by default. An
 * original goes as it is — the bytes that were picked are the bytes
 * that are stored, except that a JPEG loses the place it was taken — with a
 * light preview beside it for the conversation, and the viewer opens the
 * original. An original over 50 MB is refused before any upload starts, with a
 * message that says what to do.
 *
 * What is pinned, on each shape: the choice is offered where it was approved;
 * an original's stored bytes hash to the picked file; its preview and its
 * metadata are what the bubble and the viewer read; the default still
 * compresses; and the limit stops the send. The decisions themselves are
 * unit-tested in `tests/unit/media-compression.test.mts`.
 *
 * The backend is a route mock on the fixture host — storage included, so an
 * upload is answered here and its body inspected — and the spec refuses any
 * other configuration and aborts every request to a host that is not this
 * machine. Start the dev server with VITE_SUPABASE_URL=http://127.0.0.1:54321.
 */

const FIXTURE_HOST = "http://127.0.0.1:54321";
const USER_ID = "11111111-1111-4111-8111-1111111111c1";
const OTHER_ID = "11111111-1111-4111-8111-1111111111c2";
const CHAT_ID = "22222222-2222-4222-8222-2222222222c1";
const NOW = "2026-09-03T12:00:00.000Z";
const CHAT_NAME = "Фото с объекта";
const GREETING = "Пришлите фасад без сжатия, пожалуйста";
const LIMIT = 50 * 1024 * 1024;
const PUBLIC_MEDIA = `${FIXTURE_HOST}/storage/v1/object/public/media/`;

type Upload = { path: string; contentType: string; bytes: Buffer };
type Backend = { uploads: Upload[]; inserts: Array<Record<string, unknown>> };
type PickedFile = { name: string; mimeType: string; buffer: Buffer };

test.describe("sending photos without compression", () => {
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
    // Only the network. WebKit routes a `blob:` load as well, and with the load
    // that decodes a picked photo aborted, staging never finished on it.
    await page.route(
      (url) => (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "127.0.0.1" && url.hostname !== "localhost",
      (route) => route.abort("blockedbyclient"),
    );
    await installSession(page);
    await installUploadProbe(page);
  });

  test("a phone sends the original through «Файл», which says it goes without compression", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);
    test.skip(!(await isCoarsePointer(page)), "the attach menu choice is the phone's shape");

    await page.getByRole("button", { name: "Прикрепить" }).click();
    const menu = await attachMenuLabels(page);
    // No quality is asked for and no second gallery item offered: «Файл» is the
    // function, as in Telegram, and it says what it does (D-119).
    expect(menu, `the menu reads ${JSON.stringify(menu)}`).not.toContain("Без сжатия");
    expect(menu, `the menu reads ${JSON.stringify(menu)}`).toContain("Файл Без сжатия");
    await expect(
      page.getByRole("button", { name: "Файл", exact: true }),
      "the hint describes the item; it does not rename it",
    ).toHaveAccessibleDescription("Без сжатия");

    const facade = await testPhoto("facade.png", 205);
    await chooseFromMenu(page, "Файл", [facade]);
    const staged = page.getByTestId("staged-attachment-item");
    await expect(staged).toHaveCount(1);
    await expect(staged).toContainText("без сжатия");
    await page.getByRole("button", { name: "Отправить" }).click();

    await expect.poll(() => backend.inserts.length).toBe(1);
    const original = await expectOriginalUpload(page, backend, facade);
    const preview = await expectPreviewUpload(backend, original.path, { width: 1280, height: 960 });
    expect(backend.inserts[0]).toMatchObject({
      type: "image",
      media_bucket: "media",
      media_path: original.path,
      media_metadata: {
        kind: "image",
        uncompressed: true,
        optimized: false,
        mime_type: "image/png",
        size_bytes: facade.buffer.length,
        original_size_bytes: facade.buffer.length,
        width: 2400,
        height: 1800,
        preview: { path: preview.path, width: 1280, height: 960, mime_type: "image/webp", size_bytes: preview.bytes.length },
      },
    });

    const bubble = sentPhotoBubble(page);
    await expect(bubble.getByText("Оригинал", { exact: true })).toBeVisible();
    await expect(bubble.locator("img").first(), "the conversation draws the preview, not the original").toHaveAttribute(
      "src",
      `${PUBLIC_MEDIA}${preview.path}`,
    );
    await expectViewerServesOriginal(page, bubble, original.path, 2400);
  });

  test("a phone's gallery choice still compresses, and says so in the metadata", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);
    test.skip(!(await isCoarsePointer(page)), "the attach menu choice is the phone's shape");

    const facade = await testPhoto("facade.png", 30);
    await page.getByRole("button", { name: "Прикрепить" }).click();
    await chooseFromMenu(page, "Фото или видео", [facade]);
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(1);
    await page.getByRole("button", { name: "Отправить" }).click();

    await expect.poll(() => backend.inserts.length).toBe(1);
    await expectCompressedUpload(page, backend, facade);
    expect(backend.inserts[0]).toMatchObject({
      type: "image",
      media_metadata: { uncompressed: false, optimized: true, original_size_bytes: facade.buffer.length, original_mime_type: "image/png" },
    });
    expect(Object.keys(backend.inserts[0].media_metadata as object)).not.toContain("preview");
  });

  test("a phone refuses an original over 50 MB before any upload, and says what to do", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);
    test.skip(!(await isCoarsePointer(page)), "the attach menu choice is the phone's shape");

    const panorama = oversizedFile("panorama.jpg");
    const facade = await testPhoto("facade.png", 120);
    await page.getByRole("button", { name: "Прикрепить" }).click();
    await chooseFromMenu(page, "Файл", [panorama, onDisk(facade)]);

    const alert = page.getByRole("dialog").filter({ hasText: "Файл больше 50 МБ" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("panorama.jpg");
    await expect(alert).toContainText("51 МБ");
    await expect(alert).toContainText("до 50 МБ");
    await expect(alert).toContainText("«Фото или видео»");
    await alert.getByRole("button", { name: "Понятно" }).click();

    // The rest of the pick is not held hostage by the one file.
    const staged = page.getByTestId("staged-attachment-item");
    await expect(staged).toHaveCount(1);
    await expect(staged).toContainText("facade.png");
    expect(backend.uploads, "nothing is uploaded before the person sends").toHaveLength(0);
  });

  test("a desktop lists the photos with «Сжать изображение» checked, and unchecked sends the originals", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);
    test.skip(await isCoarsePointer(page), "the send dialog is the desktop's shape");

    await page.getByRole("button", { name: "Прикрепить" }).click();
    const menu = await attachMenuLabels(page);
    expect(menu, "the menu is the same on every device (D-119)").not.toContain("Без сжатия");
    expect(menu, `the menu reads ${JSON.stringify(menu)}`).toContain("Файл Без сжатия");

    const north = await testPhoto("north.png", 205);
    const south = await testPhoto("south.png", 340);
    await chooseFromMenu(page, "Фото или видео", [north, south]);

    const dialog = sendDialog(page, "Отправить 2 фото");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("north.png");
    await expect(dialog).toContainText("south.png");
    const compress = dialog.getByRole("checkbox", { name: "Сжать изображение" });
    await expect(compress).toBeChecked();
    expect(backend.uploads, "nothing is uploaded while the dialog is open").toHaveLength(0);

    await compress.uncheck();
    await dialog.getByPlaceholder("Подпись").fill("Фасад, обе стороны");
    await dialog.getByRole("button", { name: "Отправить" }).click();
    await expect(page.getByTestId("media-send-dialog"), "sending closes the dialog").toHaveCount(0);

    await expect.poll(() => backend.inserts.length).toBe(2);
    const first = await expectOriginalUpload(page, backend, north);
    const second = await expectOriginalUpload(page, backend, south);
    await expectPreviewUpload(backend, first.path, { width: 1280, height: 960 });
    await expectPreviewUpload(backend, second.path, { width: 1280, height: 960 });
    expect(backend.inserts[0]).toMatchObject({ content: "Фасад, обе стороны", media_path: first.path, media_metadata: { uncompressed: true } });
    expect(backend.inserts[1]).toMatchObject({ content: "", media_path: second.path, media_metadata: { uncompressed: true } });

    await expectViewerServesOriginal(page, sentPhotoBubble(page, "Фасад, обе стороны"), first.path, 2400);
  });

  test("a desktop that leaves «Сжать изображение» checked sends compressed, as before", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);
    test.skip(await isCoarsePointer(page), "the send dialog is the desktop's shape");

    const north = await testPhoto("north.png", 60);
    await page.getByRole("button", { name: "Прикрепить" }).click();
    await chooseFromMenu(page, "Фото или видео", [north]);
    const dialog = sendDialog(page, "Отправить фото");
    await expect(dialog.getByRole("checkbox", { name: "Сжать изображение" })).toBeChecked();
    await dialog.getByRole("button", { name: "Отправить" }).click();

    await expect.poll(() => backend.inserts.length).toBe(1);
    await expectCompressedUpload(page, backend, north);
    expect(backend.inserts[0]).toMatchObject({ media_metadata: { uncompressed: false, optimized: true } });
  });

  test("a desktop flags an original over 50 MB in the dialog and sends nothing until it is resolved", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);
    test.skip(await isCoarsePointer(page), "the send dialog is the desktop's shape");

    const north = await testPhoto("north.png", 160);
    const panorama = oversizedFile("panorama.jpg");
    await page.getByRole("button", { name: "Прикрепить" }).click();
    await chooseFromMenu(page, "Фото или видео", [onDisk(north), panorama]);

    const dialog = sendDialog(page, "Отправить 2 фото");
    const compress = dialog.getByRole("checkbox", { name: "Сжать изображение" });
    const send = dialog.getByRole("button", { name: "Отправить" });
    const notice = dialog.getByTestId("media-send-limit-notice");
    await expect(compress).toBeChecked();
    await expect(notice).toHaveCount(0);
    await expect(send).toBeEnabled();

    await compress.uncheck();
    await expect(notice).toContainText("panorama.jpg");
    await expect(notice).toContainText("51 МБ");
    await expect(notice).toContainText("«Сжать изображение»");
    await expect(send).toBeDisabled();

    // Ticking the box again is one way out…
    await compress.check();
    await expect(notice).toHaveCount(0);
    await expect(send).toBeEnabled();

    // …taking the file out is the other. The title counts what is left, so the
    // dialog is found again by its new title before anything inside it is
    // asserted — against the old title every "not there" below would pass on an
    // empty match.
    await compress.uncheck();
    await expect(send).toBeDisabled();
    await dialog.getByRole("button", { name: "Убрать panorama.jpg" }).click();
    const remaining = sendDialog(page, "Отправить фото");
    await expect(remaining).toBeVisible();
    await expect(remaining.getByRole("checkbox", { name: "Сжать изображение" })).not.toBeChecked();
    await expect(remaining).not.toContainText("panorama.jpg");
    await expect(remaining.getByTestId("media-send-limit-notice")).toHaveCount(0);
    await remaining.getByRole("button", { name: "Отправить" }).click();

    await expect.poll(() => backend.inserts.length).toBe(1);
    await expectOriginalUpload(page, backend, north);
    const handed = await probedUploads(page);
    expect(handed.filter((upload) => upload.size > LIMIT), "the oversized original was never handed to storage").toHaveLength(0);
    expect(
      handed.filter((upload) => !upload.path.endsWith(".preview.webp")).map((upload) => upload.size),
      "one original went, and it is the photo",
    ).toEqual([north.buffer.length]);
  });

  test("a desktop's «Файл» stages the originals without asking, and refuses one over 50 MB with the menu's way out", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);
    test.skip(await isCoarsePointer(page), "a phone's «Файл» is pinned above");

    // «Файл» says «Без сжатия» and means it on every device: a send dialog
    // would only ask again what the item already answered (D-119).
    const north = await testPhoto("north.png", 250);
    const panorama = oversizedFile("panorama.jpg");
    await page.getByRole("button", { name: "Прикрепить" }).click();
    await chooseFromMenu(page, "Файл", [onDisk(north), panorama]);

    const alert = page.getByRole("dialog").filter({ hasText: "Файл больше 50 МБ" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("panorama.jpg");
    await expect(alert, "the way out named is the menu on the screen, not a dialog that never opened").toContainText("«Фото или видео»");
    await expect(alert).not.toContainText("«Сжать изображение»");
    await alert.getByRole("button", { name: "Понятно" }).click();
    await expect(page.getByTestId("media-send-dialog"), "nothing asks about compression").toHaveCount(0);

    const staged = page.getByTestId("staged-attachment-item");
    await expect(staged).toHaveCount(1);
    await expect(staged).toContainText("без сжатия");
    expect(backend.uploads, "nothing is uploaded before the person sends").toHaveLength(0);
    await page.getByRole("button", { name: "Отправить" }).click();

    await expect.poll(() => backend.inserts.length).toBe(1);
    await expectOriginalUpload(page, backend, north);
    expect(backend.inserts[0]).toMatchObject({ media_metadata: { uncompressed: true, optimized: false } });
  });

  test("a phone's original JPEG leaves without the place it was taken, and with nothing else changed", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);
    test.skip(!(await isCoarsePointer(page)), "the attach menu choice is the phone's shape");

    const site = await locatedPhoto("site.jpg");
    await page.getByRole("button", { name: "Прикрепить" }).click();
    await chooseFromMenu(page, "Файл", [site]);
    await expect(page.getByTestId("staged-attachment-item")).toHaveCount(1);
    await page.getByRole("button", { name: "Отправить" }).click();

    await expect.poll(() => backend.inserts.length).toBe(1);
    await expectLocationRemoved(page, backend, site);
  });

  test("a desktop's original JPEG leaves without the place it was taken, and with nothing else changed", async ({ page }) => {
    const backend = await installBackend(page);
    await openChat(page);
    test.skip(await isCoarsePointer(page), "the send dialog is the desktop's shape");

    const site = await locatedPhoto("site.jpg");
    await page.getByRole("button", { name: "Прикрепить" }).click();
    await chooseFromMenu(page, "Фото или видео", [site]);
    const dialog = sendDialog(page, "Отправить фото");
    await dialog.getByRole("checkbox", { name: "Сжать изображение" }).uncheck();
    await dialog.getByRole("button", { name: "Отправить" }).click();

    await expect.poll(() => backend.inserts.length).toBe(1);
    await expectLocationRemoved(page, backend, site);
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

async function isCoarsePointer(page: Page): Promise<boolean> {
  return page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
}

async function attachMenuLabels(page: Page): Promise<string[]> {
  const menu = page.getByTestId("composer-attach-menu");
  await expect(menu).toBeVisible();
  // A hint under an item reads as a line of its own; one space stands for any break.
  return (await menu.getByRole("button").allInnerTexts()).map((label) => label.replace(/\s+/g, " ").trim());
}

async function chooseFromMenu(page: Page, item: string, files: Array<PickedFile | string>) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: item, exact: true }).click();
  await (await chooser).setFiles(files as Parameters<Awaited<typeof chooser>["setFiles"]>[0]);
}

function sendDialog(page: Page, title: string): Locator {
  return page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

function sentPhotoBubble(page: Page, caption?: string): Locator {
  const bubbles = page.locator('[data-message-bubble="true"]').filter({ has: page.getByRole("button", { name: "Открыть фото" }) });
  return caption ? bubbles.filter({ hasText: caption }).first() : bubbles.last();
}

async function expectViewerServesOriginal(page: Page, bubble: Locator, originalPath: string, width: number) {
  const originalUrl = `${PUBLIC_MEDIA}${originalPath}`;
  await bubble.getByRole("button", { name: "Открыть фото" }).click();
  const viewer = page.locator('[role="dialog"][aria-modal="true"]').filter({ has: page.getByTestId("media-viewer-stage") });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText("Оригинал", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const picture = document.querySelector<HTMLImageElement>('[data-testid="media-viewer-stage"] img');
        return picture && picture.complete ? { src: picture.currentSrc || picture.src, width: picture.naturalWidth } : null;
      }),
    )
    .toEqual({ src: originalUrl, width });

  await page.evaluate(() => {
    const opened: string[] = [];
    (window as unknown as { __opened: string[] }).__opened = opened;
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await viewer.getByRole("button", { name: "Открыть оригинал" }).click();
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([originalUrl]);
}

// ── what reached storage ─────────────────────────────────────────────────────

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type HandedUpload = { path: string; type: string; size: number; sha256: string };

/**
 * What the application handed to `fetch` for each storage upload, hashed in the
 * page.
 *
 * The route sees the request too, but Chromium does not give an intercepted
 * request the bytes of a file-backed blob — a photo picked from disk arrives as
 * an empty part — and a pick that includes the oversized file has to be picked
 * from disk; WebKit gives it the bytes of no blob part at all. Hashing the
 * form's file part before it is sent is the bytes the application chose to
 * send, which is the property under test: no re-encode. Below the resumable
 * threshold the bytes are kept as well, for the storage mock to store when the
 * route received none.
 */
async function installUploadProbe(page: Page) {
  await page.addInitScript(() => {
    const handed: Array<{ path: string; type: string; size: number; sha256: string; base64: string | null }> = [];
    (window as unknown as { __letscubeUploadProbe: typeof handed }).__letscubeUploadProbe = handed;
    const send = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const marker = "/storage/v1/object/media/";
      const body = init?.body;
      if (url.includes(marker) && body instanceof FormData) {
        const file = body.get("");
        if (file instanceof Blob) {
          const bytes = await file.arrayBuffer();
          const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
          const view = new Uint8Array(bytes);
          const kept = view.length <= 6 * 1024 * 1024;
          let binary = "";
          for (let at = 0; kept && at < view.length; at += 0x8000) {
            binary += String.fromCharCode(...view.subarray(at, at + 0x8000));
          }
          handed.push({
            path: decodeURIComponent(new URL(url).pathname.slice(new URL(url).pathname.indexOf(marker) + marker.length)),
            type: file.type,
            size: bytes.byteLength,
            sha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
            base64: kept ? btoa(binary) : null,
          });
        }
      }
      return send(input, init);
    };
  });
}

async function probedUploads(page: Page): Promise<HandedUpload[]> {
  return page.evaluate(() =>
    (window as unknown as { __letscubeUploadProbe: Array<HandedUpload & { base64: string | null }> }).__letscubeUploadProbe
      .map(({ base64: _bytes, ...upload }) => upload),
  );
}

/** The bytes the page handed to storage for `path`, when it kept them. */
async function probedBytes(page: Page, path: string): Promise<Buffer | null> {
  const base64 = await page.evaluate(
    (objectPath) =>
      (window as unknown as { __letscubeUploadProbe: Array<{ path: string; base64: string | null }> }).__letscubeUploadProbe
        .find((upload) => upload.path === objectPath)?.base64 ?? null,
    path,
  );
  return base64 === null ? null : Buffer.from(base64, "base64");
}

async function expectOriginalUpload(page: Page, backend: Backend, file: PickedFile): Promise<{ path: string }> {
  const handed = await probedUploads(page);
  const upload = handed.find((candidate) => candidate.sha256 === sha256(file.buffer));
  expect(
    upload,
    `no upload hashes to ${file.name}; handed: ${handed.map((u) => `${u.path} ${u.type} ${u.size}`).join(", ")}`,
  ).toBeTruthy();
  expect(upload!.type).toBe(file.mimeType);
  expect(upload!.size).toBe(file.buffer.length);
  expect(upload!.path.endsWith(".png"), upload!.path).toBe(true);
  expect(backend.uploads.map((stored) => stored.path), "storage answered the upload").toContain(upload!.path);
  return { path: upload!.path };
}

async function expectPreviewUpload(backend: Backend, originalPath: string, size: { width: number; height: number }): Promise<Upload> {
  const previewPath = originalPath.replace(/\.[^./]+$/, "") + ".preview.webp";
  const preview = backend.uploads.find((candidate) => candidate.path === previewPath);
  expect(preview, `no preview beside ${originalPath}`).toBeTruthy();
  expect(preview!.contentType).toBe("image/webp");
  const meta = await sharp(preview!.bytes).metadata();
  expect({ width: meta.width, height: meta.height, format: meta.format }).toEqual({ ...size, format: "webp" });
  return preview!;
}

type LocatedFile = PickedFile & { withoutLocation: Buffer };

async function expectLocationRemoved(page: Page, backend: Backend, file: LocatedFile) {
  const originals = (await probedUploads(page)).filter((upload) => !upload.path.endsWith(".preview.webp"));
  expect(
    originals,
    `one original went; handed: ${originals.map((upload) => `${upload.path} ${upload.type} ${upload.size}`).join(", ")}`,
  ).toHaveLength(1);
  const [upload] = originals;
  expect(upload.size, "not a byte was added or taken away").toBe(file.buffer.length);
  expect(upload.sha256, "the picked bytes did not go as they were").not.toBe(sha256(file.buffer));
  expect(upload.sha256, "what went is the picked file with its GPS directory emptied, byte for byte").toBe(
    sha256(file.withoutLocation),
  );
  expect(backend.inserts[0]).toMatchObject({
    media_path: upload.path,
    media_metadata: { uncompressed: true, optimized: false, mime_type: "image/jpeg", size_bytes: file.buffer.length },
  });
}

async function expectCompressedUpload(page: Page, backend: Backend, file: PickedFile) {
  const handed = await probedUploads(page);
  expect(handed, "one object: the compressed photo, and no preview").toHaveLength(1);
  const [upload] = handed;
  expect(upload.type).toBe("image/webp");
  expect(upload.sha256).not.toBe(sha256(file.buffer));
  expect(upload.size).toBeLessThan(file.buffer.length);
  expect(backend.uploads.map((stored) => stored.path), "storage answered the upload").toEqual([upload.path]);
}

// ── fixtures ─────────────────────────────────────────────────────────────────

/** A 2400x1800 PNG heavy enough that a WebP of it is smaller, so compression really applies. */
async function testPhoto(name: string, hue: number): Promise<PickedFile> {
  const lines = [
    ...Array.from({ length: 25 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100 + 300}" y2="1800"/>`),
    ...Array.from({ length: 19 }, (_, i) => `<line x1="0" y1="${i * 100}" x2="2400" y2="${i * 100 - 200}"/>`),
  ].join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1800" viewBox="0 0 2400 1800">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue} 55% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360} 60% 28%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="2400" height="1800" fill="url(#g)"/>` +
    `<g stroke="hsl(${(hue + 180) % 360} 70% 80%)" stroke-width="5" opacity="0.55">${lines}</g>` +
    `<circle cx="1200" cy="900" r="420" fill="none" stroke="white" stroke-width="28"/>` +
    `</svg>`;
  const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 6 }).toBuffer();
  expect(buffer.length, "the test photo must stay under the resumable threshold").toBeLessThan(6 * 1024 * 1024);
  return { name, mimeType: "image/png", buffer };
}

/**
 * A real JPEG with the EXIF a phone writes, placed after its JFIF segment:
 * Orientation 1 and a GPS directory holding a latitude and a longitude.
 * `withoutLocation` is the same file with that directory and the coordinates it
 * points to zeroed, worked out here from the layout rather than by the module
 * under test.
 */
async function locatedPhoto(name: string): Promise<LocatedFile> {
  const picture = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 61, g: 120, b: 184 } } })
    .jpeg({ quality: 80 })
    .toBuffer();
  const at = picture[2] === 0xff && picture[3] === 0xe0 ? 4 + picture.readUInt16BE(4) : 2;
  const buffer = Buffer.concat([picture.subarray(0, at), gpsExifSegment(), picture.subarray(at)]);
  const withoutLocation = Buffer.from(buffer);
  const tiff = at + 4 + 6;
  withoutLocation.fill(0, tiff + 56, tiff + 158);
  return { name, mimeType: "image/jpeg", buffer, withoutLocation };
}

/** An APP1 EXIF segment: IFD0 at 8 with Orientation and the GPS pointer, the GPS directory at 56, its values up to 158. */
function gpsExifSegment(): Buffer {
  const tiff = Buffer.alloc(158);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(count, at + 4);
    tiff.writeUInt32LE(value, at + 8);
  };
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  entry(10, 0x0112, 3, 1, 1);
  entry(22, 0x8825, 4, 1, 56);
  tiff.writeUInt16LE(4, 56);
  entry(58, 0x0000, 1, 4, 0x0302);
  entry(70, 0x0001, 2, 2, 0x4e);
  entry(82, 0x0002, 5, 3, 110);
  entry(94, 0x0004, 5, 3, 134);
  [55, 1, 45, 1, 2088, 100].forEach((value, index) => tiff.writeUInt32LE(value, 110 + index * 4));
  [37, 1, 37, 1, 1234, 100].forEach((value, index) => tiff.writeUInt32LE(value, 134 + index * 4));
  const identifier = Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  const length = 2 + identifier.length + tiff.length;
  return Buffer.concat([Buffer.from([0xff, 0xe1, length >> 8, length & 0xff]), identifier, tiff]);
}

/** One byte over the limit, on disk: a buffer this size cannot cross the protocol. */
function oversizedFile(name: string): string {
  const path = test.info().outputPath(name);
  writeFileSync(path, Buffer.alloc(LIMIT + 1, 0xff));
  return path;
}

/** The same photo, on disk: a pick cannot mix paths with buffers, and the oversized file has to be a path. */
function onDisk(file: PickedFile): string {
  const path = test.info().outputPath(file.name);
  writeFileSync(path, file.buffer);
  return path;
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
          email: "compression-qa@example.invalid",
          user_metadata: { full_name: "Максим" },
          app_metadata: {},
          created_at: now,
        },
      }),
    );
  }, { userId: USER_ID, now: NOW });
}

async function installBackend(page: Page): Promise<Backend> {
  const backend: Backend = { uploads: [], inserts: [] };
  const me = profile(USER_ID, "Максим", "maksim");
  const anya = profile(OTHER_ID, "Аня", null);
  const memberships = [membership(CHAT_ID, USER_ID, "owner", me), membership(CHAT_ID, OTHER_ID, "member", anya)];
  const chats = [chat(CHAT_ID, CHAT_NAME, "2026-09-03T11:30:00.000Z", memberships)];
  const messages: Array<ReturnType<typeof message>> = [
    message("55555555-5555-4555-8555-5555555555c1", CHAT_ID, OTHER_ID, GREETING, "2026-09-03T11:30:00.000Z", anya),
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
      const objectPath = decodeURIComponent(url.pathname.slice("/storage/v1/object/public/media/".length));
      const stored = backend.uploads.find((upload) => upload.path === objectPath);
      if (!stored) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: stored.contentType, body: stored.bytes });
    }
    if (url.pathname.startsWith("/storage/v1/object/media/") && method === "POST") {
      const objectPath = decodeURIComponent(url.pathname.slice("/storage/v1/object/media/".length));
      const file = multipartFile(request.postDataBuffer(), request.headers()["content-type"] ?? "");
      if (!file) return json(route, { statusCode: "400", error: "Bad Request", message: "no file part" }, 400);
      // An empty part is the engine withholding a blob, not an empty file.
      const bytes = file.bytes.length ? file.bytes : (await probedBytes(page, objectPath)) ?? file.bytes;
      backend.uploads.push({ path: objectPath, contentType: file.contentType, bytes });
      return json(route, { Id: `object-${backend.uploads.length}`, Key: `media/${objectPath}` });
    }
    if (url.pathname === "/auth/v1/user") {
      return json(route, { id: USER_ID, aud: "authenticated", role: "authenticated", email: "compression-qa@example.invalid", user_metadata: { full_name: "Максим" }, app_metadata: {}, created_at: NOW });
    }
    if (url.pathname.includes("/rest/v1/profiles")) return json(route, one([me]));
    if (url.pathname.includes("/rest/v1/chat_members")) {
      const chatId = eq("chat_id");
      const userId = eq("user_id");
      return json(route, one(memberships.filter((row) =>
        (!chatId || row.chat_id === chatId) && (!userId || row.user_id === userId),
      )));
    }
    if (url.pathname.endsWith("/rpc/chat_list_summaries")) {
      return json(route, { code: "PGRST202", details: null, hint: null, message: "Could not find the function public.chat_list_summaries" }, 404);
    }
    if (url.pathname.includes("/rest/v1/chats")) {
      if (method !== "GET") return route.fulfill({ status: 204 });
      const id = eq("id");
      return json(route, one(chats.filter((row) => !id || row.id === id)));
    }
    if (url.pathname.includes("/rest/v1/media_variants")) return json(route, []);
    if (url.pathname.endsWith("/rest/v1/messages") && method === "POST") {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      backend.inserts.push(body);
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

/** The file part of a `storage-js` upload: a multipart form whose file field has an empty name. */
function multipartFile(body: Buffer | null, contentType: string): { contentType: string; bytes: Buffer } | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!body || !boundary) return null;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    const headers = part.subarray(0, split).toString("utf8");
    if (/name=""/.test(headers) && /filename=/.test(headers)) {
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "application/octet-stream";
      return { contentType: type, bytes: Buffer.from(part.subarray(split + 4)) };
    }
    start = next;
  }
  return null;
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
    invite_policy: "admins_only",
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
  await route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
}
