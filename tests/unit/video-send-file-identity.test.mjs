import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium } = requireKub("@playwright/test");
const { build } = createRequire(requireKub.resolve("vite"))("esbuild");
const src = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));

test("mounted video ladder rereads same-size replacements and retires obsolete facts before asynchronous inspection", async () => {
  const output = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": src }, define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "synthetic-video-leaves", setup(p) {
      p.onResolve({ filter: /(?:videoSource|videoTranscodeSupport|videoTranscode)$/ }, args => ({ path: args.path, namespace: "video-leaf" }));
      p.onLoad({ filter: /.*/, namespace: "video-leaf" }, args => ({ loader: "js", contents:
        args.path.endsWith("videoSource") ? `export async function readVideoSource(file){window.reads.push(file);if(window.hold)await new Promise(r=>window.release=r);return {source:{width:file===window.first?1920:640,height:file===window.first?1080:360,duration:2,sizeBytes:file.size,bitrate:9000000,fps:30,audioChannels:0}};}` :
        args.path.endsWith("videoTranscodeSupport") ? `export async function videoTranscodeSupport(){if(window.holdSupport)await new Promise(r=>window.releaseSupport=r);return {available:true,codec:'avc'}};export async function canEncodeFrame(){return true}` :
        `export function planVideoSend(){return {action:window.forceEncode?'transcode':'as-is'}};export async function transcodeVideo(){window.encodes++;return new File(['encoded'],'out.mp4',{type:'video/mp4'})}` }));
    } }], stdin: { resolveDir: src, loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {useVideoSendLadder} from './hooks/useVideoSendLadder';
      window.first=new File([new Uint8Array(2*1024*1024)],'same.mp4',{type:'video/mp4'});window.second=new File([new Uint8Array(2*1024*1024).fill(1)],'same.mp4',{type:'video/mp4'});
      window.reads=[];window.hold=false;window.encodes=0;const root=createRoot(document.getElementById('root'));
      function App({file}){window.ladder=useVideoSendLadder([{id:'same-pick',file}]);return <span>{String(window.ladder.ready)}</span>}
      window.paint=file=>flushSync(()=>root.render(<App file={file}/>));window.unmount=()=>flushSync(()=>root.unmount());window.paint(window.first);
    ` } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: output.outputFiles[0].text });
    await page.waitForFunction(() => window.ladder?.ready === true);
    assert.equal(await page.evaluate(() => window.reads.length), 1);
    assert.equal(await page.evaluate(() => window.ladder.summary.label), "720p", "source calibration must offer a smaller rung");
    await page.evaluate(() => window.paint(window.first));
    assert.equal(await page.evaluate(() => window.reads.length), 1, "same File was redundantly reread");
    await page.evaluate(() => { window.hold = true; window.paint(window.second); });
    assert.equal(await page.evaluate(() => window.ladder.ready), false, "replacement reused old readiness/rungs");
    assert.equal(await page.evaluate(() => window.reads.length), 2, "same-size replacement was not inspected");
    await page.evaluate(() => { window.hold = false; window.release(); });
    await page.waitForFunction(() => window.ladder.ready === true);
    assert.equal(await page.evaluate(() => window.ladder.summary.label), "Исходное", "replacement summary retained old source facts");
    assert.equal(await page.evaluate(() => window.ladder.summary.encoding), 0);
    await page.evaluate(() => window.paint(window.first));
    await page.waitForFunction(() => window.ladder.ready === true);
    await page.evaluate(() => { window.forceEncode = true; window.holdSupport = true; window.pending = window.ladder.prepare([window.first]); });
    await page.waitForFunction(() => typeof window.releaseSupport === "function");
    await page.evaluate(() => { window.unmount(); window.holdSupport = false; window.releaseSupport(); });
    assert.equal(await page.evaluate(() => window.pending), null, "a retired hook published a prepared selection");
    assert.equal(await page.evaluate(() => window.encodes), 0, "encoder started after editor/sheet retirement");
  } finally { await browser.close(); }
});
