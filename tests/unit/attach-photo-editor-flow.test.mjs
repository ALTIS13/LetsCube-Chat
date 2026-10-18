import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = new URL("../../", import.meta.url), src = fileURLToPath(new URL("artifacts/kub/src/", root));
const requireKub = createRequire(new URL("artifacts/kub/package.json", root));
const { chromium } = requireKub("@playwright/test");
const { build } = createRequire(requireKub.resolve("vite"))("esbuild");
const shipped = "5d2f5eb6c77101ba0b0cf63216ee8f9dc0269b52";
const A = "10000000-0000-4000-8000-000000000001", B = "10000000-0000-4000-8000-000000000002";
const CHAT = "20000000-0000-4000-8000-000000000001", TOPIC = "20000000-0000-4000-8000-000000000002";
const origin = "http://attach-editor.invalid";
let browser;
const bundles = new Map();

function callback(name) {
  const source = readFileSync(new URL("artifacts/kub/src/components/chat/ChatWindow.tsx", root), "utf8");
  const tree = ts.createSourceFile("ChatWindow.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && ts.isCallExpression(node.initializer)) {
      found.push(node.initializer.arguments[0].getText(tree));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.equal(found.length, 1, `one actual ${name} callback`); return found[0];
}

async function compile(baseline = false) {
  const leaf = new Map([
    ["components/kub/index.ts", "export const KubIcon=()=>null;export const KubGlassLayer=()=>null;"],
    ["lib/outbox/appOutbox.ts", "export const appOutbox={stop(){}};"],
    ["lib/supabase/client.ts", "export const createClient=()=>{throw Error('SYNTHETIC_FIXTURE_API_REFUSED')};"],
    ["lib/monitoring.ts", "export const reportError=()=>{};"],
    ["lib/appDialogs.ts", "export const requestAppConfirm=async()=>true;export const showAppAlert=()=>{};"],
    ["lib/actionFeedback.ts", "export const showActionFeedback=value=>{(window.feedback??=[]).push(value)};"],
    ["lib/platform/capabilities.ts", "export const isNativeAndroid=()=>false;"],
    ["hooks/useMemberMentions.ts", `export const useMemberMentionPicker=()=>({open:false,fieldAttributes:{},
      onKeyDown:()=>false,onChange:()=>false,observeSelection(){},onCompositionStart(){},onCompositionEnd(){},onPaste(){}});`],
    ["hooks/useVideoSendLadder.ts", `const ladder={progress:null,ready:false,stops:[],
      cancel(){window.ladderCancels=(window.ladderCancels??0)+1;},
      prepare:async files=>{if(window.holdLadder)await new Promise(resolve=>window.releaseLadder=resolve);
        window.ladderReturned=(window.ladderReturned??0)+1;return{files,origins:undefined};}};
      export const useVideoSendLadder=()=>ladder;`],
    ["components/chat/attach/AttachLocationPanel.tsx", "export const AttachLocationPanel=()=>null;"],
  ]);
  const result = await build({ write: false, bundle: true, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": src }, define: { "process.env.NODE_ENV": '"development"', "import.meta.env": JSON.stringify({ DEV: false, VITE_KUB_QA_ALLOW_MUTATIONS: "0" }) },
    plugins: [{ name: "owned-sheet-io-leaves", setup(plugin) {
      plugin.onResolve({ filter: /(?:^|\/)AttachVideoEditor(?:\.tsx)?$/ }, () => ({ path: "video-editor", namespace: "video-editor-leaf" }));
      plugin.onLoad({ filter: /.*/, namespace: "video-editor-leaf" }, () => ({ loader: "tsx", resolveDir: src, contents: `
        import React,{useEffect} from 'react';
        export default function AttachVideoEditor(props){
          window.editorFile=props.file;
          useEffect(()=>{window.editorMounts++;return()=>{window.editorUnmounts++;};},[]);
          const apply=changed=>window.applyAccepted=props.onApply({file:changed?window.trimmed:props.file,
            width:8,height:6,duration:0.8,changed});
          return <div data-video-editor=""><button data-editor-action="cancel" onClick={props.onCancel}>Cancel</button>
            <button data-editor-action="noop" onClick={()=>apply(false)}>Noop</button>
            <button data-editor-action="apply" onClick={()=>apply(true)}>Apply synthetic trim</button>
            <button data-editor-action="hold" onClick={()=>{window.releaseExport=()=>apply(true);}}>Hold</button>
            {props.onRestore&&<button data-editor-action="restore" onClick={props.onRestore}>Restore</button>}</div>;
        }` }));
      plugin.onResolve({ filter: /(?:^|\/)AttachPhotoEditor(?:\.tsx)?$/ }, () => ({ path: "editor", namespace: "editor-leaf" }));
      plugin.onLoad({ filter: /.*/, namespace: "editor-leaf" }, () => ({ loader: "tsx", resolveDir: src, contents: `
        import React,{useEffect} from 'react';
        export function AttachPhotoEditor(props){
          window.editorFile=props.file;
          useEffect(()=>{window.editorMounts++;return()=>{window.editorUnmounts++;};},[]);
          const apply=changed=>props.onApply({file:changed?window.baked:props.file,width:changed?8:16,height:changed?6:12,changed});
          return <div data-photo-editor=""><button data-editor-action="cancel" onClick={props.onCancel}>Cancel</button>
            <button data-editor-action="noop" onClick={()=>apply(false)}>Noop</button>
            <button data-editor-action="apply" onClick={()=>{window.bakedQuality=props.quality;apply(true);}}>Apply</button>
            <button data-editor-action="hold" onClick={()=>{window.bakedQuality=props.quality;window.releaseExport=()=>apply(true);}}>Hold</button>
            {props.onRestore&&<button data-editor-action="restore" onClick={props.onRestore}>Restore</button>}</div>;
        }export default AttachPhotoEditor;` }));
      plugin.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, args => {
        const relative = args.path.replaceAll("\\", "/").slice(src.replaceAll("\\", "/").length).replace(/^\//, "");
        if (leaf.has(relative)) return { contents: leaf.get(relative), loader: "tsx", resolveDir: src };
        if (baseline === "edit-generation" && relative === "components/chat/attach/AttachSheet.tsx") {
          const source = readFileSync(args.path, "utf8").replaceAll("\r\n", "\n");
          const anchor = "lifetimeRef.current.version += 1;\n    cancelLadderRef.current();\n    const edit: EditingMedia";
          assert.equal(source.split(anchor).length, 2, "one actual interaction generation omission");
          return { contents: source.replace(anchor, "cancelLadderRef.current();\n    const edit: EditingMedia"),
            loader: "tsx", resolveDir: dirname(args.path) };
        }
        if (baseline === "late-apply" && relative === "components/chat/attach/AttachSheet.tsx") {
          const source = readFileSync(args.path,"utf8");
          const anchor = "const applyMediaEdit = (edit: EditingMedia, result: MediaEditResult): boolean => {\n    if (!editIsCurrent(edit)) return false;";
          assert.equal(source.replaceAll("\r\n","\n").split(anchor).length,2,"one actual apply guard omission");
          return {contents:source.replaceAll("\r\n","\n").replace(anchor,
            "const applyMediaEdit = (edit: EditingMedia, result: MediaEditResult): boolean => {"),loader:"tsx",resolveDir:dirname(args.path)};
        }
        if (baseline === true && /components\/chat\/attach\/Attach(?:Sheet|GalleryPanel)\.tsx$/.test(relative)) {
          return { contents: execFileSync("git", ["show", `${shipped}:artifacts/kub/src/${relative}`],
            { cwd: fileURLToPath(root), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), loader: "tsx", resolveDir: dirname(args.path) };
        }
      });
    } }], stdin: { loader: "tsx", resolveDir: src, sourcefile: "attach-editor-integration.tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import AttachSheet from './components/chat/attach/AttachSheet';import {useAppStore} from './store/app.store';
      import * as staged from './lib/stagedAttachments';import * as compression from './lib/mediaCompression';
      import * as quality from './lib/mediaQuality';import * as workflow from './lib/stagedUploadWorkflow';
      import {removeLocation as actualRemoveLocation} from './lib/mediaLocation';
      import {browserOutgoingMediaStorage} from './lib/outbox/outgoingMediaStorage';
      import {keepOutgoingMediaFor,restoreOutgoingMedia} from './lib/outbox/appOutgoingMedia';
      import {reloadWouldLose} from './lib/reloadGuard';
      const {MAX_STAGED_ATTACHMENTS,createStagedAttachment,revokeAttachmentPreview,validateStagedAttachment}=staged;
      const {originalLimitMessage,originalPreviewDimensions,planAttachmentPreparation,shouldBuildOriginalPreview}=compression;
      const {DEFAULT_MEDIA_QUALITY,DEFAULT_PHOTO_SEND_QUALITY}=quality;
      const {createStagedUploadScope,runScopedStagedPreparation,commitPreparedStagedAttachments}=workflow;
      const uploadScope=createStagedUploadScope('${CHAT}'),stagedAttachmentsRef={current:[]};
      const setStagedAttachments=update=>{stagedAttachmentsRef.current=update(stagedAttachmentsRef.current);};
      const showAppAlert=()=>{},prepareOriginalPreview=async()=>null;
      window.encodes=[];window.locations=[];window.requests=[];window.sends=[];window.tasks=[];
      window.editorMounts=0;window.editorUnmounts=0;window.releaseExport=null;
      const prepareChatImageAttachment=async(file,q)=>{
        window.encodes.push({file,quality:q});if(file===window.baked)throw Error('BAKED_FILE_ENCODED_AGAIN');
        return {file,dimensions:{width:16,height:12}};
      };
      const readMediaDimensions=async()=>({width:16,height:12});
      const removeLocation=async file=>{window.locations.push(file);return actualRemoveLocation(file);};
      const stageFiles=${callback("stageFiles")};
      const storage=browserOutgoingMediaStorage();
      const sendStagedAttachments=async(caption,_id,attachments,_origin,mentionEntities)=>{
        window.sends.push({caption,attachments,mentionEntities});
        for(const attachment of attachments)await storage.save('${A}',{tempId:'tmp:'+attachment.clientMessageId,
          chatId:'${CHAT}',topicId:'${TOPIC}',replyToId:null,caption,clientSentAt:new Date().toISOString(),attachment});
        return true;
      };
      const sendMediaFromSheet=${callback("sendMediaFromSheet")};
      const created=new Set(),nativeCreate=URL.createObjectURL.bind(URL),nativeRevoke=URL.revokeObjectURL.bind(URL);
      window.urlFiles=new Map();URL.createObjectURL=value=>{const u=nativeCreate(value);created.add(u);window.urlFiles.set(u,value);return u;};
      URL.revokeObjectURL=u=>{created.delete(u);nativeRevoke(u);};
      let model={open:true,chatId:'${CHAT}',topicId:'${TOPIC}'},root=createRoot(document.getElementById('root')),coldRestored=[];
      function render(){flushSync(()=>root.render(model.open?<AttachSheet {...model}
        incoming={window.incoming} initialCaption="Synthetic caption\nsecond line" onIncomingTaken={()=>{}}
        onClose={()=>{model.open=false;render();}} onSendLocation={()=>{throw Error('NO_LOCATION_CASE');}}
        onSendMedia={request=>{window.requests.push(request);window.tasks.push(sendMediaFromSheet(request));}}/>:null));}
      async function picture(color,name,width=16,height=12){const c=document.createElement('canvas');c.width=width;c.height=height;
        c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,width,height);
        return new File([await new Promise(r=>c.toBlob(r,'image/png'))],name,{type:'image/png',lastModified:1234});}
      window.fixture={async mount(kind='photo'){
        if(kind==='video'){
          window.first=new File([new Uint8Array([1,2,3,4])],'first.mp4',{type:'video/mp4',lastModified:1234});
          window.second=new File([new Uint8Array([5,6,7,8])],'second.mp4',{type:'video/mp4',lastModified:1234});
          window.trimmed=window.baked=new File([new Uint8Array([9,10])],'trimmed.mp4',{type:'video/mp4',lastModified:1234});
        }else{window.first=await picture('#ff0000','first.png');window.second=await picture('#00ff00','second.png');
          window.baked=await picture('#000000','edited.png',8,6);}
        window.incoming={id:1,source:'library',files:[window.first,window.second]};
        useAppStore.getState().setAuthSessionIdentity({userId:'${A}',sessionId:'old-synthetic-session'});
        useAppStore.getState().setCurrentUser({id:'${A}'});render();},
        rerender(next){model={...model,...next};render();},
        owner(mode){const before=useAppStore.getState().accountEpoch;flushSync(()=>{const s=useAppStore.getState();if(mode==='A-null-A'){s.setCurrentUser(null);s.setCurrentUser({id:'${A}'});}
          else if(mode==='epoch'){s.setAuthSessionIdentity({userId:'${A}',sessionId:'new-synthetic-session'});s.setCurrentUser({id:'${A}'});}
          else {s.setAuthSessionIdentity({userId:'${B}',sessionId:'other-synthetic-session'});s.setCurrentUser({id:'${B}'});}});
          return{before,after:useAppStore.getState().accountEpoch};},
        async drain(){await Promise.all(window.tasks);},
        release(){flushSync(()=>window.releaseExport?.());},
        losses:reloadWouldLose,
        async restored(){return storage.list('${A}');},
        async rawDto(){const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('kub-outbox-media',1);
          r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
          try{return await new Promise((resolve,reject)=>{const tx=db.transaction('media','readonly'),r=tx.objectStore('media').getAll();
            tx.oncomplete=()=>resolve(r.result);tx.onabort=()=>reject(tx.error);});}finally{db.close();}},
        async coldRestore(){keepOutgoingMediaFor('${A}');coldRestored=await restoreOutgoingMedia('${A}');return coldRestored;},
        close(){root.unmount();keepOutgoingMediaFor(null);
          for(const attachment of stagedAttachmentsRef.current)revokeAttachmentPreview(attachment);
          for(const entry of coldRestored)revokeAttachmentPreview(entry.attachment);
          const leaked=created.size;for(const u of [...created])URL.revokeObjectURL(u);return leaked;}};
    ` } });
  return result.outputFiles[0].text;
}

test.before(async () => { browser = await chromium.launch({ headless: true, env: { ...process.env, KUB_QA_ALLOW_MUTATIONS: "0" } }); });
test.after(async () => { await browser?.close(); });
async function mount(t, baseline = false, media = "photo") {
  if (!bundles.has(baseline)) bundles.set(baseline, await compile(baseline));
  const context = await browser.newContext({ serviceWorkers: "block" }), page = await context.newPage();
  const unexpected = [], errors = []; page.setDefaultTimeout(3000); page.on("pageerror", e => errors.push(e.message));
  await context.route("**/*", route => {
    if (route.request().url() === origin + "/") return route.fulfill({ contentType: "text/html", body: '<title>Synthetic attach integration</title><main><div id="root"></div></main>' });
    unexpected.push(route.request().url()); return route.abort();
  });
  t.after(async () => {
    try { assert.equal(await page.evaluate(() => { window.fixture.release(); return window.fixture.close(); }),0,"owned preview URLs disposed"); }
    finally { await context.close(); }
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  });
  await page.goto(origin); await page.addScriptTag({ content: bundles.get(baseline) });
  await page.evaluate(media => window.fixture.mount(media), media);
  await page.locator('[data-attach-pick] [role="checkbox"]').first().waitFor();
  return page;
}
async function editorEntry(page) {
  assert.equal(await page.locator('[data-attach-pick] [role="checkbox"]').count(), 2, "known selected-photo calibration");
  assert.equal(await page.locator('[data-attach-edit]').count(), 2, "GALLERY_EDIT_ENTRY_MISSING");
}
async function openEditor(page, index = 0) {
  await editorEntry(page); await page.locator('[data-attach-edit]').nth(index).click();
  await page.locator('[data-photo-editor]').waitFor();
}
async function openVideoEditor(page, index = 0) {
  await editorEntry(page); await page.locator('[data-attach-edit]').nth(index).click();
  await page.locator('[data-video-editor]').waitFor();
}
async function send(page) { await page.getByTestId("attach-send").click(); await page.evaluate(() => window.fixture.drain()); }
async function assertNoLateReplacement(page) {
  const shown=await page.evaluate(()=>[...document.querySelectorAll('[data-attach-pick] img')].some(n=>window.urlFiles.get(n.src)===window.baked));
  assert.equal(shown,false,"LATE_APPLY_MUST_NOT_REPLACE_CANCELLED_PICK");
}

test("shipped mounted sheet has real selected photos but fails the gallery-edit acceptance assertion", { timeout: 15000 }, async t => {
  const page = await mount(t, true);
  await assert.rejects(() => editorEntry(page), error => error.code === "ERR_ASSERTION"
    && error.actual === 0 && error.expected === 2 && /GALLERY_EDIT_ENTRY_MISSING/.test(error.message));
});

for (const action of ["cancel", "noop"]) test(`mounted editor ${action} preserves Files, caption, album order and HD`, { timeout: 15000 }, async t => {
  const page = await mount(t); await openEditor(page);
  await page.locator(`[data-editor-action="${action}"]`).click(); await page.locator('[data-photo-editor]').waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Переместить фото 1 позже", exact: true }).click();
  await send(page);
  const actual = await page.evaluate(() => { const r=window.requests[0];return {count:window.requests.length,
    originalOrder:r.files[0]===window.second&&r.files[1]===window.first,caption:r.caption,quality:r.photoQuality,
    prepared:r.preparedPhotos?.size??0}; });
  assert.deepEqual(actual, { count: 1, originalOrder: true, caption: "Synthetic caption\nsecond line", quality: "original", prepared: 0 });
});

test("reopening edits the current baked File; explicit restore returns the original pick without a prepared claim", { timeout: 15000 }, async t => {
  const page=await mount(t);await openEditor(page);await page.locator('[data-editor-action="apply"]').click();
  await page.locator('[data-photo-editor]').waitFor({state:'detached'});
  await openEditor(page);assert.equal(await page.evaluate(()=>window.editorFile===window.baked),true,"reopened editor must receive current baked File");
  assert.equal(await page.locator('[data-editor-action="restore"]').count(),1);
  await page.locator('[data-editor-action="noop"]').click();
  await page.locator('[data-photo-editor]').waitFor({state:'detached'});
  await openEditor(page);await page.locator('[data-editor-action="restore"]').click();
  await page.locator('[data-photo-editor]').waitFor({state:'detached'});await send(page);
  assert.deepEqual(await page.evaluate(()=>({original:window.requests[0].files[0]===window.first,
    second:window.requests[0].files[1]===window.second,prepared:window.requests[0].preparedPhotos?.size??0})),{original:true,second:true,prepared:0});
});

test("only baked photos hide HD; reopening retains baked quality and Restore returns the original File and HD", { timeout: 15000 }, async t => {
  const page = await mount(t);
  await openEditor(page); await page.locator('[data-editor-action="apply"]').click();
  await page.locator('[data-photo-editor]').waitFor({ state: "detached" });
  await page.getByTestId("attach-hd").click();
  const feedbackTitle = await page.evaluate(() => window.feedback.at(-1).title);
  await openEditor(page); await page.locator('[data-editor-action="apply"]').click();
  await page.locator('[data-photo-editor]').waitFor({ state: "detached" });
  const reopenedQuality = await page.evaluate(() => window.bakedQuality);
  await openEditor(page, 1); await page.locator('[data-editor-action="apply"]').click();
  await page.locator('[data-photo-editor]').waitFor({ state: "detached" });
  const allBakedHd = await page.getByTestId("attach-hd").count();
  await openEditor(page); await page.locator('[data-editor-action="restore"]').click();
  await page.locator('[data-photo-editor]').waitFor({ state: "detached" });
  assert.equal(allBakedHd, 0, "HD_HAS_NO_UNEDITED_PHOTO_TO_CHANGE");
  assert.equal(reopenedQuality, "original", "REOPEN_MUST_RETAIN_BAKED_QUALITY");
  assert.equal(feedbackTitle, "Неизменённые фото: SD");
  assert.equal(await page.getByTestId("attach-hd").count(), 1, "Restore makes an unedited photo available again");
  await send(page);
  assert.deepEqual(await page.evaluate(() => {
    const request = window.requests[0];
    return { count: window.requests.length, firstOriginal: request.files[0] === window.first,
      secondBaked: request.files[1] === window.baked, originalPrepared: request.preparedPhotos?.has(window.first) ?? false,
      bakedQuality: request.preparedPhotos?.get(window.baked)?.quality, quality: request.photoQuality };
  }), { count: 1, firstOriginal: true, secondBaked: true, originalPrepared: false, bakedQuality: "compact", quality: "compact" });
});

test("editing an unselected photo preserves selection and never adds its baked File to the outgoing album", { timeout: 15000 }, async t => {
  const page=await mount(t);await page.locator('[data-attach-pick] [role="checkbox"]').first().click();
  await openEditor(page);await page.locator('[data-editor-action="apply"]').click();
  await page.locator('[data-photo-editor]').waitFor({state:'detached'});await send(page);
  assert.deepEqual(await page.evaluate(()=>({onlySecond:window.requests[0].files.length===1&&window.requests[0].files[0]===window.second,
    prepared:window.requests[0].preparedPhotos?.size??0})),{onlySecond:true,prepared:0});
});

test("an unresolved editor makes the sheet inert and cannot send the raw selection as fallback", { timeout: 15000 }, async t => {
  const page=await mount(t);await openEditor(page);await page.locator('[data-editor-action="hold"]').click();
  assert.equal(await page.getByTestId('attach-sheet').evaluate(n=>n.inert),true);
  assert.ok((await page.evaluate(()=>window.fixture.losses())).includes('attach-sheet'));
  await page.evaluate(()=>document.querySelector('[data-testid="attach-send"]').click());
  assert.equal(await page.evaluate(()=>window.requests.length),0);
  await page.locator('[data-editor-action="cancel"]').click();await page.evaluate(()=>window.fixture.release());
  await assertNoLateReplacement(page);await send(page);
  assert.equal(await page.evaluate(()=>window.requests[0].files[0]===window.first),true,"only an explicit Cancel permits the original again");
});

test("apply replaces only the same pick, hands baked exact File/quality to actual staging and cold bytes DTO", { timeout: 15000 }, async t => {
  const page = await mount(t); const ids = await page.locator('[data-attach-edit]').evaluateAll(nodes => nodes.map(n=>n.dataset.attachEdit));
  await openEditor(page); await page.locator('[data-editor-action="apply"]').click();
  await page.locator('[data-photo-editor]').waitFor({ state: "detached" });
  assert.deepEqual(await page.locator('[data-attach-edit]').evaluateAll(nodes => nodes.map(n=>n.dataset.attachEdit)), ids);
  await page.getByTestId("attach-hd").click(); await send(page);
  const actual = await page.evaluate(async () => { const r=window.requests[0],s=window.sends[0],rows=await window.fixture.restored(),raw=await window.fixture.rawDto();
    const buffers=[];const visit=value=>{if(value instanceof ArrayBuffer)buffers.push([...new Uint8Array(value)]);
      else if(value&&typeof value==='object')Object.values(value).forEach(visit);};visit(raw);
    const original=[...new Uint8Array(await window.first.arrayBuffer())];
    return {count:window.requests.length,exact:r.files[0]===window.baked&&r.files[1]===window.second,
      raw:{buffers:buffers.length,versions:raw.map(row=>row.storage_v),hasOriginal:buffers.some(b=>JSON.stringify(b)===JSON.stringify(original))},
      prepared:[r.preparedPhotos?.get(window.baked),r.preparedPhotos?.has(window.first)??false,r.preparedPhotos?.has(window.second)??false],
      requestQuality:r.photoQuality,caption:r.caption,encodedOnlyUnedited:window.encodes.length===1&&window.encodes[0].file===window.second,
      encodeQuality:window.encodes[0]?.quality,locatedBoth:window.locations[0]===window.baked&&window.locations[1]===window.second,
      stagedExact:s.attachments[0].file===window.baked,qualities:s.attachments.map(a=>a.mediaQuality),
      dto:await Promise.all(rows.map(async row=>({name:row.attachment.file.name,bytes:[...new Uint8Array(await row.attachment.file.arrayBuffer())],
        previewUrl:row.attachment.previewUrl,quality:row.attachment.mediaQuality}))),
      baked:[...new Uint8Array(await window.baked.arrayBuffer())]}; });
  assert.equal(actual.count,1); assert.equal(actual.exact,true); assert.deepEqual(actual.prepared,[{width:8,height:6,quality:"original"},false,false]);
  assert.equal(actual.requestQuality,"compact"); assert.equal(actual.caption,"Synthetic caption\nsecond line");
  assert.equal(actual.encodedOnlyUnedited,true); assert.equal(actual.encodeQuality,"compact"); assert.equal(actual.locatedBoth,true);
  assert.equal(actual.stagedExact,true); assert.deepEqual(actual.qualities,["original","compact"]);
  assert.deepEqual(actual.raw,{buffers:2,versions:[1,1],hasOriginal:false},"cold DTO must contain only final selected bytes, never undo originals");
  assert.equal(actual.dto.length,2); const edited=actual.dto.find(row=>row.name==="edited.png");
  assert.deepEqual(edited.bytes,actual.baked); assert.equal(edited.quality,"original"); assert.equal(edited.previewUrl,null);
  await page.reload(); await page.addScriptTag({ content: bundles.get(false) });
  const cold=await page.evaluate(async()=>{const rows=await window.fixture.coldRestore();const row=rows.find(r=>r.attachment.file.name==='edited.png');
    return {count:rows.length,bytes:[...new Uint8Array(await (await fetch(row.attachment.previewUrl)).arrayBuffer())],
      quality:row.attachment.mediaQuality,caption:row.caption};});
  assert.deepEqual(cold,{count:2,bytes:actual.baked,quality:"original",caption:"Synthetic caption\nsecond line"});
});

for (const retire of ["cancel", "close", "deselect", "chat", "topic", "account", "epoch", "A-null-A"]) {
  test(`held export then ${retire} cannot late-replace or send`, { timeout: 15000 }, async t => {
    const page=await mount(t);await openEditor(page);await page.locator('[data-editor-action="hold"]').click();
    assert.equal(await page.evaluate(()=>window.requests.length),0);
    if(retire==='cancel')await page.locator('[data-editor-action="cancel"]').click();
    else if(retire==='close')await page.evaluate(()=>window.fixture.rerender({open:false}));
    else if(retire==='deselect')await page.locator('[data-attach-pick] [role="checkbox"]').first().evaluate(n=>n.click());
    else if(retire==='chat')await page.evaluate(()=>window.fixture.rerender({chatId:'other-synthetic-chat'}));
    else if(retire==='topic')await page.evaluate(()=>window.fixture.rerender({topicId:'other-synthetic-topic'}));
    else {const epochs=await page.evaluate(retire=>window.fixture.owner(retire),retire);
      assert.ok(epochs.after>epochs.before,"real store retirement must actually advance accountEpoch");}
    await page.locator('[data-photo-editor]').waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>window.editorUnmounts),1,"retiring the sheet/pick must unmount the exporter");
    await page.evaluate(()=>window.fixture.release());await assertNoLateReplacement(page);
    assert.equal(await page.evaluate(()=>window.requests.length),0);
    if(retire==='cancel'){await send(page);assert.equal(await page.evaluate(()=>window.requests[0].files[0]===window.first),true,"late export replaced cancelled edit");}
    else if(retire==='deselect'){await send(page);assert.equal(await page.evaluate(()=>window.requests[0].files.length===1&&window.requests[0].files[0]===window.second),true,
      "deselection retires the edit, not the remaining current selection");}
    else {await page.evaluate(()=>document.querySelector('[data-testid="attach-send"]')?.click());
      assert.equal(await page.evaluate(()=>window.requests.length),0,"a permanently retired sheet cannot send its selection");}
  });
}

test("literal omission of the late-apply guard resurrects a cancelled edit in the actual mounted sheet", { timeout: 15000 }, async t => {
  const page=await mount(t,"late-apply");await openEditor(page);await page.locator('[data-editor-action="hold"]').click();
  await page.locator('[data-editor-action="cancel"]').click();await page.evaluate(()=>window.fixture.release());
  await assert.rejects(()=>assertNoLateReplacement(page),error=>error.code==='ERR_ASSERTION'&&error.actual===true&&error.expected===false
    &&/LATE_APPLY_MUST_NOT_REPLACE_CANCELLED_PICK/.test(error.message));
});

test("video: shipped selected videos have no edit entry (loaded absence control)", { timeout: 15000 }, async t => {
  const page = await mount(t, true, "video");
  assert.equal(await page.locator('[data-attach-pick="video"]').count(), 2);
  await assert.rejects(() => editorEntry(page), error => error.code === "ERR_ASSERTION"
    && error.actual === 0 && error.expected === 2 && /GALLERY_EDIT_ENTRY_MISSING/.test(error.message));
});

test("video: Apply preserves pick identity and sends only the synthetic baked trim through actual staging/DTO", { timeout: 15000 }, async t => {
  const page = await mount(t, false, "video");
  const ids = await page.locator('[data-attach-edit]').evaluateAll(nodes => nodes.map(node => node.dataset.attachEdit));
  await openVideoEditor(page); await page.locator('[data-editor-action="apply"]').click();
  await page.locator('[data-video-editor]').waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.applyAccepted), true);
  assert.deepEqual(await page.locator('[data-attach-edit]').evaluateAll(nodes => nodes.map(node => node.dataset.attachEdit)), ids);
  assert.equal(await page.getByText("Обрезано", { exact: true }).count(), 1);
  await send(page);
  const result = await page.evaluate(async () => {
    const request = window.requests[0], staged = window.sends[0].attachments;
    const rows = await window.fixture.restored();
    const files = Object.fromEntries(await Promise.all(rows.map(async row => [row.attachment.file.name,
      [...new Uint8Array(await row.attachment.file.arrayBuffer())]])));
    return { requests: window.requests.length, selectedExact: request.files[0] === window.trimmed && request.files[1] === window.second,
      rawSelected: request.files.includes(window.first), preparedPhotos: request.preparedPhotos?.size ?? 0,
      stagedExact: staged[0].file === window.trimmed && staged[1].file === window.second,
      caption: request.caption, imageEncodes: window.encodes.length, files };
  });
  assert.deepEqual(result, { requests: 1, selectedExact: true, rawSelected: false, preparedPhotos: 0,
    stagedExact: true, caption: "Synthetic caption\nsecond line", imageEncodes: 0,
    files: { "trimmed.mp4": [9, 10], "second.mp4": [5, 6, 7, 8] } });
});

for (const action of ["cancel", "noop"]) test(`video: ${action} preserves exact source Files, caption and album order`, { timeout: 15000 }, async t => {
  const page = await mount(t, false, "video"); await openVideoEditor(page);
  await page.locator(`[data-editor-action="${action}"]`).click();
  await page.locator('[data-video-editor]').waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Переместить видео 1 позже", exact: true }).click();
  await send(page);
  assert.deepEqual(await page.evaluate(() => ({ count: window.requests.length,
    exactOrder: window.requests[0].files[0] === window.second && window.requests[0].files[1] === window.first,
    caption: window.requests[0].caption, trimmedSelected: window.requests[0].files.includes(window.trimmed) })),
  { count: 1, exactOrder: true, caption: "Synthetic caption\nsecond line", trimmedSelected: false });
});

test("video: reopen receives the baked File; only explicit Restore returns the original", { timeout: 15000 }, async t => {
  const page = await mount(t, false, "video"); await openVideoEditor(page);
  await page.locator('[data-editor-action="apply"]').click();
  await page.locator('[data-video-editor]').waitFor({ state: "detached" });
  await openVideoEditor(page);
  assert.equal(await page.evaluate(() => window.editorFile === window.trimmed), true);
  assert.equal(await page.locator('[data-editor-action="restore"]').count(), 1);
  await page.locator('[data-editor-action="restore"]').click();
  await page.locator('[data-video-editor]').waitFor({ state: "detached" });
  assert.equal(await page.getByText("Обрезано", { exact: true }).count(), 0);
  await send(page);
  assert.equal(await page.evaluate(() => window.requests[0].files[0] === window.first
    && !window.requests[0].files.includes(window.trimmed)), true);
});

for (const retire of ["close", "A-null-A"]) test(`video: held synthetic completion after ${retire} is refused by the actual sheet`, { timeout: 15000 }, async t => {
  const page = await mount(t, false, "video"); await openVideoEditor(page);
  await page.locator('[data-editor-action="hold"]').click();
  assert.equal(await page.getByTestId("attach-sheet").evaluate(node => node.inert), true);
  if (retire === "close") await page.evaluate(() => window.fixture.rerender({ open: false }));
  else {
    const epochs = await page.evaluate(() => window.fixture.owner("A-null-A"));
    assert.ok(epochs.after > epochs.before, "actual store must advance the account epoch");
  }
  await page.locator('[data-video-editor]').waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.editorUnmounts), 1);
  await page.evaluate(() => window.fixture.release());
  assert.equal(await page.evaluate(() => window.applyAccepted), false, "RETIRED_VIDEO_APPLY_MUST_BE_REFUSED");
  assert.equal(await page.evaluate(() => window.requests.length), 0);
  assert.equal(await page.evaluate(() => window.sends.length), 0);
});

test("video: loaded omission of the central apply fence accepts a canceled held completion", { timeout: 15000 }, async t => {
  const page = await mount(t, "late-apply", "video"); await openVideoEditor(page);
  await page.locator('[data-editor-action="hold"]').click();
  await page.locator('[data-editor-action="cancel"]').click();
  await page.evaluate(() => window.fixture.release());
  await assert.rejects(async () => assert.equal(await page.evaluate(() => window.applyAccepted), false,
    "RETIRED_VIDEO_APPLY_MUST_BE_REFUSED"), error => error.code === "ERR_ASSERTION"
      && error.actual === true && error.expected === false && /RETIRED_VIDEO_APPLY_MUST_BE_REFUSED/.test(error.message));
  assert.equal(await page.locator('[data-attach-pick="video"] video').first().evaluate(node => window.urlFiles.get(node.src) === window.trimmed), true);
});

for (const cancelEditor of [false, true]) test(`video: awaiting Send cannot outlive a new editor${cancelEditor ? " even after editor Cancel" : ""}`, { timeout: 15000 }, async t => {
  const page = await mount(t, process.env.ATTACH_FLOW_OMISSION === "edit-generation" ? "edit-generation" : false, "video");
  await page.evaluate(() => { window.holdLadder = true; });
  await page.getByTestId("attach-send").click();
  await page.waitForFunction(() => typeof window.releaseLadder === "function");
  assert.equal(await page.evaluate(() => window.requests.length), 0, "actual send preparation must still be pending");
  const cancellations = await page.evaluate(() => window.ladderCancels ?? 0);
  await openVideoEditor(page); await page.locator('[data-editor-action="hold"]').click();
  assert.equal(await page.evaluate(() => window.ladderCancels), cancellations + 1, "new interaction must cancel ladder preparation");
  if (cancelEditor) {
    await page.locator('[data-editor-action="cancel"]').click();
    await page.locator('[data-video-editor]').waitFor({ state: "detached" });
  }
  // Return a valid old result despite cancellation, proving the generation fence.
  await page.evaluate(() => window.releaseLadder());
  await page.waitForFunction(() => window.ladderReturned === 1);
  await page.evaluate(() => window.fixture.drain());
  assert.deepEqual(await page.evaluate(() => ({ requests: window.requests.length, sends: window.sends.length })),
    { requests: 0, sends: 0 }, "NEW_EDIT_INTENT_PERMANENTLY_RETIRES_OLD_SEND");
  assert.equal(await page.getByTestId("attach-sheet").count(), 1);
  assert.equal(await page.locator('[data-video-editor]').count(), cancelEditor ? 0 : 1);
  if (!cancelEditor) {
    await page.evaluate(() => window.fixture.release());
    await page.locator('[data-video-editor]').waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => window.applyAccepted), true, "current editor version must remain usable");
  }
  await page.evaluate(() => { window.holdLadder = false; });
  await send(page);
  assert.deepEqual(await page.evaluate(cancelEditor => ({ count: window.requests.length,
    firstExact: window.requests[0].files[0] === (cancelEditor ? window.first : window.trimmed),
    secondExact: window.requests[0].files[1] === window.second }), cancelEditor),
  { count: 1, firstExact: true, secondExact: true }, "only a fresh explicit Send owns the current selection");
});
