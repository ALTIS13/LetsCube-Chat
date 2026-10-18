import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin, Rollup } from "vite";
import {
  computeBuildId,
  readEntryAssets,
  renderServiceWorker,
  type EmittedFile,
} from "./src/lib/pwa/serviceWorkerBuild.ts";

const LOCAL_EDITORS = [
  "/src/components/chat/attach/AttachPhotoEditor.tsx",
  "/src/components/chat/attach/AttachVideoEditor.tsx",
];

function assertEditorAssetPath(file: string): void {
  if (!file || /[\\:%?#\s"'<>]/u.test(file)
    || file.split("/").some(part => !part || part === "." || part === "..")
    || !/\.(?:m?js|css)$/.test(file)) {
    throw new Error(`kub-service-worker-build: invalid editor asset path ${JSON.stringify(file)}.`);
  }
}

/** Only local editors and their static dependencies, never the boot chunk's lazy tools. */
function readEditorAssets(bundle: Rollup.OutputBundle): string[] {
  const files = new Set<string>();
  function output(file: string) {
    assertEditorAssetPath(file);
    if (!Object.hasOwn(bundle, file)) throw new Error(`kub-service-worker-build: missing editor graph file ${file}.`);
    const item = bundle[file];
    if (item.fileName !== file) throw new Error(`kub-service-worker-build: invalid editor graph file ${file}.`);
    return item;
  }
  function visit(file: string) {
    const chunk = output(file);
    if (chunk.type !== "chunk" || !/\.m?js$/.test(file)) {
      throw new Error(`kub-service-worker-build: invalid editor graph file ${file}.`);
    }
    if (files.has(file)) return;
    files.add(file);
    for (const css of [...(chunk.viteMetadata?.importedCss ?? [])].sort()) {
      const asset = output(css);
      if (asset.type !== "asset" || !css.endsWith(".css")) {
        throw new Error(`kub-service-worker-build: invalid editor graph file ${css}.`);
      }
      files.add(css);
    }
    for (const dependency of [...chunk.imports].sort()) visit(dependency);
  }
  for (const chunk of Object.values(bundle)) {
    if (chunk.type === "chunk" && LOCAL_EDITORS.some(editor => chunk.facadeModuleId?.replaceAll("\\", "/").endsWith(editor))) {
      visit(chunk.fileName);
    }
  }
  return [...files].sort();
}

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
      async handler(outputOptions, bundle) {
        const outDir = outputOptions.dir;
        if (!outDir) throw new Error("kub-service-worker-build needs a directory build (build.outDir).");
        const editors = readEditorAssets(bundle);
        const id = await stampServiceWorker(outDir, editors);
        if (editors.length) this.info(`sw.js editor precache ${editors.join(", ")}`);
        this.info(`sw.js build ${id}`);
      },
    },
  };
}

/** Extra precache entries are validated output-relative JS/CSS filenames. */
export async function stampServiceWorker(outDir: string, extraPrecache: readonly string[] = []): Promise<string> {
  const files = await readEmittedFiles(outDir);
  const worker = files.find((file) => file.path === "sw.js");
  const index = files.find((file) => file.path === "index.html");
  if (!worker) throw new Error(`kub-service-worker-build: sw.js is missing from ${outDir}.`);
  if (!index) throw new Error(`kub-service-worker-build: index.html is missing from ${outDir}.`);

  const decoder = new TextDecoder();
  const { entry, precache } = readEntryAssets(decoder.decode(index.bytes));
  if (!entry) throw new Error("kub-service-worker-build: index.html boots no module entry under /assets/.");

  const emitted = new Set(files.map(file => file.path));
  for (const file of extraPrecache) {
    assertEditorAssetPath(file);
    if (!emitted.has(file)) throw new Error(`kub-service-worker-build: missing emitted editor file ${file}.`);
  }
  // Rollup filenames are output-relative; keep the same URL base as the boot entry.
  const base = entry.slice(0, entry.indexOf("/assets/") + 1);
  const merged = [...new Set([...precache, ...extraPrecache.map(file => base + file)])];

  const id = await computeBuildId(files);
  const rendered = renderServiceWorker(decoder.decode(worker.bytes), { id, entry, precache: merged });
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
