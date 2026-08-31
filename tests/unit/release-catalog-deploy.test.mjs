import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
const encodeTauriSignature = (value) => Buffer.from(value, "utf8").toString("base64");
function toBashPath(path) {
  if (process.platform !== "win32") return path;
  const converted = spawnSync(
    bash,
    ["-lc", "cygpath -u \"$1\"", "release-catalog-test", path],
    { encoding: "utf8" },
  );
  assert.equal(converted.status, 0, converted.stderr);
  return converted.stdout.trim();
}

const fakeMinisignRoot = mkdtempSync(join(tmpdir(), "letscube-fake-minisign-"));
const fakeMinisign = join(fakeMinisignRoot, "minisign");
writeFileSync(fakeMinisign, `#!/usr/bin/env bash
set -eu
[[ "$#" -eq 6 ]]
[[ "$1" == "-Vm" && -f "$2" ]]
[[ "$3" == "-p" && -f "$4" ]]
[[ "$5" == "-x" && -f "$6" ]]
[[ "\${FAKE_MINISIGN_FAIL:-0}" != "1" ]]
`);
chmodSync(fakeMinisign, 0o755);
const signedPublisherEnv = (releaseRoot, overrides = {}) => ({
  ...process.env,
  PATH: `${toBashPath(fakeMinisignRoot)}:${process.env.PATH ?? ""}`,
  RELEASE_ROOT: releaseRoot,
  ...overrides,
});

