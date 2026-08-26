import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { readAndroidReleaseMetadata } from "./android-release-metadata.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const EXPECTED_APPLICATION_ID = "com.kub.messenger";
const EXPECTED_EXPORTED_COMPONENTS = [
  "activity:com.kub.messenger.MainActivity:",
  "receiver:androidx.profileinstaller.ProfileInstallReceiver:android.permission.DUMP",
  "receiver:com.google.firebase.iid.FirebaseInstanceIdReceiver:com.google.android.c2dm.permission.SEND",
];
const EXPECTED_PERMISSIONS = new Set([
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.CAMERA",
  "android.permission.INTERNET",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.RECORD_AUDIO",
  "android.permission.WAKE_LOCK",
  "com.google.android.c2dm.permission.RECEIVE",
  "com.kub.messenger.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
]);
const AUTHORIZING_RELATION = "delegate_permission/common.handle_all_urls";

function executableNames(name) {
  return process.platform === "win32" ? [`${name}.bat`, `${name}.exe`, name] : [name];
}

function findExecutable(directories, name) {
  for (const directory of directories) {
    for (const executable of executableNames(name)) {
      const path = resolve(directory, executable);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

export function resolveAndroidTools(androidHome = process.env.ANDROID_HOME) {
  if (!androidHome || !existsSync(androidHome)) {
    throw new Error("ANDROID_HOME must reference an Android SDK directory.");
  }

  const buildToolsDirectory = resolve(androidHome, "build-tools");
  const buildToolVersions = existsSync(buildToolsDirectory)
    ? readdirSync(buildToolsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    : [];
  const apksigner = findExecutable(buildToolVersions.map((version) => resolve(buildToolsDirectory, version)), "apksigner");
  const apkanalyzer = findExecutable([
    resolve(androidHome, "cmdline-tools", "latest", "bin"),
    resolve(androidHome, "tools", "bin"),
  ], "apkanalyzer");

  if (!apksigner || !apkanalyzer) {
    throw new Error("Required Android SDK release verification tools are unavailable.");
  }
  return { apksigner, apkanalyzer };
}

function quoteWindowsArgument(value) {
  if (/^[A-Za-z0-9_@./:\\-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function runTool(tool, args) {
  const executable = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : tool;
  const executableArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", [tool, ...args].map(quoteWindowsArgument).join(" ")]
    : args;
  const result = spawnSync(executable, executableArgs, { encoding: "utf8", stdio: "pipe" });

  if (result.error || result.status !== 0) {
    throw new Error("Android release inspection command failed.");
  }
  return `${result.stdout}\n${result.stderr}`;
}

function normalizeFingerprint(value) {
  const compact = value.replaceAll(":", "").trim();
  if (!/^[0-9a-f]{64}$/i.test(compact)) return null;
  return compact.toUpperCase().match(/.{2}/g).join(":");
}

function readCertificateFingerprint(output) {
  if (/android debug/i.test(output)) {
    throw new Error("Android debug certificates are not accepted for release verification.");
  }
  const fingerprints = [...output.matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([0-9A-Fa-f:]{64,95})\s*$/gm)]
    .map((match) => normalizeFingerprint(match[1]))
    .filter(Boolean);
  if (fingerprints.length !== 1) {
    throw new Error("Release APK must contain exactly one SHA-256 signing certificate.");
  }
  return fingerprints[0];
}

function readExportedComponents(manifest) {
  const components = [];
  const pattern = /<(activity|activity-alias|service|receiver|provider)\b([^>]*)\/?\s*>/g;
  for (const match of manifest.matchAll(pattern)) {
    const attributes = match[2];
    const exported = /\bandroid:exported\s*=\s*["']true["']/.test(attributes);
    const name = attributes.match(/\bandroid:name\s*=\s*["']([^"']+)["']/)?.[1];
    if (!exported || !name) continue;
    const permission = attributes.match(/\bandroid:permission\s*=\s*["']([^"']+)["']/)?.[1] || "";
    const normalizedName = name.startsWith(".") ? `${EXPECTED_APPLICATION_ID}${name}` : name;
    components.push(`${match[1]}:${normalizedName}:${permission}`);
  }
  return components;
}

function verifyExportedComponents(manifest) {
  const components = readExportedComponents(manifest).sort();
  const expected = [...EXPECTED_EXPORTED_COMPONENTS].sort();
  if (components.length !== expected.length || components.some((component, index) => component !== expected[index])) {
    throw new Error("Release APK exported components do not match the approved contract.");
  }
}

function verifyPermissions(output) {
  const permissions = new Set(output.match(/(?:[A-Za-z_][A-Za-z0-9_]*\.)+[A-Za-z_][A-Za-z0-9_]*/g) || []);
  if (
    permissions.size !== EXPECTED_PERMISSIONS.size
    || [...permissions].some((permission) => !EXPECTED_PERMISSIONS.has(permission))
  ) {
    throw new Error("Release APK permissions do not match the approved contract.");
  }
}

function verifyCertificateAssociation(assetLinksPath, fingerprint) {
  if (!existsSync(assetLinksPath)) {
    throw new Error("Digital Asset Links association is required for release verification.");
  }
  let document;
  try {
    document = JSON.parse(readFileSync(assetLinksPath, "utf8"));
  } catch {
    throw new Error("Digital Asset Links association is invalid.");
  }

  const statement = Array.isArray(document) && document.length === 1 ? document[0] : null;
  const target = statement?.target;
  const associated = Array.isArray(statement?.relation)
    && statement.relation.length === 1
    && statement.relation[0] === AUTHORIZING_RELATION
    && target?.namespace === "android_app"
    && target.package_name === EXPECTED_APPLICATION_ID
    && Array.isArray(target.sha256_cert_fingerprints)
    && target.sha256_cert_fingerprints.length === 1
    && normalizeFingerprint(target.sha256_cert_fingerprints[0]) === fingerprint;
  if (!associated) {
    throw new Error("Release APK certificate does not match Digital Asset Links association.");
  }
}

export function verifyAndroidRelease(apkPath, options = {}) {
  if (!existsSync(apkPath) || !statSync(apkPath).isFile()) {
    throw new Error("Release APK is missing.");
  }

  const expectedMetadata = options.expectedMetadata || {
    applicationId: EXPECTED_APPLICATION_ID,
    ...readAndroidReleaseMetadata(options.root || root),
  };
  const tools = options.tools || resolveAndroidTools(options.androidHome);
  const run = options.run || runTool;
  const inspection = (tool, args) => run(tool, [...args, apkPath]).trim();

  const signature = inspection(tools.apksigner, ["verify", "--verbose", "--print-certs"]);
  const fingerprint = readCertificateFingerprint(signature);
  const applicationId = inspection(tools.apkanalyzer, ["manifest", "application-id"]);
  const versionName = inspection(tools.apkanalyzer, ["manifest", "version-name"]);
  const versionCode = inspection(tools.apkanalyzer, ["manifest", "version-code"]);
  const debuggable = inspection(tools.apkanalyzer, ["manifest", "debuggable"]);
  const manifest = inspection(tools.apkanalyzer, ["manifest", "print"]);
  const permissions = inspection(tools.apkanalyzer, ["manifest", "permissions"]);

  if (applicationId !== expectedMetadata.applicationId) {
    throw new Error("Release APK application ID does not match canonical metadata.");
  }
  if (versionName !== expectedMetadata.versionName) {
    throw new Error("Release APK version name does not match canonical metadata.");
  }
  if (versionCode !== String(expectedMetadata.versionCode)) {
    throw new Error("Release APK version code does not match canonical metadata.");
  }
  if (debuggable !== "false" || /android:debuggable\s*=\s*["']true["']/.test(manifest)) {
    throw new Error("Release APK must not be debuggable.");
  }

  verifyExportedComponents(manifest);
  verifyPermissions(permissions);
  verifyCertificateAssociation(
    options.assetLinksPath || resolve(options.root || root, "artifacts/kub/public/.well-known/assetlinks.json"),
    fingerprint,
  );

  const contents = readFileSync(apkPath);
  return {
    path: basename(apkPath),
    version: versionName,
    build: Number(versionCode),
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

export function readAndroidReleaseCliApk(args) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  if (normalized.length !== 1 || !normalized[0]) {
    throw new Error("Usage: verify-android-release.mjs APK");
  }
  return normalized[0];
}

function main(args) {
  console.log(JSON.stringify(verifyAndroidRelease(resolve(readAndroidReleaseCliApk(args)))));
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Android release verification failed.");
    process.exitCode = 1;
  }
}
