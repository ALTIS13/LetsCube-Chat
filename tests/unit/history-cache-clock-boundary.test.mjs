import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { chromium, webkit } from '@playwright/test';

assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS, '0');
const origin = 'http://127.0.0.1:19647';
const source = readFileSync(new URL('../../artifacts/kub/src/lib/historyCache/storage.ts', import.meta.url), 'utf8').replaceAll('\r\n','\n');
const helper = readFileSync(new URL('../helpers/history-cache-idb.mjs', import.meta.url), 'utf8');
async function fixture(t, engine, mutate = value => value) {
  const js = ts.transpileModule(mutate(source), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const browser = await engine.launch({ headless: true }); t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: 'block' }); t.after(() => context.close());
  let external = 0;
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== origin || !['/','/storage.js','/helper.js'].includes(u.pathname)) { external++; return route.abort('blockedbyclient'); }
    return route.fulfill({ contentType: u.pathname === '/' ? 'text/html' : 'text/javascript',
      body: u.pathname === '/' ? '<!doctype html><title>Synthetic clock boundary</title>' : u.pathname === '/storage.js' ? js : helper });
  });
  t.after(() => assert.equal(external, 0));
  const first = await context.newPage(), second = await context.newPage();
  await first.goto(origin); await second.goto(origin);
  await first.evaluate(async () => {
    const { browserHistoryCacheStorage } = await import('/storage.js');
    const { digest, rawRows, holdDigest, historyCacheIdbProbe } = await import('/helper.js');
    window.probe = historyCacheIdbProbe(); window.storage = browserHistoryCacheStorage(probe.factory);
    window.digest = digest; window.rawRows = rawRows; window.holdDigest = holdDigest;
    window.lease = await storage.capture('synthetic', 'owner');
  });
  return { first, second };
}

async function behindLock({first,second}) {
  await first.evaluate(async () => {
    window.value={payload:'synthetic',digest:await digest('synthetic')};
    if(!await storage.write(lease,'profile',value,1000))throw Error('POSITIVE_CONTROL_FAILED');
    window.clock=1000;window.calls=0;window.baseTransactions=probe.transactions.length;
  });
  await second.evaluate(async () => {
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('kub-history-cache',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('FIXTURE_OPEN'))});
    const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');
    let stamped=false;
    window.keepLock=true;window.lockDone=new Promise(resolve=>{
      tx.oncomplete=()=>{db.close();resolve({outcome:'complete',stamped})};tx.onabort=tx.onerror=()=>{db.close();resolve({outcome:'abort',stamped})};
    });
    const deadline=performance.now()+7000;
    await new Promise(resolve=>{
      let entered=false;
      const pump=()=>{const r=store.get(JSON.stringify(['scope','synthetic','owner','profile']));r.onsuccess=()=>{
        if(!entered){entered=true;resolve()}
        if(window.keepLock){if(performance.now()>=deadline){tx.abort();return}pump()}
        else if(r.result){store.put({...r.result,verifiedAt:2000});stamped=true}
      }};pump();
    });
  });
  try {
    await first.evaluate(()=>{window.pending=storage.write(lease,'page',value,()=>{window.calls++;return window.clock}).then(written=>({written}),()=>({written:false}))});
    await first.waitForFunction(()=>probe.transactions.length>window.baseTransactions,{},{timeout:5000});
    const blockedCalls=await first.evaluate(()=>window.calls);
    await first.evaluate(()=>{window.clock=2000});
    assert.deepEqual(await second.evaluate(()=>{window.keepLock=false;return window.lockDone}),{outcome:'complete',stamped:true},'EXCLUSIVE_COMPETITOR_MUST_COMMIT_NEWER_ROW');
    const result=await first.evaluate(async()=>({...(await window.pending),calls:window.calls,verifiedAt:(await storage.read(lease,'page',2000))?.verifiedAt??null}));
    return {blockedCalls,...result};
  } finally {
    await second.evaluate(()=>{window.keepLock=false;return window.lockDone}).catch(()=>{});
  }
}
const checkLock=result=>assert.deepEqual(result,{blockedCalls:0,written:true,calls:1,verifiedAt:2000},'CLOCK_MUST_WAIT_FOR_EXCLUSIVE_TRANSACTION');

async function sizeBoundary({first}) {
  return first.evaluate(async()=>{
    const small={payload:'retained',digest:await digest('retained')};
    if(!await storage.write(lease,'keep',small,1000))throw Error('POSITIVE_CONTROL_FAILED');
    const owner=JSON.stringify(['owner',lease.namespace,lease.ownerId]);
    const row={key:JSON.stringify(['scope',lease.namespace,lease.ownerId,'large']),ownerKey:owner,scope:'large',payload:'',digest:'0'.repeat(64),verifiedAt:0};
    const bytes=r=>new TextEncoder().encode(JSON.stringify(r)).length+new TextEncoder().encode(r.key).length+
      ('ownerKey'in r?new TextEncoder().encode(r.ownerKey).length:0)+1024;
    const overhead=bytes({key:owner,generation:lease.generation});
    const payload='x'.repeat(8388608-overhead-bytes(row));
    row.payload=payload;const beforeSize=bytes(row)+overhead;row.verifiedAt=2000;const afterSize=bytes(row)+overhead;
    const value={payload,digest:await digest(payload)},before=JSON.stringify(await rawRows());let calls=0;
    const written=await storage.write(lease,'large',value,()=>{calls++;return 2000});
    return {beforeSize,afterSize,written,calls,unchanged:before===JSON.stringify(await rawRows()),
      retained:(await storage.read(lease,'keep',2000))?.payload==='retained'};
  });
}
const checkSize=result=>assert.deepEqual(result,{beforeSize:8388608,afterSize:8388611,written:false,calls:1,unchanged:true,retained:true},'RESOLVED_SIZE_MUST_REFUSE_BEFORE_ANY_EVICTION');
const once=(text,from,to)=>{assert.equal(text.split(from).length,2,'MUTATION_ANCHOR_MUST_BE_UNIQUE');return text.replace(from,to)};