function nginxSection(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing Nginx section: ${start}`);
  assert.notEqual(endIndex, -1, `missing Nginx section boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("release catalog nginx is read-only, CORS-enabled and uses distinct cache policies", () => {
  const nginx = readFileSync(nginxPath, "utf8");
  const updaterManifests = nginxSection(
    nginx,
    "location ~ ^/releases/updater/v1/windows/(stable|test)\\.json$",
    "location /releases/updater/files/",
  );
  const updaterArtifacts = nginxSection(
    nginx,
    "location /releases/updater/files/",
    "location /releases/updater/",
  );
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

  assert.match(updaterManifests, /limit_except\s+GET\s+HEAD\s*\{\s*deny all;/);
  assert.match(updaterManifests, /try_files\s+\$uri\s+=404/);
  assert.match(updaterManifests, /default_type\s+application\/json/);
  assert.match(updaterManifests, /Cache-Control\s+"no-cache, no-store, must-revalidate"/);
  assert.doesNotMatch(updaterManifests, /immutable/);

  assert.match(updaterArtifacts, /limit_except\s+GET\s+HEAD\s*\{\s*deny all;/);
  assert.match(updaterArtifacts, /try_files\s+\$uri\s+=404/);
  assert.match(updaterArtifacts, /default_type\s+application\/octet-stream/);
  assert.match(updaterArtifacts, /Cache-Control\s+"public, max-age=31536000, immutable"/);
  assert.doesNotMatch(updaterArtifacts, /no-store/);
});

test("signed updater publication is atomic, channel-safe and reusable for promotion", () => {
  const workspace = mkdtempSync(join(tmpdir(), "letscube-updater-"));
  const publicRoot = join(workspace, "public");
  const installer = join(workspace, "LETSCUBE_0.2.1_x64-setup.exe");
  const updaterArtifact = join(workspace, "LETSCUBE_0.2.1_x64-setup.exe");
  const signatureFile = join(workspace, "LETSCUBE_0.2.1_x64-setup.exe.sig");
  const updaterBytes = Buffer.from("LETSCUBE signed updater fixture");
  const signature = encodeTauriSignature("untrusted comment: test signature fixture\nnot-a-real-signature\n");
  writeFileSync(installer, updaterBytes);
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
    { encoding: "utf8", env: signedPublisherEnv(publicRoot) },
  );

  const testPublish = publish("test");
  assert.equal(testPublish.status, 0, testPublish.stderr);
  const stablePublish = publish("stable");
  assert.equal(stablePublish.status, 0, stablePublish.stderr);

  const immutableRelative = "releases/updater/files/windows/0.2.1/letscube-0.2.1-setup.exe";
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
  const updaterArtifact = join(workspace, "bundle.exe");
  const signatureFile = join(workspace, "bundle.exe.sig");
  writeFileSync(installer, "first updater");
  writeFileSync(updaterArtifact, "first updater");
  writeFileSync(signatureFile, encodeTauriSignature("test signature fixture"));
  const base = [publisherPath, "windows", "0.2.1", installer, "Notes"];
  const run = (args) => spawnSync(bash, args, {
    encoding: "utf8",
    env: signedPublisherEnv(publicRoot),
  });

  const invalidChannel = run([...base, "--channel", "preview", "--updater-artifact", updaterArtifact, "--signature-file", signatureFile]);
  assert.notEqual(invalidChannel.status, 0);
  assert.match(invalidChannel.stderr, /channel/i);

  writeFileSync(signatureFile, "\n\t");
  const emptySignature = run([...base, "--channel", "test", "--updater-artifact", updaterArtifact, "--signature-file", signatureFile]);
  assert.notEqual(emptySignature.status, 0);
  assert.match(emptySignature.stderr, /signature/i);

  writeFileSync(signatureFile, encodeTauriSignature("test signature fixture"));
  const first = run([...base, "--channel", "test", "--updater-artifact", updaterArtifact, "--signature-file", signatureFile]);
  assert.equal(first.status, 0, first.stderr);
  writeFileSync(updaterArtifact, "different updater bytes");
  writeFileSync(installer, "different updater bytes");
  const replacement = run([...base, "--channel", "stable", "--updater-artifact", updaterArtifact, "--signature-file", signatureFile]);
  assert.notEqual(replacement.status, 0);
  assert.match(replacement.stderr, /immutable|already exists/i);
});

test("signed updater publisher rejects a failed cryptographic verification", () => {
  const workspace = mkdtempSync(join(tmpdir(), "letscube-updater-verification-"));
  const publicRoot = join(workspace, "public");
  const artifact = join(workspace, "bundle.exe");
  const signatureFile = join(workspace, "bundle.exe.sig");
  writeFileSync(artifact, "signed updater bytes");
  writeFileSync(signatureFile, encodeTauriSignature("invalid cryptographic signature"));

  const result = spawnSync(
    bash,
    [
      publisherPath,
      "windows",
      "0.2.1",
      artifact,
      "Verification failure",
      "--channel",
      "test",
      "--updater-artifact",
      artifact,
      "--signature-file",
      signatureFile,
    ],
    {
      encoding: "utf8",
      env: signedPublisherEnv(publicRoot, { FAKE_MINISIGN_FAIL: "1" }),
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /signature verification failed/i);
  assert.equal(
    existsSync(join(publicRoot, "releases/updater/v1/windows/test.json")),
    false,
  );
  assert.equal(
    existsSync(join(publicRoot, "releases/updater/files/windows/0.2.1")),
    false,
  );
});

test("signed updater manifest reads the validated immutable signature copy", () => {
  const workspace = mkdtempSync(join(tmpdir(), "letscube-updater-signature-copy-"));
  const publicRoot = join(workspace, "public");
  const installer = join(workspace, "installer.exe");
  const updaterArtifact = join(workspace, "bundle.exe");
  const signatureFile = join(workspace, "bundle.exe.sig");
  const sourceSignature = encodeTauriSignature("source-signature-before-copy");
  const immutableSignature = encodeTauriSignature("immutable-signature-after-copy");
  writeFileSync(installer, "updater");
  writeFileSync(updaterArtifact, "updater");
  writeFileSync(signatureFile, `${sourceSignature}\n`);
  const installHook = join(workspace, "install-hook.sh");
  writeFileSync(installHook, `install() {
  /usr/bin/install "$@"
  destination="\${@: -1}"
  if [[ "$destination" == *.sig ]]; then
    printf '%s\\n' '${immutableSignature}' > "$destination"
  fi
}
`);

  const result = spawnSync(
    bash,
    [
      publisherPath,
      "windows",
      "0.2.2",
      installer,
      "Signature copy regression",
      "--channel",
      "test",
      "--updater-artifact",
      updaterArtifact,
      "--signature-file",
      signatureFile,
    ],
    {
      encoding: "utf8",
      env: signedPublisherEnv(publicRoot, {
        BASH_ENV: toBashPath(installHook),
      }),
    },
  );
  assert.equal(result.status, 0, result.stderr);

  const immutableSidecar = join(
    publicRoot,
    "releases/updater/files/windows/0.2.2/letscube-0.2.2-setup.exe.sig",
  );
  const manifest = JSON.parse(readFileSync(
    join(publicRoot, "releases/updater/v1/windows/test.json"),
    "utf8",
  ));
  assert.equal(readFileSync(immutableSidecar, "utf8").trim(), immutableSignature);
  assert.equal(manifest.platforms["windows-x86_64"].signature, immutableSignature);
});

test("legacy download catalog publisher remains stable-only", () => {
  const workspace = mkdtempSync(join(tmpdir(), "letscube-release-legacy-channel-"));
  const artifact = join(workspace, "candidate.exe");
  writeFileSync(artifact, "legacy Windows installer");
  const result = spawnSync(
    bash,
    [publisherPath, "windows", "test", "0.2.2", "5", artifact],
    { encoding: "utf8", env: { ...process.env, RELEASE_ROOT: join(workspace, "public") } },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /channel/i);
});

test("publisher rejects symlinked updater parent and version paths", () => {
  const makeInputs = (workspace) => {
    const installer = join(workspace, "installer.exe");
    const updaterArtifact = join(workspace, "bundle.exe");
    const signatureFile = join(workspace, "bundle.exe.sig");
    writeFileSync(installer, "updater");
    writeFileSync(updaterArtifact, "updater");
    writeFileSync(signatureFile, encodeTauriSignature("test signature fixture"));
    return { installer, updaterArtifact, signatureFile };
  };
  const run = (publicRoot, inputs) => spawnSync(
    bash,
    [
      publisherPath,
      "windows",
      "0.2.3",
      inputs.installer,
      "Symlink guard",
      "--channel",
      "test",
      "--updater-artifact",
      inputs.updaterArtifact,
      "--signature-file",
      inputs.signatureFile,
    ],
    { encoding: "utf8", env: signedPublisherEnv(publicRoot) },
  );
  const linkType = process.platform === "win32" ? "junction" : "dir";

  const parentWorkspace = mkdtempSync(join(tmpdir(), "letscube-updater-parent-link-"));
  const parentPublicRoot = join(parentWorkspace, "public");
  const externalUpdaterRoot = join(parentWorkspace, "external-updater");
  mkdirSync(join(parentPublicRoot, "releases"), { recursive: true });
  mkdirSync(externalUpdaterRoot, { recursive: true });
  symlinkSync(externalUpdaterRoot, join(parentPublicRoot, "releases/updater"), linkType);
  const parentResult = run(parentPublicRoot, makeInputs(parentWorkspace));
  assert.notEqual(parentResult.status, 0);
  assert.match(parentResult.stderr, /symlink|confinement/i);
  assert.deepEqual(readdirSync(externalUpdaterRoot), []);

  const versionWorkspace = mkdtempSync(join(tmpdir(), "letscube-updater-version-link-"));
  const versionPublicRoot = join(versionWorkspace, "public");
  const versionInputs = makeInputs(versionWorkspace);
  const versionFilesRoot = join(versionPublicRoot, "releases/updater/files/windows");
  const externalVersionRoot = join(versionWorkspace, "external-version");
  mkdirSync(versionFilesRoot, { recursive: true });
  mkdirSync(externalVersionRoot, { recursive: true });
  writeFileSync(join(externalVersionRoot, "letscube-0.2.3-setup.exe"), "updater");
  writeFileSync(join(externalVersionRoot, "letscube-0.2.3-setup.exe.sig"), "signature-fixture");
  symlinkSync(externalVersionRoot, join(versionFilesRoot, "0.2.3"), linkType);
  const versionResult = run(versionPublicRoot, versionInputs);
  assert.notEqual(versionResult.status, 0);
  assert.match(versionResult.stderr, /symlink|confinement/i);
  assert.equal(
    existsSync(join(versionPublicRoot, "releases/updater/v1/windows/test.json")),
    false,
  );
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

test("legacy publisher accepts optional highlights and keeps jq and Python output identical", () => {
  const fixtureHighlights = join(root, "tests/fixtures/release-highlights.json");
  const makeFakeJq = (workspace) => {
    const bin = join(workspace, "fake-jq-bin");
    mkdirSync(bin);
    const fakeJq = join(bin, "jq");
    writeFileSync(fakeJq, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "-ace" ]]; then
  python - "$3" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as highlights_file:
    print(json.dumps(json.load(highlights_file), separators=(",", ":")))
PY
  exit 0
fi
platform=""; channel=""; version=""; build=""; published_at=""; notes=""; url=""; size=""; sha256=""; highlights=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arg)
      case "$2" in
        platform) platform="$3" ;;
        channel) channel="$3" ;;
        version) version="$3" ;;
        publishedAt) published_at="$3" ;;
        notes) notes="$3" ;;
        url) url="$3" ;;
        sha256) sha256="$3" ;;
      esac
      shift 3
      ;;
    --argjson)
      case "$2" in
        build) build="$3" ;;
        size) size="$3" ;;
        highlights) highlights="$3" ;;
      esac
      shift 3
      ;;
    *) shift ;;
  esac
