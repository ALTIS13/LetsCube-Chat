import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const PUBLIC_KEYS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_VAPID_PUBLIC_KEY",
  "VITE_AUTH_CAPTCHA_PROVIDER",
  "VITE_AUTH_CAPTCHA_SITE_KEY",
  "VITE_AUTH_GATEWAY_URL",
];

export function parseEnvText(text) {
  const values = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

export function collectPublicAndroidBuildEnv(source, metadata) {
  const output = {};
  for (const key of PUBLIC_KEYS) {
    const value = source.get(key);
    if (value) output[key] = value;
  }

  if (!output.VITE_SUPABASE_URL) {
    throw new Error("VITE_SUPABASE_URL is required for an Android production build.");
  }
  if (!output.VITE_SUPABASE_PUBLISHABLE_KEY && !output.VITE_SUPABASE_ANON_KEY) {
    throw new Error(
      "VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY is required for an Android production build.",
    );
  }
  if (!output.VITE_SUPABASE_URL.startsWith("https://")) {
    throw new Error("VITE_SUPABASE_URL must use HTTPS for an Android production build.");
  }

  return {
    ...output,
    VITE_ACCESS_SNAPSHOT_RPC_ENABLED: "1",
    VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED: "1",
    VITE_APP_ENV: "production",
    VITE_APP_VERSION: metadata.version,
    VITE_APP_COMMIT: metadata.commit,
    BASE_PATH: "/",
    PORT: "5173",
    NODE_ENV: "production",
  };
}

function run(command, args, env) {
  const executable = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : command;
  const executableArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArgument).join(" ")]
      : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function getCommandOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Unable to read Android build metadata from ${command}.`);
  return result.stdout.trim();
}

function quoteWindowsArgument(value) {
  if (/^[A-Za-z0-9_@./:\\-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function getAndroidVersion() {
  const gradle = readFileSync(resolve(root, "android/app/build.gradle"), "utf8");
  const match = gradle.match(/versionName\s+"([^"]+)"/);
  if (!match) throw new Error("Android versionName is missing from android/app/build.gradle.");
  return match[1];
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

async function main() {
  const envPath = resolve(
    process.env.KUB_INFRA_ENV_FILE || resolve(root, ".local/secrets/letscube-infra.env"),
  );
  if (!existsSync(envPath)) {
    throw new Error("Local infra env file is missing. Set KUB_INFRA_ENV_FILE or restore .local/secrets/letscube-infra.env.");
  }

  const source = parseEnvText(readFileSync(envPath, "utf8"));
  const publicEnv = collectPublicAndroidBuildEnv(source, {
    commit: getCommandOutput("git", ["rev-parse", "--short=12", "HEAD"]),
    version: getAndroidVersion(),
  });
  const env = { ...process.env, ...publicEnv };
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  console.log("Android production build: public connection settings validated; private keys are not forwarded.");
  run(pnpm, ["--filter", "@workspace/kub", "run", "build"], env);

  const bundlePath = resolve(root, "artifacts/kub/dist/public");
  if (!bundleContainsValue(bundlePath, publicEnv.VITE_SUPABASE_URL)) {
    throw new Error("Built Android web bundle does not contain the configured public Supabase origin.");
  }

  run(pnpm, ["android:sync"], env);
  run(pnpm, ["android:build:debug"], env);
  console.log("Android production debug APK is ready at android/app/build/outputs/apk/debug/app-debug.apk.");
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Android production build failed.");
    process.exitCode = 1;
  });
}
