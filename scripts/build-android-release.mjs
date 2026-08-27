import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  collectPublicAndroidBuildEnv,
  createAndroidBuildProcessEnv,
  parseEnvText,
} from "./build-android-production.mjs";
import { readAndroidReleaseMetadata } from "./android-release-metadata.mjs";
import { resolveAndroidTools } from "./verify-android-release.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const expectedApplicationId = "com.kub.messenger";
const RELEASE_SIGNING_ENV_KEYS = [
  "LETSCUBE_ANDROID_KEYSTORE_PATH",
  "LETSCUBE_ANDROID_KEY_ALIAS",
  "LETSCUBE_ANDROID_STORE_PASSWORD",
  "LETSCUBE_ANDROID_KEY_PASSWORD",
];

function quoteWindowsArgument(value) {
  if (/^[A-Za-z0-9_@./:\\=-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function run(command, args, env, cwd = root) {
  const executable = process.platform === "win32" ? env.ComSpec || "cmd.exe" : command;
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

export function resolveAndroidReleaseCommands(
  androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT,
) {
  return resolveAndroidTools(androidHome);
}

export function createAndroidReleaseProcessEnv(baseEnv, publicEnv) {
  const env = createAndroidBuildProcessEnv(baseEnv, publicEnv);
  for (const key of RELEASE_SIGNING_ENV_KEYS) {
    if (baseEnv[key]) env[key] = baseEnv[key];
  }
  return env;
}

export function createAndroidReleaseToolProcessEnv(baseEnv) {
  return createAndroidBuildProcessEnv(baseEnv, {});
}

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
  const toolEnv = createAndroidReleaseToolProcessEnv(process.env);
  const tools = resolveAndroidReleaseCommands(toolEnv.ANDROID_HOME || toolEnv.ANDROID_SDK_ROOT);
  const source = parseEnvText(readFileSync(envPath, "utf8"));
  const publicEnv = collectPublicAndroidBuildEnv(source, {
    commit: run("git", ["rev-parse", "--short=12", "HEAD"], toolEnv),
    version: releaseMetadata.versionName,
  });
  const buildEnv = createAndroidBuildProcessEnv(process.env, publicEnv);
  const releaseEnv = createAndroidReleaseProcessEnv(process.env, publicEnv);
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  run(pnpm, ["--filter", "@workspace/kub", "run", "build"], buildEnv);

  const bundlePath = resolve(root, "artifacts/kub/dist/public");
  if (!bundleContainsValue(bundlePath, publicEnv.VITE_SUPABASE_URL)) {
    throw new Error("Built Android web bundle does not contain the configured public Supabase origin.");
  }

  run(pnpm, ["android:sync"], buildEnv);
  run("gradlew.bat", ["assembleRelease", "bundleRelease"], releaseEnv, resolve(root, "android"));

  const apkPath = resolve(root, "android/app/build/outputs/apk/release/app-release.apk");
  const aabPath = resolve(root, "android/app/build/outputs/bundle/release/app-release.aab");
  run(tools.apksigner, ["verify", "--verbose", apkPath], toolEnv);
  const actualMetadata = {
    applicationId: run(tools.apkanalyzer, ["manifest", "application-id", apkPath], toolEnv),
    versionName: run(tools.apkanalyzer, ["manifest", "version-name", apkPath], toolEnv),
    versionCode: run(tools.apkanalyzer, ["manifest", "version-code", apkPath], toolEnv),
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
