import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {MessageChannel} from 'node:worker_threads';

const source=await readFile(new URL('../../artifacts/kub/public/sw.js',import.meta.url),'utf8');
const require=createRequire(new URL('../../artifacts/kub/package.json',import.meta.url));
const {transformSync}=createRequire(require.resolve('vite'))('esbuild');
const clientSource=await readFile(new URL('../../artifacts/kub/src/lib/platform/webMessagePreviews.ts',import.meta.url),'utf8');
const clientCode=transformSync(clientSource,{loader:'ts',format:'cjs',target:'es2022'}).code;
const id=n=>'70000000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner={recipient_id:id(1),session_id:id(30),subscription_id:id(40)};
const localOwner={userId:id(1),sessionId:id(30),accountEpoch:1};
const secret='wpg1_'+'a'.repeat(64),fingerprint='v1:'+'b'.repeat(64);
const publicKey='sb_publishable_FICTIONAL_ONLY_PUBLIC_KEY';
const now=1792225000000;
const ctx=(extra={})=>({preview_v:1,...owner,subscription_fingerprint:fingerprint,revision:1,preview_level:'message',
  installation_consent:true,observed_at_epoch_ms:now,expires_at_epoch_ms:now+600000,...extra});
const content=(extra={})=>({preview_v:1,...owner,subscription_fingerprint:fingerprint,revision:1,
  notification_id:id(50),chat_id:id(10),message_id:id(20),preview_level:'message',sender_name:'QA Sender',
  title:'QA Sender',body:'Fictional QA message',observed_at_epoch_ms:now,expires_at_epoch_ms:now+15000,...extra});
