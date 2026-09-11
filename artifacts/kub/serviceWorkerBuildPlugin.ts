import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import {
  computeBuildId,
  readEntryAssets,
  renderServiceWorker,
  type EmittedFile,
} from "./src/lib/pwa/serviceWorkerBuild.ts";

/**
 * Writes the build's identity into the emitted `sw.js`.
 *
 * Vite copies `public/sw.js` verbatim, and a browser installs a new worker only
 * when the worker's bytes change. With a constant cache name they never did, so
 * the worker was never replaced and its cache was never cleared. This rewrites
 * the one build line of the copied worker after every file is on disk, with a
 * digest of all of them — see `src/lib/pwa/serviceWorkerBuild.ts`.
 *
 * Build-only: the dev server keeps serving the template as-is, whose record
 * reads `dev`, and an unbuilt worker never caches anything.
 *
 * Every failure throws, which fails the build. A worker that silently shipped
 * without its identity would look exactly like the defect this exists to fix.
 */
export function serviceWorkerBuild(): Plugin {
  return {
    name: "kub-service-worker-build",
    apply: "build",
    writeBundle: {
      sequential: true,
      order: "post",
      async handler(outputOptions) {
        const outDir = outputOptions.dir;
        if (!outDir) throw new Error("kub-service-worker-build needs a directory build (build.outDir).");
        const id = await stampServiceWorker(outDir);
        this.info(`sw.js build ${id}`);
      },
    },
  };
}

/** Rewrites `<outDir>/sw.js` in place and returns the build id it now carries. */
export async function stampServiceWorker(outDir: string): Promise<string> {
  const files = await readEmittedFiles(outDir);
  const worker = files.find((file) => file.path === "sw.js");
  const index = files.find((file) => file.path === "index.html");
  if (!worker) throw new Error(`kub-service-worker-build: sw.js is missing from ${outDir}.`);
  if (!index) throw new Error(`kub-service-worker-build: index.html is missing from ${outDir}.`);

  const decoder = new TextDecoder();
  const { entry, precache } = readEntryAssets(decoder.decode(index.bytes));
  if (!entry) throw new Error("kub-service-worker-build: index.html boots no module entry under /assets/.");

  const id = await computeBuildId(files);
  const rendered = renderServiceWorker(decoder.decode(worker.bytes), { id, entry, precache });
  await writeFile(path.join(outDir, "sw.js"), rendered);
  return id;
}

async function readEmittedFiles(root: string): Promise<EmittedFile[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files: EmittedFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    files.push({
      path: path.relative(root, absolute).split(path.sep).join("/"),
      bytes: new Uint8Array(await readFile(absolute)),
    });
  }
  return files;
}
