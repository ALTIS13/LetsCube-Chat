import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium } = requireKub("@playwright/test");
const { build } = createRequire(requireKub.resolve("vite"))("esbuild");
const tailwind = createRequire(requireKub.resolve("@tailwindcss/vite"));
const { compile, optimize } = tailwind("@tailwindcss/node");
const { Scanner } = tailwind("@tailwindcss/oxide");
const src = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const output = mkdtempSync(join(tmpdir(), "letscube-edited-video-quality-"));
const origin = "https://edited-video-quality.invalid";
const callerSource = readFileSync(join(src, "components/chat/attach/AttachSheet.tsx"), "utf8");
const caller = ts.createSourceFile("AttachSheet.tsx", callerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expressions = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const name = node.name.getText(caller);
    if (["replacement", "videoPicks", "offersLadder"].includes(name)) expressions.set(name, node.initializer.getText(caller));
  }
  ts.forEachChild(node, visit);
}
visit(caller);
for (const name of ["replacement", "videoPicks", "offersLadder"]) assert.ok(expressions.has(name), `actual ${name} wiring missing`);
const results = [];
let browser, bundle, css;

test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
  const built = await build({
    bundle: true, write: false, outdir: join(output, "bundle"), format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": src }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": JSON.stringify({
      VITE_SUPABASE_URL: origin, VITE_SUPABASE_ANON_KEY: "synthetic-fixture", VITE_KUB_QA_ALLOW_MUTATIONS: "0",
    }) },
    plugins: [{ name: "controlled-video-io", setup(p) {
      p.onResolve({ filter: /(?:videoSource|videoTranscodeSupport|videoTranscode)$/ }, args => ({ path: args.path, namespace: "video-io" }));
      p.onLoad({ filter: /.*/, namespace: "video-io" }, args => ({ loader: "js", contents:
        args.path.endsWith("videoSource") ? `export async function readVideoSource(file){window.proof.reads.push(file.name);return {source:{width:1920,height:1080,duration:1,sizeBytes:file.size}}}` :
        args.path.endsWith("videoTranscodeSupport") ? `export async function videoTranscodeSupport(){return {available:true,codec:'avc'}};export async function canEncodeFrame(codec,width,height){window.proof.probes.push({width,height});return true}` :
        `export function planVideoSend(){throw Error('NO_ENCODE_EXPECTED')};export async function transcodeVideo(){window.proof.encodes++;throw Error('NO_ENCODE_EXPECTED')}` }));
    } }],
    stdin: { resolveDir: src, sourcefile: "edited-video-quality-fixture.tsx", loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {useVideoSendLadder} from './hooks/useVideoSendLadder';
      import {AttachVideoQualityRow} from './components/chat/attach/AttachVideoQuality';
      const root=createRoot(document.getElementById('root'));
      window.proof={reads:[],probes:[],encodes:0};
      const baked=new File(['exact-baked',new Uint8Array(1000000)],'baked.mp4',{type:'video/mp4'});
      const raw=new File(['raw-video',new Uint8Array(1000000)],'raw.mp4',{type:'video/mp4'});
      const edit={pick:{id:'edited',kind:'video',file:raw,edited:false}},result={file:baked},url='blob:synthetic';
      const replacement=${expressions.get("replacement")};
      const untouched={id:'picked',kind:'video',file:raw};
      function Fixture({onlyEdited}){
        const chosen=onlyEdited?[replacement]:[replacement,untouched];const selectionScope='gallery';
        const videoPicks=${expressions.get("videoPicks")};
        const ladder=useVideoSendLadder(videoPicks);
        const offersLadder=${expressions.get("offersLadder")};
        window.ladder=ladder;window.offersLadder=offersLadder;
        return <section data-fixture-sheet="" className="relative mx-auto mt-6 p-2"
          style={{width:innerWidth<768?'calc(100vw - 1rem)':'min(24.375rem, calc(100vw - 1.5rem))'}}>
          {offersLadder?<AttachVideoQualityRow stops={ladder.stops} stop={ladder.stop}
            onStopChange={ladder.setStop} summary={ladder.summary} videos={ladder.videos}/>:null}
        </section>;
      }
      window.paint=onlyEdited=>flushSync(()=>root.render(<Fixture onlyEdited={onlyEdited}/>));
      window.dispose=()=>flushSync(()=>root.unmount());window.paint(false);
    ` },
  });
  bundle = built.outputFiles.find(file => file.path.endsWith(".js")).text;
  const compiler = await compile(readFileSync(join(src, "index.css"), "utf8"), { base: src, onDependency() {} });
  css = optimize(compiler.build(new Scanner({}).scanFiles([{ content: bundle, extension: "js" }]))).code;
  browser = await chromium.launch({ headless: true, env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" } });
});

test.after(async () => {
  await browser?.close();
  writeFileSync(join(output, "metadata.json"), JSON.stringify({ syntheticOnly: true, auth: false, realEncode: false,
    callerSha256: createHash("sha256").update(callerSource).digest("hex"),
    reusedSourceEvidence: "media-edited-album-quality.test.mts: 7/7; not rerun", results }, null, 2));
  console.log(`Edited-video quality evidence: ${output}`);
});

for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
  test(`${width} ${theme}: mounted quality governs only unedited video; edited-only slider absent`, async () => {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, serviceWorkers: "block" });
    const page = await context.newPage(), errors = [], unexpected = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && route.request().method() === "GET") {
        if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body:
          `<!doctype html><html lang="ru" class="${theme}"><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body class="bg-[color:var(--kub-bg)]"><div id="root"></div><script src="/fixture.js"></script></body></html>` });
        if (url.pathname === "/fixture.css") return route.fulfill({ contentType: "text/css", body: css });
        if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
        if (/^\/fonts\/inter\/inter-(latin|latin-ext|cyrillic|cyrillic-ext)\.woff2$/.test(url.pathname)) {
          return route.fulfill({ contentType: "font/woff2", body: readFileSync(new URL(`../../artifacts/kub/public${url.pathname}`, import.meta.url)) });
        }
      }
      unexpected.push("unlisted-request");return route.abort();
    });
    try {
      await page.goto(origin);
      await page.waitForFunction(() => window.ladder?.ready && window.offersLadder);
      await page.evaluate(() => document.fonts.ready);
      const slider = page.getByTestId("attach-video-quality-slider");
      assert.equal(await slider.count(), 1);
      assert.equal(await slider.getAttribute("aria-label"), "Качество видео");
      assert.deepEqual(await page.evaluate(() => window.proof.reads), ["raw.mp4"]);
      assert.equal(await page.evaluate(() => window.ladder.videos), 1);
      assert.equal(await page.evaluate(() => window.ladder.summary.encoding), 1);
      assert.equal(await page.getByTestId("attach-video-quality").getAttribute("data-attach-video-stop"), "720");
      await slider.focus();await page.keyboard.press("Home");
      await page.waitForFunction(() => window.ladder.stop === 480);
      assert.match(await slider.getAttribute("aria-valuetext"), /^480p,/);
      await page.evaluate(() => window.paint(false));
      assert.equal(await page.evaluate(() => window.ladder.stop), 480, "same selection lost the chosen stop");
      assert.deepEqual(await page.evaluate(() => window.proof.reads), ["raw.mp4"], "same File was redundantly probed");
      const geometry = await page.getByTestId("attach-video-quality").evaluate(row => {
        const rect = row.getBoundingClientRect(), input = row.querySelector("input").getBoundingClientRect();
        const outsideText = [...row.querySelectorAll("span")].filter(node => node.childElementCount === 0 && node.textContent?.trim()).some(node => {
          const range = document.createRange();range.selectNodeContents(node);const text = range.getBoundingClientRect();
          return text.left < rect.left - .5 || text.right > rect.right + .5 || text.top < rect.top - .5 || text.bottom > rect.bottom + .5;
        });
        return { width: rect.width, height: rect.height, outsideText,
          inputInside: input.left >= rect.left && input.right <= rect.right,
          overflow: document.documentElement.scrollWidth > innerWidth, text: row.textContent };
      });
      assert.ok(geometry.width > 300 && geometry.height > 40);
      assert.equal(geometry.outsideText, false);assert.equal(geometry.inputInside, true);assert.equal(geometry.overflow, false);
      assert.equal(geometry.text.includes("2 видео"), false);
      await page.mouse.move(1, 1);
      await page.screenshot({ path: join(output, `${width}-${theme}-mixed-480p.png`) });
      const mixed = await page.evaluate(() => ({ videos: window.ladder.videos, summary: window.ladder.summary, proof: window.proof }));
      await page.evaluate(() => window.paint(true));
      await page.waitForFunction(() => window.ladder.videos === 0 && !window.offersLadder);
      assert.equal(await slider.count(), 0);
      assert.deepEqual(await page.evaluate(() => window.ladder.stops), ["source"]);
      assert.equal(await page.evaluate(() => window.ladder.summary.encoding), 0);
      assert.deepEqual(await page.evaluate(() => window.proof.reads), ["raw.mp4"]);
      assert.equal(await page.evaluate(() => window.proof.encodes), 0);
      assert.deepEqual(errors, []);assert.deepEqual(unexpected, []);
      results.push({ width, theme, geometry, mixed, editedOnly: { videos: 0, slider: false }, errors, unexpected });
    } finally {
      await page.evaluate(() => window.dispose());
      await context.close();
    }
  });
}