const push=(extra={})=>({kind:'chat_message',chat_id:id(10),message_id:id(20),title:'UNTRUSTED PROVIDER',body:'UNTRUSTED PROVIDER',
  web_preview:{preview_v:1,subscription_id:id(40),notification_id:id(50)},...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const flush=()=>new Promise(r=>setImmediate(r));

// Event/transaction boundary model only; the actual sw.js handlers, validators,
// fetch construction and publication run in the VM. This is not browser/OS proof.
function storage(){
  const state={rows:new Map(),fail:false,reads:0,writes:0};
  const database={objectStoreNames:{contains:()=>true},close(){},createObjectStore(){},transaction(name,mode){
    assert.equal(name,'state');
    const tx={error:null},rows=structuredClone(state.rows);let pending=0,ended=false;
    const finish=()=>queueMicrotask(()=>{if(ended||pending)return;ended=true;
      if(state.fail){tx.error=Error('FICTIONAL_IDB_FAILURE');tx.onerror?.();return;}
      if(mode==='readwrite')state.rows=rows;tx.oncomplete?.();});
    const request=(fn,gate)=>{const req={};pending++;queueMicrotask(async()=>{if(gate)await gate;if(ended)return;req.result=fn();req.onsuccess?.();pending--;finish();});return req;};
    tx.objectStore=()=>({get(key){state.reads++;return request(()=>structuredClone(rows.get(key)),state.holdRead?.(key));},
      put(value,key){state.writes++;return request(()=>{rows.set(key,structuredClone(value));return key;});}});
    tx.abort=()=>{if(state.abortThrows)throw Error('FICTIONAL_FINISHED_TRANSACTION');ended=true;tx.onabort?.();};finish();return tx;
  }};
  state.indexedDB={open(name,version){assert.equal(name,'letscube-web-message-preview');assert.equal(version,1);
    const req={},gate=state.holdOpen?.();queueMicrotask(async()=>{if(gate)await gate;if(state.fail){req.error=Error('FICTIONAL_IDB_FAILURE');req.onerror?.();return;}
      req.result=database;req.onsuccess?.();});return req;}};
  return state;
}

function worker({db=storage(),transform=x=>x}={}){
  const listeners=new Map(),shown=[],requests=[],acks=[],timers=new Map();let timerId=0,wall=now,mono=0;
  const state={db,shown,requests,acks,fetch:async()=>new Response(JSON.stringify([content()]),{headers:{'content-type':'application/json'}}),
    close:async()=>[],advance(ms){wall+=ms;mono+=ms;for(const [n,t] of [...timers])if(t.at<=mono){timers.delete(n);t.fn();}},
    rollback(ms){wall-=ms;},async message(data,client={id:'qa-window',type:'window',url:'https://app.letscube.ru/',visibilityState:'visible'},port){
      const pending=[],replies=[];listeners.get('message')({data,source:client,ports:[port??{postMessage:x=>{acks.push(x);replies.push(x);}}],waitUntil:p=>pending.push(p)});
      await Promise.all(pending);return replies[0];
    },async push(data=push()){
      const pending=[];listeners.get('push')({data:{json:()=>data},waitUntil:p=>pending.push(p)});await Promise.all(pending);
    }};
  class Clock extends Date{static now(){return wall;}}
  const sandbox={URL,Request,Response,Headers,Date:Clock,Promise,AbortController,TextDecoder,TextEncoder,Uint8Array,
    atob,performance:{now:()=>mono},indexedDB:db.indexedDB,
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,at:mono+delay});return id;},clearTimeout:id=>timers.delete(id),
    fetch:(url,init)=>{requests.push({url,init});return state.fetch(url,init);},caches:{},
    self:{location:{origin:'https://app.letscube.ru'},addEventListener:(name,fn)=>listeners.set(name,fn),
      registration:{getNotifications:()=>state.close(),showNotification:(title,options)=>{shown.push({title,options});return Promise.resolve();}},
      clients:{matchAll:async()=>[]}},console:{log(){assert.fail('NO_LOGS');},error(){assert.fail('NO_LOGS');}}};
  vm.runInNewContext(transform(source),sandbox,{filename:'sw.js'});
  const module={exports:{}};vm.runInNewContext(clientCode,{...sandbox,MessageChannel,module,exports:module.exports},{filename:'webMessagePreviews.js'});
  state.client=module.exports;
  let intent=90;state.store=module.exports.createWebPreviewStore(db.indexedDB,()=>id(intent++));
  state.retire=async token=>{await state.message({type:'LETSCUBE_WEB_PREVIEW_RETIRE',v:1});await state.store.retireIf(token);};
  return state;
}
async function begin(w,extra={}){
  await w.message({type:'LETSCUBE_WEB_PREVIEW_RETIRE',v:1});
  const own=extra.owner?{userId:extra.owner.recipient_id,sessionId:extra.owner.session_id,accountEpoch:2}:localOwner;
  return w.store.begin(own);
}
async function install(w,{context=ctx(),grant_secret=secret,public_key=publicKey,ack}={}){
  ack??=await begin(w);
  assert.equal(await w.store.activate(ack,{storage_v:1,context,grant_secret},now,now+context.expires_at_epoch_ms-context.observed_at_epoch_ms,()=>true),true);
  const result=await w.message({type:'LETSCUBE_WEB_PREVIEW_INSTALL',v:1,intent_id:ack.intent_id,generation:ack.generation,context,public_key});
  assert.equal(result?.ok,true,'CONFIRMED_INSTALL_REQUIRED');return {...ack,...result};
}
const generic=w=>{assert.equal(w.shown.length,1);assert.equal(w.shown[0].title,'LETSCUBE');assert.equal(w.shown[0].options.body,'Новое уведомление');};

test('actual worker looks up before FIRST publication, then preserves tag, routing and grouping',async()=>{
  const w=worker();await install(w);await w.push();
  assert.equal(w.requests.length,1);assert.equal(w.requests[0].url,'https://core.letscube.ru/rest/v1/rpc/web_message_preview_content');
  const init=w.requests[0].init;assert.equal(init.method,'POST');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
  assert.deepEqual(JSON.parse(init.body),{p_grant_secret:secret,p_notification_id:id(50)});
  assert.equal(init.headers.apikey,publicKey);assert.equal(init.headers.Authorization,undefined);
  assert.equal(w.shown.length,1);assert.equal(w.shown[0].title,'QA Sender');assert.equal(w.shown[0].options.body,'Fictional QA message');
  assert.equal(w.shown[0].options.tag,'message:chat:'+id(10));assert.equal(w.shown[0].options.renotify,true);
  assert.equal(w.shown[0].options.data.url,'/?chat='+id(10)+'&message='+id(20));
  assert.doesNotMatch(JSON.stringify(w.shown)+JSON.stringify(w.acks),/wpg1_|grant_secret|Fictional QA message.*grant/);
});

