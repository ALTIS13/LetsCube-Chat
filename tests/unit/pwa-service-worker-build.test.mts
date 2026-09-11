import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stampServiceWorker } from "../../artifacts/kub/serviceWorkerBuildPlugin.ts";
import {
  UNBUILT_SERVICE_WORKER,
  computeBuildId,
  readEntryAssets,
  readServiceWorkerBuild,
  renderServiceWorker,
} from "../../artifacts/kub/src/lib/pwa/serviceWorkerBuild.ts";

/**
 * The worker's bytes have to change with every build, or no browser ever
 * installs the new one and no old cache is ever deleted.
 *
 * `kub-app-shell-v2` was a constant for 429 commits: production served the
 * same `sw.js` (SHA-256 3e9303db…) through every deploy since July, `activate`
 * never ran again, and every deploy's assets piled up in Cache Storage.
 */

const template = await readFile(new URL("../../artifacts/kub/public/sw.js", import.meta.url), "utf8");
const bytes = (text: string) => new TextEncoder().encode(text);

// The shape `vite build` actually emits, measured on this repository's build:
// a module entry and a stylesheet, next to a font stylesheet from another host
// that a worker must never try to precache.
const BUILT_INDEX = `<!DOCTYPE html>
<html lang="ru"><head>
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet" />
<script>(function(){ var x = "<script type=\\"module\\" src=\\"/assets/fake.js\\">"; })();</script>
<script type="module" crossorigin src="/assets/index-YU1NL3MD.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-Ab12Cd.js">
<link rel="stylesheet" crossorigin href="/assets/index-BI8AuhlQ.css">
</head><body><div id="root"></div></body></html>`;

test("the id changes when any served byte changes, and only then", async () => {
  const files = [
    { path: "assets/index-a.js", bytes: bytes("console.log(1)") },
    { path: "offline.html", bytes: bytes("<p>offline</p>") },
    { path: "sw.js", bytes: bytes(template) },
  ];
  const id = await computeBuildId(files);
  assert.match(id, /^[0-9a-f]{16}$/);

  // Stable: the order a file system lists files in is not part of a build.
  assert.equal(await computeBuildId([...files].reverse()), id);

  // A change to a non-script file counts: offline.html is precached, so a
  // worker that kept its old id would keep serving the old page. The edit keeps
  // the length, so a digest of names and sizes alone cannot pass this.
  const offlineChanged = files.map((file) =>
    file.path === "offline.html" ? { ...file, bytes: bytes("<p>0ffline</p>") } : file,
  );
  assert.notEqual(await computeBuildId(offlineChanged), id);

  // A rename with identical bytes is a different build too.
  const renamed = files.map((file) =>
    file.path === "assets/index-a.js" ? { ...file, path: "assets/index-b.js" } : file,
  );
  assert.notEqual(await computeBuildId(renamed), id);
});

test("two builds whose names and contents line up into one stream do not collide", async () => {
  // Name and content run together: "a" + "bc" and "ab" + "c" are both "abc".
  assert.notEqual(
    await computeBuildId([{ path: "a", bytes: bytes("bc") }]),
    await computeBuildId([{ path: "ab", bytes: bytes("c") }]),
  );
  // One build's content spells out another build's next record, so only the
  // content's length can tell a file named "b" from bytes that merely say so.
  assert.notEqual(
    await computeBuildId([
      { path: "a", bytes: bytes("x") },
      { path: "b", bytes: bytes("") },
    ]),
    await computeBuildId([{ path: "a", bytes: bytes("x1:b:") }]),
  );
});

test("an empty or ambiguous build has no identity", async () => {
  await assert.rejects(computeBuildId([]), /no identity/);
  await assert.rejects(
    computeBuildId([
      { path: "sw.js", bytes: bytes("a") },
      { path: "sw.js", bytes: bytes("b") },
    ]),
    /twice/,
  );
});

test("the entry and the shell's files are read from the built document", () => {
  assert.deepEqual(readEntryAssets(BUILT_INDEX), {
    entry: "/assets/index-YU1NL3MD.js",
    precache: ["/assets/index-YU1NL3MD.js", "/assets/vendor-Ab12Cd.js", "/assets/index-BI8AuhlQ.css"],
  });
});

test("attribute order and quoting do not change what is read", () => {
  const html = `<script src='/assets/main-1.js' type=module></script><link href="/assets/app.css" rel="stylesheet">`;
  assert.deepEqual(readEntryAssets(html), {
    entry: "/assets/main-1.js",
    precache: ["/assets/main-1.js", "/assets/app.css"],
  });
});

