import { expect, test, type Page } from "@playwright/test";
import {
  chat,
  membership,
  message,
  missingFunction,
  openChat,
  openFixture,
  person,
  requireFixtureServer,
} from "./helpers/messageActionsFixture";

/**
 * Tracker item 33: «просмотр документов и т.п вещей сразу в чате, на примере
 * других медиа». A file is Telegram's row — its extension, its name, its size,
 * and a button that says what a press does — and opens in place where the
 * engine can draw it (`lib/documentPreview.ts`). It used to be a bare link that
 * opened a browser tab.
 */

const AT = "2026-09-28T09:00:00.000Z";
const ME = person("ce111111-1111-4111-8111-000000000001", "Максим Орлов");
const ANNA = person("ce111111-1111-4111-8111-000000000002", "Анна Смирнова");
const CHAT = "ce222222-2222-4222-8222-000000000001";
const CHAT_NAME = "Объект на Минской";
const REPORT = "Отчёт смены.txt";
const REPORT_TEXT = "Бетон принят: 12 м³\nАрматура: акт подписан\nСледующая поставка — четверг";
const ESTIMATE = "Смета.pdf";
const ESTIMATE_CAPTION = "Смета на октябрь, проверь итог";
const ARCHIVE = "Фото объекта.zip";
const PDF_BYTES = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";

// The fixture's files are served from the application's own origin, where its
// service worker answers every navigation with the application; production's
// live on the storage host, which the worker does not touch.
test.use({ serviceWorkers: "block" });

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 768;

async function boot(page: Page) {
  await openFixture(page, {
    me: ME,
    people: [ANNA],
    chats: [chat(CHAT, "group", CHAT_NAME, AT)],
    memberships: [membership(CHAT, ME, "owner", AT), membership(CHAT, ANNA, "member", AT)],
    messages: [
      // Sent with a caption: the text is the caption, and the name is the one
      // the file was picked under.
      message("ce555555-5555-4555-8555-000000000001", CHAT, ANNA, ESTIMATE_CAPTION, "2026-09-28T08:50:00.000Z", {
        type: "file",
        media_url: "/__fixture-media/estimate.pdf",
        media_metadata: { size_bytes: 1_258_291, mime_type: "application/pdf", file_name: ESTIMATE },
      }),
      message("ce555555-5555-4555-8555-000000000002", CHAT, ANNA, ARCHIVE, "2026-09-28T08:55:00.000Z", {
        type: "file",
        media_url: "/__fixture-media/photos.zip",
        media_metadata: { size_bytes: 24_117_248, mime_type: "application/zip" },
      }),
      message("ce555555-5555-4555-8555-000000000003", CHAT, ANNA, REPORT, AT, {
        type: "file",
        media_url: "/__fixture-media/report.txt",
        media_metadata: { size_bytes: 120, mime_type: "text/plain" },
      }),
    ],
    rpc: (name) => (name === "search_chat_messages" ? missingFunction(name) : undefined),
  });
  await page.route("**/__fixture-media/report.txt", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: REPORT_TEXT }),
  );
  await page.route("**/__fixture-media/estimate.pdf", (route) =>
    route.fulfill({ status: 200, contentType: "application/pdf", body: PDF_BYTES }),
  );
  await page.route("**/__fixture-media/photos.zip", (route) =>
    route.fulfill({ status: 200, contentType: "application/zip", body: "PK" }),
  );
  await openChat(page, CHAT_NAME, REPORT);
}

const row = (page: Page, name: string) => page.getByTestId("file-message").filter({ hasText: name });

test.beforeEach(async ({ request }) => {
  await requireFixtureServer(request);
});

test("a file says its kind, its name and its size, and a text file opens in place", async ({ page }) => {
  await boot(page);
  const report = row(page, REPORT);
  await expect(report.getByTestId("file-message-kind")).toHaveText("120 Б · TXT");
  await expect(report).toHaveAttribute("data-file-preview", "text");
  await expect(row(page, ESTIMATE).getByTestId("file-message-kind")).toHaveText("1,2 МБ · PDF");
  // A caption does not take the file's name; it stands under the file.
  await expect(row(page, ESTIMATE).getByTestId("file-message-name")).toHaveText(ESTIMATE);
  await expect(page.getByTestId("file-message-caption")).toHaveText(ESTIMATE_CAPTION);

  await report.click();
  const viewer = page.getByTestId("document-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId("document-viewer-name")).toHaveText(REPORT);
  await expect(viewer.getByTestId("document-viewer-text")).toHaveText(REPORT_TEXT);

  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  // Back where the press came from.
  await expect(report).toBeFocused();
});

test("a PDF opens in place on a computer and downloads on a phone, as Telegram's web client does", async ({ page }) => {
  // Headless Chromium has no viewer and says so; a desktop browser has one.
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "pdfViewerEnabled", { get: () => true }));
  await boot(page);
  const estimate = row(page, ESTIMATE);
  if (isDesktop(page)) {
    await expect(estimate).toHaveAttribute("data-file-preview", "pdf");
    await estimate.click();
    await expect(page.getByTestId("document-viewer-pdf")).toHaveAttribute("data", /\/__fixture-media\/estimate\.pdf$/);
    await expect(page.getByTestId("document-viewer-pdf")).toHaveAttribute("type", "application/pdf");
    await page.getByTestId("document-viewer-close").click();
    await expect(page.getByTestId("document-viewer")).toHaveCount(0);
  } else {
    // An Android engine has no PDF viewer inside a page.
    await expect(estimate).toHaveAttribute("data-file-preview", "download");
    const download = page.waitForEvent("download");
    await estimate.click();
    expect((await download).suggestedFilename()).toBe(ESTIMATE);
  }
});

test("an archive downloads under its own name", async ({ page }) => {
  await boot(page);
  const archive = row(page, ARCHIVE);
  await expect(archive).toHaveAttribute("data-file-preview", "download");
  await expect(archive.getByTestId("file-message-kind")).toHaveText("23 МБ · ZIP");
  const download = page.waitForEvent("download");
  await archive.click();
  expect((await download).suggestedFilename()).toBe(ARCHIVE);
});
