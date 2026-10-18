import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const output = mkdtempSync(join(tmpdir(), "letscube-gallery-edit-ui-"));
const origin = "https://gallery-edit.invalid";
const results = [];
const source = readFileSync(join(src, "components/chat/attach/AttachGalleryPanel.tsx"), "utf8");
let browser, bundle, css;

test.before(async () => {
  assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, "0");
  const built = await build({
    write: false, outdir: join(output, "bundle"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": src },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": JSON.stringify({
      VITE_SUPABASE_URL: origin, VITE_SUPABASE_ANON_KEY: "synthetic-fixture", VITE_MEDIA_SIGNED_URLS: "signed-only", VITE_KUB_QA_ALLOW_MUTATIONS: "0",
    }) },
    stdin: { resolveDir: src, sourcefile: "gallery-edit-ui-fixture.tsx", loader: "tsx", contents: `
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import {AttachGalleryPanel} from './components/chat/attach/AttachGalleryPanel';
      import {KubGlassLayer} from './components/kub/KubGlassLayer';import {moveSelected} from './lib/attachSheet';
      import * as m from 'mediabunny';
      const root=createRoot(document.getElementById('root'));const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
      window.activeURLs=new Set();URL.createObjectURL=value=>{const url=create(value);window.activeURLs.add(url);return url;};
      URL.revokeObjectURL=url=>{window.activeURLs.delete(url);revoke(url);};
      async function photo(color,index){const canvas=document.createElement('canvas');canvas.width=480;canvas.height=320;
        const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,480,320);
        ctx.fillStyle='#f4dc7a';ctx.fillRect(75+index*30,70,190,180);ctx.fillStyle='#ffffff';ctx.fillRect(260,105,95,100);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));canvas.width=canvas.height=0;
        return new File([blob],'synthetic-'+index+'.png',{type:'image/png'});
      }
      async function video(){const format=new m.Mp4OutputFormat({fastStart:'in-memory'});
        const codec=await m.getFirstEncodableVideoCodec(['avc','vp9','av1'].filter(c=>format.getSupportedVideoCodecs().includes(c)),{width:320,height:240});
        if(!codec)throw Error('SYNTHETIC_VIDEO_CAPABILITY_REFUSED');
        const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');
        const source=new m.CanvasSource(canvas,{codec,quality:new m.Quality({bitrate:150000})});
        const out=new m.Output({format,target:new m.BufferTarget()});out.addVideoTrack(source,{frameRate:10});
        try{await out.start();for(let i=0;i<5;i++){
          ctx.fillStyle='#e8a9b5';ctx.fillRect(0,0,320,240);ctx.fillStyle='#36815a';ctx.fillRect(70+i*5,60,150,140);
          await source.add(i/10,.1,{keyFrame:i===0});
        }await out.finalize();return new File([out.target.buffer],'synthetic-trimmed.mp4',{type:'video/mp4'});
        }finally{if(out.state!=='finalized')await out.cancel();canvas.width=canvas.height=0;}
      }
      function Gallery({picks}){const [selected,setSelected]=useState(picks.slice(0,4).map(p=>p.id));
        const entries=[{id:'camera',label:'Камера',icon:'camera',onPress:()=>window.proof.entries++},
          {id:'library',label:'Из галереи',icon:'image',onPress:()=>window.proof.entries++}];
        return <section data-fixture-sheet="" className="relative mx-auto mt-6 overflow-hidden rounded-[1.75rem] py-3"
          style={{width:innerWidth<768?'calc(100vw - 1rem)':'min(24.375rem, calc(100vw - 1.5rem))'}}>
          <KubGlassLayer strong className="rounded-[inherit] border border-[color:var(--glass-line)]"/>
          <div className="relative"><AttachGalleryPanel entries={entries} picks={picks} selected={selected} reserveBottom={0}
            onEdit={id=>window.proof.edits.push(id)}
            onToggle={id=>{window.proof.toggles.push(id);setSelected(current=>current.includes(id)?current.filter(v=>v!==id):[...current,id]);}}
            onMove={(id,direction)=>{window.proof.moves.push({id,direction});setSelected(current=>moveSelected(current,id,direction));}}/>
          </div>
        </section>;
      }
      window.unmount=()=>flushSync(()=>root.render(null));
      window.dispose=()=>{window.unmount();for(const url of [...window.activeURLs])URL.revokeObjectURL(url);};
      window.mount=async(includeGif=false)=>{
        window.dispose();const files=await Promise.all([photo('#87c8e7',0),photo('#b0c8a4',1),photo('#d9b8e4',2),video()]);
        const picks=files.map((file,index)=>({id:['hd','sd','plain','video'][index],file,url:URL.createObjectURL(file),
          kind:index===3?'video':'image',source:'library',...(index<2?{preparedPhoto:{width:480,height:320,quality:index===0?'original':'compact'},edited:true}:{}),
          ...(index===3?{edited:true}:{})}));
        if(includeGif){const bytes=Uint8Array.from(atob('R0lGODlhAQABAIAAAObm5gAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='),c=>c.charCodeAt(0));
          const file=new File([bytes],'synthetic.gif',{type:'image/gif'});picks.push({id:'gif',file,url:URL.createObjectURL(file),kind:'image',source:'library'});}
        window.proof={edits:[],toggles:[],moves:[],entries:0};window.picks=picks;flushSync(()=>root.render(<Gallery picks={picks}/>));
      };
    ` },
  });
  bundle = built.outputFiles.find(file => file.path.endsWith(".js")).text;
  const compiler = await compile(readFileSync(join(src, "index.css"), "utf8"), { base: src, onDependency() {} });
  css = optimize(compiler.build(new Scanner({}).scanFiles([{ content: bundle, extension: "js" }]))).code;
  browser = await chromium.launch({ headless: true, env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" } });
});

test.after(async () => {
  await browser?.close();
  writeFileSync(join(output, "metadata.json"), JSON.stringify({
    syntheticOnly: true, auth: false, sourceSha256: createHash('sha256').update(source).digest('hex'),
    baselineEvidenceReused: 'tests/unit/attach-photo-editor-flow.test.mjs: shipped mounted photos/video edit-entry absence controls; not rerun', results,
  }, null, 2));
  console.log(`Gallery edit affordance evidence: ${output}`);
});

async function fixture(width = 390, theme = "dark", includeGif = false) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, serviceWorkers: "block" });
  const page = await context.newPage(), unexpected = [], errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.protocol==='blob:'&&url.origin===origin&&route.request().method()==='GET'
      &&await page.evaluate(value=>window.activeURLs.has(value),url.href))return route.continue();
    if(url.origin===origin&&route.request().method()==='GET'){
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><html class="${theme}" lang="ru"><head><meta charset="utf-8"><title>Synthetic attach gallery</title><link rel="stylesheet" href="/fixture.css"></head><body class="bg-[color:var(--kub-bg)]"><button id="outside">Outside synthetic control</button><div id="root"></div><script src="/fixture.js"></script></body></html>`});
      if(url.pathname==='/fixture.css')return route.fulfill({contentType:'text/css',body:css});
      if(url.pathname==='/fixture.js')return route.fulfill({contentType:'text/javascript',body:bundle});
      if(/^\/fonts\/inter\/inter-(latin|latin-ext|cyrillic|cyrillic-ext)\.woff2$/.test(url.pathname))return route.fulfill({contentType:'font/woff2',body:readFileSync(new URL(`../../artifacts/kub/public${url.pathname}`,import.meta.url))});
    }
    unexpected.push('unlisted-request');return route.abort();
  });
  await page.goto(origin);await page.locator('#outside').focus();await page.evaluate(value=>window.mount(value),includeGif);
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-attach-pick] img')].every(n=>n.complete&&n.naturalWidth>0)
    &&[...document.querySelectorAll('video')].every(n=>n.readyState>=2));
  await page.evaluate(()=>document.fonts.ready);
  return{page,context,errors,unexpected};
}

async function dispose(f){
  await f.page.evaluate(()=>window.dispose());
  assert.equal(await f.page.evaluate(()=>window.activeURLs.size),0,'all fixture-owned URLs must be revoked');
  await f.page.locator('#outside').focus();
  assert.equal(await f.page.locator('#outside').evaluate(n=>n===document.activeElement),true);
  await f.context.close();
}

for(const width of [390,1440])for(const theme of ['light','dark'])test(`${width} ${theme}: edited badges and 44px edit targets do not overlap tile controls`,async()=>{
  const f=await fixture(width,theme);try{
    assert.equal(await f.page.title(),'Synthetic attach gallery');assert.equal(new URL(f.page.url()).origin,origin);
    const geometry=await f.page.locator('[data-fixture-sheet]').evaluate(sheet=>{
      const rect=n=>n?.getBoundingClientRect().toJSON()??null;
      const overlaps=(a,b)=>!!a&&!!b&&Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5;
      const inside=(a,b)=>a.left>=b.left-.5&&a.top>=b.top-.5&&a.right<=b.right+.5&&a.bottom<=b.bottom+.5;
      return{sheet:rect(sheet),overflow:document.documentElement.scrollWidth>innerWidth,tiles:[...sheet.querySelectorAll('[data-attach-pick]')].map((tile,index)=>{
        const edit=tile.querySelector('[data-attach-edit]'),selection=tile.querySelector('[data-attach-selection]');
        const move=tile.querySelector('button[aria-label^="Переместить"]')?.parentElement;
        const badge=tile.querySelector('[data-attach-edited]')??[...tile.querySelectorAll('span')].find(n=>n.textContent==='Обрезано');
        const parts={edit:rect(edit),selection:rect(selection),move:rect(move),badge:rect(badge)};
        const pairs=Object.entries(parts).flatMap(([name,a],at,all)=>all.slice(at+1).filter(([,b])=>overlaps(a,b)).map(([other])=>`${name}/${other}`));
        const textRect=badge?(()=>{const range=document.createRange();range.selectNodeContents(badge);return rect(range);})():null;
        return{index,kind:tile.dataset.attachPick,tile:rect(tile),...parts,overlaps:pairs,
          partsInside:Object.values(parts).filter(Boolean).every(p=>inside(p,rect(tile))),badgeText:badge?.textContent??null,
          textInside:!textRect||inside(textRect,rect(tile)),editSvgPaths:edit?.querySelectorAll('svg path').length??0,
          badgeSvg:badge?.querySelectorAll('svg').length??0,number:selection?.dataset.attachSelection??null};
      })};
    });
    const before=geometry.tiles.map(t=>t.tile);
    await f.page.locator('[data-attach-edit="hd"]').hover();await f.page.locator('[data-attach-edit="hd"]').focus();
    assert.deepEqual(await f.page.locator('[data-attach-pick]').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON())),before,'hover/focus must not resize or move tiles');
    await f.page.locator('#outside').focus();await f.page.mouse.move(1,1);
    await f.page.screenshot({path:join(output,`${width}-${theme}-gallery.png`)});
    results.push({width,theme,geometry,errors:f.errors,unexpected:f.unexpected});
    assert.equal(geometry.sheet.width,width===390?374:390,'use actual phone insets and desktop390px cap');
    assert.equal(geometry.overflow,false);assert.equal(geometry.tiles.length,4);
    assert.deepEqual(geometry.tiles.map(t=>t.number),['1','2','3','4']);
    assert.deepEqual(geometry.tiles.map(t=>t.badgeText),['HD','SD',null,'Обрезано']);
    assert.ok(geometry.tiles.slice(0,2).every(t=>t.badgeSvg===1),'quality badges retain actual pencil glyph');
    for(const tile of geometry.tiles){
      assert.ok(tile.edit.width>=44&&tile.edit.height>=44,'literal44px edit target');assert.ok(tile.editSvgPaths>0,'actual KubIcon must render paths');
      assert.ok(tile.partsInside&&tile.textInside,`tile${tile.index}: controls/text remain inside`);
      assert.deepEqual(tile.overlaps,[],`tile${tile.index} ${tile.kind}: overlays must not collide`);
    }
    assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
  }finally{await dispose(f);}
});

test('edit, selection and reorder callbacks are independent; GIF has no edit entry',async()=>{
  const f=await fixture(390,'dark',true);try{
    assert.equal(await f.page.locator('[data-attach-pick]').count(),5);assert.equal(await f.page.locator('[data-attach-edit]').count(),4);
    assert.equal(await f.page.locator('[data-attach-edit="gif"]').count(),0);
    for(const id of ['hd','sd','plain','video'])await f.page.locator(`[data-attach-edit="${id}"]`).click();
    assert.deepEqual(await f.page.evaluate(()=>window.proof),{edits:['hd','sd','plain','video'],toggles:[],moves:[],entries:0});
    await f.page.locator('[data-attach-edit="hd"]').focus();await f.page.keyboard.press('Enter');
    assert.equal(await f.page.evaluate(()=>window.proof.edits.length),5);assert.equal(await f.page.evaluate(()=>window.proof.toggles.length),0);
    await f.page.getByRole('checkbox',{name:'Фото 3, номер 3 в порядке отправки',exact:true}).click();
    assert.deepEqual(await f.page.evaluate(()=>window.proof.toggles),['plain']);
    await f.page.getByRole('button',{name:'Переместить фото 2 раньше',exact:true}).click();
    assert.deepEqual(await f.page.evaluate(()=>window.proof.moves),[{id:'sd',direction:-1}]);
    assert.equal(await f.page.evaluate(()=>window.proof.edits.length),5);
    assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
    results.push({case:'callbacks-gif',proof:await f.page.evaluate(()=>window.proof),gifEdit:false,errors:f.errors,unexpected:f.unexpected});
  }finally{await dispose(f);}
});
