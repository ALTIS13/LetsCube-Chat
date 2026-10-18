import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import ts from "typescript";
import { chromium, webkit } from "@playwright/test";

const root = new URL("../../", import.meta.url);
const owner = "11111111-1111-4111-8111-000000000001";

function modules(mutation = null) {
  const sources = {};
  for (const name of ["outgoingMedia", "modalStack", "reloadGuard", "uploadFailure", "outbox/backgroundUploads",
    "outbox/outgoingMediaStorage", "outbox/appOutgoingMedia", "outbox/idbTransaction"]) {
    const path = new URL(`artifacts/kub/src/lib/${name}.ts`, root);
    if (!existsSync(path)) continue;
    let source = readFileSync(path, "utf8");
    if(mutation==='tombstone'&&name==='outbox/appOutgoingMedia'){
      const needle='records.get(key(userId, entry.tempId))?.entry === null || ';
      assert.equal(source.split(needle).length,2);source=source.replace(needle,'');
    }
    if(mutation==='reload'&&name==='reloadGuard'){
      const needle='if (outgoingMediaPersistenceWouldLose())';
      assert.equal(source.split(needle).length,2);source=source.replace(needle,'if (false)');
    }
    if(mutation==='storage-version'&&name==='outbox/outgoingMediaStorage'){
      const needle='if (value.storage_v !== 1) return null;';
      assert.equal(source.split(needle).length,2);source=source.replace(needle,'');
    }
    if (name === "outbox/appOutgoingMedia") source = source.replace(/from "\.\/outgoingMediaStorage(?:\.ts)?"/,
      'from "/held-storage.mjs"');
    // Match Vite's single module identity for extensionless and explicit TS imports.
    source = source.replace(/(from ["'])(\.[^"']+)(["'])/g,
      (_, before, path, after) => before + (path.endsWith(".ts") ? path : path + ".ts") + after);
    sources[`/lib/${name}.ts`] = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  }
  // Reuse the existing real-IDB fault delegate; change ONLY its exact owned DB name.
  sources["/fault.mjs"] = readFileSync(new URL("tests/helpers/outbox-idb-fault.mjs", root), "utf8")
    .replace('args[0] !== "kub-outbox"', 'args[0] !== "kub-outbox-media"')
    .replace('record.outcome = outcome;', 'record.outcome = outcome; record.errorName = tx.error?.name ?? null;');
  sources["/drain.mjs"] = `export async function writes(probe,operation,count){
    for(let i=0;i<200&&probe.transactions.filter(tx=>tx.operations.includes(operation)).length<count;i++)
      await new Promise(r=>setTimeout(r,5));
    if(probe.transactions.filter(tx=>tx.operations.includes(operation)).length<count)throw Error('MEDIA_FIXTURE_WRITE_NOT_ENTERED');
    await probe.idle();await new Promise(r=>setTimeout(r,0));
  }`;
  sources["/held-storage.mjs"] = `
    import {browserOutgoingMediaStorage as actual} from '/lib/outbox/outgoingMediaStorage.ts';
    export * from '/lib/outbox/outgoingMediaStorage.ts';
    export const browserOutgoingMediaStorage=(...args)=>{
      const storage=actual(window.mediaFactory??args[0]);
      return {...storage,async list(user){
        const rows=await storage.list(user);
        if(window.holdRestore){window.restoreSnapshotRead();await window.restoreGate;}
        if(window.failRestoredSnapshot)throw Error('FICTIONAL_RESTORE_READ_FAILURE');
        return rows;
      }};
    };`;
  sources["/entry.mjs"] = `export function entry(id='one',userId='${owner}'){
    const file=new File(['fictional voice bytes'],'voice.webm',{type:'audio/webm'});
    return {tempId:'tmp:'+id,chatId:'22222222-2222-4222-8222-000000000001',
      topicId:'22222222-2222-4222-8222-000000000002',replyToId:'33333333-3333-4333-8333-000000000001',
      caption:'Fictional caption',clientSentAt:'2026-10-18T00:00:00.000Z',
      attachment:{id:'attachment-'+id,file,kind:'voice',previewUrl:null,name:'voice.webm',size:file.size,
        mimeType:file.type,status:'failed',progress:null,error:null,clientMessageId:id,uploaded:null,durationMs:3000}};
  }`;
  sources['/raw-store.mjs'] = `export async function rawStore(run,mode='readwrite'){
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('kub-outbox-media',1);
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try{return await new Promise((resolve,reject)=>{const tx=db.transaction('media',mode);
      let request;try{request=run(tx.objectStore('media'));}catch(error){reject(error);return;}
      tx.oncomplete=()=>resolve(request?.result);tx.onabort=()=>reject(tx.error??Error('RAW_STORE_ABORT'));
    });}finally{db.close();}
  }`;
  return sources;
}

