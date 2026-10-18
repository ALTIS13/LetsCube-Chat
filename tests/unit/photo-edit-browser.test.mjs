import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "@playwright/test";
import sharp from "sharp";

const lib = new URL("../../artifacts/kub/src/lib/", import.meta.url);
const sourcePath = new URL("photoEdit.ts", lib);
const kubRequire = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { build } = createRequire(kubRequire.resolve("vite"))("esbuild");

async function compositor(mutation) {
  // The shipped preparation path can encode, but has no edit intent. This is
  // the behavioral baseline until the new module exists, not a fake compositor.
  let source = existsSync(sourcePath) ? readFileSync(sourcePath, "utf8") : `
    import {prepareChatImageAttachment,readMediaDimensions} from './mediaUpload.ts';
    export async function renderPhotoEditPreview(file){return{file,...await readMediaDimensions(file),changed:false};}
    export async function exportPhotoEdit(file,intent,options){const value=await prepareChatImageAttachment(file,options.quality);
      return{file:value.file,...value.dimensions,changed:value.file!==file};}
  `;
  if (mutation) source = mutation(source);
  const result = await build({ stdin: { contents: source, resolveDir: fileURLToPath(lib),
    sourcefile: "photoEdit.ts", loader: "ts" }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
  return result.outputFiles[0].text;
}

const fixture = `
export async function image(width=120,height=80,transparent=false){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='rgb(240,20,30)';ctx.fillRect(0,0,width/2,height/2);
  if(!transparent){ctx.fillStyle='rgb(20,180,40)';ctx.fillRect(width/2,0,width/2,height/2);}
  ctx.fillStyle='rgb(20,40,220)';ctx.fillRect(0,height/2,width/2,height/2);
  if(!transparent){ctx.fillStyle='rgb(240,210,20)';ctx.fillRect(width/2,height/2,width/2,height/2);}
  const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));canvas.width=canvas.height=0;
  return new File([blob],'fictional.png',{type:'image/png',lastModified:123});
}
export async function pixels(file,points){
  const url=URL.createObjectURL(file),img=new Image();
  try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
    const result={width:canvas.width,height:canvas.height,pixels:points.map(([x,y])=>[...ctx.getImageData(x,y,1,1).data])};
    canvas.width=canvas.height=0;return result;
  }finally{img.removeAttribute('src');URL.revokeObjectURL(url);}
}
`;

async function browserFixture(t, engine, mutation) {
  const code = await compositor(mutation), errors = [], requests = [];
  const server = createServer((req, res) => {
    if (!["/", "/photo.mjs", "/fixture.mjs"].includes(req.url)) { requests.push(req.url); res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": req.url === "/" ? "text/html" : "text/javascript" });
    res.end(req.url === "/" ? "<!doctype html><title>Fictional photo compositor</title>" : req.url === "/photo.mjs" ? code : fixture);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await engine.launch({ headless: true }); t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" }); t.after(() => context.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin !== origin) { requests.push("OFF_ORIGIN"); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(async () => { window.photo = await import("/photo.mjs"); window.f = await import("/fixture.mjs"); });
  t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(requests, []); });
  return page;
}

for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
  test(`${name}: photo compositor uses rotated natural crop and bakes opaque cover/round pen into PNG`, { timeout: 30000 }, async t => {
    const page = await browserFixture(t, engine);
    const result = await page.evaluate(async () => {
      const file = await f.image();
      const source = await f.pixels(file, [[10, 10], [10, 70]]);
      const result = await photo.renderPhotoEditPreview(file, { rotation: 90, crop: { x: 0, y: 0, width: 40, height: 60 },
        marks: [{ kind: "cover", x: .25, y: .25, width: .5, height: .5 },
          { kind: "pen", points: [{ x: .1, y: .1 }], color: "#ff0000", width: .1 }] });
      return { source, changed: result.changed, width: result.width, height: result.height, type: result.file.type,
        output: await f.pixels(result.file, [[1, 1], [20, 30], [4, 6]]) };
    });
    assert.deepEqual(result, { source: { width: 120, height: 80, pixels: [[240, 20, 30, 255], [20, 40, 220, 255]] },
      changed: true, width: 40, height: 60, type: "image/png",
      output: { width: 40, height: 60, pixels: [[20, 40, 220, 255], [0, 0, 0, 255], [255, 0, 0, 255]] } });
  });

  test(`${name}: no-op preserves exact File while explicit full crop is also no-op`, { timeout: 30000 }, async t => {
    const page = await browserFixture(t, engine);
    const result = await page.evaluate(async () => {
      const file = await f.image();
      const one = await photo.renderPhotoEditPreview(file, { rotation: 0, crop: null, marks: [] });
      const two = await photo.exportPhotoEdit(file, { rotation: 0, crop: { x: 0, y: 0, width: 120, height: 80 }, marks: [] }, { quality: "compact" });
      return [one.file === file, two.file === file, one.changed, two.changed, one.width, two.height];
    });
    assert.deepEqual(result, [true, true, false, false, 120, 80]);
  });

  test(`${name}: every clockwise quarter-turn keeps the hand-checked corner order`, { timeout: 30000 }, async t => {
    const page = await browserFixture(t, engine);
    const result = await page.evaluate(async () => {
      const file = await f.image(), outputs = [];
      for (const rotation of [90, 180, 270]) {
        const result = await photo.renderPhotoEditPreview(file, { rotation, crop: null, marks: [] });
        outputs.push(await f.pixels(result.file, [[5, 5], [result.width - 6, 5], [5, result.height - 6], [result.width - 6, result.height - 6]]));
      }
      return outputs;
    });
    const red = [240, 20, 30, 255], green = [20, 180, 40, 255], blue = [20, 40, 220, 255], yellow = [240, 210, 20, 255];
    assert.deepEqual(result, [
      { width: 80, height: 120, pixels: [blue, red, yellow, green] },
      { width: 120, height: 80, pixels: [yellow, blue, green, red] },
      { width: 80, height: 120, pixels: [green, yellow, red, blue] },
    ]);
  });

  test(`${name}: pen caps/joins are rounded and fractional cover edges contain no source sliver`, { timeout: 30000 }, async t => {
    const page = await browserFixture(t, engine);
    const result = await page.evaluate(async () => {
      const file = await f.image(80, 80);
      const pen = await photo.renderPhotoEditPreview(file, { rotation: 0, crop: null,
        marks: [{ kind: "pen", points: [{ x: .25, y: .5 }, { x: .5, y: .5 }, { x: .5, y: .75 }], color: "#ff00ff", width: .2 }] });
      const cover = await photo.renderPhotoEditPreview(file, { rotation: 0, crop: null,
        marks: [{ kind: "cover", x: .205, y: .205, width: .3, height: .3 }] });
      return { pen: await f.pixels(pen.file, [[13, 40], [13, 33], [47, 33]]),
        cover: await f.pixels(cover.file, [[16, 16], [40, 40]]) };
    });
    assert.deepEqual(result.pen, { width: 80, height: 80, pixels: [[255, 0, 255, 255], [240, 20, 30, 255], [20, 180, 40, 255]] });
    assert.deepEqual(result.cover, { width: 80, height: 80, pixels: [[0, 0, 0, 255], [0, 0, 0, 255]] });
  });

  test(`${name}: final output follows literal SD/balanced/HD sizes and its actual MIME`, { timeout: 30000 }, async t => {
    const page = await browserFixture(t, engine);
    const result = await page.evaluate(async () => {
      const file = await f.image(3000, 3000), outputs = [];
      const probe = document.createElement("canvas"); probe.width = probe.height = 1;
      const webp = (await new Promise(resolve => probe.toBlob(resolve, "image/webp"))).type === "image/webp";
      probe.width = probe.height = 0;
      for (const quality of ["compact", "balanced", "original"]) {
        const result = await photo.exportPhotoEdit(file, { rotation: 0, crop: null,
          marks: [{ kind: "cover", x: .25, y: .25, width: .5, height: .5 }] }, { quality });
        const bytes = new Uint8Array(await result.file.arrayBuffer());
        const magic = result.file.type === "image/webp" ? String.fromCharCode(...bytes.slice(8, 12)) : [...bytes.slice(0, 3)].join(",");
        outputs.push({ changed: result.changed, width: result.width, height: result.height,
          type: result.file.type, name: result.file.name, magic,
          pixel: (await f.pixels(result.file, [[result.width / 2, result.height / 2]])).pixels[0] });
      }
      return { webp, outputs };
    });
    const type = result.webp ? "image/webp" : "image/jpeg", extension = result.webp ? "webp" : "jpg";
    assert.deepEqual(result.outputs.map(output => ({ ...output, pixel: undefined })), [1280, 1920, 2560].map(size => ({
      changed: true, width: size, height: size, type, name: `fictional-edit.${extension}`,
      magic: result.webp ? "WEBP" : "255,216,255", pixel: undefined,
    })));
    for (const output of result.outputs) {
      assert.equal(output.pixel[3], 255);
      assert.ok(output.pixel.slice(0, 3).every(value => value <= 3), "flattened cover remains black after final encode");
    }
  });

  test(`${name}: transparent preview keeps alpha and final JPEG fallback uses white rather than black`, { timeout: 30000 }, async t => {
    const page = await browserFixture(t, engine);
    const result = await page.evaluate(async () => {
      const file = await f.image(80, 80, true), intent = { rotation: 0, crop: null,
        marks: [{ kind: "cover", x: .5, y: .5, width: .5, height: .5 }] };
      const preview = await photo.renderPhotoEditPreview(file, intent);
      const native = HTMLCanvasElement.prototype.toBlob;
      let final;
      try {
        // A real native PNG at the existing 1x1 capability leaf models an
        // engine without WebP. The final JPEG encode and pixels remain native.
        HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
          return native.call(this, callback, this.width === 1 && this.height === 1 && type === "image/webp" ? "image/png" : type, quality);
        };
        final = await photo.exportPhotoEdit(file, intent, { quality: "original" });
      } finally { HTMLCanvasElement.prototype.toBlob = native; }
      return { preview: await f.pixels(preview.file, [[60, 10], [60, 60]]),
        finalType: final.file.type, final: await f.pixels(final.file, [[60, 10], [60, 60]]) };
    });
    assert.deepEqual(result.preview, { width: 80, height: 80, pixels: [[0, 0, 0, 0], [0, 0, 0, 255]] });
    assert.equal(result.finalType, "image/jpeg");
    assert.deepEqual(result.final.pixels[0], [255, 255, 255, 255]);
    assert.ok(result.final.pixels[1].slice(0, 3).every(value => value <= 3));
    assert.equal(result.final.pixels[1][3], 255);
  });

  test(`${name}: an edit that grows in bytes stays baked and captures its recipe before asynchronous decode`, { timeout: 30000 }, async t => {
    const page = await browserFixture(t, engine);
    const result = await page.evaluate(async () => {
      const file = await f.image(32, 32);
      const marks = Array.from({ length: 64 }, (_, i) => ({ kind: "pen", width: .1,
        points: [{ x: ((i % 8) + .5) / 8, y: (Math.floor(i / 8) + .5) / 8 }],
        color: "#" + ((i * 1234567) % 0xffffff).toString(16).padStart(6, "0") }));
      marks.push({ kind: "cover", x: .25, y: .25, width: .5, height: .5 });
      const intent = { rotation: 0, crop: null, marks };
      const pending = photo.exportPhotoEdit(file, intent, { quality: "original" });
      intent.rotation = 90; marks.at(-1).x = NaN; marks[0].points[0].x = NaN;
      const result = await pending;
      return { changed: result.changed, same: result.file === file, grew: result.file.size > file.size,
        center: (await f.pixels(result.file, [[16, 16]])).pixels[0] };
    });
    assert.deepEqual({ ...result, center: undefined }, { changed: true, same: false, grew: true, center: undefined });
    assert.equal(result.center[3], 255); assert.ok(result.center.slice(0, 3).every(value => value <= 3));
  });

  test(`${name}: native EXIF orientation is honored before the explicit quarter-turn`, { timeout: 30000 }, async t => {
    const page = await browserFixture(t, engine);
    const svg = '<svg width="80" height="60" xmlns="http://www.w3.org/2000/svg"><path fill="#f0141e" d="M0 0h40v30H0z"/><path fill="#14b428" d="M40 0h40v30H40z"/><path fill="#1428dc" d="M0 30h40v30H0z"/><path fill="#f0d214" d="M40 30h40v30H40z"/></svg>';
    const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).withMetadata({ orientation: 6 }).toBuffer();
    const result = await page.evaluate(async bytes => {
      const file = new File([new Uint8Array(bytes)], "oriented.jpg", { type: "image/jpeg" });
      const source = await f.pixels(file, [[10, 10]]);
      const result = await photo.renderPhotoEditPreview(file, { rotation: 90, crop: null, marks: [] });
      return { source, width: result.width, height: result.height, output: await f.pixels(result.file, [[10, 10]]) };
    }, [...jpeg]);
    assert.deepEqual([result.source.width, result.source.height, result.width, result.height], [60, 80, 80, 60]);
    for (const [got, want] of [[result.source.pixels[0], [20, 40, 220, 255]], [result.output.pixels[0], [240, 210, 20, 255]]]) {
      assert.ok(got.every((value, index) => Math.abs(value - want[index]) <= 4));
    }
  });

  test(`${name}: invalid recipes/decode/export reject and a large natural source gets only a bounded result canvas`, { timeout: 30000 }, async t => {
    const page = await browserFixture(t, engine);
    const result = await page.evaluate(async () => {
      const file = await f.image(), valid = { rotation: 0, crop: null, marks: [] };
      const invalid = [
        { ...valid, rotation: 45 }, { ...valid, crop: { x: -1, y: 0, width: 10, height: 10 } },
        { ...valid, crop: { x: 0, y: 0, width: 0, height: 10 } },
        { ...valid, crop: { x: 119, y: 0, width: 2, height: 10 } },
        { ...valid, crop: { x: 0, y: 0, width: Infinity, height: 1 } },
        { ...valid, marks: [{ kind: "cover", x: .9, y: 0, width: .2, height: .2 }] },
        { ...valid, marks: [{ kind: "pen", points: [], color: "red", width: .1 }] },
        { ...valid, marks: [{ kind: "pen", points: [{ x: NaN, y: .1 }], color: "red", width: .1 }] },
        { ...valid, marks: [{ kind: "pen", points: [{ x: .1, y: .1 }], color: "not-a-color", width: .1 }] },
        { ...valid, marks: [{ kind: "pen", points: [{ x: .1, y: .1 }], color: "red", width: 0 }] },
      ];
      const errors = [];
      for (const intent of invalid) { try { await photo.renderPhotoEditPreview(file, intent); errors.push("RESOLVED"); } catch (error) { errors.push(error.message); } }
      for (const bad of [new File(["bad"], "bad.png", { type: "image/png" }), new File(["GIF89a"], "animated.gif", { type: "image/gif" })]) {
        try { await photo.renderPhotoEditPreview(bad, valid); errors.push("RESOLVED"); } catch (error) { errors.push(error.message); }
      }
      try { await photo.exportPhotoEdit(file, valid, { quality: "invented" }); errors.push("RESOLVED"); } catch (error) { errors.push(error.message); }
      const native = HTMLCanvasElement.prototype.toBlob;
      try {
        HTMLCanvasElement.prototype.toBlob = function(callback) { callback(null); };
        try { await photo.renderPhotoEditPreview(file, { ...valid, rotation: 90 }); errors.push("RESOLVED"); } catch (error) { errors.push(error.message); }
      } finally { HTMLCanvasElement.prototype.toBlob = native; }
      const large = await f.image(8192, 64);
      const bounded = await photo.renderPhotoEditPreview(large, { ...valid, rotation: 180 });
      return { errors, bounded: [bounded.width, bounded.height] };
    });
    assert.deepEqual(result.errors, ["PHOTO_EDIT_INVALID_INTENT", ...Array(4).fill("PHOTO_EDIT_INVALID_CROP"),
      ...Array(5).fill("PHOTO_EDIT_INVALID_MARK"), "PHOTO_EDIT_DECODE_FAILED", "PHOTO_EDIT_UNSUPPORTED_FILE",
      "PHOTO_EDIT_INVALID_QUALITY", "PHOTO_EDIT_EXPORT_FAILED"]);
    assert.deepEqual(result.bounded, [4096, 32]);
  });

  test(`${name}: abort before decode, during decode and after native PNG encode rejects and disposes owned resources`, { timeout: 30000 }, async t => {
    const page = await browserFixture(t, engine);
    const result = await page.evaluate(async () => {
      const file = await f.image(), intent = { rotation: 90, crop: null, marks: [] };
      const nativeCreate = URL.createObjectURL, nativeRevoke = URL.revokeObjectURL;
      const nativeElement = document.createElement, nativeBlob = HTMLCanvasElement.prototype.toBlob;
      const active = new Set(), canvases = []; let created = 0, revoked = 0, release;
      URL.createObjectURL = function(blob) { const url = nativeCreate.call(this, blob); active.add(url); created++; return url; };
      URL.revokeObjectURL = function(url) { active.delete(url); revoked++; return nativeRevoke.call(this, url); };
      document.createElement = function(name, ...rest) { const node = nativeElement.call(this, name, ...rest); if (name === "canvas") canvases.push(node); return node; };
      const errors = [];
      try {
        const before = new AbortController(); before.abort();
        try { await photo.renderPhotoEditPreview(file, intent, before.signal); errors.push("RESOLVED"); } catch (error) { errors.push(error.name); }
        const during = new AbortController(), decoding = photo.renderPhotoEditPreview(file, intent, during.signal); during.abort();
        try { await decoding; errors.push("RESOLVED"); } catch (error) { errors.push(error.name); }
        let entered; const encoded = new Promise(resolve => { entered = resolve; });
        HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
          nativeBlob.call(this, blob => { release = () => callback(blob); entered(); }, ...args);
        };
        const late = new AbortController(), pending = photo.renderPhotoEditPreview(file, intent, late.signal);
        await encoded; late.abort();
        try { await pending; errors.push("RESOLVED"); } catch (error) { errors.push(error.name); }
        return { errors, created, revoked, active: active.size, disposed: canvases.every(canvas => canvas.width === 0 && canvas.height === 0) };
      } finally {
        release?.(); URL.createObjectURL = nativeCreate; URL.revokeObjectURL = nativeRevoke;
        document.createElement = nativeElement; HTMLCanvasElement.prototype.toBlob = nativeBlob;
      }
    });
    assert.deepEqual(result, { errors: ["AbortError", "AbortError", "AbortError"], created: 2, revoked: 2, active: 0, disposed: true });
  });
}

