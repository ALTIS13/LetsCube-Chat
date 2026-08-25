import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { readAndroidReleaseMetadata } from "./android-release-metadata.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const EXPECTED_APPLICATION_ID = "com.kub.messenger";
const ALLOWED_EXPORTED_COMPONENTS = new Set(["activity:com.kub.messenger.MainActivity"]);
const ALLOWED_DANGEROUS_PERMISSIONS = new Set([
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.CAMERA",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.RECORD_AUDIO",
]);
const DANGEROUS_PERMISSIONS = new Set([
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCEPT_HANDOVER",
  "android.permission.ACTIVITY_RECOGNITION",
  "android.permission.ADD_VOICEMAIL",
  "android.permission.ANSWER_PHONE_CALLS",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.BODY_SENSORS",
  "android.permission.BODY_SENSORS_BACKGROUND",
  "android.permission.CALL_PHONE",
  "android.permission.CAMERA",
  "android.permission.GET_ACCOUNTS",
  "android.permission.NEARBY_WIFI_DEVICES",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.PROCESS_OUTGOING_CALLS",
  "android.permission.READ_CALENDAR",
  "android.permission.READ_CALL_LOG",
  "android.permission.READ_CONTACTS",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
  "android.permission.READ_PHONE_NUMBERS",
  "android.permission.READ_PHONE_STATE",
  "android.permission.READ_SMS",
  "android.permission.RECEIVE_MMS",
  "android.permission.RECEIVE_SMS",
  "android.permission.RECEIVE_WAP_PUSH",
  "android.permission.RECORD_AUDIO",
  "android.permission.SEND_SMS",
  "android.permission.UWB_RANGING",
  "android.permission.WRITE_CALENDAR",
  "android.permission.WRITE_CALL_LOG",
  "android.permission.WRITE_CONTACTS",
  "android.permission.WRITE_EXTERNAL_STORAGE",
]);

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
    const normalizedName = name.startsWith(".") ? `${EXPECTED_APPLICATION_ID}${name}` : name;
    components.push(`${match[1]}:${normalizedName}`);
  }
  return components;
}

function verifyExportedComponents(manifest) {
  const unexpected = readExportedComponents(manifest)
    .filter((component) => !ALLOWED_EXPORTED_COMPONENTS.has(component));
  if (unexpected.length > 0) {
    throw new Error("Release APK contains an unexpected exported component.");
  }
}

function verifyPermissions(output) {
  const permissions = new Set(output.match(/android\.permission\.[A-Z0-9_]+/g) || []);
  const unexpected = [...permissions].filter(
    (permission) => DANGEROUS_PERMISSIONS.has(permission) && !ALLOWED_DANGEROUS_PERMISSIONS.has(permission),
  );
  if (unexpected.length > 0) {
    throw new Error("Release APK requests an unexpected dangerous permission.");
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

  const associated = Array.isArray(document) && document.some((statement) => {
    const target = statement?.target;
    return target?.package_name === EXPECTED_APPLICATION_ID
      && Array.isArray(target.sha256_cert_fingerprints)
      && target.sha256_cert_fingerprints.some((candidate) => normalizeFingerprint(candidate) === fingerprint);
  });
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

function main(args) {
  if (args.length !== 1) throw new Error("Usage: verify-android-release.mjs APK");
  console.log(JSON.stringify(verifyAndroidRelease(resolve(args[0]))));
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Android release verification failed.");
    process.exitCode = 1;
  }
}