for (const [name, engine] of [['Chromium',chromium],['WebKit',webkit]]) {
  test(`${name}: clock is sampled once only after a real competing readwrite transaction releases`, {timeout:30000}, async t => {
    checkLock(await behindLock(await fixture(t,engine)));
  });
  test(`${name}: invalid runtime clock inputs and results never write epoch-zero rows`, {timeout:30000}, async t => {
    const {first} = await fixture(t,engine);
    const result = await first.evaluate(async () => {
      const value = {payload:'synthetic',digest:await digest('synthetic')};
      const failures = [], kinds=['undefined','null','string','object','boolean','nan','infinity','negative','fraction','promise','throw'];
      const clocks=[undefined,null,'1000',{},true,() => NaN,() => Infinity,() => -1,() => 1.5,() => Promise.resolve(1000),() => {throw Error('SYNTHETIC_CLOCK')}];
      for (const [index,clock] of clocks.entries()) {
        const before = JSON.stringify(await rawRows()); let refused = false;
        try { refused = await storage.write(lease,'invalid',value,clock) === false; } catch { refused = true; }
        if(!refused || before !== JSON.stringify(await rawRows()))failures.push(kinds[index]);
      }
      return {failedKinds:failures,count:clocks.length};
    });
    assert.deepEqual(result,{failedKinds:[],count:11},'INVALID_CLOCK_MUST_NOT_BE_SILENTLY_COERCED_TO_ZERO');
  });
  test(`${name}: stale generation does not resolve clock; real callback rollback preserves rows`, {timeout:30000}, async t=>{
    const {first}=await fixture(t,engine);
    const result=await first.evaluate(async()=>{
      const value={payload:'retained',digest:await digest('retained')};
      if(!await storage.write(lease,'keep',value,2000))throw Error('POSITIVE_CONTROL_FAILED');
      let rollbackCalls=0;const before=JSON.stringify(await rawRows());
      const rollback=await storage.write(lease,'new',value,()=>{rollbackCalls++;return 1999});
      const same=before===JSON.stringify(await rawRows());
      const mutable={...lease},hold=await holdDigest();let staleCalls=0;
      const pending=storage.write(mutable,'stale',value,()=>{staleCalls++;return 2000});await hold.started;
      try{
        await storage.invalidate('synthetic','owner');Object.assign(mutable,await storage.capture('synthetic','owner'));
        const afterRetire=JSON.stringify(await rawRows());hold.release();
        return {rollback,rollbackCalls,same,stale:await pending,staleCalls,retiredUnchanged:afterRetire===JSON.stringify(await rawRows())};
      }finally{hold.release()}
    });
    assert.deepEqual(result,{rollback:false,rollbackCalls:1,same:true,stale:false,staleCalls:0,retiredUnchanged:true});
  });
  test(`${name}: caller cannot redirect lease or mutate hashed payload while digest awaits`, {timeout:30000}, async t=>{
    const {first}=await fixture(t,engine);
    const result=await first.evaluate(async()=>{
      const original={...lease},mutable={...lease},foreign=await storage.capture('other','foreign');
      const value={payload:'captured',digest:await digest('captured')},otherDigest=await digest('changed');
      const hold=await holdDigest();let calls=0;
      const pending=storage.write(mutable,'page',value,()=>{calls++;return 1000});await hold.started;
      try{
        Object.assign(mutable,foreign);value.payload='changed';value.digest=otherDigest;hold.release();
        return {written:await pending,calls,original:(await storage.read(original,'page',1000))?.payload==='captured',
          foreignAbsent:await storage.read(foreign,'page',1000)===null};
      }finally{hold.release()}
    });
    assert.deepEqual(result,{written:true,calls:1,original:true,foreignAbsent:true});
  });
  test(`${name}: final clock-size overflow refuses without pruning or evicting retained rows`, {timeout:30000}, async t=>{
    checkSize(await sizeBoundary(await fixture(t,engine)));
  });
}

test('Chromium: sampling clock before transaction is killed by the real lock oracle', {timeout:30000}, async t=>{
  const mutate=text=>{
    text=once(text,'          if (clock) row.verifiedAt = clock();','');
    return once(text,'      return transact<boolean>("readwrite", (store, request, set) => {\n        request(store.get(owner)',
      '      if (clock) row.verifiedAt = clock();\n      return transact<boolean>("readwrite", (store, request, set) => {\n        request(store.get(owner)');
  };
  const result=await behindLock(await fixture(t,chromium,mutate));
  assert.throws(()=>checkLock(result),{code:'ERR_ASSERTION',message:/CLOCK_MUST_WAIT_FOR_EXCLUSIVE_TRANSACTION/});
});
test('Chromium: removing post-clock size guard is killed by retained-row literal oracle', {timeout:30000}, async t=>{
  const mutate=text=>once(text,'          if (rowBytes(row) + overhead > MAX_BYTES) { set(false); return; }','');
  const result=await sizeBoundary(await fixture(t,chromium,mutate));
  assert.throws(()=>checkSize(result),{code:'ERR_ASSERTION',message:/RESOLVED_SIZE_MUST_REFUSE_BEFORE_ANY_EVICTION/});
});
