import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const VISIBLE_ROOTS = [
  path.join(ROOT, "artifacts/kub/src"),
  path.join(ROOT, "artifacts/kub/public/manifest.json"),
];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".json", ".html"]);
const FORBIDDEN = /кибер(?:-|\s)?арен|клуб/iu;

test("user-facing application sources use neutral LETSCUBE terminology", async () => {
  const violations = [];

  for (const root of VISIBLE_ROOTS) {
    for (const file of await sourceFiles(root)) {
      const content = await readFile(file, "utf8");
      const lines = content.split(/\r?\n/u);
      lines.forEach((line, index) => {
        if (FORBIDDEN.test(line)) {
          violations.push(`${path.relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }

  assert.deepEqual(violations, []);
});

async function sourceFiles(target) {
  const stat = await import("node:fs/promises").then(({ stat }) => stat(target));
  if (stat.isFile()) return [target];

  const files = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const fullPath = path.join(target, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(fullPath)));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}
