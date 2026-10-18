import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import type { Rollup } from "../../artifacts/kub/node_modules/vite/dist/node/index.js";
import { serviceWorkerBuild, stampServiceWorker } from "../../artifacts/kub/serviceWorkerBuildPlugin.ts";
import { readServiceWorkerBuild } from "../../artifacts/kub/src/lib/pwa/serviceWorkerBuild.ts";

const template = await readFile(new URL("../../artifacts/kub/public/sw.js", import.meta.url), "utf8");
const photo = "/workspace/artifacts/kub/src/components/chat/attach/AttachPhotoEditor.tsx";
const video = "C:\\workspace\\artifacts\\kub\\src\\components\\chat\\attach\\AttachVideoEditor.tsx";

function chunk(fileName: string, facadeModuleId: string | null, imports: string[] = [], css: string[] = [], dynamicImports: string[] = []): Rollup.OutputChunk {
  return {
    type: "chunk", fileName, preliminaryFileName: fileName, name: fileName, facadeModuleId,
    isEntry: fileName === "assets/main.js", isDynamicEntry: facadeModuleId === photo || facadeModuleId === video,
    isImplicitEntry: false, imports, dynamicImports, implicitlyLoadedBefore: [], importedBindings: {}, exports: [],
    modules: {}, moduleIds: [], code: "export {};", map: null, sourcemapFileName: null, referencedFiles: [],
    viteMetadata: { importedCss: new Set(css), importedAssets: new Set() },
  };
}
function asset(fileName: string): Rollup.OutputAsset {
  return { type: "asset", fileName, names: [fileName], originalFileNames: [], source: "body{}", name: fileName, originalFileName: null, needsCodeReference: false };
}
function graph(): Rollup.OutputBundle {
  return {
    "assets/main.js": chunk("assets/main.js", "/workspace/index.html", ["assets/shared.js"], ["assets/main.css"], ["assets/photo.js", "assets/video.js", "assets/livekit.js"]),
    "assets/photo.js": chunk("assets/photo.js", photo, ["assets/main.js", "assets/shared.js"], ["assets/photo.css"]),
    "assets/video.js": chunk("assets/video.js", video, ["assets/main.js", "assets/shared.js"]),
    // Actual Rollup references are output filenames. The cycle exercises dedupe,
    // while the boot chunk's dynamic edges must not pull in unrelated tools.
    "assets/shared.js": chunk("assets/shared.js", null, ["assets/main.js"], ["assets/shared.css"]),
    "assets/livekit.js": chunk("assets/livekit.js", "/workspace/src/tools/LiveKit.tsx", [], ["assets/livekit.css"]),
    "assets/main.css": asset("assets/main.css"), "assets/photo.css": asset("assets/photo.css"),
    "assets/shared.css": asset("assets/shared.css"), "assets/livekit.css": asset("assets/livekit.css"),
  };
}
async function fixture(t: test.TestContext, bundle = graph(), base = "/") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kub-sw-editor-precache-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, item] of Object.entries(bundle)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), item.type === "chunk" ? item.code : item.source);
  }
  await writeFile(path.join(dir, "sw.js"), template);
  await writeFile(path.join(dir, "index.html"), `<script type="module" src="${base}assets/main.js"></script><link rel="stylesheet" href="${base}assets/main.css">`);
  return { dir, bundle };
}
async function run(dir: string, bundle: Rollup.OutputBundle, factory = serviceWorkerBuild) {
  const plugin = factory();
  const hook = plugin.writeBundle;
  assert.ok(hook && typeof hook !== "function");
  await hook.handler.call({ info() {} } as unknown as Rollup.PluginContext, { dir }, bundle);
  return readServiceWorkerBuild(await readFile(path.join(dir, "sw.js"), "utf8"));
}

test("actual writeBundle precaches only editor roots, static cyclic closure and Vite CSS, merged once with boot assets", async t => {
  const f = await fixture(t);
  const build = await run(f.dir, f.bundle);
  assert.deepEqual(build?.precache, [
    "/assets/main.js", "/assets/main.css", "/assets/photo.css", "/assets/photo.js",
    "/assets/shared.css", "/assets/shared.js", "/assets/video.js",
  ]);
  assert.equal(build?.entry, "/assets/main.js");
  assert.match(build?.id ?? "", /^[a-f0-9]{16}$/);
  assert.equal(build?.precache.some(file => file.includes("livekit")), false);
});

test("editor output references preserve the built document's nested base", async t => {
  const f = await fixture(t, graph(), "/qa/");
  assert.deepEqual((await run(f.dir, f.bundle))?.precache, [
    "/qa/assets/main.js", "/qa/assets/main.css", "/qa/assets/photo.css", "/qa/assets/photo.js",
    "/qa/assets/shared.css", "/qa/assets/shared.js", "/qa/assets/video.js",
  ]);
});

test("only exact normalized editor facade suffixes are roots, not filenames or other lazy tools", async t => {
  const bundle = graph();
  (bundle["assets/photo.js"] as Rollup.OutputChunk).facadeModuleId = "/unrelated/AttachPhotoEditor.tsx";
  (bundle["assets/video.js"] as Rollup.OutputChunk).facadeModuleId = "/workspace/src/components/chat/attach/AttachVideoEditor.tsx?other";
  const f = await fixture(t, bundle);
  assert.deepEqual((await run(f.dir, bundle))?.precache, ["/assets/main.js", "/assets/main.css"]);
});