test('actual SQL Unicode character limits reach the worker without UTF16 truncation or a broader allowance',async()=>{
  const {PGlite}=await import('@electric-sql/pglite');const pg=new PGlite();
  try{
    const name='a'.repeat(95)+'\u{1f600}',body='a'.repeat(239)+'\u{1f600}';
    const {rows:[row]}=await pg.query('SELECT left($1::text,96) AS sender_name,left($1::text,96) AS title,left($2::text,240) AS body,char_length($1::text) AS name_count,char_length($2::text) AS body_count',[name,body]);
    assert.equal(row.name_count,96);assert.equal(row.body_count,240);
    assert.equal(row.sender_name.length,97);assert.equal(row.body.length,241);
    const w=worker();await install(w);w.fetch=async()=>Response.json([content({sender_name:row.sender_name,title:row.title,body:row.body})]);
    await w.push();assert.equal(w.shown.length,1);assert.equal(w.shown[0].title,name);assert.equal(w.shown[0].options.body,body);
    for(const extra of [{body:body+'x'},{sender_name:name+'x'},{title:name+'x'}]){
      const over=worker();await install(over);over.fetch=async()=>Response.json([content(extra)]);
      await over.push();generic(over);
    }
  }finally{await pg.close();}
});

test('actual Hume installer and actual SW handler compose through real MessagePorts without secret transfer',async()=>{
  const w=worker(),token=await begin(w),envelope={storage_v:1,context:ctx(),grant_secret:secret},packets=[];
  assert.equal(await w.store.activate(token,envelope,now,now+600000,()=>true),true);
  const portWorker={postMessage(data,ports){packets.push(structuredClone(data));void w.message(data,undefined,ports[0]).finally(()=>ports[0].close());}};
  assert.equal(await w.client.installWebMessagePreview(portWorker,token,envelope,publicKey,()=>true),true);
  assert.deepEqual(Object.keys(packets[0]).sort(),['context','generation','intent_id','public_key','type','v']);
  assert.doesNotMatch(JSON.stringify(packets),/wpg1_|grant_secret/);
  await w.push();assert.equal(w.shown[0].title,'QA Sender');assert.equal(w.requests.length,1);
  const privileged='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.c2ln';
  assert.equal(await w.client.installWebMessagePreview(portWorker,token,envelope,privileged,()=>true),false);
  assert.equal(packets.length,1);
});

test('actual Hume None intent denies a held push before its fresh IDB open completes',async()=>{
  const w=worker();await install(w);const opening=deferred(),openStarted=deferred(),rpc=deferred(),rpcStarted=deferred();
  w.fetch=async()=>{rpcStarted.resolve();return rpc.promise;};const pendingPush=w.push();await rpcStarted.promise;
  const fresh=w.client.createWebPreviewStore(w.db.indexedDB,()=>id(99));let once=true;
  w.db.holdOpen=()=>{if(once){once=false;openStarted.resolve();return opening.promise;}};
  const client=w.client.createWebMessagePreviewClient({owner:()=>localOwner,foreground:()=>true,store:fresh,now:()=>now,
    retireHint:()=>{void w.message({type:'LETSCUBE_WEB_PREVIEW_RETIRE',v:1});},
    crypto:{},subscription:async()=>null,rpc:async()=>{assert.fail('NO_REMOTE_BEFORE_DURABLE_DENIAL');},
    preference:async()=>{assert.fail('NO_ACCOUNT_WRITE_BEFORE_DURABLE_DENIAL');},install:async()=>false});
  const pendingChoice=client.setChoice('none');await openStarted.promise;
  rpc.resolve(new Response(JSON.stringify([content()])));await pendingPush;
  try{generic(w);}finally{opening.resolve();await pendingChoice;w.db.holdOpen=null;}
});

test('push text and caller API URL never become content authority; missing/malformed selector stays generic',async()=>{
  for(const value of [undefined,{preview_v:2,subscription_id:id(40),notification_id:id(50)},
    {preview_v:1,subscription_id:id(41),notification_id:id(50)},
    {preview_v:1,subscription_id:id(40),notification_id:id(50),api_url:'https://foreign.invalid'}]){
    const w=worker();await install(w);await w.push(push({web_preview:value,api_url:'https://foreign.invalid'}));
    generic(w);assert.equal(w.requests.length,0);
  }
});