async function browserCase(t, engine, run, { mutation = null } = {}) {
  const source = modules(mutation), unexpected = [], errors = [];
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const path=source[url.pathname]?url.pathname:url.pathname+'.ts';
    if(url.pathname!=='/'&&!source[path]){unexpected.push(url.pathname);res.writeHead(404);res.end();return;}
    res.writeHead(200,{'content-type':url.pathname==='/'?'text/html':'text/javascript'});
    res.end(url.pathname==='/'?'<!doctype html><title>Fictional media durability</title>':source[path]);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser = await engine.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" });
  t.after(() => context.close());
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    const path = source[url.pathname] ? url.pathname : url.pathname + ".ts";
    if (url.origin !== origin || (url.pathname !== "/" && !source[path])) {
      unexpected.push(url.origin + url.pathname); return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin);
  // Calibration only: product bytes DTO must work even when native File cloning does not.
  const capability=await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('media-file-control',1);
      r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const result=await new Promise(resolve=>{const tx=db.transaction('files','readwrite');
      try{tx.objectStore('files').put(new File(['native control'],'control.webm',{type:'audio/webm'}),'one');}
      catch(e){resolve({ok:false,error:e.name});return;}
      tx.oncomplete=()=>resolve({ok:true});tx.onabort=()=>resolve({ok:false,error:tx.error?.name??'AbortError'});});
    db.close();return result;
  });
  await run(page,capability);
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, [], "caught storage failures must not become unhandled rejections");
}

async function cancelledRestore(page){
  return page.evaluate(async owner=>{
    const app=await import('/lib/outbox/appOutgoingMedia.ts'),media=await import('/lib/outgoingMedia.ts');
    const {browserOutgoingMediaStorage}=await import('/lib/outbox/outgoingMediaStorage.ts');
    const e=(await import('/entry.mjs')).entry();
    app.keepOutgoingMediaFor(owner);media.rememberOutgoing(e);
    const seed=await browserOutgoingMediaStorage().list(owner);
    if(seed.length!==1)throw Error('MEDIA_FIXTURE_SEED_NOT_COMMITTED');
    let release;window.holdRestore=true;window.restoreGate=new Promise(r=>{release=r;});
    const entered=new Promise(r=>{window.restoreSnapshotRead=r;});
    const pending=app.restoreOutgoingMedia(owner);await entered;
    media.cancelOutgoing(e.tempId);
    const diskAfterCancel=(await browserOutgoingMediaStorage().list(owner)).length;
    window.holdRestore=false;release();const restored=await pending;
    const {createBackgroundUploadSender}=await import('/lib/outbox/backgroundUploads.ts');
    let uploads=0,inserts=0;
    await createBackgroundUploadSender({currentUserId:()=>owner,online:()=>true,entries:media.allOutgoingEntries,
      viewed:()=>false,uploading:()=>false,cancelled:media.isOutgoingCancelled,placeholder:()=>({upload_waiting:true}),
      patch(){},async upload(){uploads++;return{};},async insert(){inserts++;},forget(){},describe(){return{};},refusal(){return'failure';}}).run();
    return{diskAfterCancel,restored:restored.length,inMemory:!!media.outgoingEntry(e.tempId),
      cancelled:media.isOutgoingCancelled(e.attachment.id),uploads,inserts};
  },owner);
}

