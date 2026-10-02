import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { BotApiError } from "../../artifacts/api-server/src/bot/errors.ts";

type Inspector = typeof import("../../artifacts/api-server/src/bot/inlineMedia.ts")["inspectInlineMedia"];

const sourceUrl = new URL("../../artifacts/api-server/src/bot/inlineMedia.ts", import.meta.url);
const source = (await readFile(sourceUrl, "utf8")).replace(/\r\n/g, "\n");
const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
const temporaryPrefix = "letscube-pdf-mutation-";

function replaceOnce(input: string, before: string, after: string): string {
  assert.equal(input.split(before).length - 1, 1, "mutation or import target must occur exactly once");
  return input.replace(before, after);
}

async function withInspector(copy: string, probe: (inspect: Inspector) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), temporaryPrefix));
  try {
    let materialized = replaceOnce(copy, '"#bot/errors"', JSON.stringify(new URL("errors.ts", sourceUrl).href));
    materialized = replaceOnce(materialized, '"#bot/schemas"', JSON.stringify(new URL("schemas.ts", sourceUrl).href));
    const modulePath = join(root, "inlineMedia.mts");
    await writeFile(modulePath, materialized, { flag: "wx", mode: 0o600 });
    const module = await import(pathToFileURL(modulePath).href);
    assert.equal(typeof module.inspectInlineMedia, "function");
    await probe(module.inspectInlineMedia as Inspector);
  } finally {
    const absoluteRoot = resolve(root);
    assert.equal(dirname(absoluteRoot), resolve(tmpdir()), "cleanup must remain in the temporary directory");
    assert.ok(basename(absoluteRoot).startsWith(temporaryPrefix), "cleanup must target this harness directory");
    await rm(absoluteRoot, { recursive: true, force: true });
  }
}

function inspectOutput(inspect: Inspector, output: string): Promise<Record<string, string | number>> {
  return inspect(pdf, "application/pdf", "report.pdf", async (tool, args, bytes) => {
    assert.equal(tool, "pdfinfo");
    assert.deepEqual(args, ["-"]);
    assert.equal(bytes, pdf);
    return output;
  });
}

async function rejectionProbe(inspect: Inspector, output: string): Promise<void> {
  await assert.rejects(
    () => inspectOutput(inspect, output),
    (error: unknown) => error instanceof BotApiError && error.code === "validation_failed",
  );
}

const physicalValidation = String.raw`    const lines = output.split(/\r?\n/);
    const pageFields = lines.filter(line => line.startsWith("Pages:"));
    const encryptionFields = lines.filter(line => line.startsWith("Encrypted:"));
    const pages = pageFields.length === 1 ? /^Pages:[ \t]+(\d+)[ \t]*$/.exec(pageFields[0]) : null;
    if (!pages || Number(pages[1]) < 1 || Number(pages[1]) > 10_000 ||
        encryptionFields.length !== 1 || !/^Encrypted:[ \t]+no[ \t]*$/.test(encryptionFields[0])) invalid();`;

const oldMultilineValidation = String.raw`    const pages = /^Pages:\s+(\d+)\s*$/m.exec(output);
    if (!pages || Number(pages[1]) < 1 || Number(pages[1]) > 10_000 || /^Encrypted:\s+yes/m.test(output)) invalid();`;

const cases: { name: string; before: string; after: string; output: string }[] = [
  {
    name: "restores Unicode-aware multiline metadata extraction",
    before: physicalValidation,
    after: oldMultilineValidation,
    output: "Title: review\u2028Pages: 1\nPages: 10001\nEncrypted: no\n",
  },
  {
    name: "drops the unique physical Pages requirement",
    before: String.raw`const pages = pageFields.length === 1 ? /^Pages:[ \t]+(\d+)[ \t]*$/.exec(pageFields[0]) : null;`,
    after: String.raw`const pages = /^Pages:[ \t]+(\d+)[ \t]*$/.exec(pageFields[0] ?? "");`,
    output: "Pages: 1\nPages: 1\nEncrypted: no\n",
  },
  {
    name: "drops the unique physical Encrypted requirement",
    before: "encryptionFields.length !== 1 || ",
    after: "",
    output: "Pages: 1\nEncrypted: no\nEncrypted: no\n",
  },
  {
    name: "raises the page ceiling to 10001",
    before: "Number(pages[1]) > 10_000",
    after: "Number(pages[1]) > 10_001",
    output: "Pages: 10001\nEncrypted: no\n",
  },
];

test("literal PDF regressions and controls pass against an isolated unmodified source copy", async () => {
  await withInspector(source, async inspect => {
    for (const entry of cases) await rejectionProbe(inspect, entry.output);
    for (const output of [
      "Pages: 1\nEncrypted: no\n",
      "Pages: 10000\nEncrypted: no\n",
      "Title: review\u2028Pages: 10001\u2028Encrypted: yes\nPages: 1\nEncrypted: no\n",
    ]) {
      assert.deepEqual(await inspectOutput(inspect, output), { file_name: "report.pdf" });
    }
  });
});

for (const entry of cases) {
  test(`literal PDF regression kills a mutant that ${entry.name}`, async () => {
    const mutated = replaceOnce(source, entry.before, entry.after);
    assert.notEqual(mutated, source);
    await withInspector(mutated, async inspect => {
      // Import/setup errors cannot count as a kill; this mutant must actually admit the forbidden case.
      assert.deepEqual(await inspectOutput(inspect, entry.output), { file_name: "report.pdf" });
      await assert.rejects(
        () => rejectionProbe(inspect, entry.output),
        { code: "ERR_ASSERTION", operator: "rejects" },
      );
    });
  });
}