test('held content is denied after durable None/logout, account or same-UID session replacement',async()=>{
  for(const change of ['None','logout','account','session','subscription','same-session']){
    const w=worker(),active=await install(w),held=deferred(),started=deferred();
    w.fetch=async()=>{started.resolve();return held.promise;};const pending=w.push();await started.promise;
    if(change==='None'||change==='logout'){
      await w.retire(active);
    }else{
      const next={...owner,...(change==='account'?{recipient_id:id(2)}:change==='session'?{session_id:id(31)}:change==='subscription'?{subscription_id:id(41)}:{})};
      await begin(w,{owner:next,intent_id:id(91)});
    }
    held.resolve(new Response(JSON.stringify([content()])));await pending;generic(w);
    const restarted=worker({db:w.db});await restarted.push();generic(restarted);assert.equal(restarted.requests.length,0);
  }
});

test('retirement during tag close and storage reread failure prevent rich publication',async()=>{
  for(const mode of ['retire','idb']){
    const w=worker(),active=await install(w);let closed=0;
    w.close=async()=>{closed++;if(mode==='idb')w.db.fail=true;else await w.retire(active);return [];};
    await w.push();generic(w);assert.equal(closed,1);
  }
});

test('durable confirmed install survives worker restart; stale install ACK cannot overwrite a newer intent',async()=>{
  const w=worker(),first=await install(w),next=await begin(w,{intent_id:id(91)});
  const stale=await w.message({type:'LETSCUBE_WEB_PREVIEW_INSTALL',v:1,generation:first.generation,intent_id:first.intent_id,context:ctx(),public_key:publicKey});
  assert.equal(stale?.ok,false);
  await install(w,{ack:next});const fresh=worker({db:w.db});await fresh.push();assert.equal(fresh.shown[0].title,'QA Sender');
  assert.equal(next.generation,first.generation+1);
});

test('retired BEGIN cannot be reopened by its held install, including after worker restart',async()=>{
  const w=worker(),ack=await begin(w);
  await w.retire(ack);
  const restarted=worker({db:w.db});
  assert.equal(await restarted.store.activate(ack,{storage_v:1,context:ctx(),grant_secret:secret},now,now+600000,()=>true),false);
  const stale=await restarted.message({type:'LETSCUBE_WEB_PREVIEW_INSTALL',v:1,generation:ack.generation,intent_id:ack.intent_id,context:ctx(),public_key:publicKey});
  assert.equal(stale?.ok,false,'DURABLE_RETIREMENT_IS_TERMINAL_FOR_THIS_INTENT');
  await restarted.push();generic(restarted);assert.equal(restarted.requests.length,0);
});

test('held INSTALL readback cannot clear a newer synchronous retirement hint',async()=>{
  const w=worker(),active=await install(w),held=deferred(),started=deferred();let reads=0;
  w.db.holdRead=key=>{if(key==='worker-public-api'&&++reads===2){started.resolve();return held.promise;}};
  const pending=w.message({type:'LETSCUBE_WEB_PREVIEW_INSTALL',v:1,generation:active.generation,intent_id:active.intent_id,context:ctx(),public_key:publicKey});
  await started.promise;
  await w.message({type:'LETSCUBE_WEB_PREVIEW_RETIRE',v:1});
  held.resolve();const ack=await pending;assert.equal(ack?.ok,false,'LATE_INSTALL_CANNOT_UNBLOCK_RETIRED_WORKER');
  w.db.holdRead=null;await w.push();generic(w);assert.equal(w.requests.length,0);
});

