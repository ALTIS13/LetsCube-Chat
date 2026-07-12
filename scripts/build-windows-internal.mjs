import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const rootMetadata = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const metadata = JSON.parse(readFileSync(resolve(root, "desktop/package.json"), "utf8"));
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

if (!SEMVER_PATTERN.test(metadata.version)) {
  throw new Error("Windows package version must be strict SemVer.");
}
if (metadata.version !== rootMetadata.version || metadata.desktopBuild !== rootMetadata.desktopBuild) {
  throw new Error("Root and desktop release metadata must match.");
}
if (!Number.isSafeInteger(metadata.desktopBuild) || metadata.desktopBuild < 0) {
  throw new Error("desktopBuild must be a non-negative integer.");
}

const artifact = resolve(
  root,
  `dist/windows/LETSCUBE-${metadata.version}-x64-setup.exe`,
);
if (existsSync(artifact)) rmSync(artifact);

run("pnpm", [
  "exec",
  "electron-builder",
  "--config",
  "electron-builder.yml",
  "--win",
  "nsis",
  "--x64",
  "--publish",
  "never",
]);

if (!existsSync(artifact) || statSync(artifact).size < 1_000_000) {
  throw new Error("Windows NSIS artifact was not created or is unexpectedly small.");
}

console.log(`Windows internal installer ready: ${artifact}`);
console.log(`Version ${metadata.version}, build ${metadata.desktopBuild}. Signing is not configured.`);

function run(command, args) {
  const executable = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : command;
  const executableArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArgument).join(" ")]
    : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function quoteWindowsArgument(value) {
  if (/^[A-Za-z0-9_@./:\\-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}
