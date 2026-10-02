import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectInlineMedia } from "./inlineMedia.mjs";

// Runs only in the owned network-none QA container, with synthetic bytes.
assert.equal(process.env.LETSCUBE_SYNTHETIC_PROBE, "1");
const directory = await mkdtemp(join(tmpdir(), "letscube-synthetic-probe-"));
const ffmpeg = args => execFileSync("ffmpeg", ["-v", "error", "-threads", "1", ...args], { timeout: 30_000, maxBuffer: 262_144, stdio: ["ignore", "ignore", "pipe"] });
let checks = 0;
const fixtures = [];
function titledPdf(pageCount, title) {
  const titleHex = "FEFF" + Array.from(title, char => char.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  const page = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>";
  const kids = Array.from({ length: pageCount }, (_, index) => index + 4);
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids.map(id => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    `<< /Title <${titleHex}> >>`, ...Array.from({ length: pageCount }, () => page)];
  let source = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(source.length); source += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source, "ascii");
}
try {
  for (const [extension, codec, mime] of [["webm", "libopus", "audio/webm"], ["ogg", "libopus", "audio/ogg"], ["mp3", "libmp3lame", "audio/mpeg"]]) {
    const file = join(directory, `voice.${extension}`);
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=500:duration=0.25", "-c:a", codec, file]);
    const bytes = await readFile(file);
    const metadata = await inspectInlineMedia(bytes, mime);
    assert.ok(metadata.duration_ms >= 250 && metadata.duration_ms <= 350);
    fixtures.push({ mime_type: mime, bytes_base64: bytes.toString("base64") });
    checks++;
  }
  for (const [extension, codec, mime] of [["mp4", "libx264", "video/mp4"], ["webm", "libvpx-vp9", "video/webm"]]) {
    const file = join(directory, `video.${extension}`);
    ffmpeg(["-f", "lavfi", "-i", "color=c=blue:s=160x120:r=10:d=0.3", "-c:v", codec, "-threads", "1", file]);
    const bytes = await readFile(file);
    const metadata = await inspectInlineMedia(bytes, mime);
    assert.deepEqual({ width: metadata.width, height: metadata.height }, { width: 160, height: 120 });
    assert.ok(metadata.duration_ms >= 300 && metadata.duration_ms <= 400);
    fixtures.push({ mime_type: mime, bytes_base64: bytes.toString("base64") });
    checks++;
    await assert.rejects(() => inspectInlineMedia(bytes, mime === "video/mp4" ? "video/webm" : "audio/webm"), /validation_failed/);
    checks++;
  }
  const parts = ["%PDF-1.4\n"];
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>"];
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(parts.join(""))); parts.push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`); }
  const xref = Buffer.byteLength(parts.join(""));
  parts.push(`xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  assert.deepEqual(await inspectInlineMedia(Buffer.from(parts.join("")), "application/pdf", "report.pdf"), { file_name: "report.pdf" });
  fixtures.push({ mime_type: "application/pdf", bytes_base64: Buffer.from(parts.join("")).toString("base64"), file_name: "report.pdf" });
  await assert.rejects(() => inspectInlineMedia(Buffer.from("%PDF-1.4\nfake\n%%EOF\n"), "application/pdf"), /validation_failed/);
  checks += 2;
  for (const title of ["review", "review\u2028Pages: 1\u2028Encrypted: no", "review\nPages: 1\nEncrypted: no"]) {
    await assert.rejects(() => inspectInlineMedia(titledPdf(10001, title), "application/pdf"), /validation_failed/);
    checks++;
  }
  assert.deepEqual(await inspectInlineMedia(titledPdf(1, "review\u2028Pages: 10001\u2028Encrypted: yes"), "application/pdf"),
    { file_name: "document.pdf" });
  checks++;
  const file = join(directory, "flac.ogg");
  ffmpeg(["-f", "lavfi", "-i", "sine=duration=0.2", "-c:a", "flac", file]);
  const bytes = await readFile(file);
  await assert.rejects(() => inspectInlineMedia(bytes, "audio/ogg"), /validation_failed/);
  checks++;
  console.log(`PROBE ${checks} real synthetic format/codec cases passed; no credentials or network`);
  if (process.env.LETSCUBE_EXPORT_SYNTHETIC === "1") console.log("SYNTHETIC_FIXTURES:" + JSON.stringify(fixtures));
} finally {
  for (const file of await readdir(directory)) await unlink(join(directory, file));
  await rmdir(directory);
}
