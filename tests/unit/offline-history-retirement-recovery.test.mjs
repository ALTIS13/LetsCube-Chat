import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium,makeBundle,fixture,data,CHAT,ORIGIN} from '../e2e/cold-media-open-fixture.mjs';
const OTHER='94000000-0000-4000-8000-000000000001';
let browser,bundle;
async function observed(mutation){
 let js=await makeBundle(mutation),anchor='window.start = () => {';assert.equal(js.split(anchor).length,2);
 const offline='if (state.offline) value =';assert.equal(js.split(offline).length,2);
 js=js.replace(offline,'if (table === "messages" && state.denyHistory) value = {data:null,error:{code:"42501"},status:403}; else '+offline);
 return js.replace(anchor,`
  window.qa={writes:[],retiredDone:false};const originalCapture=offlineHistory.capture;let armed=window.input.retireMode;
  offlineHistory.capture=(...args)=>{const o=originalCapture(...args);if(!o)return o;return new Proxy(o,{get(target,key){const value=target[key];
   if(key!=='writeMessages')return value;return(...input)=>{
    const entry={before:input[3](),after:null,done:false,result:null};window.qa.writes.push(entry);const result=value(...input);
    if(armed){const mode=armed;armed=null;
     if(mode==='offline'){window.input.offline=true;Object.defineProperty(navigator,'onLine',{configurable:true,value:false})}
     window.qa.retirement=originalCapture().invalidateChat('${OTHER}').then(()=>{window.qa.retiredDone=true});}
    entry.after=input[3]();return result.then(ok=>{entry.done=true;entry.result=ok;return ok});
   }}})};
  window.qa.saved=()=>originalCapture().readDefaultMessages('${CHAT}');
  window.qa.burst=async()=>{const tasks=[];for(let n=0;n<20;n++)tasks.push(originalCapture().invalidateChat('${OTHER}'));await Promise.all(tasks)};
  window.qa.retireAccount=()=>{useAppStore.setState({currentUser:null,accountEpoch:2});offlineHistory.setIdentity(null)};
  window.qa.deny=()=>{window.input.denyHistory=true;window.dispatchEvent(new Event('online'))};
  window.start = () => {`);
}
test.before(async()=>{assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS,'0');bundle=await observed();browser=await chromium.launch({headless:true})});
test.after(async()=>browser?.close());
async function open(mode,js=bundle){const input=data('private');input.retireMode=mode;const f=await fixture(browser,js,input);
 await f.page.waitForFunction(()=>window.snapshot?.().count===1&&window.qa.writes.some(w=>w.done));return f}
async function saved(f){for(let n=0;n<40;n++){if(await f.page.evaluate(async()=>(await qa.saved())?.messages.length===1))return true;await sleep(50)}return false}
async function recovery(js=bundle){
 const f=await open('unrelated',js);try{
  await f.page.waitForFunction(()=>qa.retiredDone);
  assert.deepEqual(await f.page.evaluate(()=>({before:qa.writes[0].before,after:qa.writes[0].after,result:qa.writes[0].result,warmRow:snapshot().count===1})),{before:true,after:true,result:false,warmRow:true});
  const boundaryReads=await f.page.evaluate(()=>readCalls.filter(c=>c.table==='chat_members').length);
  assert.equal(await saved(f),true,'RETIRED_UNRELATED_HANDLE_MUST_RECOVER_CURRENT_HISTORY');
  assert.ok(await f.page.evaluate(()=>readCalls.filter(c=>c.table==='chat_members').length)>boundaryReads,'RECOVERY_MUST_RECHECK_CLEAR_BOUNDARY');
  assert.equal(f.errors(),0);assert.equal(f.blocked(),0);
 }finally{await f.close()}
}
test('unrelated chat retirement rechecks server boundaries and saves through the actual hook/service/IDB',{timeout:15000},()=>recovery());
async function noRetry(mode,js=bundle){
 const f=await open(mode==='offline'?'offline':'unrelated',js);try{
  await f.page.waitForFunction(()=>qa.retiredDone);
  if(mode==='unmount')await f.page.evaluate(()=>dispose());
  if(mode==='account')await f.page.evaluate(()=>qa.retireAccount());
  const reads=await f.page.evaluate(()=>readCalls.length);await sleep(1150);
  assert.equal(await f.page.evaluate(()=>readCalls.length),reads,'RETIRED_OFFLINE_ACCOUNT_OR_HOOK_MUST_NOT_RETRY');
  assert.equal(await f.page.evaluate(()=>qa.writes[0].result),false);
  assert.equal(f.errors(),0);assert.equal(f.blocked(),0);
 }finally{await f.close()}
}
for(const mode of ['offline','unmount','account'])test(`retirement does not request fresh REST after ${mode}`,{timeout:15000},()=>noRetry(mode));

async function accessRefusal(js=bundle){
 const f=await open(null,js);try{
  assert.equal(await saved(f),true);await f.page.evaluate(()=>qa.deny());await f.page.waitForFunction(()=>snapshot().historyError);
  const reads=await f.page.evaluate(()=>readCalls.filter(c=>c.table==='messages').length);await sleep(2900);
  assert.equal(await f.page.evaluate(()=>readCalls.filter(c=>c.table==='messages').length),reads,'AUTHORITATIVE_REFUSAL_MUST_NOT_START_A_SELF_RETRY_LOOP');
  assert.equal(await f.page.evaluate(()=>qa.saved()),null);assert.equal(await f.page.evaluate(()=>snapshot().count),0);
  assert.equal(f.errors(),0);assert.equal(f.blocked(),0);
 }finally{await f.close()}
}
test('authoritative 403 retires disk/visible history without a self-retry loop',{timeout:15000},()=>accessRefusal());