test('IDB failure/eviction, expired context and invalid credentials stay generic without lookup',async()=>{
  for(const mode of ['failed','evicted','expired','none','service','secret']){
    const w=worker();
    if(mode==='none'||mode==='service'||mode==='secret'){
      const ack=await begin(w),context=ctx(mode==='none'?{preview_level:'none',installation_consent:false,expires_at_epoch_ms:null}:{});
      await w.store.activate(ack,{storage_v:1,context,grant_secret:mode==='secret'?'bad':secret},now,now+600000,()=>true);
      const result=await w.message({type:'LETSCUBE_WEB_PREVIEW_INSTALL',v:1,generation:ack.generation,intent_id:ack.intent_id,context,
        public_key:mode==='service'?'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.fake':publicKey});
      assert.equal(result?.ok,false);
    }else{await install(w);if(mode==='failed')w.db.fail=true;if(mode==='evicted')w.db.rows.clear();if(mode==='expired')w.advance(600001);}
    await w.push();generic(w);assert.equal(w.requests.length,0);
  }
});

test('bounded RPC aborts once; a late success cannot upgrade generic or retry',async()=>{
  const w=worker();await install(w);const held=deferred(),started=deferred();
  w.fetch=async()=>{started.resolve();return held.promise;};const pending=w.push();await started.promise;
  w.advance(5000);await pending;generic(w);assert.equal(w.requests[0].init.signal.aborted,true);
  held.resolve(new Response(JSON.stringify([content()])));await flush();assert.equal(w.shown.length,1);assert.equal(w.requests.length,1);
});

test('IDB deadline still settles generic if abort races an already finished transaction',async()=>{
  const w=worker();await install(w);const held=deferred(),started=deferred();
  w.db.abortThrows=true;w.db.holdRead=()=>{started.resolve();return held.promise;};
  const pending=w.push();await started.promise;
  assert.doesNotThrow(()=>w.advance(2000),'IDB_ABORT_RACE_MUST_NOT_ESCAPE_DEADLINE');
  await pending;generic(w);assert.equal(w.requests.length,0);held.resolve();await flush();assert.equal(w.shown.length,1);
});

test('response tuple, body, TTL and final clock rollback are independently enforced',async()=>{
  for(const row of [content({recipient_id:id(2)}),content({session_id:id(31)}),content({subscription_id:id(41)}),
    content({subscription_fingerprint:'v1:'+'c'.repeat(64)}),content({revision:2}),content({notification_id:id(51)}),
    content({chat_id:id(11)}),content({message_id:id(21)}),content({preview_level:'sender'}),content({body:'x'.repeat(241)}),
    content({body:'line\nbreak'}),content({expires_at_epoch_ms:now+15001}),content({expires_at_epoch_ms:now}),{...content(),alert_origin:'bad'}]){
    const w=worker();await install(w);w.fetch=async()=>new Response(JSON.stringify([row]));await w.push();generic(w);
  }
  for(const mode of ['rollback','expired']){
    const w=worker();await install(w);w.close=async()=>{if(mode==='rollback')w.rollback(1);else w.advance(15001);return [];};
    await w.push();generic(w);
  }
});

test('sender choice, unavailable/non2xx/malformed RPC and nonmessage fallback have positive controls',async()=>{
  const sender=worker();await install(sender,{context:ctx({preview_level:'sender'})});
  sender.fetch=async()=>new Response(JSON.stringify([content({preview_level:'sender',body:'Новое сообщение'})]));
  await sender.push();assert.equal(sender.shown[0].options.body,'Новое сообщение');
  for(const reply of [new Response('[]'),new Response('{}'),new Response('invalid'),new Response('error',{status:503})]){
    const w=worker();await install(w);w.fetch=async()=>reply;await w.push();generic(w);assert.equal(w.requests.length,1);
  }
  const task=worker();await task.push({kind:'task_assigned',task_id:'qa-task',title:'QA task',body:'Assigned'});
  assert.equal(task.shown[0].title,'QA task');assert.equal(task.shown[0].options.data.url,'/tasks?task=qa-task');
});

test('INSTALL snapshots nonsecret context before IO and never rewrites the shared grant record',async()=>{
  const w=worker(),active=await install(w),before=structuredClone(w.db.rows.get('current')),held=deferred(),started=deferred();
  let block=true;w.db.holdRead=key=>{if(key==='current'&&block){block=false;started.resolve();return held.promise;}};
  const data={type:'LETSCUBE_WEB_PREVIEW_INSTALL',v:1,generation:active.generation,intent_id:active.intent_id,context:ctx(),public_key:publicKey};
  const pending=w.message(data);await started.promise;data.context.recipient_id=id(2);data.public_key='invalid';held.resolve();
  assert.equal((await pending)?.ok,true);assert.deepEqual(w.db.rows.get('current'),before);
  assert.deepEqual([...w.db.rows.keys()].sort(),['current','worker-public-api']);
  assert.doesNotMatch(JSON.stringify(w.db.rows.get('worker-public-api')),/wpg1_|grant_secret|payload|body/);
  assert.equal(w.db.rows.get('worker-public-api').public_key,publicKey);
});

