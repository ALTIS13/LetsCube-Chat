import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const hookPath=new URL('../../artifacts/kub/src/hooks/useNotifications.ts',import.meta.url);
const source=readFileSync(hookPath,'utf8');
const feedPath=new URL('../../artifacts/kub/src/lib/notificationFeedV2.ts',import.meta.url);
const feedSource=readFileSync(feedPath,'utf8').replaceAll('\r\n','\n');
const UID='10000000-0000-4000-8000-000000000001',SESSION='20000000-0000-4000-8000-000000000001';
const ID='30000000-0000-4000-8000-000000000001',MARKER='40000000-0000-4000-8000-000000000001';
const READ_AT='2026-10-12T12:00:00.000Z',CREATED='2026-10-12T11:00:00.000Z';
const plain=v=>JSON.parse(JSON.stringify(v));
async function drain(){for(let i=0;i<50;i++)await Promise.resolve();}
function javascript(text) {
  const result=ts.transpileModule(text,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);return result.outputText;
}
function actualCallbacks(text) {
  const tree=ts.createSourceFile('useNotifications.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),reads=[],frames=[];
  assert.equal(tree.parseDiagnostics.length,0);
  function visit(node){
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='markReadIds'
      &&node.initializer&&ts.isCallExpression(node.initializer))reads.push(node.initializer.arguments[0].getText(tree));
    if(ts.isMethodDeclaration(node)&&node.name.getText(tree)==='onRows')frames.push('function '+node.getText(tree));
    ts.forEachChild(node,visit);
  }
  visit(tree);assert.equal(reads.length,1);assert.equal(frames.length,1);return {read:reads[0],frame:frames[0]};
}
function notice(id=ID,changes={}) {
  return {id,user_id:UID,kind:'message',created_at:CREATED,read_at:null,alert_suppressed_at:null,feed_revision:1,
    payload:{chat_id:'50000000-0000-4000-8000-000000000001',message_id:id,preview:'fictional old metadata'},...changes};
}
// The raw UPDATE callback was replaced by the real controller -> real onRows
// setter. The read-write callback is also extracted from the actual hook.
async function consumer(initial=[notice()],text=source,feed=feedSource) {
  const callbacks=actualCallbacks(text),module={exports:{}},pending=[],rpcCalls=[],alerts=[];
  vm.runInNewContext(javascript(feed),{module,exports:module.exports,Object,Date,JSON,Promise,Map,Set});
  let current=true,items=initial.map(row=>({...row,alert_origin:null})),held,receive,finishRead;
  const server=new Map(initial.map(row=>[row.id,row]));
  const ordered=()=>[...server.values()].sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
  const scope={PAGE_SIZE:30,accountGenerationRef:{current:1},handshake:undefined,retries:0,live:true,stopped:false,refreshAfterOpen:false,
    clearTimeout(){},isNativeAndroid:()=>false,nativeReadFetchRevisionRef:{current:0},
    readOwner:{userId:UID,pending:new Set()},current:()=>current,isCurrentReadOwner:()=>current,
    alertRowsRef:{current:{rows:new Map(initial.map(row=>[row.id,row]))}},displayRef:{current:rows=>rows},
    setItems:value=>pending.push(value),setLoading(){},setError(){},mapPgError:()=> 'fictional read error',
    settle(){finishRead?.();finishRead=undefined;},
    supabase:{rpc(fn,args){rpcCalls.push({fn,args});return new Promise(resolve=>{held=resolve;});}},
  };
  const compile=text=>vm.runInNewContext('(function(){'+javascript('const callback='+text+';')+'\nreturn callback;})()',scope);
  const frame=compile(callbacks.frame),read=compile(callbacks.read);
  const feedApi=module.exports.createNotificationFeedV2({userId:UID,sessionId:SESSION,accountEpoch:1},{
    isCurrent:()=>current,subscribe(callback,status){receive=callback;status('SUBSCRIBED');return()=>{};},
    open(){receive({event_id:MARKER,recipient_id:UID,notification_id:null,event_kind:'invalidate',created_at:CREATED});
      return Promise.resolve({v:2,barrier_event_id:MARKER,page:{v:2,rows:ordered(),next:null},lookup:{v:2,rows:[],unavailable_ids:[]}});},
    page:()=>Promise.resolve({v:2,rows:ordered(),next:null}),
    lookup:({p_ids})=>Promise.resolve({v:2,rows:ordered().filter(row=>p_ids.includes(row.id)),unavailable_ids:p_ids.filter(id=>!server.has(id))}),
    onRows:frame,onCreated:(row,isCurrent)=>alerts.push({row,isCurrent}),onResync(){scope.settle();},
  });
  scope.connection={controller:feedApi};
  scope.refresh=()=>new Promise(resolve=>{finishRead=resolve;feedApi.refresh();});
  const flush=()=>{while(pending.length){const update=pending.shift();items=typeof update==='function'?update(items):update;}};
  await drain();flush();
  return {read,flush,rpcCalls,alerts,get items(){return plain(items);},retire(){current=false;},dispose(){feedApi.dispose();scope.settle();},
    ack(){for(const [id,row]of server)server.set(id,{...row,read_at:READ_AT,feed_revision:row.feed_revision+1});held({error:null});},
    async update(row,{stale=false}={}){
      const old=server.get(row.id);
      if(old)server.set(row.id,{...row,feed_revision:stale?row.feed_revision:old.feed_revision+1});
      receive({event_id:'40000000-0000-4000-8000-000000000002',recipient_id:UID,notification_id:row.id,event_kind:'changed',created_at:CREATED});
      await drain();
    },
  };
}
async function acknowledgedThenUpdate(feed=feedSource) {
  const c=await consumer(undefined,source,feed);
  try {
    const read=c.read([ID]);assert.deepEqual(plain(c.rpcCalls),[{fn:'notifications_mark_read',args:{p_id:ID}}]);
    assert.equal(c.items[0].read_at,null,'RPC pending is not read confirmation');
    c.ack();await read;c.flush();assert.equal(c.items[0].read_at,READ_AT,'actual fresh read positive control');
    await c.update(notice(ID,{payload:{...notice().payload,preview:'fictional changed metadata'}}));c.flush();
    assert.equal(c.items[0].read_at,READ_AT,'STALE_REALTIME_MUST_NOT_REOPEN_READ');
    assert.equal(c.items[0].payload.preview,'fictional changed metadata');
    assert.equal(c.items.filter(n=>!n.read_at).length,0,'read row cannot inflate bell unread count');
  } finally {c.dispose();}
}
test('changed signal plus stale read-null row after actual ACK preserves confirmed read',()=>acknowledgedThenUpdate());
test('newer known revision replaces metadata and accepts a real read timestamp; older snapshot cannot regress it',async()=>{
  const c=await consumer();try {
    const newer=notice(ID,{read_at:READ_AT,payload:{...notice().payload,preview:'fictional newer metadata'}});
    await c.update(newer);c.flush();const accepted=c.items;
    assert.equal(accepted[0].read_at,READ_AT);assert.equal(accepted[0].payload.preview,'fictional newer metadata');
    await c.update(notice(),{stale:true});c.flush();assert.deepEqual(c.items,accepted);
  }finally{c.dispose();}
});
test('unknown changed signal cannot insert an unverified row or overflow/reorder the bounded view',async()=>{
  const rows=Array.from({length:30},(_,i)=>notice('30000000-0000-4000-8000-'+String(30-i).padStart(12,'0')));
  const c=await consumer(rows);try {
    const before=c.items;await c.update(notice('30000000-0000-4000-8000-000000000999'));c.flush();assert.deepEqual(c.items,before);
    const replacement={...rows[15],payload:{preview:'fictional replacement'}};await c.update(replacement);c.flush();
    assert.equal(c.items.length,30);assert.deepEqual(c.items.map(n=>n.id),rows.map(n=>n.id));
    assert.equal(c.items[15].payload.preview,'fictional replacement');assert.equal(c.alerts.length,0);
  }finally{c.dispose();}
});
async function queuedPublication(text=source){
  const queued=await consumer(undefined,text);
  try{await queued.update(notice(ID,{read_at:READ_AT}));queued.retire();queued.flush();assert.equal(queued.items[0].read_at,null,'QUEUED_V2_ROW_MUST_RETIRE');}
  finally{queued.dispose();}
}
test('retired changed callback and queued state publication both remain inert',async()=>{
  const first=await consumer();try{first.retire();await first.update(notice(ID,{read_at:READ_AT}));first.flush();assert.equal(first.items[0].read_at,null);}finally{first.dispose();}
  await queuedPublication();
});
test('compiled omission of commit-time owner fence restores the literal queued-publication RED',async()=>{
  const anchor='setItems(previous => current() ? visible : previous);';assert.equal(source.split(anchor).length-1,1);
  await queuedPublication();
  await assert.rejects(queuedPublication(source.replace(anchor,'setItems(visible);')),
    error=>error.code==='ERR_ASSERTION'&&error.message.includes('QUEUED_V2_ROW_MUST_RETIRE'));
});
test('compiled omission of actual monotone read overlay fails the literal read oracle',async()=>{
  const anchor='read_at: forwardTimestamp(old.read_at, row.read_at)';assert.equal(feedSource.split(anchor).length-1,1);
  await assert.rejects(acknowledgedThenUpdate(feedSource.replace(anchor,'read_at: row.read_at')),
    error=>error.code==='ERR_ASSERTION'&&error.message.includes('STALE_REALTIME_MUST_NOT_REOPEN_READ'));
});
test.after(()=>{assert.equal(readFileSync(hookPath,'utf8'),source);assert.equal(readFileSync(feedPath,'utf8').replaceAll('\r\n','\n'),feedSource);});
