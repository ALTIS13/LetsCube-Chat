import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const kubRequire = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium, webkit } = kubRequire("@playwright/test");
const browserName = process.env.PHOTO_EDITOR_BROWSER ?? "chromium";
assert.ok(["chromium", "webkit"].includes(browserName));
const { build } = createRequire(kubRequire.resolve("vite"))("esbuild");
const tw = createRequire(kubRequire.resolve("@tailwindcss/vite"));
const { compile, optimize } = tw("@tailwindcss/node");
const { Scanner } = tw("@tailwindcss/oxide");
const src = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const output = mkdtempSync(join(tmpdir(), "letscube-photo-editor-ui-"));
const origin = "https://photo-editor.invalid";
const results = [];
let browser, bundle, css;

test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
  const built = await build({
    write: false, outdir: join(output, "bundle"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": src },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": JSON.stringify({
      VITE_SUPABASE_URL: origin, VITE_SUPABASE_ANON_KEY: "synthetic-fixture", VITE_MEDIA_SIGNED_URLS: "signed-only",
    }) },
    plugins: [{ name: "controlled-real-photo-helper", setup(plugin) {
      plugin.onResolve({ filter: /^@\/lib\/photoEdit$/ }, () => ({ path: "photo-boundary", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", resolveDir: src, contents: `
        import {renderPhotoEditPreview as preview, exportPhotoEdit as output} from ${JSON.stringify(join(src, "lib/photoEdit.ts"))};
        async function invoke(kind,file,intent,signal,quality) {
          const call={kind,intent:structuredClone(intent),quality,aborted:signal?.aborted ?? false};
          window.boundary.calls.push(call);
          signal?.addEventListener('abort',()=>call.aborted=true,{once:true});
          if(window.boundary.fail===kind){window.boundary.fail=null;throw new Error('synthetic-export-failure');}
          const result=await(kind==='preview'?preview(file,intent,signal):output(file,intent,{signal,quality}));
          if(window.boundary.hold===kind) await new Promise(resolve=>window.boundary.pending.push(resolve));
          return result;
        }
        export const renderPhotoEditPreview=(file,intent,signal)=>invoke('preview',file,intent,signal);
        export const exportPhotoEdit=(file,intent,options)=>invoke('export',file,intent,options.signal,options.quality);
      ` }));
      if (process.env.PHOTO_EDITOR_MUTANT) plugin.onLoad({ filter: /AttachPhotoEditor\.tsx$/ }, args => {
        let contents = readFileSync(args.path, "utf8").replace(/\r\n/g, "\n");
        const changes = {
          "late-apply": ["if (!isCurrent(operation)) return;\n    let accepted", "let accepted"],
          "omit-abort": ["operationRef.current?.controller.abort();", "void operationRef.current;"],
          "empty-stroke": ["if (distance < 2) return;", "if (distance < 0) return;"],
          "back-keeps-marks": ["setStage(\"geometry\");\n    setMarks([]);", "setStage(\"geometry\");"],
        };
        const change = changes[process.env.PHOTO_EDITOR_MUTANT];
        assert.ok(change && contents.includes(change[0]), "literal mutation must match actual source");
        return { contents: contents.replace(change[0], change[1]), loader: "tsx" };
      });
    } }],
    stdin: { resolveDir: src, sourcefile: "photo-editor-ui-fixture.tsx", loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import AttachPhotoEditor from './components/chat/attach/AttachPhotoEditor';
      const root=createRoot(document.getElementById('root'));
      const nativeCreate=URL.createObjectURL.bind(URL),nativeRevoke=URL.revokeObjectURL.bind(URL);
      window.activeURLs=new Set();
      URL.createObjectURL=value=>{const url=nativeCreate(value);window.activeURLs.add(url);return url;};
      URL.revokeObjectURL=url=>{window.activeURLs.delete(url);nativeRevoke(url);};
      window.boundary={calls:[],pending:[],hold:null,fail:null};
      window.proof={apply:0,cancel:0,restore:0};
      window.unmount=()=>flushSync(()=>root.render(null));
      window.release=()=>{window.boundary.hold=null;window.boundary.pending.splice(0).forEach(resolve=>resolve());};
      window.mount=async(options={})=>{
        window.unmount();if(window.inputURL)URL.revokeObjectURL(window.inputURL);
        const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
        const c=canvas.getContext('2d');c.fillStyle='#87c8e7';c.fillRect(0,0,640,480);
        c.fillStyle='#36815a';c.fillRect(0,300,640,180);c.fillStyle='#f4dc7a';c.fillRect(150,120,340,240);
        c.fillStyle='#d14f4f';c.fillRect(210,180,100,100);c.fillStyle='#ffffff';c.fillRect(350,180,80,100);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        window.inputFile=new File([blob],'synthetic-photo.png',{type:options.gif?'image/gif':'image/png'});
        window.inputURL=URL.createObjectURL(window.inputFile);
        if(options.cached){const image=new Image();image.src=window.inputURL;await image.decode();}
        window.boundary={calls:[],pending:[],hold:null,fail:null};
        window.proof={apply:0,cancel:0,restore:0};
        const props={file:window.inputFile,url:window.inputURL,quality:'original',
          onApply:result=>{if(window.boundary.rejectApplyOnce){window.boundary.rejectApplyOnce=false;window.proof.applyRejected=1;return false;}
            window.proof.apply++;window.proof.sameFile=result.file===window.inputFile;
            window.proof.changed=result.changed;window.proof.width=result.width;window.proof.height=result.height;window.result=result;},
          onCancel:()=>{window.proof.cancel++;},...(options.restore?{onRestore:()=>window.proof.restore++}:{})};
        window.currentProps=props;flushSync(()=>root.render(<AttachPhotoEditor {...props}/>));
      };
      window.replaceFile=()=>{
        const file=new File([window.inputFile],'replacement.png',{type:'image/png'});
        const url=URL.createObjectURL(file);window.currentProps={...window.currentProps,file,url};
        flushSync(()=>root.render(<AttachPhotoEditor {...window.currentProps}/>));
      };
    ` },
  });
  bundle = built.outputFiles.find(file => file.path.endsWith(".js")).text;
  const compiler = await compile(readFileSync(join(src, "index.css"), "utf8"), { base: src, onDependency() {} });
  css = optimize(compiler.build(new Scanner({}).scanFiles([{ content: bundle, extension: "js" }]))).code
    + built.outputFiles.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n");
  browser = await (browserName === "webkit" ? webkit : chromium).launch({ headless: true, env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" } });
});

test.after(async () => {
  await browser?.close();
  writeFileSync(join(output, "metadata.json"), JSON.stringify({ browser: browserName, syntheticOnly: true, auth: false, results }, null, 2));
  console.log(`Photo editor UI evidence: ${output}`);
});

async function fixture(width = 390, theme = "dark", options = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const unexpected = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.protocol === "blob:" && url.origin === origin && route.request().method() === "GET"
      && await page.evaluate(value => window.activeURLs.has(value), url.href)) return route.continue();
    if (url.origin === origin && route.request().method() === "GET") {
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html class="${theme}" lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body><button id="outside">Outside synthetic control</button><div id="root"></div><script src="/fixture.js"></script></body></html>` });
      if (url.pathname === "/fixture.css") return route.fulfill({ contentType: "text/css", body: css });
      if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
      if (/^\/fonts\/inter\/inter-(latin|latin-ext|cyrillic|cyrillic-ext)\.woff2$/.test(url.pathname)) return route.fulfill({ contentType: "font/woff2", body: readFileSync(new URL(`../../artifacts/kub/public${url.pathname}`, import.meta.url)) });
    }
    unexpected.push("unlisted-request");return route.abort();
  });
  await page.goto(origin);
  await page.locator("#outside").focus();
  await page.evaluate(options => window.mount(options), options);
  try {
    if (!options.gif) await page.locator('[data-photo-editor-tool="apply"]:not([disabled])').waitFor({ timeout: 5000 });
  } catch {
    const state = await page.evaluate(() => ({
      images:[...document.querySelectorAll('.reactEasyCrop_Image')].map(node=>({complete:node.complete,width:node.naturalWidth,height:node.naturalHeight})),
      crop:document.querySelector('.reactEasyCrop_CropArea')?.getBoundingClientRect().toJSON(),
    }));
    results.push({startupRefused:true,browser:browserName,state,errors,unexpected});
    await context.close();
    throw new Error(`Synthetic editor startup refused: ${JSON.stringify({state,errors,unexpected})}`);
  }
  return { page, context, unexpected, errors };
}

const tool = (page, name) => page.locator(`[data-photo-editor-tool="${name}"]`);
async function draw(page, start, end) {
  const box = await page.locator("[data-photo-editor-markup]").boundingBox();
  await page.mouse.move(box.x + box.width * start[0], box.y + box.height * start[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * end[0], box.y + box.height * end[1], { steps: 6 });
  await page.mouse.up();
}
async function markup(page) {
  await tool(page, "markup").click();
  await page.locator('[data-photo-editor-stage="markup"]').waitFor();
}

for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
  test(`${width} ${theme}: real cropper, cover and pen fit a stable full-screen viewport`, async () => {
    const f = await fixture(width, theme);
    try {
      const { page } = f;
      await page.evaluate(async () => { await document.fonts.ready; });
      const initial = await page.locator("[data-photo-editor]").boundingBox();
      assert.equal(initial.width, width);assert.equal(initial.x, 0);assert.equal(initial.y, 0);
      assert.equal(await page.locator(".reactEasyCrop_Container").count(), 1);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll("style")].some(node => node.textContent.includes(".reactEasyCrop_Container"))), false,
        "cropper styles must come from the packaged CSS import, not runtime injection");
      await page.screenshot({ path: join(output, `${width}-${theme}-geometry.png`) });
      await markup(page);
      await tool(page, "cover").click();await draw(page, [.25, .28], [.47, .58]);
      await tool(page, "pen").click();await draw(page, [.6, .65], [.8, .8]);
      assert.equal(await page.locator('[data-photo-editor-mark="cover"]').count(), 1);
      assert.equal(await page.locator('[data-photo-editor-mark="pen"]').count(), 1);
      assert.equal(await page.locator('[data-photo-editor-mark="cover"]').getAttribute("fill"), "#000000");
      const fit = await page.locator("[data-photo-editor]").evaluate(root => ({
        transform: getComputedStyle(root).transform,
        overflow: document.documentElement.scrollWidth > innerWidth,
        controls: [...root.querySelectorAll("button,select,input[type=range]")].map(node => {
          const r=node.getBoundingClientRect();return {width:r.width,height:r.height,inside:r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight};
        }),
      }));
      assert.equal(fit.transform, "none");assert.equal(fit.overflow, false);
      assert.ok(fit.controls.every(c => c.width >= 44 && c.height >= 44 && c.inside));
      assert.deepEqual(await page.locator("[data-photo-editor]").boundingBox(), initial);
      await page.mouse.move(1, 1);
      await page.screenshot({ path: join(output, `${width}-${theme}-markup.png`) });
      assert.deepEqual(f.errors, []);assert.deepEqual(f.unexpected, []);
      results.push({ width, theme, fit, errors: f.errors, unexpected: f.unexpected });
    } finally { await f.context.close(); }
  });
}

test("no-op Apply returns the exact current File without flattening it", async () => {
  const f = await fixture();
  try {
    await tool(f.page, "apply").click();
    await f.page.waitForFunction(() => window.proof.apply === 1);
    assert.deepEqual(await f.page.evaluate(() => ({same:window.proof.sameFile,changed:window.proof.changed})), { same: true, changed: false });
  } finally { await f.context.close(); }
});

test("already decoded current pick initializes and Reset keeps that current File, not raw restore", async () => {
  const f = await fixture(390, "dark", { cached: true, restore: true });
  try {
    await tool(f.page, "rotate").click();await markup(f.page);
    await draw(f.page, [.2,.2], [.5,.5]);await tool(f.page, "reset").click();
    await f.page.locator('[data-photo-editor-stage="geometry"]').waitFor();
    await tool(f.page, "apply").click();await f.page.waitForFunction(() => window.proof.apply === 1);
    assert.deepEqual(await f.page.evaluate(() => ({same:window.proof.sameFile,changed:window.proof.changed,restore:window.proof.restore})),
      {same:true,changed:false,restore:0});
  } finally { await f.context.close(); }
});

test("actual crop/quarter-turn/zoom are passed in rotated natural pixels", async () => {
  const f = await fixture();
  try {
    await tool(f.page, "rotate").click();
    await tool(f.page, "aspect").selectOption("1");
    await tool(f.page, "zoom").fill("1.5");
    await tool(f.page, "apply").click();
    await f.page.waitForFunction(() => window.proof.apply === 1);
    const result = await f.page.evaluate(() => ({call:window.boundary.calls.at(-1),proof:window.proof}));
    assert.equal(result.call.intent.rotation, 90);assert.ok(result.call.intent.crop);
    assert.ok(result.call.intent.crop.x + result.call.intent.crop.width <= 480);
    assert.ok(result.call.intent.crop.y + result.call.intent.crop.height <= 640);
    assert.equal(result.proof.changed, true);assert.equal(result.proof.width, result.proof.height);
  } finally { await f.context.close(); }
});

test("empty draw clicks do not add strokes; Undo and explicit Back clear the expected marks", async () => {
  const f = await fixture();
  try {
    await markup(f.page);await tool(f.page, "pen").click();
    await f.page.locator("[data-photo-editor-markup]").click();
    assert.equal(await f.page.locator("[data-photo-editor-mark]").count(), 0);
    await draw(f.page, [.2,.2], [.4,.4]);await draw(f.page, [.5,.5], [.7,.6]);
    await tool(f.page, "undo").click();assert.equal(await f.page.locator("[data-photo-editor-mark]").count(), 1);
    await tool(f.page, "geometry").click();await markup(f.page);
    assert.equal(await f.page.locator("[data-photo-editor-mark]").count(), 0);
  } finally { await f.context.close(); }
});

test("export failure keeps cover edits; Retry bakes an opaque cover into actual output pixels", async () => {
  const f = await fixture();
  try {
    await markup(f.page);await tool(f.page, "cover").click();await draw(f.page, [.2,.2], [.5,.6]);
    await f.page.evaluate(() => window.boundary.fail = "export");await tool(f.page, "apply").click();
    await f.page.getByRole("alert").waitFor();assert.equal(await f.page.locator('[data-photo-editor-mark="cover"]').count(), 1);
    assert.equal(await f.page.evaluate(() => window.proof.apply), 0);
    await tool(f.page, "apply").click();await f.page.waitForFunction(() => window.proof.apply === 1);
    const pixel = await f.page.evaluate(async () => {
      const image=await createImageBitmap(window.result.file);const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();return [...ctx.getImageData(Math.round(c.width*.3),Math.round(c.height*.3),1,1).data];
    });
    assert.deepEqual(pixel, [0,0,0,255]);
  } finally { await f.context.close(); }
});

test("rejected synchronous Apply keeps the editor live and all edits retryable", async () => {
  const f = await fixture();
  try {
    await markup(f.page);await draw(f.page, [.2,.2], [.5,.6]);
    await f.page.evaluate(() => window.boundary.rejectApplyOnce=true);await tool(f.page, "apply").click();
    await f.page.waitForFunction(() => window.proof.applyRejected===1);
    await f.page.getByRole("alert").waitFor();
    assert.equal(await f.page.locator("[data-photo-editor]").getAttribute("data-photo-editor-busy"), "false");
    assert.equal(await f.page.locator('[data-photo-editor-mark="cover"]').count(), 1);
    await tool(f.page, "apply").click();await f.page.waitForFunction(() => window.proof.apply===1);
  } finally { await f.context.close(); }
});

for (const action of ["cancel", "unmount", "replaceFile", "restore"]) {
  test(`${action}: abort held real export and refuse late Apply`, async () => {
    const f = await fixture(390, "dark", { restore: action === "restore" });
    try {
      await tool(f.page, "rotate").click();await f.page.evaluate(() => window.boundary.hold = "export");
      await tool(f.page, "apply").click();await f.page.waitForFunction(() => window.boundary.pending.length === 1);
      if (action === "cancel" || action === "restore") await tool(f.page, action).click();
      else await f.page.evaluate(action => window[action](), action);
      assert.equal(await f.page.evaluate(() => window.boundary.calls.at(-1).aborted), true);
      await f.page.evaluate(() => window.release());
      await f.page.waitForTimeout(50);
      assert.equal(await f.page.evaluate(() => window.proof.apply), 0);
      if (action === "restore") assert.equal(await f.page.evaluate(() => window.proof.restore), 1);
    } finally { await f.context.close(); }
  });
}

test("held preview cannot create a URL or change stage after Cancel", async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => window.boundary.hold = "preview");await tool(f.page, "markup").click();
    await f.page.waitForFunction(() => window.boundary.pending.length === 1);
    await tool(f.page, "cancel").click();await f.page.evaluate(() => window.release());await f.page.waitForTimeout(50);
    assert.equal(await f.page.evaluate(() => window.boundary.calls.at(-1).aborted), true);
    assert.equal(await f.page.locator('[data-photo-editor-stage="markup"]').count(), 0);
    assert.equal(await f.page.evaluate(() => window.activeURLs.size), 1, "only the caller-owned input URL remains");
  } finally { await f.context.close(); }
});

test("startup dialog focus has no tooltip; keyboard Tab stays inside and Escape cancels", async () => {
  const f = await fixture();
  try {
    await f.page.waitForTimeout(450);
    assert.equal(await f.page.locator('[data-photo-editor]').evaluate(node => node === document.activeElement), true);
    assert.equal(await f.page.getByRole('tooltip').count(), 0);
    await f.page.screenshot({ path: join(output, '390-dark-startup-focus.png') });
    await f.page.keyboard.press('Tab');
    assert.equal(await tool(f.page, 'cancel').evaluate(node => node === document.activeElement), true);
    await f.page.getByRole('tooltip').waitFor();
    assert.equal(await tool(f.page, "restore").count(), 0);
    await f.page.locator("#outside").evaluate(node => node.focus());
    assert.equal(await f.page.evaluate(() => Boolean(document.activeElement.closest("[data-photo-editor]"))), true);
    await tool(f.page, "cancel").focus();await f.page.keyboard.press("Shift+Tab");
    assert.equal(await f.page.evaluate(() => Boolean(document.activeElement.closest("[data-photo-editor]"))), true);
    await f.page.keyboard.press("Escape");assert.equal(await f.page.evaluate(() => window.proof.cancel), 1);
    await f.page.evaluate(() => window.unmount());assert.equal(await f.page.locator("#outside").evaluate(node => node === document.activeElement), true);
  } finally { await f.context.close(); }
});

test("GIF is refused without calling the compositor", async () => {
  const f = await fixture(390, "dark", { gif: true });
  try {
    await f.page.getByRole("alert").waitFor();assert.equal(await tool(f.page, "apply").isDisabled(), true);
    assert.equal(await f.page.evaluate(() => window.boundary.calls.length), 0);
  } finally { await f.context.close(); }
});
