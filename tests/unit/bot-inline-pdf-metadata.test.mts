import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { BotApiError } from "../../artifacts/api-server/src/bot/errors.ts";
import {
  inspectInlineMedia,
  runMediaProbe,
  type MediaProbe,
} from "../../artifacts/api-server/src/bot/inlineMedia.ts";

const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");

function probeOutput(output: string): MediaProbe {
  return async (tool, args, bytes) => {
    assert.equal(tool, "pdfinfo");
    assert.deepEqual(args, ["-"]);
    assert.equal(bytes, pdf);
    return output;
  };
}

function validationFailed(error: unknown): boolean {
  return error instanceof BotApiError && error.code === "validation_failed";
}

test("PDF metadata cannot inject an admissible page count through a Title U+2028", async () => {
  const output = "Title: review\u2028Pages: 1\nPages: 10001\nEncrypted: no\n";
  await assert.rejects(
    () => inspectInlineMedia(pdf, "application/pdf", undefined, probeOutput(output)),
    validationFailed,
  );
});

test("a fake Encrypted field in Title cannot override the physical encrypted status", async () => {
  const output = "Title: review\u2028Encrypted: no\nPages: 1\nEncrypted: yes (print:yes copy:yes)\n";
  await assert.rejects(
    () => inspectInlineMedia(pdf, "application/pdf", undefined, probeOutput(output)),
    validationFailed,
  );
});

test("PDF metadata rejects duplicate physical Pages fields instead of trusting the first", async () => {
  for (const output of [
    "Pages: 1\nPages: 10001\nEncrypted: no\n",
    "Pages: 1\r\nPages: 1\r\nEncrypted: no\r\n",
  ]) {
    await assert.rejects(
      () => inspectInlineMedia(pdf, "application/pdf", undefined, probeOutput(output)),
      validationFailed,
    );
  }
});

test("PDF metadata requires exactly one physical Encrypted field", async () => {
  for (const output of [
    "Pages: 1\n",
    "Pages: 1\nEncrypted: no\nEncrypted: no\n",
    "Title: review\u2028Encrypted: no\nPages: 1\n",
  ]) {
    await assert.rejects(
      () => inspectInlineMedia(pdf, "application/pdf", undefined, probeOutput(output)),
      validationFailed,
    );
  }
});

test("valid PDF metadata with one physical Pages and Encrypted field retains the filename", async () => {
  for (const newline of ["\n", "\r\n"]) {
    const output = [
      "Title: review\u2028continued title",
      "Pages:           1",
      "Encrypted:       no",
      "Page size:       100 x 100 pts",
      "",
    ].join(newline);
    assert.deepEqual(
      await inspectInlineMedia(pdf, "application/pdf", "report.pdf", probeOutput(output)),
      { file_name: "report.pdf" },
    );
  }
});

test("fake fields in Title cannot reject valid physical page count and encryption status", async () => {
  const output = "Title: review\u2028Pages: 10001\u2028Encrypted: yes\nPages: 1\nEncrypted: no\n";
  assert.deepEqual(
    await inspectInlineMedia(pdf, "application/pdf", "report.pdf", probeOutput(output)),
    { file_name: "report.pdf" },
  );
});

function syntheticPdf(pageCount: number, title: string): Buffer {
  const titleHex = "FEFF" + Array.from(title, char =>
    char.charCodeAt(0).toString(16).padStart(4, "0"),
  ).join("");
  const page = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>";
  const kids = [3, ...Array.from({ length: pageCount - 1 }, (_, index) => index + 6)];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids.map(id => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    page,
    "<< /Length 0 >>\nstream\n\nendstream",
    `<< /Title <${titleHex}> >>`,
    ...Array.from({ length: pageCount - 1 }, () => page),
  ];
  let source = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source, "ascii");
}

const pdfinfoVersion = spawnSync("pdfinfo", ["-v"], {
  windowsHide: true,
  encoding: "utf8",
  timeout: 8_000,
  maxBuffer: 64 * 1024,
  env: {
    PATH: process.env.PATH,
    LANG: "C",
    LC_ALL: "C",
    ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}),
  },
});

test("actual pdfinfo cannot let synthetic PDF Title U+2028 bypass the 10000-page limit", {
  skip: pdfinfoVersion.status !== 0 ? "local pdfinfo executable is unavailable" : false,
}, async () => {
  const valid = syntheticPdf(1, "review");
  assert.deepEqual(await inspectInlineMedia(valid, "application/pdf"), { file_name: "document.pdf" });

  const overLimit = syntheticPdf(10001, "review");
  const controlOutput = await runMediaProbe("pdfinfo", ["-"], overLimit);
  assert.deepEqual(
    controlOutput.split(/\r?\n/).filter(line => line.startsWith("Pages:")).map(line => line.slice(6).trim()),
    ["10001"],
  );
  await assert.rejects(() => inspectInlineMedia(overLimit, "application/pdf"), validationFailed);

  const injected = syntheticPdf(10001, "review\u2028Pages: 1\u2028Encrypted: no");
  assert.ok(injected.length < 6_291_456);
  const injectedOutput = await runMediaProbe("pdfinfo", ["-"], injected);
  assert.ok(injectedOutput.includes("\u2028Pages: 1"));
  assert.deepEqual(
    injectedOutput.split(/\r?\n/).filter(line => line.startsWith("Pages:")).map(line => line.slice(6).trim()),
    ["10001"],
  );
  await assert.rejects(() => inspectInlineMedia(injected, "application/pdf"), validationFailed);
});