for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]]) {
  test(`${name}: media save/drop ACK follows native commit, post-success abort rejects and can retry`, { timeout: 30000 }, async t => {
    await browserCase(t, engine, async (page,capability) => {
      const result = await page.evaluate(async owner => {
        const { entry } = await import("/entry.mjs");
        const { outboxIdbFault } = await import("/fault.mjs");
        const { browserOutgoingMediaStorage } = await import("/lib/outbox/outgoingMediaStorage.ts");
        const put = outboxIdbFault({ operation: "put", armed: true });
        const save = browserOutgoingMediaStorage(put.factory), e = entry();
        let saveRejected = false; try { await save.save(owner, e); } catch { saveRejected = true; }
        await put.idle();
        const afterAbort = (await browserOutgoingMediaStorage().list(owner)).length;
        try{await save.save(owner, e);}catch{throw Error('MEDIA_NATIVE_SAVE_'+put.transactions.map(t=>t.errorName??'none').join('_'));}
        const saveCommittedAtAck = put.transactions.at(-1).outcome === "complete";
        await put.idle();
        const drop = outboxIdbFault({ operation: "delete", armed: true });
        const remove = browserOutgoingMediaStorage(drop.factory);
        let dropRejected = false; try { await remove.drop(e.tempId); } catch { dropRejected = true; }
        await drop.idle();
        const kept = await browserOutgoingMediaStorage().list(owner);
        const preserved = kept.length === 1 && await kept[0].attachment.file.text() === await e.attachment.file.text()
          && kept[0].caption === e.caption && kept[0].replyToId === e.replyToId && kept[0].topicId === e.topicId;
        await remove.drop(e.tempId);
        const dropCommittedAtAck = drop.transactions.at(-1).outcome === "complete";
        await drop.idle(); put.close(); drop.close();
        return { saveRejected, afterAbort, saveCommittedAtAck, dropRejected, preserved, dropCommittedAtAck,
          aborts: put.aborts + drop.aborts };
      }, owner);
      assert.deepEqual(result, { saveRejected: true, afterAbort: 0, saveCommittedAtAck: true,
        dropRejected: true, preserved: true, dropCommittedAtAck: true, aborts: 2 });
      await page.reload();
      assert.equal(await page.evaluate(async owner => (await (await import("/lib/outbox/outgoingMediaStorage.ts"))
        .browserOutgoingMediaStorage().list(owner)).length, owner), 0);
    });
  });

  test(`${name}: reload follows actual media commit/abort rather than native File capability`, { timeout: 30000 }, async t => {
    await browserCase(t, engine, async (page,capability) => {
      const result = await page.evaluate(async owner => {
        const { outboxIdbFault } = await import("/fault.mjs");
        const probe = outboxIdbFault({ operation: "put", armed: true });
        window.mediaFactory = probe.factory;
        const media = await import("/lib/outgoingMedia.ts"), app = await import("/lib/outbox/appOutgoingMedia.ts");
        const { reloadWouldLose } = await import("/lib/reloadGuard.ts");
        const { writes } = await import("/drain.mjs");
        const e = (await import("/entry.mjs")).entry();
        app.keepOutgoingMediaFor(owner); media.rememberOutgoing(e);
        const pendingVeto = reloadWouldLose().includes("outgoing-in-memory");
        await writes(probe,'put',1);
        const failedVeto = reloadWouldLose().includes("outgoing-in-memory");
        const bytesKept = await media.outgoingEntry(e.tempId).attachment.file.text();
        media.rememberOutgoing(e); await writes(probe,'put',2);
        const committedVeto = reloadWouldLose().includes("outgoing-in-memory");
        media.cancelOutgoing(e.tempId); await writes(probe,'delete',1);
        const cancelledVeto = reloadWouldLose().includes("outgoing-in-memory");
        probe.close();
        return { pendingVeto, failedVeto, bytesKept, committedVeto, cancelledVeto, aborts: probe.aborts };
      }, owner);
      assert.deepEqual(result, { pendingVeto: true, failedVeto: true, bytesKept: "fictional voice bytes",
        committedVeto: false, cancelledVeto: false, aborts: 1 });
    });
  });

  test(`${name}: user cancellation survives a held actual IDB restore snapshot containing that media`, { timeout: 30000 }, async t => {
    await browserCase(t, engine, async page => {
      const result=await cancelledRestore(page);
      assert.deepEqual(result, { diskAfterCancel: 0, restored: 0, inMemory: false, cancelled: true,uploads:0,inserts:0 });
    });
  });

  test(`${name}: versioned media bytes and metadata survive a fresh document and actual retry`,{timeout:30000},async t=>{
    await browserCase(t,engine,async page=>{
      const saved=await page.evaluate(async owner=>{
        const {browserOutgoingMediaStorage}=await import('/lib/outbox/outgoingMediaStorage.ts');
        const e=(await import('/entry.mjs')).entry('cold');
        e.attachment.file=new File(['cold voice bytes'],'original.webm',{type:'audio/webm',lastModified:123456789});
        e.attachment.size=e.attachment.file.size;
        e.attachment.previewFile=new File(['small preview'],'preview.webp',{type:'image/webp',lastModified:123456790});
        const saved=browserOutgoingMediaStorage().save(owner,e);
        // Later UI mutations must not change the save's captured metadata.
        e.caption='Changed after save';e.attachment.clientMessageId='late-client';
        await saved;
        const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('kub-outbox-media',1);
          r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        const record=await new Promise((resolve,reject)=>{const r=db.transaction('media','readonly').objectStore('media').get(e.tempId);
          r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();
        return{version:record.storage_v,fileVersion:record.entry.attachment.file.file_v,
          bytes:record.entry.attachment.file.bytes instanceof ArrayBuffer,
          previewBytes:record.entry.attachment.previewFile.bytes instanceof ArrayBuffer};
      },owner);
      assert.deepEqual(saved,{version:1,fileVersion:1,bytes:true,previewBytes:true});
      await page.reload();
      const cold=await page.evaluate(async owner=>{
        const app=await import('/lib/outbox/appOutgoingMedia.ts'),media=await import('/lib/outgoingMedia.ts');
        const {reloadWouldLose}=await import('/lib/reloadGuard.ts');
        app.keepOutgoingMediaFor(owner);const entries=await app.restoreOutgoingMedia(owner);
        const e=entries[0],file=e.attachment.file,preview=e.attachment.previewFile;
        const {createBackgroundUploadSender}=await import('/lib/outbox/backgroundUploads.ts');
        let uploads=0,inserts=0;
        await createBackgroundUploadSender({currentUserId:()=>owner,online:()=>true,entries:media.allOutgoingEntries,
          viewed:()=>false,uploading:()=>false,cancelled:media.isOutgoingCancelled,
          placeholder:()=>({upload_waiting:true}),patch(){},
          async upload(entry){if(await entry.attachment.file.text()!=='cold voice bytes')throw Error('BYTES_MISMATCH');uploads++;return{};},
          async insert(){inserts++;},forget(entry){media.forgetOutgoing(entry.tempId);},describe(){return{};},refusal(){return'failure';}}).run();
        const {browserOutgoingMediaStorage}=await import('/lib/outbox/outgoingMediaStorage.ts');
        const remaining=await browserOutgoingMediaStorage().list(owner);
        return{count:entries.length,bytes:await file.text(),name:file.name,type:file.type,lastModified:file.lastModified,size:file.size,
          preview:await preview.text(),previewName:preview.name,previewType:preview.type,previewModified:preview.lastModified,
          attachmentName:e.attachment.name,mimeType:e.attachment.mimeType,
          caption:e.caption,replyToId:e.replyToId,topicId:e.topicId,clientId:e.attachment.clientMessageId,
          uploads,inserts,remaining:remaining.length,losses:reloadWouldLose()};
      },owner);
      assert.deepEqual(cold,{count:1,bytes:'cold voice bytes',name:'original.webm',type:'audio/webm',lastModified:123456789,size:16,
        preview:'small preview',previewName:'preview.webp',previewType:'image/webp',previewModified:123456790,
        attachmentName:'voice.webm',mimeType:'audio/webm',
        caption:'Fictional caption',replyToId:'33333333-3333-4333-8333-000000000001',
        topicId:'22222222-2222-4222-8222-000000000002',clientId:'cold',uploads:1,inserts:1,remaining:0,losses:[]});
    });
  });

  test(`${name}: failed byte conversion creates no write and keeps the exact live media reload veto until retry`,{timeout:30000},async t=>{
    await browserCase(t,engine,async page=>{
      const result=await page.evaluate(async owner=>{
        const {outboxIdbFault}=await import('/fault.mjs');
        const probe=outboxIdbFault();window.mediaFactory=probe.factory;
        const {browserOutgoingMediaStorage}=await import('/lib/outbox/outgoingMediaStorage.ts');
        const app=await import('/lib/outbox/appOutgoingMedia.ts'),media=await import('/lib/outgoingMedia.ts');
        const {reloadWouldLose}=await import('/lib/reloadGuard.ts');
        const storage=browserOutgoingMediaStorage(probe.factory),e=(await import('/entry.mjs')).entry('unreadable');
        const file=e.attachment.file;
        Object.defineProperty(file,'arrayBuffer',{configurable:true,value:async()=>{throw Error('FICTIONAL_BYTES_UNAVAILABLE');}});
        let rejected=false;try{await storage.save(owner,e);}catch{rejected=true;}
        const transactionsOnFailure=probe.transactions.length;
        app.keepOutgoingMediaFor(owner);media.rememberOutgoing(e);
        await storage.list(owner);
        const failedVeto=reloadWouldLose().includes('outgoing-in-memory');
        const exactFile=media.outgoingEntry(e.tempId).attachment.file===file;
        const beforeRetryWrites=probe.transactions.filter(tx=>tx.operations.includes('put')).length;
        delete file.arrayBuffer;
        media.rememberOutgoing(e);const disk=await storage.list(owner);
        const committedVeto=reloadWouldLose().includes('outgoing-in-memory');
        media.cancelOutgoing(e.tempId);await storage.list(owner);probe.close();
        return{rejected,transactionsOnFailure,failedVeto,exactFile,beforeRetryWrites,committedVeto,
          diskBytes:await disk[0].attachment.file.text()};
      },owner);
      assert.deepEqual(result,{rejected:true,transactionsOnFailure:0,failedVeto:true,exactFile:true,beforeRetryWrites:0,
        committedVeto:false,diskBytes:'fictional voice bytes'});
    });
  });

  test(`${name}: byte conversion precedes the transaction and a later drop cannot be overtaken across storage instances`,{timeout:30000},async t=>{
    await browserCase(t,engine,async page=>{
      const result=await page.evaluate(async owner=>{
        const {outboxIdbFault}=await import('/fault.mjs');const probe=outboxIdbFault();
        const {browserOutgoingMediaStorage}=await import('/lib/outbox/outgoingMediaStorage.ts');
        const first=browserOutgoingMediaStorage(probe.factory),second=browserOutgoingMediaStorage(probe.factory);
        const e=(await import('/entry.mjs')).entry('held-bytes'),file=e.attachment.file;
        const bytes=await file.arrayBuffer();let release,entered;
        const gate=new Promise(r=>{release=r;}),reading=new Promise(r=>{entered=r;});
        Object.defineProperty(file,'arrayBuffer',{value:async()=>{entered();await gate;return bytes;}});
        const save=first.save(owner,e);await reading;
        const drop=second.drop(e.tempId);
        await new Promise(r=>setTimeout(r,0));const beforeRelease=probe.transactions.length;
        release();await save;await drop;
        const left=await second.list(owner);
        const operations=probe.transactions.flatMap(tx=>tx.operations);probe.close();
        return{beforeRelease,operations,left:left.length};
      },owner);
      assert.deepEqual(result,{beforeRelease:0,operations:['put','delete','getAll'],left:0});
      await page.reload();
      assert.equal(await page.evaluate(async owner=>(await(await import('/lib/outbox/outgoingMediaStorage.ts'))
        .browserOutgoingMediaStorage().list(owner)).length,owner),0);
    });
  });

  test(`${name}: DTO validates version, byte size, metadata and owner binding with a durable positive sibling`,{timeout:30000},async t=>{
    await browserCase(t,engine,async page=>{
      const seed=await page.evaluate(async owner=>{
        const {browserOutgoingMediaStorage}=await import('/lib/outbox/outgoingMediaStorage.ts');
        const {rawStore}=await import('/raw-store.mjs');
        const e=(await import('/entry.mjs')).entry('valid');await browserOutgoingMediaStorage().save(owner,e);
        const original=await rawStore(store=>store.get(e.tempId),'readonly');
        const variants=[
          row=>{row.storage_v=2;},row=>{row.entry.attachment.file.file_v=2;},
          row=>{row.entry.attachment.file.size+=1;},row=>{row.entry.attachment.file.size=-1;},
          row=>{row.entry.attachment.file.size=26214401;row.entry.attachment.size=26214401;},
          row=>{row.entry.attachment.file.type='AUDIO/WEBM';},row=>{row.entry.attachment.file.lastModified=0.5;},
          row=>{row.entry.attachment.file.name=null;},row=>{row.entry.attachment.file.extra=true;},
          row=>{row.entry.attachment.file.bytes=new Uint8Array([1,2]);},
          row=>{row.entry.attachment.size=1;},row=>{row.entry.attachment.previewFile={file_v:1};},
          row=>{row.entry.tempId='tmp:mismatched';},row=>{row.entry.chatId=null;},
        ];
        const rows=variants.map((mutate,i)=>{const row=structuredClone(original);
          row.tempId=row.entry.tempId='tmp:bad-'+i;mutate(row);return row;});
        const other=structuredClone(original);other.userId='11111111-1111-4111-8111-000000000002';
        other.tempId=other.entry.tempId='tmp:other';rows.push(other);
        await rawStore(store=>{for(const row of rows)store.put(row);});
        return rows.length;
      },owner);
      assert.equal(seed,15);
      await page.reload();
      const read=await page.evaluate(async owner=>{
        const storage=(await import('/lib/outbox/outgoingMediaStorage.ts')).browserOutgoingMediaStorage();
        const own=await storage.list(owner),other=await storage.list('11111111-1111-4111-8111-000000000002');
        return{own:own.map(e=>e.tempId),other:other.map(e=>e.tempId),bytes:await own[0].attachment.file.text()};
      },owner);
      assert.deepEqual(read,{own:['tmp:valid'],other:['tmp:other'],bytes:'fictional voice bytes'});
    });
  });
}

test('Chromium: legacy native File and versioned bytes coexist in the unchanged v1 object store after a cold read',{timeout:30000},async t=>{
  await browserCase(t,chromium,async(page,capability)=>{
    assert.equal(capability.ok,true,'legacy record control needs an actual native File commit');
    const seeded=await page.evaluate(async owner=>{
      const {browserOutgoingMediaStorage,toPersisted}=await import('/lib/outbox/outgoingMediaStorage.ts');
      const {rawStore}=await import('/raw-store.mjs'),{entry}=await import('/entry.mjs');
      await browserOutgoingMediaStorage().save(owner,entry('dto'));
      const legacy=entry('legacy');legacy.attachment.previewFile=new File(['old preview'],'old.png',{type:'image/png',lastModified:42});
      await rawStore(store=>store.put(toPersisted(owner,legacy)));
      return await new Promise((resolve,reject)=>{const r=indexedDB.open('kub-outbox-media');r.onerror=()=>reject(r.error);
        r.onsuccess=()=>{const db=r.result;const tx=db.transaction('media','readonly');
          resolve({version:db.version,stores:[...db.objectStoreNames],indexes:[...tx.objectStore('media').indexNames]});db.close();};});
    },owner);
    assert.deepEqual(seeded,{version:1,stores:['media'],indexes:['userId']});
    await page.reload();
    const cold=await page.evaluate(async owner=>{
      const storage=(await import('/lib/outbox/outgoingMediaStorage.ts')).browserOutgoingMediaStorage();
      const rows=await storage.list(owner);
      return await Promise.all(rows.map(async e=>({id:e.tempId,bytes:await e.attachment.file.text(),
        caption:e.caption,preview:e.attachment.previewFile?await e.attachment.previewFile.text():null})));
    },owner);
    assert.deepEqual(cold,[{id:'tmp:dto',bytes:'fictional voice bytes',caption:'Fictional caption',preview:null},
      {id:'tmp:legacy',bytes:'fictional voice bytes',caption:'Fictional caption',preview:'old preview'}]);
  });
});

test('Chromium literal DTO version-check omission accepts an unsupported disk version',{timeout:30000},async t=>{
  await browserCase(t,chromium,async page=>{
    const result=await page.evaluate(async owner=>{
      const storage=(await import('/lib/outbox/outgoingMediaStorage.ts')).browserOutgoingMediaStorage();
      const {rawStore}=await import('/raw-store.mjs'),e=(await import('/entry.mjs')).entry('mutant');
      await storage.save(owner,e);const row=await rawStore(store=>store.get(e.tempId),'readonly');
      row.storage_v=2;await rawStore(store=>store.put(row));
      return(await storage.list(owner)).map(e=>e.tempId);
    },owner);
    assert.deepEqual(result,['tmp:mutant']);
  },{mutation:'storage-version'});
});

test('Chromium: failed delete keeps cancellation/reload veto until one initialization retry commits', {timeout:30000},async t=>{
  await browserCase(t,chromium,async page=>{
    const result=await page.evaluate(async owner=>{
      const {outboxIdbFault}=await import('/fault.mjs'),{writes}=await import('/drain.mjs');
      const probe=outboxIdbFault({operation:'delete',armed:true});window.mediaFactory=probe.factory;
      const app=await import('/lib/outbox/appOutgoingMedia.ts'),media=await import('/lib/outgoingMedia.ts');
      const {reloadWouldLose}=await import('/lib/reloadGuard.ts');
      const e=(await import('/entry.mjs')).entry();
      app.keepOutgoingMediaFor(owner);media.rememberOutgoing(e);await writes(probe,'put',1);
      let release;window.holdRestore=true;window.restoreGate=new Promise(r=>{release=r;});
      const entered=new Promise(r=>{window.restoreSnapshotRead=r;});
      const pending=app.restoreOutgoingMedia(owner);await entered;
      media.cancelOutgoing(e.tempId);await writes(probe,'delete',1);
      const vetoAfterAbort=reloadWouldLose().includes('outgoing-in-memory');
      window.failRestoredSnapshot=true;window.holdRestore=false;release();const restored=await pending;
      const vetoAfterSnapshot=reloadWouldLose().includes('outgoing-in-memory');
      window.failRestoredSnapshot=false;app.keepOutgoingMediaFor(owner);app.keepOutgoingMediaFor(owner);
      await writes(probe,'delete',2);
      const vetoAfterRetry=reloadWouldLose().includes('outgoing-in-memory');
      const again=await app.restoreOutgoingMedia(owner);probe.close();
      return{vetoAfterAbort,vetoAfterSnapshot,vetoAfterRetry,restored:restored.length,again:again.length,
        cancelled:media.isOutgoingCancelled(e.attachment.id),present:!!media.outgoingEntry(e.tempId),aborts:probe.aborts,
        deletes:probe.transactions.filter(tx=>tx.operations.includes('delete')).length};
    },owner);
    assert.deepEqual(result,{vetoAfterAbort:true,vetoAfterSnapshot:true,vetoAfterRetry:false,restored:0,again:0,
      cancelled:true,present:false,aborts:1,deletes:2});
  });
});

for(const mode of ['explicit-reenqueue','same-owner-reset','switch-owner']){
  test(`Chromium: held restore respects ${mode} without replacing current bytes/owner`,{timeout:30000},async t=>{
    await browserCase(t,chromium,async page=>{
      const result=await page.evaluate(async({owner,mode})=>{
        const app=await import('/lib/outbox/appOutgoingMedia.ts'),media=await import('/lib/outgoingMedia.ts');
        const {browserOutgoingMediaStorage}=await import('/lib/outbox/outgoingMediaStorage.ts');
        const {entry}=await import('/entry.mjs');const e=entry();
        app.keepOutgoingMediaFor(owner);media.rememberOutgoing(e);
        await browserOutgoingMediaStorage().list(owner);
        let release;window.holdRestore=true;window.restoreGate=new Promise(r=>{release=r;});
        const entered=new Promise(r=>{window.restoreSnapshotRead=r;});
        const pending=app.restoreOutgoingMedia(owner);await entered;
        if(mode==='explicit-reenqueue')media.cancelOutgoing(e.tempId);
        else{app.keepOutgoingMediaFor(null);media.cancelAllOutgoing();}
        const nextOwner=mode==='switch-owner'?'11111111-1111-4111-8111-000000000002':owner;
        app.keepOutgoingMediaFor(nextOwner);
        const file=new File(['current bytes'],'current.webm',{type:'audio/webm'});
        const next={...e,caption:'Current caption',attachment:{...e.attachment,
          file,size:file.size,name:file.name,mimeType:file.type}};
        media.rememberOutgoing(next);await browserOutgoingMediaStorage().list(nextOwner);
        window.holdRestore=false;release();const restored=await pending;
        const live=media.outgoingEntry(e.tempId),disk=await browserOutgoingMediaStorage().list(nextOwner);
        return{restored:restored.length,bytes:await live.attachment.file.text(),caption:live.caption,
          cancelled:media.isOutgoingCancelled(e.attachment.id),diskBytes:await disk[0].attachment.file.text(),
          diskCaption:disk[0].caption};
      },{owner,mode});
      assert.deepEqual(result,{restored:0,bytes:'current bytes',caption:'Current caption',cancelled:false,
        diskBytes:'current bytes',diskCaption:'Current caption'});
    });
  });
}

test('Chromium literal tombstone omission resurrects the cancelled media and reaches actual background retry', {timeout:30000},async t=>{
  await browserCase(t,chromium,async page=>{
    assert.deepEqual(await cancelledRestore(page),{diskAfterCancel:0,restored:1,inMemory:true,cancelled:false,uploads:1,inserts:1});
  },{mutation:'tombstone'});
});

test('Chromium literal reload-veto omission permits reload while actual media persistence is pending', {timeout:30000},async t=>{
  await browserCase(t,chromium,async page=>{
    const result=await page.evaluate(async owner=>{
      const {outboxIdbFault}=await import('/fault.mjs'),{writes}=await import('/drain.mjs');
      const probe=outboxIdbFault({operation:'put',armed:true});window.mediaFactory=probe.factory;
      const app=await import('/lib/outbox/appOutgoingMedia.ts'),media=await import('/lib/outgoingMedia.ts');
      const {reloadWouldLose}=await import('/lib/reloadGuard.ts');
      app.keepOutgoingMediaFor(owner);media.rememberOutgoing((await import('/entry.mjs')).entry());
      const losses=reloadWouldLose();await writes(probe,'put',1);probe.close();return losses;
    },owner);
    assert.deepEqual(result,[]);
  },{mutation:'reload'});
});

test('WebKit native structured-clone media representation control',{timeout:30000},async t=>{
  await browserCase(t,webkit,async page=>{
    const result=await page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('media-representation-control',1);
        r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const file=new File(['representation bytes'],'voice.webm',{type:'audio/webm',lastModified:1234});
      const result={};
      const byteRecord={v:1,bytes:await file.arrayBuffer(),name:file.name,type:file.type,lastModified:file.lastModified};
      for(const [name,value]of[['File',file],['Blob',file.slice(0,file.size,file.type)],
        ['ArrayBuffer',await file.arrayBuffer()],['ByteRecord',byteRecord]]){
        const write=await new Promise(resolve=>{
          const tx=db.transaction('files','readwrite');
          try{tx.objectStore('files').put(value,name);}catch(e){resolve({ok:false,error:e.name});return;}
          tx.oncomplete=()=>resolve({ok:true});tx.onabort=()=>resolve({ok:false,error:tx.error?.name??'AbortError'});
        });
        if(write.ok){
          const value=await new Promise((resolve,reject)=>{const r=db.transaction('files','readonly').objectStore('files').get(name);
            r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
          write.bytesMatch=new TextDecoder().decode(value instanceof ArrayBuffer?value:value.bytes??await value.arrayBuffer())==='representation bytes';
          write.kind=value.constructor.name;
        }
        result[name]=write;
      }
      db.close();return result;
    });
    t.diagnostic(JSON.stringify(result));
    assert.deepEqual(result.ArrayBuffer,{ok:true,bytesMatch:true,kind:'ArrayBuffer'});
    assert.deepEqual(result.ByteRecord,{ok:true,bytesMatch:true,kind:'Object'});
    await page.reload();
    const cold=await page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('media-representation-control',1);
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const record=await new Promise((resolve,reject)=>{const r=db.transaction('files','readonly').objectStore('files').get('ByteRecord');
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      db.close();
      const file=new File([record.bytes],record.name,{type:record.type,lastModified:record.lastModified});
      return{bytesMatch:await file.text()==='representation bytes',name:file.name,type:file.type,
        size:file.size,lastModified:file.lastModified};
    });
    assert.deepEqual(cold,{bytesMatch:true,name:'voice.webm',type:'audio/webm',size:20,lastModified:1234});
  });
});