for (const missing of ["assets/photo.js", "assets/shared.js", "assets/photo.css"]) {
  test(`declared editor file ${missing} missing on disk refuses before stamping`, async t => {
    const f = await fixture(t);
    await rm(path.join(f.dir, missing));
    await assert.rejects(run(f.dir, f.bundle), /missing emitted editor file/);
    assert.equal(await readFile(path.join(f.dir, "sw.js"), "utf8"), template);
  });
}

for (const missing of ["assets/shared.js", "assets/photo.css"]) {
  test(`declared dependency ${missing} missing from bundle refuses even if stale bytes exist on disk`, async t => {
    const f = await fixture(t);
    delete f.bundle[missing];
    await assert.rejects(run(f.dir, f.bundle), /missing editor graph file/);
    assert.equal(await readFile(path.join(f.dir, "sw.js"), "utf8"), template);
  });
}

for (const invalid of ["https://cdn.invalid/editor.js", "//cdn.invalid/editor.js", "/assets/editor.js", "../editor.js", "assets/../editor.js", "assets/%2e%2e/editor.js", "assets\\editor.js", "assets/editor.js?old"]) {
  test(`unsafe static reference ${invalid} is refused`, async t => {
    const f = await fixture(t);
    (f.bundle["assets/photo.js"] as Rollup.OutputChunk).imports.push(invalid);
    await assert.rejects(run(f.dir, f.bundle), /invalid editor asset path/);
    assert.equal(await readFile(path.join(f.dir, "sw.js"), "utf8"), template);
  });
}

test("unsafe CSS, wrong dependency kind and mismatched output identity refuse", async t => {
  const f = await fixture(t);
  const photoChunk = f.bundle["assets/photo.js"] as Rollup.OutputChunk;
  photoChunk.viteMetadata!.importedCss.add("../external.css");
  await assert.rejects(run(f.dir, f.bundle), /invalid editor asset path/);
  photoChunk.viteMetadata!.importedCss.delete("../external.css");
  f.bundle["assets/shared.js"] = asset("assets/shared.js");
  await assert.rejects(run(f.dir, f.bundle), /invalid editor graph file/);
  f.bundle["assets/shared.js"] = chunk("assets/renamed.js", null);
  await assert.rejects(run(f.dir, f.bundle), /invalid editor graph file/);
});

test("direct stamp default remains boot-only; optional same-build extras dedupe and validate disk", async t => {
  const f = await fixture(t);
  await stampServiceWorker(f.dir);
  assert.deepEqual(readServiceWorkerBuild(await readFile(path.join(f.dir, "sw.js"), "utf8"))?.precache, ["/assets/main.js", "/assets/main.css"]);
  await writeFile(path.join(f.dir, "sw.js"), template);
  await stampServiceWorker(f.dir, ["assets/photo.js", "assets/photo.js", "assets/main.js"]);
  assert.deepEqual(readServiceWorkerBuild(await readFile(path.join(f.dir, "sw.js"), "utf8"))?.precache, ["/assets/main.js", "/assets/main.css", "/assets/photo.js"]);
  await writeFile(path.join(f.dir, "sw.js"), template);
  await assert.rejects(stampServiceWorker(f.dir, ["../photo.js"]), /invalid editor asset path/);
  await assert.rejects(stampServiceWorker(f.dir, ["assets/stale.js"]), /missing emitted editor file/);
  assert.equal(await readFile(path.join(f.dir, "sw.js"), "utf8"), template);
});

for (const [name, before, after] of [
  ["photo root", '"/src/components/chat/attach/AttachPhotoEditor.tsx"', '"/src/components/chat/attach/NotThePhotoEditor.tsx"'],
  ["static imports", "for (const dependency of [...chunk.imports].sort()) visit(dependency);", "void chunk.imports;"],
  ["Vite CSS", "for (const css of [...(chunk.viteMetadata?.importedCss ?? [])].sort()) {", "for (const css of [] as string[]) {"],
]) {
  test(`loaded omission of ${name} fails the literal installed-precache acceptance`, async t => {
    const url = new URL("../../artifacts/kub/serviceWorkerBuildPlugin.ts", import.meta.url);
    const source = await readFile(url, "utf8");
    assert.equal(source.split(before).length, 2, "one actual source omission anchor");
    const changed = source.replace(before, after).replace('"./src/lib/pwa/serviceWorkerBuild.ts"', JSON.stringify(new URL("../../artifacts/kub/src/lib/pwa/serviceWorkerBuild.ts", import.meta.url).href));
    const compiled = ts.transpileModule(changed, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const mutant = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
    const f = await fixture(t);
    await assert.rejects(async () => assert.deepEqual((await run(f.dir, f.bundle, mutant.serviceWorkerBuild))?.precache, [
      "/assets/main.js", "/assets/main.css", "/assets/photo.css", "/assets/photo.js",
      "/assets/shared.css", "/assets/shared.js", "/assets/video.js",
    ]), error => error instanceof assert.AssertionError && Array.isArray(error.actual));
  });
}
