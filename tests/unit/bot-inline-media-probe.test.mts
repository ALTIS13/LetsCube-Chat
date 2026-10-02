import assert from "node:assert/strict";
import test from "node:test";
import { decodeInlineMedia, inspectInlineMedia, mediaProbeArgs, parseInlineMediaProbe } from "../../artifacts/api-server/src/bot/inlineMedia.ts";
import type { InlineMediaMime } from "../../artifacts/api-server/src/bot/inlineMedia.ts";

const probe = (format: string, streams: unknown[], duration = "0.5", packets: unknown[] = [{ pts_time: "0.0", duration_time: "0.5" }]) =>
  JSON.stringify({ format: { format_name: format, duration }, streams, packets });
const video = { codec_type: "video", codec_name: "h264", width: 320, height: 240 };
const audio = { codec_type: "audio", codec_name: "opus" };

test("base64 admission accepts literal 6MiB and refuses +1, aliases and noncanonical bits", () => {
  assert.equal(decodeInlineMedia({ mime_type: "application/pdf", bytes_base64: Buffer.alloc(6_291_456).toString("base64") }).length, 6_291_456);
  for (const bytes_base64 of [Buffer.alloc(6_291_457).toString("base64"), "AB==", "Y Q==", "YQ", ""]) {
    assert.throws(() => decodeInlineMedia({ mime_type: "application/pdf", bytes_base64 }), /validation_failed/);
  }
  assert.throws(() => decodeInlineMedia({ mime_type: "text/html", bytes_base64: "YQ==" }), /validation_failed/);
});

test("probe uses an owned seekable file, disables external references and permits no network", async () => {
  const args = mediaProbeArgs();
  assert.deepEqual(args.slice(args.indexOf("-protocol_whitelist"), args.indexOf("-protocol_whitelist") + 2), ["-protocol_whitelist", "file"]);
  assert.deepEqual(args.slice(-2), ["-i", "@owned-media@"]);
  assert.equal(args[args.indexOf("-enable_drefs") + 1], "0");
  assert.equal(args[args.indexOf("-use_absolute_path") + 1], "0");
  assert.equal(args[args.indexOf("-max_alloc") + 1], "16777216");
  assert.equal(args[args.indexOf("-probesize") + 1], "6291456");
  assert.equal(args[args.indexOf("-format_whitelist") + 1], "mov,matroska,webm,ogg,mp3");
  const bytes = Buffer.from("fixture bytes");
  const metadata = await inspectInlineMedia(bytes, "video/mp4", undefined, async (tool, actualArgs, input) => {
    assert.equal(tool, "ffprobe"); assert.deepEqual(actualArgs, args); assert.equal(input, bytes);
    return probe("mov,mp4,m4a,3gp,3g2,mj2", [video]);
  });
  assert.deepEqual(metadata, { width: 320, height: 240, duration_ms: 500 });
});

test("playable narrow containers and codecs produce measured duration, not a caller value", () => {
  const samples: [InlineMediaMime, string, unknown[]][] = [
    ["video/mp4", "mov,mp4,m4a,3gp,3g2,mj2", [video, { codec_type: "audio", codec_name: "aac" }]],
    ["video/webm", "matroska,webm", [{ ...video, codec_name: "vp9" }, audio]],
    ["audio/webm", "matroska,webm", [audio]], ["audio/ogg", "ogg", [audio]],
    ["audio/mpeg", "mp3", [{ codec_type: "audio", codec_name: "mp3" }]],
  ];
  for (const [mime, format, streams] of samples) {
    assert.equal(parseInlineMediaProbe(probe(format, streams, "N/A", [
      { pts_time: "-0.01", duration_time: "0.02" }, { pts_time: "0.99", duration_time: "0.02" },
    ]), mime).duration_ms, 1010);
  }
});

test("probe rejects wrong container, disguised video voice, unsupported codecs, empty or excessive media", () => {
  const negatives = [
    ["audio/ogg", probe("mp3", [audio])], ["audio/webm", probe("matroska,webm", [audio, video])],
    ["video/mp4", probe("mov", [{ ...video, codec_name: "hevc" }])],
    ["video/webm", probe("matroska,webm", [{ ...video, codec_name: "h264" }])],
    ["audio/mpeg", probe("mp3", [{ codec_type: "audio", codec_name: "aac" }])],
    ["video/mp4", probe("mov", [{ ...video, width: 4097 }])],
    ["video/mp4", probe("mov", [{ ...video, height: 0 }])],
    ["audio/ogg", probe("ogg", [audio, audio])],
    ["audio/ogg", probe("ogg", [audio], "1800.001")],
    ["audio/ogg", probe("ogg", [audio], "0", [])],
    ["audio/ogg", probe("ogg", [audio], "0", [{ pts_time: "NaN" }])],
    ["audio/ogg", "not JSON"], ["audio/ogg", "[]"],
  ] as const;
  for (const [mime, output] of negatives) assert.throws(() => parseInlineMediaProbe(output, mime), /validation_failed/);
  assert.equal(parseInlineMediaProbe(probe("ogg", [audio], "1800"), "audio/ogg").duration_ms, 1_800_000);
  assert.equal(parseInlineMediaProbe(probe("mov", [{ ...video, width: 4096, height: 4096 }]), "video/mp4").width, 4096);
});

test("PDF requires an actual parser success, sane page count and safe filename", async () => {
  const pdf = Buffer.from("%PDF-1.4\nfixture\n%%EOF\n");
  assert.deepEqual(await inspectInlineMedia(pdf, "application/pdf", "report.pdf", async (tool, args) => {
    assert.equal(tool, "pdfinfo"); assert.deepEqual(args, ["-"]); return "Pages: 1\nEncrypted: no\n";
  }), { file_name: "report.pdf" });
  for (const name of ["../a.pdf", "x\\a.pdf", "\u0000.pdf", " ", ".", "..", "a".repeat(129)]) {
    await assert.rejects(() => inspectInlineMedia(pdf, "application/pdf", name, async () => "Pages: 1\n"), /validation_failed/);
  }
  for (const output of ["Pages: 0\n", "Pages: 10001\n", "Pages: 1\nEncrypted: yes\n", ""]) {
    await assert.rejects(() => inspectInlineMedia(pdf, "application/pdf", undefined, async () => output), /validation_failed/);
  }
  await assert.rejects(() => inspectInlineMedia(Buffer.from("<html>%%EOF"), "application/pdf", undefined, async () => "Pages: 1\n"), /validation_failed/);
});
