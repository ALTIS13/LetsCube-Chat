import assert from "node:assert/strict";
import test from "node:test";

import {
  documentFacts,
  documentPreviewOf,
  formatFileSize,
  previewEngineOf,
  TEXT_PREVIEW_LIMIT_BYTES,
} from "../../artifacts/kub/src/lib/documentPreview.ts";

/**
 * Tracker item 33: «просмотр документов и т.п вещей сразу в чате, на примере
 * других медиа». A file is Telegram's row — its extension, its name, its size —
 * and opens in place where the engine can draw it.
 */

const desktop = previewEngineOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36", 0);
const android = previewEngineOf("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36", 5);
const iphone = previewEngineOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", 5);
const ipad = previewEngineOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 5);

test("a file says its name, its extension and its size, from what the message recorded", () => {
  const facts = documentFacts({ content: "Акт сверки 2026.pdf", mediaMetadata: { size_bytes: 1_258_291, mime_type: "application/pdf" } });
  assert.equal(facts.name, "Акт сверки 2026.pdf");
  assert.equal(facts.extension, "PDF");
  assert.equal(facts.family, "pdf");
  assert.equal(formatFileSize(facts.sizeBytes), "1,2 МБ");
  // No extension, no metadata: still a row, never a blank.
  const bare = documentFacts({ content: null, mediaMetadata: null });
  assert.equal(bare.name, "Файл");
  assert.equal(bare.extension, "ФАЙЛ");
  assert.equal(bare.sizeBytes, null);
  // The MIME type decides when the name cannot.
  assert.equal(documentFacts({ content: "report", mediaMetadata: { mime_type: "application/pdf" } }).family, "pdf");
});

test("sizes read the way a Russian file manager writes them", () => {
  assert.equal(formatFileSize(340), "340 Б");
  assert.equal(formatFileSize(12 * 1024), "12 КБ");
  assert.equal(formatFileSize(1.5 * 1024), "1,5 КБ");
  assert.equal(formatFileSize(2.4 * 1024 * 1024 * 1024), "2,4 ГБ");
  assert.equal(formatFileSize(null), null);
});

test("a PDF opens in place where the engine draws one, and downloads where it does not", () => {
  const pdf = documentFacts({ content: "Акт.pdf", mediaMetadata: { size_bytes: 80_000 } });
  assert.equal(documentPreviewOf(pdf, desktop), "pdf");
  // Android's engines have no PDF viewer inside a page; iOS draws one page as
  // a picture. Both download, as Telegram's web client does for every PDF.
  assert.equal(documentPreviewOf(pdf, android), null);
  assert.equal(documentPreviewOf(pdf, iphone), null);
  assert.equal(documentPreviewOf(pdf, ipad), null);
  // A browser whose viewer is off, or a headless one, says so itself.
  const viewerOff = previewEngineOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140", 0, false);
  assert.equal(documentPreviewOf(pdf, viewerOff), null);
});

test("text opens in place up to a megabyte, and pictures, films and recordings in what every engine plays", () => {
  const small = documentFacts({ content: "log.txt", mediaMetadata: { size_bytes: 4_000 } });
  const large = documentFacts({ content: "dump.csv", mediaMetadata: { size_bytes: TEXT_PREVIEW_LIMIT_BYTES + 1 } });
  const unknown = documentFacts({ content: "notes.md", mediaMetadata: null });
  assert.equal(documentPreviewOf(small, android), "text");
  assert.equal(documentPreviewOf(large, desktop), null);
  // An unknown size is not read into the page on trust.
  assert.equal(documentPreviewOf(unknown, desktop), null);

  assert.equal(documentPreviewOf(documentFacts({ content: "план.png", mediaMetadata: null }), iphone), "image");
  assert.equal(documentPreviewOf(documentFacts({ content: "clip.mp4", mediaMetadata: null }), android), "video");
  assert.equal(documentPreviewOf(documentFacts({ content: "звонок.m4a", mediaMetadata: null }), desktop), "audio");
  // A drawing can fetch from anywhere, and some engines cannot decode the rest.
  assert.equal(documentPreviewOf(documentFacts({ content: "logo.svg", mediaMetadata: null }), desktop), null);
  assert.equal(documentPreviewOf(documentFacts({ content: "IMG_0001.HEIC", mediaMetadata: null }), desktop), null);
  assert.equal(documentPreviewOf(documentFacts({ content: "архив.zip", mediaMetadata: null }), desktop), null);
});
