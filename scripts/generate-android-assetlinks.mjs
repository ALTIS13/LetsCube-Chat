import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const packageName = "com.kub.messenger";
const relation = "delegate_permission/common.handle_all_urls";
const fingerprintPattern = /Signer #\d+ certificate SHA-256 digest:\s*([0-9A-Fa-f]{64})\s*$/gm;

function quoteWindowsArgument(value) {
  if (/^[A-Za-z0-9_@./:\\-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function runApkSigner(apkPath) {
  const command = process.env.LETSCUBE_ANDROID_APKSIGNER || "apksigner";
  const args = ["verify", "--verbose", "--print-certs", apkPath];
  const executable = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : command;
  const executableArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArgument).join(" ")]
    : args;
  const result = spawnSync(executable, executableArgs, { encoding: "utf8", stdio: "pipe" });

  if (result.error || result.status !== 0) {
    throw new Error("Release APK certificate verification failed.");
  }
  return `${result.stdout}\n${result.stderr}`;
}

export function readReleaseCertificateFingerprint(apkPath) {
  if (!existsSync(apkPath)) throw new Error("Release APK is missing.");

  const verification = runApkSigner(apkPath);
  if (/certificate DN:\s*.*android debug/i.test(verification)) {
    throw new Error("Android debug certificate cannot generate asset links.");
  }

  const fingerprints = [...verification.matchAll(fingerprintPattern)]
    .map((match) => match[1].toUpperCase().match(/.{2}/g).join(":"));
  if (fingerprints.length !== 1) {
    throw new Error("Release APK must have exactly one SHA-256 signer certificate.");
  }
  return fingerprints[0];
}

export function generateAndroidAssetLinks(apkPath, outputPath) {
  const fingerprint = readReleaseCertificateFingerprint(apkPath);
  const document = [
    {
      relation: [relation],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: [fingerprint],
      },
    },
  ];

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function main(args) {
  if (args.length !== 2) {
    throw new Error("Usage: generate-android-assetlinks.mjs APK OUTPUT");
  }
  generateAndroidAssetLinks(resolve(args[0]), resolve(args[1]));
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Android asset links generation failed.");
    process.exitCode = 1;
  }
}
