import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { chromium } = requireKub("@playwright/test");
const { build } = createRequire(requireKub.resolve("vite"))("esbuild");
const tw = createRequire(requireKub.resolve("@tailwindcss/vite"));
const { compile, optimize } = tw("@tailwindcss/node");
const { Scanner } = tw("@tailwindcss/oxide");
const src = fileURLToPath(new URL("../../artifacts/kub/src/", import.meta.url));
const output = mkdtempSync(join(tmpdir(), "letscube-video-editor-ui-"));
const origin = "https://video-editor.invalid";
const results = [];
let browser, bundle, css;

test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
  const built = await build({
    write: false, outdir: join(output, "bundle"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": src },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": JSON.stringify({
      VITE_SUPABASE_URL: origin, VITE_SUPABASE_ANON_KEY: "synthetic-fixture", VITE_MEDIA_SIGNED_URLS: "signed-only",
    }) },
    plugins: [{ name: "controlled-real-video-helper", setup(plugin) {
      plugin.onResolve({ filter: /^@\/lib\/videoEdit$/ }, () => ({ path: "video-boundary", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", resolveDir: src, contents: `
        import {inspectVideoEdit as inspect, trimVideo as trim} from ${JSON.stringify(join(src, "lib/videoEdit.ts"))};
        async function invoke(kind,file,range,options={}) {
          const call={kind,range,aborted:options.signal?.aborted??false,settled:false};window.boundary.calls.push(call);
          options.signal?.addEventListener('abort',()=>call.aborted=true,{once:true});
          try {
            if(window.boundary.fail===kind){window.boundary.fail=null;throw Error('synthetic-transient-failure');}
            const result=await(kind==='inspect'?inspect(file,options):trim(file,range,options));
            if(kind==='trim'&&window.boundary.badProgress){options.onProgress?.(-1);options.onProgress?.(NaN);options.onProgress?.(2);}
            if(window.boundary.hold===kind)await new Promise(resolve=>window.boundary.pending.push(resolve));
            return result;
          }finally{call.settled=true;}
        }
        export const inspectVideoEdit=(file,options)=>invoke('inspect',file,null,options);
        export const trimVideo=(file,range,options)=>invoke('trim',file,range,options);
      ` }));
      if (process.env.VIDEO_EDITOR_MUTANT) plugin.onLoad({ filter: /AttachVideoEditor\.tsx$/ }, args => {
        let contents = readFileSync(args.path, "utf8").replace(/\r\n/g, "\n");
        const changes = {
          "late-apply": ["if (!isCurrent(operation)) return;\n    let accepted", "let accepted"],
          "omit-abort": ["operationRef.current?.controller.abort();", "void operationRef.current;"],
          "skip-disposal-wait": ["await pending?.done;", "void pending?.done;"],
          "omit-preview-end": ["if (video.currentTime >= end)", "if (false)"],
        };
        const change = changes[process.env.VIDEO_EDITOR_MUTANT];
        assert.ok(change && contents.includes(change[0]), "literal mutation must match actual source");
        return { contents: contents.replace(change[0], change[1]), loader: "tsx" };
      });
    } }],
    stdin: { resolveDir: src, sourcefile: "video-editor-ui-fixture.tsx", loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import * as m from 'mediabunny';import AttachVideoEditor from './components/chat/attach/AttachVideoEditor';
      import {trimVideo as prepareTrimmedInput} from './lib/videoEdit';
      const root=createRoot(document.getElementById('root'));
      const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.activeURLs=new Set();
      URL.createObjectURL=value=>{const url=create(value);window.activeURLs.add(url);return url;};
      URL.revokeObjectURL=url=>{window.activeURLs.delete(url);revoke(url);};
      async function generate(short=false){
        const format=new m.Mp4OutputFormat({fastStart:'in-memory'});
        const codec=await m.getFirstEncodableVideoCodec(['avc','vp9','av1'].filter(c=>format.getSupportedVideoCodecs().includes(c)),{width:320,height:240});
        const audioCodec=await m.getFirstEncodableAudioCodec(['aac','opus'].filter(c=>format.getSupportedAudioCodecs().includes(c)),{numberOfChannels:1,sampleRate:48000});
        if(!codec||!audioCodec)throw Error('SYNTHETIC_AV_CAPABILITY_REFUSED');
        const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');
        const video=new m.CanvasSource(canvas,{codec,quality:new m.Quality({bitrate:150000})});
        const audio=short?null:new m.AudioSampleSource({codec:audioCodec,quality:new m.Quality({bitrate:96000})});
        const out=new m.Output({format,target:new m.BufferTarget()});out.addVideoTrack(video,{frameRate:short?50:10});if(audio)out.addAudioTrack(audio);
        try{await out.start();const count=short?3:30,dt=short?.02:.1;
          await Promise.all([(async()=>{for(let i=0;i<count;i++){
            ctx.fillStyle=['#87c8e7','#36815a','#d14f4f'][Math.floor(i/count*3)];ctx.fillRect(0,0,320,240);
            ctx.fillStyle='#f4dc7a';ctx.fillRect(80+i*2,65,100,110);await video.add(i*dt,dt,{keyFrame:i===0});
          }})(),(async()=>{if(!audio)return;for(let i=0;i<count;i++){
            const data=new Float32Array(Math.round(48000*dt));for(let j=0;j<data.length;j++)data[j]=.1*Math.sin(2*Math.PI*440*(i*dt+j/48000));
            const sample=new m.AudioSample({data,format:'f32-planar',numberOfChannels:1,sampleRate:48000,timestamp:i*dt});
            try{await audio.add(sample);}finally{sample.close();}
          }})()]);await out.finalize();return new File([out.target.buffer],'synthetic-video.mp4',{type:'video/mp4'});
        }finally{if(out.state!=='finalized')await out.cancel();canvas.width=canvas.height=0;}
      }
      window.unmount=()=>flushSync(()=>root.render(null));
      window.release=()=>{window.boundary.hold=null;window.boundary.pending.splice(0).forEach(resolve=>resolve());};
      window.mount=async(options={})=>{
        window.unmount();if(window.inputURL)URL.revokeObjectURL(window.inputURL);
        window.inputFile=options.invalid?new File(['invalid synthetic bytes'],'unsupported.mp4',{type:'video/mp4'}):await generate(options.short);
        if(options.trimmedInput)window.inputFile=(await prepareTrimmedInput(window.inputFile,{start:1.1,end:1.9})).file;
        if(options.noEncoder)Object.defineProperty(window,'VideoEncoder',{value:undefined,configurable:true});
        window.inputURL=URL.createObjectURL(window.inputFile);window.boundary={calls:[],pending:[],hold:options.holdInspect?'inspect':null,fail:null};
        window.proof={apply:0,cancel:0,restore:0};
        const props={file:window.inputFile,url:window.inputURL,
          onApply:result=>{if(window.boundary.rejectApplyOnce){window.boundary.rejectApplyOnce=false;window.proof.rejected=1;return false;}
            window.proof.apply++;window.proof.sameFile=result.file===window.inputFile;window.proof.changed=result.changed;window.result=result;},
          onCancel:()=>{window.proof.cancel++;window.proof.cancelAfterSettled=window.boundary.calls.every(c=>c.settled);},
          ...(options.restore?{onRestore:()=>{window.proof.restore++;window.proof.restoreAfterSettled=window.boundary.calls.every(c=>c.settled);}}:{})};
        window.currentProps=props;flushSync(()=>root.render(<AttachVideoEditor {...props}/>));
      };
      window.replaceFile=()=>{const file=new File([window.inputFile],'replacement.mp4',{type:'video/mp4'}),url=URL.createObjectURL(file);
        window.currentProps={...window.currentProps,file,url};flushSync(()=>root.render(<AttachVideoEditor {...window.currentProps}/>));};
      window.analyze=async()=>{const input=new m.Input({source:new m.BlobSource(window.result.file),formats:[m.MP4]});try{
        return{duration:await input.computeDuration(),audio:!!await input.getPrimaryAudioTrack(),video:!!await input.getPrimaryVideoTrack()};
      }finally{input.dispose();}};
    ` },
  });
  bundle = built.outputFiles.find(file => file.path.endsWith(".js")).text;
  const compiler = await compile(readFileSync(join(src, "index.css"), "utf8"), { base: src, onDependency() {} });
  css = optimize(compiler.build(new Scanner({}).scanFiles([{ content: bundle, extension: "js" }]))).code;
  browser = await chromium.launch({ headless: true, env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" } });
});

test.after(async () => {
  await browser?.close();
  writeFileSync(join(output, "metadata.json"), JSON.stringify({ syntheticOnly: true, auth: false, results }, null, 2));
  console.log(`Video editor UI evidence: ${output}`);
});

async function fixture(width = 390, theme = "dark", options = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, serviceWorkers: "block" });
  const page = await context.newPage(), unexpected = [], errors = [];
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
  await page.goto(origin);await page.locator("#outside").focus();
  await page.evaluate(options => window.mount(options), options);
  if (!options.invalid && !options.holdInspect && !options.noEncoder) {
    await page.locator('[data-video-editor-state="ready"]').waitFor({ timeout: 7000 });
    await page.waitForFunction(()=>document.querySelector('video').readyState>=2&&!document.querySelector('video').seeking);
  }
  return { page, context, unexpected, errors };
}
const tool = (page, name) => page.locator(`[data-video-editor-tool="${name}"]`);
const range = (page, name) => page.locator(`[data-video-editor-range="${name}"]`);

for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
  test(`${width} ${theme}: trim controls and video fit fullscreen without startup tooltip`, async () => {
    const f = await fixture(width, theme);
    try {
      await f.page.evaluate(() => document.fonts.ready);await f.page.waitForTimeout(2200);
      assert.equal(await f.page.getByRole('tooltip').count(), 0);
      assert.equal(await f.page.locator('[data-video-editor]').evaluate(node=>node===document.activeElement),true);
      const fit = await f.page.locator('[data-video-editor]').evaluate(root=>({
        rect:root.getBoundingClientRect().toJSON(),transform:getComputedStyle(root).transform,overflow:document.documentElement.scrollWidth>innerWidth,
        controls:[...root.querySelectorAll('button,input')].map(node=>{const b=node.getBoundingClientRect();return{width:b.width,height:b.height,inside:b.x>=0&&b.right<=innerWidth&&b.y>=0&&b.bottom<=innerHeight};}),
        autoplay:root.querySelector('video').autoplay,paused:root.querySelector('video').paused,
        media:{readyState:root.querySelector('video').readyState,networkState:root.querySelector('video').networkState,error:root.querySelector('video').error?.code??null},
      }));
      assert.equal(fit.rect.width,width);assert.equal(fit.rect.x,0);assert.equal(fit.rect.y,0);
      assert.equal(fit.transform,'none');assert.equal(fit.overflow,false);assert.equal(fit.autoplay,false);assert.equal(fit.paused,true);
      assert.ok(fit.controls.every(c=>c.width>=44&&c.height>=44&&c.inside));
      await f.page.screenshot({path:join(output,`${width}-${theme}-trim.png`)});
      assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);results.push({width,theme,fit,errors:f.errors,unexpected:f.unexpected});
    } finally {await f.context.close();}
  });
}

test('full-range Apply returns the exact current File', async()=>{
  const f=await fixture();try{await tool(f.page,'apply').click();await f.page.waitForFunction(()=>window.proof.apply===1);
    assert.deepEqual(await f.page.evaluate(()=>({same:window.proof.sameFile,changed:window.proof.changed})),{same:true,changed:false});
  }finally{await f.context.close();}
});

test('actual trimmed-output endpoint remains exact and applicable after slider and numeric edits', async()=>{
  const f=await fixture(390,'dark',{trimmedInput:true});try{
    const slider=range(f.page,'end'),number=f.page.locator('[data-video-editor-number="end"]');
    const duration=Number(await slider.getAttribute('max'));
    assert.equal(duration,0.8106875,'actual AAC-padded output must exercise upward six-decimal rounding');
    assert.equal(await tool(f.page,'apply').isDisabled(),false);
    for(const input of [slider,number]){
      await input.fill('0.7');await input.blur();assert.equal(await tool(f.page,'apply').isDisabled(),false);
      await input.fill(String(duration));await input.blur();
      assert.equal(Number(await number.inputValue()),duration,'source endpoint must not round above actual duration');
      assert.equal(await tool(f.page,'apply').isDisabled(),false);
    }
    await tool(f.page,'apply').click();await f.page.waitForFunction(()=>window.proof.apply===1);
    const result=await f.page.evaluate(()=>({range:window.boundary.calls.at(-1).range,same:window.proof.sameFile,changed:window.proof.changed}));
    assert.deepEqual(result,{range:{start:0,end:duration},same:true,changed:false});
    assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
  }finally{await f.context.close();}
});

test('linked controls clamp crossing endpoints; actual selected trim preserves both primary tracks',async()=>{
  const f=await fixture();try{
    await range(f.page,'start').fill('1.1');await range(f.page,'end').fill('1.9');
    await f.page.locator('[data-video-editor-number="start"]').fill('9');await f.page.locator('[data-video-editor-number="start"]').blur();
    assert.ok(Math.abs(Number(await range(f.page,'start').inputValue())-1.8)<.0001);
    await range(f.page,'start').fill('1.1');await tool(f.page,'apply').click();await f.page.waitForFunction(()=>window.proof.apply===1);
    const proof=await f.page.evaluate(async()=>({call:window.boundary.calls.at(-1),actual:await window.analyze(),changed:window.proof.changed}));
    assert.deepEqual(proof.call.range,{start:1.1,end:1.9});assert.equal(proof.changed,true);
    assert.ok(Math.abs(proof.actual.duration-.8)<.06);assert.equal(proof.actual.audio,true);assert.equal(proof.actual.video,true);
  }finally{await f.context.close();}
});

test('blank numeric draft disables Apply; very short clip retains a valid full range',async()=>{
  const f=await fixture(390,'dark',{short:true});try{
    assert.ok(Number(await range(f.page,'end').inputValue())<.1);assert.equal(await tool(f.page,'apply').isDisabled(),false);
    const number=f.page.locator('[data-video-editor-number="end"]');await number.fill('');
    assert.equal(await tool(f.page,'apply').isDisabled(),true);await number.blur();assert.equal(await tool(f.page,'apply').isDisabled(),false);
    assert.match(await range(f.page,'end').getAttribute('aria-valuetext'),/00:00\./);
  }finally{await f.context.close();}
});

test('preview cannot play beyond the selected end or seek before start',async()=>{
  const f=await fixture();try{
    await range(f.page,'start').fill('1');await range(f.page,'end').fill('1.3');
    const video=f.page.locator('video');await video.evaluate(v=>{v.currentTime=.2;});
    await f.page.waitForFunction(()=>document.querySelector('video').currentTime>=.999);
    await video.evaluate(v=>v.play());await f.page.waitForFunction(()=>{const v=document.querySelector('video');return v.paused&&v.currentTime>=1.29;});
    assert.ok(await video.evaluate(v=>v.currentTime<=1.34));
  }finally{await f.context.close();}
});

test('real loadedmetadata preserves selected preview bounds without autoplay or audio',async()=>{
  const f=await fixture();try{
    assert.equal(await f.page.locator('[data-video-editor]').evaluate(n=>n===document.activeElement),true);
    await range(f.page,'start').fill('1');await range(f.page,'end').fill('1.3');
    const metadata=await f.page.locator('video').evaluate(v=>new Promise(resolve=>{
      v.addEventListener('loadedmetadata',event=>queueMicrotask(()=>resolve({
        trusted:event.isTrusted,time:v.currentTime,readyState:v.readyState,paused:v.paused,muted:v.muted,autoplay:v.autoplay,
      })),{once:true});
      v.load();
    }));
    assert.equal(metadata.trusted,true,'must observe a browser-generated metadata event');
    assert.ok(metadata.readyState>=1);assert.ok(metadata.time>=1&&metadata.time<=1.3,'metadata must not reset preview outside the selected interval');
    assert.equal(metadata.paused,true);assert.equal(metadata.muted,true);assert.equal(metadata.autoplay,false);
    const video=f.page.locator('video');await video.evaluate(v=>{v.currentTime=2.5;});
    await f.page.waitForFunction(()=>{const v=document.querySelector('video');return !v.seeking&&v.currentTime<=1.3;});
    assert.ok(await video.evaluate(v=>v.currentTime>=1));assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
    results.push({case:'real-loadedmetadata',metadata,errors:f.errors,unexpected:f.unexpected});
  }finally{await f.context.close();}
});

test('unsupported input keeps Cancel/Restore available without original-file fallback',async()=>{
  const f=await fixture(390,'dark',{invalid:true,restore:true});try{
    await f.page.getByRole('alert').waitFor();assert.equal(await tool(f.page,'apply').isDisabled(),true);
    assert.equal(await tool(f.page,'cancel').isEnabled(),true);assert.equal(await tool(f.page,'restore').isEnabled(),true);
    await tool(f.page,'restore').click();await f.page.waitForFunction(()=>window.proof.restore===1);
    assert.equal(await f.page.evaluate(()=>window.proof.apply),0);
  }finally{await f.context.close();}
});

test('actual encoder capability refusal disables Apply on a valid AV file',async()=>{
  const f=await fixture(390,'dark',{noEncoder:true,restore:true});try{
    await f.page.getByRole('alert').waitFor();assert.equal(await tool(f.page,'apply').isDisabled(),true);
    assert.equal(await tool(f.page,'cancel').isEnabled(),true);assert.equal(await tool(f.page,'restore').isEnabled(),true);
    assert.equal(await f.page.evaluate(()=>window.boundary.calls.filter(c=>c.kind==='trim').length),0);
    await tool(f.page,'cancel').click();await f.page.waitForFunction(()=>window.proof.cancel===1);
    assert.equal(await f.page.evaluate(()=>window.proof.apply),0);assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
  }finally{await f.context.close();}
});

test('trim failure and parent refusal keep the range editable and retryable',async()=>{
  const f=await fixture();try{
    await range(f.page,'start').fill('0.5');await range(f.page,'end').fill('2');
    await f.page.evaluate(()=>window.boundary.fail='trim');await tool(f.page,'apply').click();await f.page.getByRole('alert').waitFor();
    assert.equal(await f.page.evaluate(()=>window.proof.apply),0);assert.equal(await range(f.page,'start').inputValue(),'0.5');
    await f.page.evaluate(()=>window.boundary.rejectApplyOnce=true);await tool(f.page,'apply').click();await f.page.waitForFunction(()=>window.proof.rejected===1);
    await f.page.getByRole('alert').waitFor();assert.equal(await f.page.locator('[data-video-editor]').getAttribute('data-video-editor-busy'),'false');
    await tool(f.page,'apply').click();await f.page.waitForFunction(()=>window.proof.apply===1);
  }finally{await f.context.close();}
});

for(const action of ['cancel','restore','unmount','replaceFile'])test(`${action}: abort held trim, await disposal for exit, refuse late Apply`,async()=>{
  const f=await fixture(390,'dark',{restore:action==='restore'});try{
    await range(f.page,'start').fill('0.5');await f.page.evaluate(()=>{window.boundary.hold='trim';window.boundary.badProgress=true;});
    await tool(f.page,'apply').click();await f.page.waitForFunction(()=>window.boundary.pending.length===1);
    assert.equal(await f.page.getByRole('progressbar').getAttribute('aria-valuenow'),'100');
    if(action==='cancel'||action==='restore')await tool(f.page,action).click();else await f.page.evaluate(action=>window[action](),action);
    assert.equal(await f.page.evaluate(()=>window.boundary.calls.find(c=>c.kind==='trim').aborted),true);
    if(action==='cancel'||action==='restore')assert.equal(await f.page.evaluate(action=>window.proof[action],action),0,'exit must await helper settlement');
    await f.page.evaluate(()=>window.release());await f.page.waitForTimeout(60);
    assert.equal(await f.page.evaluate(()=>window.proof.apply),0);
    if(action==='cancel'||action==='restore')assert.deepEqual(await f.page.evaluate(action=>[window.proof[action],window.proof[action+'AfterSettled']],action),[1,true]);
  }finally{await f.context.close();}
});

test('Cancel during inspection awaits settlement and Tab/Escape retain dialog ownership',async()=>{
  const f=await fixture(390,'dark',{holdInspect:true});try{
    await f.page.waitForFunction(()=>window.boundary.pending.length===1);
    assert.equal(await tool(f.page,'apply').isDisabled(),true);
    await f.page.keyboard.press('Tab');assert.equal(await tool(f.page,'cancel').evaluate(n=>n===document.activeElement),true);
    await f.page.keyboard.press('Shift+Tab');assert.equal(await f.page.evaluate(()=>!!document.activeElement.closest('[data-video-editor]')),true);
    await f.page.keyboard.press('Escape');assert.equal(await f.page.evaluate(()=>window.proof.cancel),0);
    assert.equal(await f.page.evaluate(()=>window.boundary.calls[0].aborted),true);
    await f.page.evaluate(()=>window.release());await f.page.waitForFunction(()=>window.proof.cancel===1);
    await f.page.evaluate(()=>window.unmount());assert.equal(await f.page.locator('#outside').evaluate(n=>n===document.activeElement),true);
  }finally{await f.context.close();}
});
