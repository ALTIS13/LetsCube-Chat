import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  collectPublicAndroidBuildEnv,
  parseEnvText,
} from "./build-android-production.mjs";
import { readAndroidReleaseMetadata } from "./android-release-metadata.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const expectedApplicationId = "com.kub.messenger";

function quoteWindowsArgument(value) {
  if (/^[A-Za-z0-9_@./:\\=-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function run(command, args, env, cwd = root) {
  const executable = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : command;
  const executableArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArgument).join(" ")]
      : args;
  const result = spawnSync(executable, executableArgs, {
    cwd,
    encoding: "utf8",
    env,
    stdio: "pipe",
  });

  if (result.error) {
    throw new Error(`${command} could not be started.`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }

  return result.stdout.trim();
}

export { run as runReleaseCommand };

function bundleContainsValue(directory, value) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (bundleContainsValue(path, value)) return true;
    } else if (/\.(?:html|js)$/i.test(entry.name) && readFileSync(path, "utf8").includes(value)) {
      return true;
    }
  }
  return false;
}

export function verifyAndroidReleaseArtifactMetadata(actual, expected) {
  if (actual.applicationId !== expected.applicationId) {
    throw new Error("Android release APK application ID does not match canonical metadata.");
  }
  if (actual.versionName !== expected.versionName) {
    throw new Error("Android release APK version name does not match canonical metadata.");
  }
  if (actual.versionCode !== String(expected.versionCode)) {
    throw new Error("Android release APK version code does not match canonical metadata.");
  }
}

function getArtifactDetails(path, metadata) {
  return {
    path,
    size: statSync(path).size,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    versionName: metadata.versionName,
    versionCode: metadata.versionCode,
  };
}

function printArtifactDetails(details) {
  console.log(
    `${details.path} version=${details.versionName} build=${details.versionCode} size=${details.size} sha256=${details.sha256}`,
  );
}

async function main() {
  const envPath = resolve(
    process.env.KUB_INFRA_ENV_FILE || resolve(root, ".local/secrets/letscube-infra.env"),
  );
  if (!existsSync(envPath)) {
    throw new Error("Local infra env file is missing. Set KUB_INFRA_ENV_FILE or restore .local/secrets/letscube-infra.env.");
  }

  const releaseMetadata = readAndroidReleaseMetadata(root);
  const source = parseEnvText(readFileSync(envPath, "utf8"));
  const publicEnv = collectPublicAndroidBuildEnv(source, {
    commit: run("git", ["rev-parse", "--short=12", "HEAD"], process.env),
    version: releaseMetadata.versionName,
  });
  const env = { ...process.env, ...publicEnv };
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  run(pnpm, ["--filter", "@workspace/kub", "run", "build"], env);

  const bundlePath = resolve(root, "artifacts/kub/dist/public");
  if (!bundleContainsValue(bundlePath, publicEnv.VITE_SUPABASE_URL)) {
    throw new Error("Built Android web bundle does not contain the configured public Supabase origin.");
  }

  run(pnpm, ["android:sync"], env);
  run("gradlew.bat", ["assembleRelease", "bundleRelease"], env, resolve(root, "android"));

  const apkPath = resolve(root, "android/app/build/outputs/apk/release/app-release.apk");
  const aabPath = resolve(root, "android/app/build/outputs/bundle/release/app-release.aab");
  run("apksigner", ["verify", "--verbose", apkPath], env);
  const actualMetadata = {
    applicationId: run("apkanalyzer", ["manifest", "application-id", apkPath], env),
    versionName: run("apkanalyzer", ["manifest", "version-name", apkPath], env),
    versionCode: run("apkanalyzer", ["manifest", "version-code", apkPath], env),
  };
  verifyAndroidReleaseArtifactMetadata(actualMetadata, {
    applicationId: expectedApplicationId,
    ...releaseMetadata,
  });

  printArtifactDetails(getArtifactDetails(apkPath, releaseMetadata));
  printArtifactDetails(getArtifactDetails(aabPath, releaseMetadata));
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Android production release build failed.");
    process.exitCode = 1;
  });
}
