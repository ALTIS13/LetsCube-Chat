import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(".");
const nginxPath = join(root, "docs/deploy/release-catalog/nginx.conf");
const nginxMainPath = join(root, "docs/deploy/release-catalog/nginx-main.conf");
const composePath = join(root, "docs/deploy/release-catalog/docker-compose.yml");
const dockerfilePath = join(root, "docs/deploy/release-catalog/Dockerfile");
const publisherPath = join(root, "scripts/publish-native-release.sh");
const bash = process.env.KUB_BASH
  || (process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash");

test("release catalog nginx is read-only, CORS-enabled and uses distinct cache policies", () => {
  const nginx = readFileSync(nginxPath, "utf8");
  assert.match(nginx, /autoindex\s+off/);
  assert.match(nginx, /location\s+\^~\s+\/releases\/v1\//);
  assert.match(nginx, /no-cache, no-store, must-revalidate/);
  assert.match(nginx, /location\s+\^~\s+\/releases\/files\//);
  assert.match(nginx, /max-age=31536000, immutable/);
  assert.match(nginx, /Access-Control-Allow-Origin\s+"\*"/);
  assert.match(nginx, /limit_except\s+GET\s+HEAD/);
  assert.match(nginx, /location\s+=\s+\/healthz/);
  assert.doesNotMatch(nginx, /try_files\s+\$uri\s+\$uri\/\s+\/index\.html/);
});

test("release catalog compose mounts the host catalog once and keeps the container read-only", () => {
  const compose = readFileSync(composePath, "utf8");
  const dockerfile = readFileSync(dockerfilePath, "utf8");
  const nginxMain = readFileSync(nginxMainPath, "utf8");
  assert.match(compose, /\/srv\/letscube\/releases\/public:\/usr\/share\/nginx\/html:ro/);
  assert.doesNotMatch(compose, /html\/releases/);
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /tmpfs:/);
  assert.match(compose, /wget.*\/healthz/);
  assert.doesNotMatch(compose, /ports:/);
  assert.match(dockerfile, /FROM\s+nginx:/);
  assert.match(dockerfile, /USER\s+nginx/);
  assert.match(dockerfile, /EXPOSE\s+8080/);
  assert.match(compose, /expose:\s*\r?\n\s+-\s+"8080"/);
  assert.match(compose, /http:\/\/localhost:8080\/healthz/);
  assert.match(nginxMain, /pid\s+\/tmp\/nginx\.pid/);
  assert.match(nginxMain, /client_body_temp_path\s+\/tmp\/client_temp/);
  assert.doesNotMatch(dockerfile, /COPY\s+.*\.env|ARG\s+.*SECRET|ENV\s+.*TOKEN/i);
});

test("publisher creates an immutable artifact and a matching atomic manifest", () => {
  const workspace = mkdtempSync(join(tmpdir(), "letscube-release-"));
  const publicRoot = join(workspace, "public");
  const artifact = join(workspace, "candidate.apk");
  const bytes = Buffer.from("LETSCUBE internal APK fixture");
  writeFileSync(artifact, bytes);

  const result = spawnSync(
    bash,
    [publisherPath, "android", "stable", "0.1.0", "1", artifact, "Internal release"],
    { encoding: "utf8", env: { ...process.env, RELEASE_ROOT: publicRoot } },
  );
  assert.equal(result.status, 0, result.stderr);

  const published = join(publicRoot, "releases/files/android/0.1.0/letscube-0.1.0.apk");
  const manifest = JSON.parse(
    readFileSync(join(publicRoot, "releases/v1/android/stable.json"), "utf8"),
  );
  assert.deepEqual(readFileSync(published), bytes);
  assert.equal(manifest.artifact.size, bytes.length);
  assert.equal(manifest.artifact.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(
    manifest.artifact.url,
    "https://api.letscube.ru/releases/files/android/0.1.0/letscube-0.1.0.apk",
  );

  const duplicate = spawnSync(
    bash,
    [publisherPath, "android", "stable", "0.1.0", "1", artifact],
    { encoding: "utf8", env: { ...process.env, RELEASE_ROOT: publicRoot } },
  );
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /already exists/);
});

test("publisher rejects unknown platforms and malformed versions", () => {
  const workspace = mkdtempSync(join(tmpdir(), "letscube-release-invalid-"));
  const artifact = join(workspace, "candidate.apk");
  writeFileSync(artifact, "fixture");
  for (const args of [
    ["ios", "stable", "0.1.0", "1", artifact],
    ["android", "stable", "v0.1", "1", artifact],
  ]) {
    const result = spawnSync(bash, [publisherPath, ...args], {
      encoding: "utf8",
      env: { ...process.env, RELEASE_ROOT: join(workspace, "public") },
    });
    assert.notEqual(result.status, 0);
  }
});