async function restoredAccess(js=bundle){
 const f=await open(null,js);try{
  assert.equal(await saved(f),true);await f.page.evaluate(()=>qa.deny());await f.page.waitForFunction(()=>snapshot().historyError);
  await f.page.evaluate(()=>{input.denyHistory=false;dispatchEvent(new Event('online'))});await f.page.waitForFunction(()=>snapshot().count===1&&!snapshot().historyError);
  assert.equal(await saved(f),true,'ORDINARY_RECONNECT_MUST_REVALIDATE_RESTORED_ACCESS');
  const reads=await f.page.evaluate(()=>readCalls.filter(c=>c.table==='messages').length);await f.page.evaluate(()=>qa.burst());await sleep(1100);
  assert.equal(await f.page.evaluate(()=>readCalls.filter(c=>c.table==='messages').length)-reads,1,'SUCCESSFUL_REVALIDATION_MUST_RELEASE_TERMINAL_CACHE_FENCE');
  assert.equal(await saved(f),true);assert.equal(f.errors(),0);assert.equal(f.blocked(),0);
 }finally{await f.close()}
}
test('ordinary reconnect restores access and releases the terminal cache-event fence',{timeout:15000},()=>restoredAccess());

test('two real documents stop retirement broadcast ping-pong after terminal 403',{timeout:15000},async()=>{
 const f=await open(null),second=await f.context.newPage();let secondErrors=0;second.on('pageerror',()=>secondErrors++);
 try{
  assert.equal(await saved(f),true);await second.goto(ORIGIN);await second.evaluate(input=>{window.input=input;Object.defineProperty(navigator,'onLine',{configurable:true,value:true})},data('private'));
  await second.addScriptTag({content:bundle});await second.evaluate(()=>start());await second.waitForFunction(()=>snapshot().count===1);
  await f.page.evaluate(()=>{input.denyHistory=true});await second.evaluate(()=>{input.denyHistory=true});await f.page.evaluate(()=>dispatchEvent(new Event('online')));
  await f.page.waitForFunction(()=>snapshot().historyError);await second.waitForFunction(()=>snapshot().historyError);
  const count=page=>page.evaluate(()=>readCalls.filter(c=>c.table==='messages').length),before=[await count(f.page),await count(second)];
  await sleep(2900);assert.deepEqual([await count(f.page),await count(second)],before,'TERMINAL_ACCESS_REFUSALS_MUST_NOT_PING_PONG_BETWEEN_DOCUMENTS');
  for(const page of [f.page,second]){assert.equal(await page.evaluate(()=>snapshot().count),0);assert.equal(await page.evaluate(()=>qa.saved()),null)}
  assert.equal(secondErrors,0);assert.equal(f.errors(),0);assert.equal(f.blocked(),0);
 }finally{try{await second.evaluate(()=>dispose())}finally{await f.close()}}
});

test('twenty retirement events coalesce into one fresh head read',{timeout:15000},async()=>{
 const f=await open(null);try{
  assert.equal(await saved(f),true);const before=await f.page.evaluate(()=>readCalls.filter(c=>c.table==='messages').length);
  await f.page.evaluate(()=>qa.burst());await sleep(1100);
  assert.equal(await f.page.evaluate(()=>readCalls.filter(c=>c.table==='messages').length)-before,1,'RETIREMENT_BURST_MUST_NOT_START_A_FETCH_STORM');
  assert.equal(await saved(f),true);assert.equal(f.errors(),0);assert.equal(f.blocked(),0);
 }finally{await f.close()}
});

for(const [name,from,to,run,oracle]of[
 ['recovery omitted','scheduleRecoveryReconcile(ACTIVE_CHAT_RECONNECT_DELAY_MS);\n    });\n  }, [chatId, userId, accountEpoch, authSessionSource, scheduleRecoveryReconcile]);','void 0;\n    });\n  }, [chatId, userId, accountEpoch, authSessionSource, scheduleRecoveryReconcile]);',recovery,'RETIRED_UNRELATED_HANDLE_MUST_RECOVER_CURRENT_HISTORY'],
 ['offline guard omitted','if (!chatId || authSessionSource !== "sdk" || navigator.onLine === false) return;','if (!chatId || authSessionSource !== "sdk") return;',js=>noRetry('offline',js),'RETIRED_OFFLINE_ACCOUNT_OR_HOOK_MUST_NOT_RETRY'],
 ['fresh boundary omitted','clearedAtCache.evictChat(chatId);\n      scheduleRecoveryReconcile(ACTIVE_CHAT_RECONNECT_DELAY_MS);','scheduleRecoveryReconcile(ACTIVE_CHAT_RECONNECT_DELAY_MS);',recovery,'RECOVERY_MUST_RECHECK_CLEAR_BOUNDARY'],
 ['terminal refusal guard omitted','if (cacheAccessRefusedRef.current) return;','',accessRefusal,'AUTHORITATIVE_REFUSAL_MUST_NOT_START_A_SELF_RETRY_LOOP'],
 ['terminal success reset omitted','setHistoryError(null);\n        cacheAccessRefusedRef.current = false;','setHistoryError(null);',restoredAccess,'SUCCESSFUL_REVALIDATION_MUST_RELEASE_TERMINAL_CACHE_FENCE'],
])test(`actual compiled mutation killed: ${name}`,{timeout:15000},async()=>{
 const js=await observed({file:'hooks/useMessages.ts',from,to});await assert.rejects(()=>run(js),new RegExp(oracle));
});
