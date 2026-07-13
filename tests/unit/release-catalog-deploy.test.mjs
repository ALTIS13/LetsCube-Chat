import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  assert.match(nginx, /location\s+\/releases\/v1\//);
  assert.match(nginx, /no-cache, no-store, must-revalidate/);
  assert.match(nginx, /location\s+\/releases\/files\//);
  assert.match(nginx, /max-age=31536000, immutable/);
  assert.match(nginx, /location\s+~\s+\^\/releases\/updater\/v1\/windows\/\(stable\|test\)\\\.json\$/);
  assert.match(nginx, /location\s+\/releases\/updater\/files\//);
  assert.match(nginx, /no-cache, no-store, must-revalidate/);
  assert.match(nginx, /request_uri.*(?:\\\.\\\.|%2e)/i);
  assert.match(nginx, /Access-Control-Allow-Origin\s+"\*"/);
  assert.match(nginx, /limit_except\s+GET\s+HEAD/);
  assert.match(nginx, /location\s+=\s+\/healthz/);
  assert.doesNotMatch(nginx, /location\s+\^~\s+\/releases\//);
  assert.match(nginx, /location\s+~\s+\/\\\./);
  assert.doesNotMatch(nginx, /try_files\s+\$uri\s+\$uri\/\s+\/index\.html/);
});

test("signed updater publication is atomic, channel-safe and reusable for promotion", () => {
  const workspace = mkdtempSync(join(tmpdir(), "letscube-updater-"));
  const publicRoot = join(workspace, "public");
  const installer = join(workspace, "LETSCUBE_0.2.1_x64-setup.exe");
  const updaterArtifact = join(workspace, "LETSCUBE_0.2.1_x64-setup.nsis.zip");
  const signatureFile = join(workspace, "LETSCUBE_0.2.1_x64-setup.nsis.zip.sig");
  const updaterBytes = Buffer.from("LETSCUBE signed updater fixture");
  const signature = "RWQ-test-signature-fixture-not-a-private-key";
  writeFileSync(installer, "LETSCUBE installer fixture");
  writeFileSync(updaterArtifact, updaterBytes);
  writeFileSync(signatureFile, `${signature}\n`);

  const publish = (channel) => spawnSync(
    bash,
    [
      publisherPath,
      "windows",
      "0.2.1",
      installer,
      "Signed Windows update",
      "--channel",
      channel,
      "--updater-artifact",
      updaterArtifact,
      "--signature-file",
      signatureFile,
    ],
    { encoding: "utf8", env: { ...process.env, RELEASE_ROOT: publicRoot } },
  );

  const testPublish = publish("test");
  assert.equal(testPublish.status, 0, testPublish.stderr);
  const stablePublish = publish("stable");
  assert.equal(stablePublish.status, 0, stablePublish.stderr);

  const immutableRelative = "releases/updater/files/windows/0.2.1/letscube-0.2.1.nsis.zip";
  const immutablePath = join(publicRoot, immutableRelative);
  assert.deepEqual(readFileSync(immutablePath), updaterBytes);
  const expectedUrl = `https://api.letscube.ru/${immutableRelative.replaceAll("\\", "/")}`;
  for (const channel of ["stable", "test"]) {
    const manifestRoot = join(publicRoot, "releases/updater/v1/windows");
    const manifest = JSON.parse(readFileSync(join(manifestRoot, `${channel}.json`), "utf8"));
    assert.equal(manifest.version, "0.2.1");
    assert.equal(manifest.platforms["windows-x86_64"].signature, signature);
    assert.equal(manifest.platforms["windows-x86_64"].url, expectedUrl);
    assert.equal(manifest.platforms["windows-x86_64"].sha256, createHash("sha256").update(updaterBytes).digest("hex"));
    assert.equal(
      readdirSync(manifestRoot).some((name) => name.startsWith(`.${channel}.json.`)),
      false,
      "temporary manifest must be renamed away",
    );
  }
  assert.equal(
    existsSync(join(publicRoot, "releases/v1/windows/stable.json")),
    false,
    "updater mode must not replace the existing download catalog",
  );
});

test("signed updater publisher rejects invalid channels, empty signatures and immutable replacement", () => {
  const workspace = mkdtempSync(join(tmpdir(), "letscube-updater-invalid-"));
  const publicRoot = join(workspace, "public");
  const installer = join(workspace, "installer.exe");
  const updaterArtifact = join(workspace, "bundle.nsis.zip");
  const signatureFile = join(workspace, "bundle.nsis.zip.sig");
  writeFileSync(installer, "installer");
  writeFileSync(updaterArtifact, "first updater");
  writeFileSync(signatureFile, "signature-fixture");
  const base = [publisherPath, "windows", "0.2.1", installer, "Notes"];
  const run = (args) => spawnSync(bash, args, {
    encoding: "utf8",
    env: { ...process.env, RELEASE_ROOT: publicRoot },
  });

  const invalidChannel = run([...base, "--channel", "preview", "--updater-artifact", updaterArtifact, "--signature-file", signatureFile]);
  assert.notEqual(invalidChannel.status, 0);
  assert.match(invalidChannel.stderr, /channel/i);

  writeFileSync(signatureFile, "\n\t");
  const emptySignature = run([...base, "--channel", "test", "--updater-artifact", updaterArtifact, "--signature-file", signatureFile]);
  assert.notEqual(emptySignature.status, 0);
  assert.match(emptySignature.stderr, /signature/i);

  writeFileSync(signatureFile, "signature-fixture");
  const first = run([...base, "--channel", "test", "--updater-artifact", updaterArtifact, "--signature-file", signatureFile]);
  assert.equal(first.status, 0, first.stderr);
  writeFileSync(updaterArtifact, "different updater bytes");
  const replacement = run([...base, "--channel", "stable", "--updater-artifact", updaterArtifact, "--signature-file", signatureFile]);
  assert.notEqual(replacement.status, 0);
  assert.match(replacement.stderr, /immutable|already exists/i);
});

test("publisher source uses temporary manifests and never handles signing secret values", () => {
  const publisher = readFileSync(publisherPath, "utf8");
  const secrets = readFileSync(join(root, "docs/infra/SECRETS_MATRIX.md"), "utf8");
  assert.match(publisher, /mktemp/);
  assert.match(publisher, /mv\s+(?:-f\s+)?--\s+"\$temp_updater_manifest"\s+"\$updater_manifest_path"/);
  assert.doesNotMatch(publisher, /TAURI_SIGNING_PRIVATE_KEY|TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
  assert.match(secrets, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(secrets, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
  assert.doesNotMatch(secrets, /TAURI_SIGNING_PRIVATE_KEY(?:_PASSWORD)?\s*=/);
  assert.doesNotMatch(secrets, /BEGIN (?:OPENSSH|PRIVATE) KEY/);
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