test('foreign/hidden caller and unrecognized INSTALL fields cannot configure lookup',async()=>{
  for(const mode of ['foreign','hidden','unknown']){
    const w=worker(),token=await begin(w);
    await w.store.activate(token,{storage_v:1,context:ctx(),grant_secret:secret},now,now+600000,()=>true);
    const data={type:'LETSCUBE_WEB_PREVIEW_INSTALL',v:1,generation:token.generation,intent_id:token.intent_id,context:ctx(),public_key:publicKey};
    const client={id:'qa-window',type:'window',url:mode==='foreign'?'https://foreign.invalid/':'https://app.letscube.ru/',visibilityState:mode==='hidden'?'hidden':'visible'};
    if(mode==='unknown')data.api_url='https://foreign.invalid';
    assert.equal((await w.message(data,client))?.ok,false);await w.push();generic(w);assert.equal(w.requests.length,0);
  }
});

test('streamed response over 8192 bytes is refused and cancelled, not cached or published rich',async()=>{
  const w=worker();await install(w);let cancelled=false;
  w.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(' '.repeat(8193)));},cancel(){cancelled=true;}}));
  await w.push();generic(w);assert.equal(cancelled,true);assert.equal(w.requests.length,1);
});

function omitted(from,to){return text=>{assert.equal(text.split(from).length,2,'EXACT_LOADED_OMISSION');return text.replace(from,to);};}
const omissionCases=[
  ['actual worker INSTALL handler',omitted('event.data.type.startsWith("LETSCUBE_WEB_PREVIEW_")','event.data.type.startsWith("UNSUPPORTED_PREVIEW_")'),async w=>{
    await install(w);
  }],
  ['final durable reread',omitted('const readable = preview && await currentWebPreview(preview);','const readable = Boolean(preview);'),async w=>{
    const active=await install(w);w.close=async()=>{await w.retire(active);return [];};await w.push();generic(w);
  }],
  ['exact install intent',omitted('record.intent_id !== data.intent_id','false'),async w=>{
    const ack=await install(w);const result=await w.message({type:'LETSCUBE_WEB_PREVIEW_INSTALL',v:1,generation:ack.generation,intent_id:id(999),context:ctx(),public_key:publicKey});
    assert.equal(result.ok,false);
  }],
  ['exact content revision',omitted('"subscription_fingerprint", "revision", "preview_level"].every','"subscription_fingerprint", "preview_level"].every'),async w=>{
    await install(w);w.fetch=async()=>new Response(JSON.stringify([content({revision:2})]));await w.push();generic(w);
  }],
  ['pinned API origin',omitted('https://core.letscube.ru/rest/v1/rpc/web_message_preview_content','https://foreign.invalid/rest/v1/rpc/web_message_preview_content'),async w=>{
    await install(w);await w.push();assert.equal(w.requests[0].url,'https://core.letscube.ru/rest/v1/rpc/web_message_preview_content');
  }],
  ['generic provider text boundary',omitted('body: isMessagePush ? DEFAULT_PUSH_BODY : safeText','body: false ? DEFAULT_PUSH_BODY : safeText'),async w=>{
    await w.push(push({web_preview:undefined}));generic(w);
  }],
  ['literal 15-second response ceiling',omitted('row.expires_at_epoch_ms - row.observed_at_epoch_ms <= 15000','row.expires_at_epoch_ms - row.observed_at_epoch_ms <= 15001'),async w=>{
    await install(w);w.fetch=async()=>new Response(JSON.stringify([content({expires_at_epoch_ms:now+15001})]));await w.push();generic(w);
  }],
];
for(const [name,transform,control] of omissionCases)test('loaded omission is killed: '+name,async()=>{
  await control(worker());
  await assert.rejects(()=>control(worker({transform})),{code:'ERR_ASSERTION'});
});
