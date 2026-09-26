import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = new URL("../../docs/deploy/retain-web-assets.sh", import.meta.url);
const dockerfile = readFileSync(new URL("../../docs/deploy/Dockerfile", import.meta.url), "utf8");

function runMerge(source, target) {
  return spawnSync("sh", [fileURLToPath(script).replaceAll("\\", "/"), source, target], { encoding: "utf8" });
}

test("the web image stages release assets and runs retention before nginx", () => {
  assert.match(dockerfile, /COPY --from=build \/app\/artifacts\/kub\/dist\/public\/assets \/opt\/letscube\/release-assets/);
  assert.match(dockerfile, /COPY --chmod=755 docs\/deploy\/retain-web-assets\.sh \/docker-entrypoint\.d\/15-retain-web-assets\.sh/);
});

test("merge preserves previous hashes, adds nested current hashes and is idempotent", () => {
  const workspace = mkdtempSync(join(tmpdir(), "letscube-assets-"));
  try {
    const source = join(workspace, "release");
    const target = join(workspace, "retained");
    mkdirSync(join(source, "nested"), { recursive: true });
    mkdirSync(target);
    writeFileSync(join(source, "index-new.js"), "new build");
    writeFileSync(join(source, "nested", "chunk-new.js"), "new chunk");
    writeFileSync(join(target, "index-old.js"), "old build");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = runMerge(source, target);
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal(readFileSync(join(target, "index-old.js"), "utf8"), "old build");
    assert.equal(readFileSync(join(target, "index-new.js"), "utf8"), "new build");
    assert.equal(readFileSync(join(target, "nested", "chunk-new.js"), "utf8"), "new chunk");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a content-address collision fails without overwriting already served bytes", () => {
  const workspace = mkdtempSync(join(tmpdir(), "letscube-assets-"));
  try {
    const source = join(workspace, "release");
    const target = join(workspace, "retained");
    mkdirSync(source);
    mkdirSync(target);
    writeFileSync(join(source, "index-collision.js"), "new bytes");
    writeFileSync(join(target, "index-collision.js"), "old bytes");

    const result = runMerge(source, target);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /collision/i);
    assert.equal(readFileSync(join(target, "index-collision.js"), "utf8"), "old bytes");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a symlinked parent in the retained volume cannot redirect publication", () => {
  const workspace = mkdtempSync(join(tmpdir(), "letscube-assets-"));
  try {
    const source = join(workspace, "release");
    const target = join(workspace, "retained");
    const outside = join(workspace, "outside");
    mkdirSync(join(source, "nested"), { recursive: true });
    mkdirSync(target);
    mkdirSync(outside);
    writeFileSync(join(source, "nested", "chunk.js"), "public chunk");
    symlinkSync(outside, join(target, "nested"), "dir");

    const result = runMerge(source, target);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink/i);
    assert.equal(existsSync(join(outside, "chunk.js")), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