for (const [name, before, after] of [
  ["opaque-cover", 'ctx.fillStyle = "#000000";', 'ctx.fillStyle = "rgba(0,0,0,0)";'],
  ["round-cap", 'ctx.lineCap = "round";', 'ctx.lineCap = "butt";'],
  ["original-export-fallback", ': reject(failure("EXPORT_FAILED"))', ': resolve(file)'],
]) test(`literal ${name} omission is killed by actual pixels or export refusal`, { timeout: 30000 }, async t => {
  const page = await browserFixture(t, chromium, source => {
    assert.equal(source.split(before).length, 2); return source.replace(before, after);
  });
  const result = await page.evaluate(async name => {
    const file = await f.image(80, 80);
    if (name === "original-export-fallback") {
      const native = HTMLCanvasElement.prototype.toBlob;
      try {
        HTMLCanvasElement.prototype.toBlob = callback => callback(null);
        try { await photo.renderPhotoEditPreview(file, { rotation: 90, crop: null, marks: [] }); return "RESOLVED"; }
        catch (error) { return error.message; }
      } finally { HTMLCanvasElement.prototype.toBlob = native; }
    }
    const marks = name === "opaque-cover" ? [{ kind: "cover", x: 0, y: 0, width: .5, height: .5 }]
      : [{ kind: "pen", points: [{ x: .25, y: .5 }, { x: .75, y: .5 }], color: "#ff00ff", width: .2 }];
    const result = await photo.renderPhotoEditPreview(file, { rotation: 0, crop: null, marks });
    return (await f.pixels(result.file, [name === "opaque-cover" ? [10, 10] : [13, 40]])).pixels[0];
  }, name);
  if (name === "original-export-fallback") {
    assert.throws(() => assert.equal(result, "PHOTO_EDIT_EXPORT_FAILED"), { code: "ERR_ASSERTION", actual: "RESOLVED" });
  } else {
    const expected = name === "opaque-cover" ? [0, 0, 0, 255] : [255, 0, 255, 255];
    assert.throws(() => assert.deepEqual(result, expected), { code: "ERR_ASSERTION" });
    assert.deepEqual(result, name === "opaque-cover" ? [240, 20, 30, 255] : [20, 40, 220, 255]);
  }
});
