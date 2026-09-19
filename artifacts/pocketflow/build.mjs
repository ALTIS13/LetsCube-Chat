import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build as esbuild } from "esbuild";

/**
 * One bundled entry, plus the migrations beside it.
 *
 * The migrations are **copied rather than bundled**, because `migrate()` reads
 * them from disk at boot. Bundling would leave the runtime looking for a
 * directory that is not in the image, and the failure would be a bot that
 * starts, answers `getMe`, and then throws on the first query.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "dist");

await rm(distDir, { recursive: true, force: true });

await esbuild({
  entryPoints: [path.resolve(here, "src/index.ts")],
  platform: "node",
  target: "node24",
  bundle: true,
  format: "esm",
  outdir: distDir,
  outbase: path.resolve(here, "src"),
  outExtension: { ".js": ".mjs" },
  sourcemap: true,
  logLevel: "info",
  // `pg` loads native bindings when they are present and falls back to its
  // pure-JS implementation when they are not; bundling it hides that decision
  // from the runtime, so it stays external and is installed in the image.
  external: ["pg", "pg-native"],
  banner: {
    js: "import { createRequire as __pfRequire } from 'node:module'; const require = __pfRequire(import.meta.url);",
  },
});

await cp(path.resolve(here, "migrations"), path.resolve(distDir, "migrations"), {
  recursive: true,
  force: true,
});

console.log("pocketflow: built dist/index.mjs");
