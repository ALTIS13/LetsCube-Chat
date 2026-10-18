import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "@playwright/test";

const lib = new URL("../../artifacts/kub/src/lib/", import.meta.url);
const path = new URL("videoEdit.ts", lib);
const requireKub = createRequire(new URL("../../artifacts/kub/package.json", import.meta.url));
const { build } = createRequire(requireKub.resolve("vite"))("esbuild");
let syntheticBytes;

async function bundle(mutation) {
  let source = existsSync(path) ? readFileSync(path, "utf8") : `
    import {readVideoSource} from './videoSource.ts';
    export async function inspectVideoEdit(file){const {source}=await readVideoSource(file);return source;}
    export async function trimVideo(file){return{file,...await inspectVideoEdit(file),changed:false};}
  `;
  if (mutation) source = mutation(source);
  const result = await build({ stdin: { contents: source + '\nimport * as mb from "mediabunny";export {mb};',
    resolveDir: fileURLToPath(lib), sourcefile: "videoEdit.ts", loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
  return result.outputFiles[0].text;
}

const fixture = `
import {mb as m} from '/video.mjs';
export async function generate({audio=true,rotation=0}={}){
  const format=new m.Mp4OutputFormat({fastStart:'in-memory'});
  const videoCodecs=[],audioCodecs=[];
  for(const c of ['avc','vp9','av1'])if(format.getSupportedVideoCodecs().includes(c)&&await m.canDecodeVideo(c))videoCodecs.push(c);
  for(const c of ['aac','opus'])if(format.getSupportedAudioCodecs().includes(c)&&await m.canDecodeAudio(c))audioCodecs.push(c);
  const codec=await m.getFirstEncodableVideoCodec(videoCodecs,{width:320,height:240});
  const audioCodec=audio?await m.getFirstEncodableAudioCodec(audioCodecs,{numberOfChannels:1,sampleRate:48000}):null;
  if(!codec||(audio&&!audioCodec))return{unsupported:true,codec,audioCodec,
    videoEncoder:typeof VideoEncoder,audioEncoder:typeof AudioEncoder};
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
  const ctx=canvas.getContext('2d'),video=new m.CanvasSource(canvas,{codec,quality:new m.Quality({bitrate:150000}),keyFrameInterval:10});
  const sound=audio?new m.AudioSampleSource({codec:audioCodec,quality:new m.Quality({bitrate:96000})}):null;
  const output=new m.Output({format,target:new m.BufferTarget()});
  output.addVideoTrack(video,{frameRate:10,rotation});if(sound)output.addAudioTrack(sound);
  output.setMetadataTags({title:'FICTIONAL_SOURCE_TAG'});
  try{
    await output.start();
    await Promise.all([ (async()=>{for(let i=0;i<30;i++){
      ctx.fillStyle=['#ed141e','#14b428','#1428dc'][Math.floor(i/10)];ctx.fillRect(0,0,320,240);
      await video.add(i/10,.1,{keyFrame:i===0});
    }})(),(async()=>{if(!sound)return;for(let i=0;i<30;i++){
      const frequency=[220,440,880][Math.floor(i/10)],data=new Float32Array(4800);
      for(let j=0;j<data.length;j++)data[j]=.4*Math.sin(2*Math.PI*frequency*(i/10+j/48000));
      const sample=new m.AudioSample({data,format:'f32-planar',numberOfChannels:1,sampleRate:48000,timestamp:i/10});
      try{await sound.add(sample);}finally{sample.close();}
    }})() ]);
    await output.finalize();
    return{file:new File([output.target.buffer],'fictional.mp4',{type:'video/mp4'}),codec,audioCodec};
  }finally{if(output.state!=='finalized')await output.cancel();canvas.width=canvas.height=0;}
}
export async function analyze(file){
  const input=new m.Input({source:new m.BlobSource(file),formats:[m.MP4,m.WEBM,m.MATROSKA,m.QTFF]});
  try{
    const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();
    if(!video)throw Error('FIXTURE_NO_VIDEO');
    if(!await video.canDecode()){const c=await video.getDecoderConfig();throw Error('FIXTURE_VIDEO_CONFIG '+JSON.stringify({...c,description:c.description?.byteLength}));}
    const width=await video.getDisplayWidth(),height=await video.getDisplayHeight();
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d'),colors=[];
    for await(const sample of new m.VideoSampleSink(video).samples()){
      try{sample.draw(ctx,0,0);const p=[...ctx.getImageData(20,20,1,1).data];colors.push(p.slice(0,3).indexOf(Math.max(...p.slice(0,3))));}
      finally{sample.close();}
    }
    canvas.width=canvas.height=0;
    let frames=0,minTimestamp=Infinity,maxTimestamp=-Infinity;
    for await(const packet of new m.EncodedPacketSink(video).packets()){
      frames++;minTimestamp=Math.min(minTimestamp,packet.timestamp);maxTimestamp=Math.max(maxTimestamp,packet.timestamp+packet.duration);
    }
    let audioFrames=0,minAudioTimestamp=Infinity,maxAudioTimestamp=-Infinity;
    if(audio)for await(const packet of new m.EncodedPacketSink(audio).packets()){
      audioFrames++;minAudioTimestamp=Math.min(minAudioTimestamp,packet.timestamp);maxAudioTimestamp=Math.max(maxAudioTimestamp,packet.timestamp+packet.duration);
    }
    const energies=[0,0,0];let samples=0;
    if(audio)for await(const sample of new m.AudioSampleSink(audio).samples()){
      try{
        const data=new Float32Array(sample.numberOfFrames);sample.copyTo(data,{planeIndex:0,format:'f32-planar'});
        for(let k=0;k<3;k++){let re=0,im=0;const frequency=[220,440,880][k];
          for(let i=0;i<data.length;i++){const t=sample.timestamp+i/sample.sampleRate;re+=data[i]*Math.cos(2*Math.PI*frequency*t);im+=data[i]*Math.sin(2*Math.PI*frequency*t);}
          energies[k]+=re*re+im*im;
        }samples+=data.length;
      }finally{sample.close();}
    }
    return{width,height,duration:await input.computeDuration(),audio:!!audio,colors,frames,minTimestamp,maxTimestamp,
      audioFrames,minAudioTimestamp,maxAudioTimestamp,energies,samples,tag:(await input.getMetadataTags()).title??null};
  }finally{input.dispose();}
}
`;

async function browserFixture(t, engine, mutation) {
  const code = await bundle(mutation), errors = [], unexpected = [];
  const server = createServer((req, res) => {
    if (!["/", "/video.mjs", "/fixture.mjs"].includes(req.url)) { unexpected.push(req.url); res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": req.url === "/" ? "text/html" : "text/javascript" });
    res.end(req.url === "/" ? "<!doctype html><title>Fictional video trim</title>" : req.url === "/video.mjs" ? code : fixture);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await engine.launch({ headless: true }); t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" }); t.after(() => context.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin !== origin) { unexpected.push("OFF_ORIGIN"); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(async () => { window.videoEdit = await import("/video.mjs"); window.f = await import("/fixture.mjs"); });
  t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); });
  return page;
}

async function knownSyntheticBytes(t) {
  if (!syntheticBytes) {
    const page = await browserFixture(t, chromium);
    syntheticBytes = await page.evaluate(async () => {
      const {file}=await f.generate();await f.analyze(file);
      return [...new Uint8Array(await file.arrayBuffer())];
    });
  }
  return syntheticBytes;
}

test("Chromium: actual middle trim reencodes only green frames and its audio, not discarded segments", { timeout: 60000 }, async t => {
  const page = await browserFixture(t, chromium);
  const result = await page.evaluate(async () => {
    const generated = await f.generate();
    if (generated.unsupported) return generated;
    const source = await f.analyze(generated.file);
    const trimmed = await videoEdit.trimVideo(generated.file, { start: 1.1, end: 1.9 }, {});
    return { source, changed: trimmed.changed, info: [trimmed.width, trimmed.height, trimmed.duration],
      output: await f.analyze(trimmed.file), type: trimmed.file.type,
      bytes:[...new Uint8Array(await generated.file.arrayBuffer())],
      boxes:await boxes(trimmed.file) };
    async function boxes(file){const b=new Uint8Array(await file.arrayBuffer()),v=new DataView(b.buffer),types=[];
      for(let i=0;i+8<=b.length;){types.push(String.fromCharCode(...b.slice(i+4,i+8)));const size=v.getUint32(i);if(size<8)break;i+=size;}return types;}
  });
  assert.notEqual(result.unsupported, true, "Chromium synthetic AV generation must be available for this positive control");
  syntheticBytes = result.bytes;
  assert.deepEqual([...new Set(result.source.colors)], [0, 1, 2]);
  assert.ok(result.source.audio && result.source.samples > 100000);
  assert.ok(Math.abs(result.output.duration - .8) < .06);
  assert.equal(result.changed, true); assert.equal(result.type, "video/mp4");
  assert.deepEqual([...new Set(result.output.colors)], [1]);
  assert.ok(result.output.audio && result.output.samples > 30000);
  assert.ok(result.output.energies[1] > result.output.energies[0] * 100 && result.output.energies[1] > result.output.energies[2] * 100);
  assert.ok(result.output.frames >= 7 && result.output.frames <= 9);
  assert.ok(result.output.minTimestamp >= -.00001 && result.output.maxTimestamp <= .801);
  assert.deepEqual(result.info.slice(0, 2), [320, 240]);
  assert.equal(result.output.tag, null);
  assert.ok(result.boxes.indexOf("moov") >= 0 && result.boxes.indexOf("moov") < result.boxes.indexOf("mdat"), "literal faststart order");
  assert.ok(result.output.minAudioTimestamp >= -1024/48000-.00001 && result.output.maxAudioTimestamp <= .8+2*1024/48000+.00001,
    "AAC packets may contain encoder priming/padding, not the discarded one-second source segments");
  t.diagnostic(`ENCODED_TRIM ${JSON.stringify({duration:result.output.duration,videoPackets:result.output.frames,
    videoStart:result.output.minTimestamp,videoEnd:result.output.maxTimestamp,audioPackets:result.output.audioFrames,
    audioStart:result.output.minAudioTimestamp,audioEnd:result.output.maxAudioTimestamp,pcmSamples:result.output.samples})}`);
});

test("WebKit: real trim when supported, otherwise explicit unsupported on a real readable synthetic AV input", { timeout: 60000 }, async t => {
  const bytes = await knownSyntheticBytes(t);
  const page = await browserFixture(t, webkit);
  const result = await page.evaluate(async bytes => {
    const generated=await f.generate(),file=generated.file??new File([new Uint8Array(bytes)],'fictional.mp4',{type:'video/mp4'});
    const input=new videoEdit.mb.Input({source:new videoEdit.mb.BlobSource(file),formats:[videoEdit.mb.MP4]});
    let source;
    try{const v=await input.getPrimaryVideoTrack(),a=await input.getPrimaryAudioTrack();
      source={readable:await input.canRead(),video:!!v,audio:!!a,videoDecode:await v.canDecode(),audioDecode:await a.canDecode(),duration:await input.computeDuration()};
    }finally{input.dispose();}
    let info,inspectError,trimError,output;
    try{info=await videoEdit.inspectVideoEdit(file);}catch(e){inspectError=e.message;}
    try{const r=await videoEdit.trimVideo(file,{start:1.1,end:1.9});output=await f.analyze(r.file);}catch(e){trimError=e.message;}
    const noOp=await videoEdit.trimVideo(file,{start:0,end:source.duration});
    return{capability:generated.unsupported?generated:{unsupported:false},source,info,inspectError,trimError,output,
      identity:noOp.file===file,changed:noOp.changed};
  }, bytes);
  assert.ok(result.source.readable && result.source.video && result.source.audio);
  assert.equal(result.identity, true); assert.equal(result.changed, false);
  if (result.inspectError === "VIDEO_EDIT_UNSUPPORTED") {
    assert.equal(result.inspectError, "VIDEO_EDIT_UNSUPPORTED");
    assert.equal(result.trimError, "VIDEO_EDIT_UNSUPPORTED"); assert.equal(result.output, undefined);
    t.diagnostic(`EXPLICIT_UNSUPPORTED ${JSON.stringify({capability:result.capability,source:result.source})}`);
  } else {
    assert.equal(result.inspectError, undefined); assert.equal(result.trimError, undefined);
    assert.deepEqual([...new Set(result.output.colors)], [1]); assert.ok(result.output.audio);
    assert.ok(Math.abs(result.output.duration-.8)<.06);
    assert.ok(result.output.energies[1]>result.output.energies[0]*100 && result.output.energies[1]>result.output.energies[2]*100);
  }
});

test("Chromium: naturally rotated input keeps display dimensions without upscaling", { timeout: 60000 }, async t => {
  const page=await browserFixture(t,chromium);
  const result=await page.evaluate(async()=>{
    const {file}=await f.generate({audio:false,rotation:90}),source=await videoEdit.inspectVideoEdit(file);
    const r=await videoEdit.trimVideo(file,{start:1.1,end:1.9});
    return{source,info:[r.width,r.height],output:await f.analyze(r.file)};
  });
  assert.deepEqual([result.source.width,result.source.height],[240,320]);
  assert.deepEqual(result.info,[240,320]);assert.deepEqual([result.output.width,result.output.height],[240,320]);
  assert.deepEqual([...new Set(result.output.colors)],[1]);assert.equal(result.output.audio,false);
});

test("Chromium: inspection, exact full-range identity, video-only trim and bounded progress", { timeout: 60000 }, async t => {
  const page=await browserFixture(t,chromium);
  const result=await page.evaluate(async()=>{
    const {file}=await f.generate({audio:false}),info=await videoEdit.inspectVideoEdit(file),progress=[];
    const same=await videoEdit.trimVideo(file,{start:0,end:info.duration});
    const trimmed=await videoEdit.trimVideo(file,{start:.2,end:.8},{onProgress:p=>progress.push(p)});
    return{info,identity:same.file===file,changed:same.changed,trim:await f.analyze(trimmed.file),progress};
  });
  assert.deepEqual(result.info,{width:320,height:240,duration:3});
  assert.equal(result.identity,true);assert.equal(result.changed,false);
  assert.deepEqual([...new Set(result.trim.colors)],[0]);assert.equal(result.trim.audio,false);
  assert.ok(Math.abs(result.trim.duration-.6)<.03);assert.ok(result.progress.length>0);
  assert.ok(result.progress.every(p=>Number.isFinite(p)&&p>=0&&p<=1));
});

test("Chromium: invalid bounds, undecodable bytes, size cap and pre-abort reject without original fallback", { timeout: 60000 }, async t => {
  const page=await browserFixture(t,chromium);
  const result=await page.evaluate(async()=>{
    const {file}=await f.generate({audio:false}),errors=[];
    const attempt=async fn=>{try{await fn();errors.push('UNEXPECTED_SUCCESS');}catch(e){errors.push(e.name==='AbortError'?e.name:e.message);}};
    for(const range of [{start:-1,end:1},{start:1,end:1},{start:2,end:1},{start:NaN,end:1},{start:0,end:Infinity},{start:0,end:3.01}])await attempt(()=>videoEdit.trimVideo(file,range));
    await attempt(()=>videoEdit.inspectVideoEdit(new File(['bad'],'bad.mp4',{type:'video/mp4'})));
    const big=new File(['x'],'big.mp4');Object.defineProperty(big,'size',{value:52_428_801});await attempt(()=>videoEdit.inspectVideoEdit(big));
    const empty=new File([],'empty.mp4');await attempt(()=>videoEdit.trimVideo(empty,{start:0,end:1}));
    const c=new AbortController();c.abort();await attempt(()=>videoEdit.inspectVideoEdit(file,{signal:c.signal}));
    await attempt(()=>videoEdit.trimVideo(file,{start:0,end:1},{signal:c.signal}));return errors;
  });
  assert.deepEqual(result,[...Array(6).fill("VIDEO_EDIT_INVALID_RANGE"),"VIDEO_EDIT_UNREADABLE","VIDEO_EDIT_INVALID_FILE","VIDEO_EDIT_INVALID_FILE","AbortError","AbortError"]);
});

test("Chromium: abort while init is held, during encode and immediately after execute all settle before disposal", { timeout: 60000 }, async t => {
  const page=await browserFixture(t,chromium);
  const result=await page.evaluate(async()=>{
    const {file}=await f.generate(),m=videoEdit.mb,events=[],originalInit=m.Conversion.init,dispose=m.Input.prototype.dispose;
    m.Input.prototype.dispose=function(){events.push('dispose');return dispose.call(this);};
    const results=[];
    try{for(const when of ['init','encode','after-execute']){
      const c=new AbortController();let cancelSettled=false,enteredEncode=false;
      m.Conversion.init=async options=>{
        const conversion=await originalInit.call(m.Conversion,options),cancel=conversion.cancel.bind(conversion),execute=conversion.execute.bind(conversion);
        conversion.cancel=async()=>{events.push('cancel-start');await cancel();await new Promise(r=>setTimeout(r,5));cancelSettled=true;events.push('cancel-done');};
        if(when==='init')c.abort();
        if(when==='after-execute')conversion.execute=async()=>{await execute();c.abort();};
        return conversion;
      };
      events.length=0;let error;
      try{await videoEdit.trimVideo(file,{start:.1,end:2.9},{signal:c.signal,onProgress:p=>{if(when==='encode'&&p>0&&p<1){enteredEncode=true;c.abort();}}});error='UNEXPECTED_SUCCESS';}
      catch(e){error=e.name;}
      results.push({when,error,cancelSettled,enteredEncode,events:[...events]});
    }}finally{m.Conversion.init=originalInit;m.Input.prototype.dispose=dispose;}
    return results;
  });
  for(const r of result){assert.equal(r.error,"AbortError",r.when);
    if(r.when==="encode")assert.equal(r.enteredEncode,true,"must abort active encoding, not initial progress=0 before pumps start");
    if(r.when!=="after-execute"){assert.equal(r.cancelSettled,true);assert.ok(r.events.indexOf("cancel-done")<r.events.lastIndexOf("dispose"));}
    assert.equal(r.events.at(-1),"dispose");}
});

test("Chromium literal omission: removing copy:false exposes discarded segment packets/audio", { timeout: 60000 }, async t => {
  const page=await browserFixture(t,chromium,source=>{
    assert.ok(source.includes('copy: false'));return source.replace('copy: false','copy: undefined');
  });
  const result=await page.evaluate(async()=>{
    const {file}=await f.generate();const trimmed=await videoEdit.trimVideo(file,{start:1.1,end:1.9});
    return await f.analyze(trimmed.file);
  });
  assert.ok(result.frames>9||result.minTimestamp<-.01||result.maxTimestamp>.81
    ||result.colors.some(c=>c!==1)||result.energies[0]>result.energies[1]/100||result.energies[2]>result.energies[1]/100,
    "copy omission must be killed by real encoded packets or audio, not a source-string assertion");
  t.diagnostic(`COPY_OMISSION ${JSON.stringify({videoPackets:result.frames,videoStart:result.minTimestamp,videoEnd:result.maxTimestamp,
    audioPackets:result.audioFrames,audioStart:result.minAudioTimestamp,audioEnd:result.maxAudioTimestamp})}`);
});