done
python - "$platform" "$channel" "$version" "$build" "$published_at" "$notes" "$url" "$size" "$sha256" "$highlights" <<'PY'
import json
import sys

platform, channel, version, build, published_at, notes, url, size, sha256, highlights = sys.argv[1:]
json.dump({
    "schemaVersion": 1,
    "platform": platform,
    "channel": channel,
    "available": True,
    "version": version,
    "build": int(build),
    "publishedAt": published_at,
    "minimumSupportedVersion": None,
    "mandatory": False,
    "notes": notes,
    "highlights": json.loads(highlights),
    "artifact": {"url": url, "size": int(size), "sha256": sha256},
}, sys.stdout, indent=2)
sys.stdout.write("\\n")
PY
`);
    chmodSync(fakeJq, 0o755);
    return bin;
  };
  const publish = (workspace, env, args) => {
    const publicRoot = join(workspace, "public");
    const artifact = join(workspace, "candidate.apk");
    writeFileSync(artifact, "legacy Android artifact");
    const result = spawnSync(
      bash,
      [publisherPath, "android", "stable", "0.3.0", "7", artifact, ...args],
      { encoding: "utf8", env: { ...process.env, RELEASE_ROOT: publicRoot, ...env } },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(join(publicRoot, "releases/v1/android/stable.json"), "utf8"));
  };

  const pythonWorkspace = mkdtempSync(join(tmpdir(), "letscube-release-python-"));
  const pythonManifest = publish(pythonWorkspace, {}, ["--highlights-file", fixtureHighlights]);
  const jqWorkspace = mkdtempSync(join(tmpdir(), "letscube-release-jq-"));
  const fakeJqBin = makeFakeJq(jqWorkspace);
  const jqManifest = publish(
    jqWorkspace,
    { PATH: `${toBashPath(fakeJqBin)}:${process.env.PATH ?? ""}` },
    ["Compact notes", "--highlights-file", fixtureHighlights],
  );

  assert.deepEqual(pythonManifest.highlights, JSON.parse(readFileSync(fixtureHighlights, "utf8")));
  assert.deepEqual(jqManifest.highlights, pythonManifest.highlights);
  assert.equal(pythonManifest.schemaVersion, 1);
  assert.equal(jqManifest.schemaVersion, 1);
});

test("legacy publisher rejects invalid highlights before acquiring the publish lock", () => {
  const workspace = mkdtempSync(join(tmpdir(), "letscube-release-invalid-highlights-"));
  const publicRoot = join(workspace, "public");
  const artifact = join(workspace, "candidate.apk");
  const validHighlights = join(workspace, "valid-highlights.json");
  const invalidHighlights = join(workspace, "invalid-highlights.json");
  const overlongUnicodeHighlights = join(workspace, "overlong-unicode-highlights.json");
  const linkedHighlights = join(workspace, "linked-highlights.json");
  writeFileSync(artifact, "legacy Android artifact");
  writeFileSync(validHighlights, '["One change"]\\n');
  writeFileSync(invalidHighlights, '{"highlights":["not an array"]}\\n');
  writeFileSync(overlongUnicodeHighlights, JSON.stringify(["🙂".repeat(71)]));
  symlinkSync(validHighlights, linkedHighlights, "file");

  const base = [publisherPath, "android", "stable", "0.3.1", "8", artifact];
  const invalidInvocations = [
    ["--highlights-file"],
    ["--highlights-file", validHighlights, "--highlights-file", validHighlights],
    ["--unknown-option"],
    ["--highlights-file", linkedHighlights],
    ["--highlights-file", invalidHighlights],
    ["--highlights-file", overlongUnicodeHighlights],
  ];
  for (const args of invalidInvocations) {
    const result = spawnSync(bash, [...base, ...args], {
      encoding: "utf8",
      env: { ...process.env, RELEASE_ROOT: publicRoot },
    });
    assert.notEqual(result.status, 0, `expected failure for ${args.join(" ")}`);
    assert.equal(existsSync(publicRoot), false, `lock acquisition created release root for ${args.join(" ")}`);
  }
});

test("publisher rejects unknown platforms and malformed versions", () => {
  const workspace = mkdtempSync(join(tmpdir(), "letscube-release-invalid-"));
  const artifact = join(workspace, "candidate.apk");
  writeFileSync(artifact, "fixture");
  for (const args of [
    ["ios", "stable", "0.1.0", "1", artifact],
    ["macos", "stable", "0.1.0", "1", artifact],
    ["android", "stable", "v0.1", "1", artifact],
  ]) {
    const result = spawnSync(bash, [publisherPath, ...args], {
      encoding: "utf8",
      env: { ...process.env, RELEASE_ROOT: join(workspace, "public") },
    });
    assert.notEqual(result.status, 0);
  }
});