test("a document with two module entries is refused rather than half-described", () => {
  const html = `<script type="module" src="/assets/a.js"></script><script type="module" src="/assets/b.js"></script>`;
  assert.throws(() => readEntryAssets(html), /2 module entries/);
});

test("the checked-in worker is the unbuilt one, with exactly one build line", () => {
  assert.deepEqual(readServiceWorkerBuild(template), UNBUILT_SERVICE_WORKER);
});

test("rendering writes the record, and reading it back returns the same record", () => {
  const build = {
    id: "0123456789abcdef",
    entry: "/assets/index-YU1NL3MD.js",
    precache: ["/assets/index-YU1NL3MD.js", "/assets/index-BI8AuhlQ.css"],
  };
  const rendered = renderServiceWorker(template, build);
  assert.notEqual(rendered, template);
  assert.deepEqual(readServiceWorkerBuild(rendered), build);
  // Nothing but the build line moved.
  assert.equal(rendered.split("\n").length, template.split("\n").length);
});

test("a template without exactly one build line is refused, not shipped as dev", () => {
  const build = { id: "0123456789abcdef", entry: "/assets/i.js", precache: ["/assets/i.js"] };
  const line = template.match(/^const BUILD = .*; \/\/ @kub-sw-build$/m)?.[0];
  assert.ok(line, "the template must carry a build line for this case to mean anything");
  assert.throws(() => renderServiceWorker(template.replace(line, "const BUILD = null;"), build), /found 0/);
  assert.throws(() => renderServiceWorker(`${template}\n${line}\n`, build), /found 2/);
});

test("a CRLF checkout renders the same record and keeps its line endings", () => {
  const crlf = template.replace(/\r?\n/g, "\r\n");
  const build = { id: "0123456789abcdef", entry: "/assets/i.js", precache: ["/assets/i.js"] };
  const rendered = renderServiceWorker(crlf, build);
  assert.deepEqual(readServiceWorkerBuild(rendered), build);
  assert.equal(rendered.split("\r\n").length, crlf.split("\r\n").length);
});

test("a record that could break out of its line or describe another origin is refused", () => {
  const entry = "/assets/i.js";
  assert.throws(() => renderServiceWorker(template, { id: "x\"; alert(1); //", entry, precache: [entry] }), /build id/);
  assert.throws(() => renderServiceWorker(template, { id: "abc", entry: "https://cdn.example/i.js", precache: [] }), /entry/);
  assert.throws(() => renderServiceWorker(template, { id: "abc", entry, precache: [entry, "//cdn.example/x.js"] }), /precache/);
  assert.throws(() => renderServiceWorker(template, { id: "abc", entry, precache: [] }), /precached/);
});

test("the build step stamps the emitted worker from the files on disk", async (t) => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "kub-sw-build-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  await mkdir(path.join(outDir, "assets"), { recursive: true });
  await writeFile(path.join(outDir, "sw.js"), template);
  await writeFile(path.join(outDir, "index.html"), BUILT_INDEX);
  await writeFile(path.join(outDir, "assets", "index-YU1NL3MD.js"), "export {}");
  await writeFile(path.join(outDir, "assets", "index-BI8AuhlQ.css"), "body{}");

  const id = await stampServiceWorker(outDir);
  const stamped = readServiceWorkerBuild(await readFile(path.join(outDir, "sw.js"), "utf8"));
  assert.equal(stamped?.id, id);
  assert.equal(stamped?.entry, "/assets/index-YU1NL3MD.js");
  // The stylesheet travels with the entry: an offline shell that boots the
  // script without its styles is not a shell anyone can use.
  assert.deepEqual(stamped?.precache, [
    "/assets/index-YU1NL3MD.js",
    "/assets/vendor-Ab12Cd.js",
    "/assets/index-BI8AuhlQ.css",
  ]);
  assert.notDeepEqual(stamped, UNBUILT_SERVICE_WORKER);

  // The next build differs by one stylesheet byte, so its worker differs too.
  await writeFile(path.join(outDir, "sw.js"), template);
  await writeFile(path.join(outDir, "assets", "index-BI8AuhlQ.css"), "body{ }");
  assert.notEqual(await stampServiceWorker(outDir), id);
});

test("the build step fails the build when there is nothing to stamp", async (t) => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "kub-sw-build-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  await writeFile(path.join(outDir, "index.html"), BUILT_INDEX);
  await assert.rejects(stampServiceWorker(outDir), /sw\.js is missing/);

  await writeFile(path.join(outDir, "sw.js"), template);
  await writeFile(path.join(outDir, "index.html"), "<html><body>no entry</body></html>");
  await assert.rejects(stampServiceWorker(outDir), /no module entry/);
});
