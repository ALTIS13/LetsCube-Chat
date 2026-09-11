/**
 * The service worker's build identity, and the only place it is decided.
 *
 * `public/sw.js` is copied into the build byte for byte, and a browser installs
 * a new worker only when those bytes differ from the worker it already has. The
 * cache name inside them was a constant, `kub-app-shell-v2`, that had not
 * changed in 429 commits — so no deploy since July produced a new worker,
 * `activate` (the only code that deletes an old cache) never ran again, and every
 * deploy's hashed assets stayed in Cache Storage beside the ones before it.
 *
 * `vite build` now writes a build record into the worker (see the
 * `kub-service-worker-build` plugin in `artifacts/kub/serviceWorkerBuildPlugin.ts`):
 *
 *  - `id` is a digest of every file the build emits, so the worker's bytes
 *    change exactly when anything it serves changes — and a rebuild of the same
 *    sources does not push every browser through an update that changes nothing;
 *  - `entry` is the module script `index.html` boots, which is how a page and a
 *    waiting worker can tell whether they belong to the same build;
 *  - `precache` is what the offline shell cannot boot without.
 *
 * Kept free of Node imports so the Vite plugin and the unit tests run the same
 * code, and so file-system code can never be pulled into the application bundle.
 */

export type ServiceWorkerBuild = {
  /** Digest of the emitted build; `dev` for the unbuilt worker the dev server serves. */
  id: string;
  /** The module script `index.html` boots, e.g. `/assets/index-AbC123.js`. */
  entry: string | null;
  /** Same-origin files the offline shell needs, taken from `index.html`. */
  precache: string[];
};

export type EmittedFile = {
  /** Path relative to the output directory, with forward slashes. */
  path: string;
  bytes: Uint8Array;
};

/** What the dev server serves: an unbuilt worker has no build to describe. */
export const UNBUILT_SERVICE_WORKER: ServiceWorkerBuild = { id: "dev", entry: null, precache: [] };

// A fresh expression per use: a shared global regex carries `lastIndex` between
// calls, which is exactly the kind of state that makes a match silently miss.
function buildLinePattern(): RegExp {
  return /^const BUILD = .*; \/\/ @kub-sw-build(?=\r?$)/gm;
}

const SAFE_ID = /^[a-z0-9]{1,64}$/;
const SAFE_PATH = /^\/(?!\/)[^\s"'<>\\]*$/;

/**
 * Digest of an emitted build, as 16 hex characters.
 *
 * Every file counts, the worker's own template included, so a change to any
 * served byte — a chunk, a stylesheet, `offline.html`, an icon — is a new build.
 * Files are taken in path order, and each is written as a length-prefixed
 * record: the path's byte length, the path, the content's byte length, the
 * content. With both lengths spelled out, no two different builds can produce
 * the same stream, however their names and contents happen to line up.
 */
export async function computeBuildId(files: ReadonlyArray<EmittedFile>): Promise<string> {
  if (files.length === 0) throw new Error("A build with no files has no identity.");
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let previous: string | null = null;
  for (const file of sorted) {
    if (file.path === previous) throw new Error(`The build lists ${file.path} twice.`);
    previous = file.path;
    const path = encoder.encode(file.path);
    const record = [
      encoder.encode(`${path.byteLength}:`),
      path,
      encoder.encode(`:${file.bytes.byteLength}:`),
      file.bytes,
    ];
    for (const part of record) {
      chunks.push(part);
      length += part.byteLength;
    }
  }
  const stream = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    stream.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", stream));
  return Array.from(digest.subarray(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

/** A path this origin's build emitted, as opposed to a CDN, a font host or a data URL. */
function isOwnAsset(value: string): boolean {
  return SAFE_PATH.test(value) && value.includes("/assets/");
}

/**
 * The module entry and the files the shell needs, read from the built `index.html`.
 *
 * Only same-origin build output counts: the document also links a font
 * stylesheet from another host, and a worker must never try to precache that.
 */
export function readEntryAssets(indexHtml: string): Pick<ServiceWorkerBuild, "entry" | "precache"> {
  const entries: string[] = [];
  const linked: string[] = [];
  for (const tag of indexHtml.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const attributes = readAttributes(tag[2]);
    if (tag[1].toLowerCase() === "script") {
      const src = attributes.get("src");
      if (attributes.get("type") === "module" && src && isOwnAsset(src)) entries.push(src);
      continue;
    }
    const rel = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
    const href = attributes.get("href");
    if (href && isOwnAsset(href) && (rel.includes("modulepreload") || rel.includes("stylesheet"))) {
      linked.push(href);
    }
  }
  if (entries.length > 1) {
    throw new Error(`index.html boots ${entries.length} module entries; a build is expected to have one.`);
  }
  const entry = entries[0] ?? null;
  return { entry, precache: [...new Set([...entries, ...linked])] };
}

function assertBuild(build: ServiceWorkerBuild): void {
  if (!SAFE_ID.test(build.id)) throw new Error(`Invalid service worker build id: ${JSON.stringify(build.id)}`);
  if (build.entry !== null && !SAFE_PATH.test(build.entry)) {
    throw new Error(`Invalid service worker entry: ${JSON.stringify(build.entry)}`);
  }
  for (const item of build.precache) {
    if (!SAFE_PATH.test(item)) throw new Error(`Invalid precache path: ${JSON.stringify(item)}`);
  }
  if (build.entry !== null && !build.precache.includes(build.entry)) {
    throw new Error("The entry has to be precached, or the offline shell cannot boot it.");
  }
}

/**
 * Writes the build record into the worker template.
 *
 * Refuses rather than guesses: a template without exactly one build line would
 * otherwise ship a worker that still says `dev`, and the whole point — bytes
 * that change with every build — would be lost without a single error.
 */
export function renderServiceWorker(template: string, build: ServiceWorkerBuild): string {
  assertBuild(build);
  const found = template.match(buildLinePattern())?.length ?? 0;
  if (found !== 1) {
    throw new Error(
      `sw.js must carry exactly one build line ("const BUILD = …; // @kub-sw-build"); found ${found}.`,
    );
  }
  const line = `const BUILD = ${JSON.stringify(build)}; // @kub-sw-build`;
  return template.replace(buildLinePattern(), () => line);
}

/** Reads the record back out of a rendered worker; `null` when there is none. */
export function readServiceWorkerBuild(source: string): ServiceWorkerBuild | null {
  const match = source.match(/^const BUILD = (.*); \/\/ @kub-sw-build\r?$/m);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as ServiceWorkerBuild;
    assertBuild(parsed);
    return parsed;
  } catch {
    return null;
  }
}
