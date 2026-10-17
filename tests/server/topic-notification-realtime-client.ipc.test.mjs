import assert from 'node:assert/strict';
import test from 'node:test';
import {PassThrough,Writable} from 'node:stream';
import {existsSync,readFileSync} from 'node:fs';

const url=new URL('./topic-notification-realtime-client.ipc.mjs',import.meta.url);
const api=existsSync(url)?await import(url.href):{};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const config=()=>({v:1,kind:'config',binding:{fictional:'bound'},credentials:{a:'PRIVATE_A',b:'PRIVATE_B'},sources:{fictional:'source'}});
const baseline=()=>({v:1,boundary:'REAL_SDK_ACTUAL_HOOK_BASELINE_ONLY',baselineAccepted:true,
  legacyMuteAccepted:false,fullstackAccepted:false,osAccepted:false,requests:7,
  sameJwtOldNewDocuments:true,sameOldSocketProducerAndMarker:true,secret:'MUST_NOT_ESCAPE'});
function pair(module=api,runBaseline=async()=>baseline(),signal){
  const input=new PassThrough(),output=new PassThrough(),frames=[];let raw='';
  output.on('data',chunk=>{raw+=chunk.toString();});
  const done=module.runRealtimeClientIpc({input,output,runBaseline,signal});
  let offset=0;
  const read=()=>{const lines=raw.slice(offset).split('\n');offset=raw.length-lines.pop().length;
    for(const line of lines)frames.push(JSON.parse(line));return frames;};
  const send=value=>input.write(JSON.stringify(value)+'\n');
  return {input,output,frames,read,send,done,raw:()=>raw,
    answer(request,result={binding:config().binding,runtimeEnabled:true}){send({v:1,kind:'inspect-result',nonce:request.nonce,result});}};
}
async function request(p){for(let n=0;n<20;n++){const found=p.read().find(v=>v.kind==='inspect');if(found)return found;await turn();}assert.fail('INSPECT_NOT_EMITTED');}
function refused(value){assert.equal(value.status,'REFUSED');assert.equal(value.baselineAccepted,false);
  assert.equal(value.fullstackAccepted,false);assert.equal(value.code,'RT_CLIENT_IPC_REFUSED');}

test('new IPC adapter is inert and requires a callable baseline, not an env/config fallback',async()=>{
  assert.equal(typeof api.runRealtimeClientIpc,'function','REALTIME_CLIENT_IPC_REQUIRED');
  const input=new PassThrough(),output=new PassThrough();let writes=0;output.on('data',()=>writes++);
  await assert.rejects(()=>api.runRealtimeClientIpc({input,output}),/^Error: RT_CLIENT_IPC_REFUSED$/);
  assert.equal(writes,0);assert.equal(input.destroyed,false);input.destroy();output.destroy();
});

test('real duplex streams carry private initial config, nonce-only inspect and allowlisted final counts',async()=>{
  let received;const p=pair(api,async options=>{received=options;
    assert.deepEqual(await options.inspect({signal:options.signal}),{binding:config().binding,runtimeEnabled:true});return baseline();});
  p.send(config());const r=await request(p);
  assert.deepEqual(Object.keys(r).sort(),['kind','nonce','v']);assert.match(r.nonce,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  p.answer(r);const result=await p.done;
  assert.equal(received.credentials.a,'PRIVATE_A');assert.deepEqual(result,{v:1,kind:'result',status:'BASELINE_ACCEPTED',
    baselineAccepted:true,legacyMuteAccepted:false,fullstackAccepted:false,osAccepted:false,inspectCount:1,requests:7});
  assert.deepEqual(p.read().at(-1),result);assert.doesNotMatch(p.raw(),/PRIVATE_|MUST_NOT_ESCAPE|fictional|bound/);
  assert.ok(p.input.destroyed&&p.output.writableEnded);
});

test('split UTF8/config lines and CRLF work without turning partial chunks into messages',async()=>{
  const p=pair();const bytes=Buffer.from(JSON.stringify({...config(),sources:{text:'\u00e9'}})+'\r\n');
  const split=bytes.indexOf(0xc3)+1;p.input.write(bytes.subarray(0,split));p.input.write(bytes.subarray(split));
  assert.equal((await p.done).status,'BASELINE_ACCEPTED');
});

test('all inspect nonces are unique, bounded and can resolve out of order',async()=>{
  const p=pair(api,async o=>{const replies=await Promise.all([o.inspect({signal:o.signal}),o.inspect({signal:o.signal})]);
    assert.equal(replies.length,2);return baseline();});p.send(config());await request(p);await turn();
  const queries=p.read().filter(v=>v.kind==='inspect');assert.equal(queries.length,2);assert.notEqual(queries[0].nonce,queries[1].nonce);
  p.answer(queries[1]);p.answer(queries[0]);assert.equal((await p.done).inspectCount,2);
});

for(const name of ['unknown nonce','duplicate nonce','mismatched shape','runtime false','foreign binding','extra secret field'])test(name+' closes instead of adopting a response',async()=>{
  const p=pair(api,async o=>{await o.inspect({signal:o.signal});await o.inspect({signal:o.signal});return baseline();});
  p.send(config());const r=await request(p);
  if(name==='unknown nonce')p.send({v:1,kind:'inspect-result',nonce:'00000000-0000-4000-8000-000000000000',result:{binding:config().binding,runtimeEnabled:true}});
  if(name==='duplicate nonce'){p.answer(r);p.answer(r);}
  if(name==='mismatched shape')p.send({v:1,kind:'inspect-result',nonce:r.nonce,binding:config().binding,runtimeEnabled:true});
  if(name==='runtime false')p.answer(r,{binding:config().binding,runtimeEnabled:false});
  if(name==='foreign binding')p.answer(r,{binding:{fictional:'foreign'},runtimeEnabled:true});
  if(name==='extra secret field')p.answer(r,{binding:config().binding,runtimeEnabled:true,token:'MUST_NOT_ESCAPE'});
  refused(await p.done);assert.doesNotMatch(p.raw(),/MUST_NOT_ESCAPE/);
});

for(const [name,bytes] of [
  ['bad JSON',Buffer.from('{bad\n')],['invalid UTF8',Buffer.from([0xff,0x0a])],
  ['unbounded unterminated line',Buffer.alloc(1048577,0x20)],['empty line',Buffer.from('\n')],
])test(name+' refuses before baseline effects',async()=>{
  let calls=0;const p=pair(api,async()=>{calls++;return baseline();});p.input.write(bytes);
  refused(await p.done);assert.equal(calls,0);
});

test('config is first, once only, exact shape and contains no caller function/extra execution field',async()=>{
  let calls=0;const p=pair(api,async()=>{calls++;return baseline();});p.send({...config(),url:'https://production.invalid'});
  refused(await p.done);assert.equal(calls,0);
  const q=pair(api,async o=>{await o.inspect({signal:o.signal});return baseline();});q.send(config());await request(q);q.send(config());refused(await q.done);
});

test('input EOF/partial EOF and output failure abort active baseline without raw errors',async()=>{
  for(const partial of [false,true]){
    const p=pair(api,async o=>{await o.inspect({signal:o.signal});return baseline();});p.send(config());await request(p);
    p.input.end(partial?'PRIVATE_TOKEN_PARTIAL':'');refused(await p.done);assert.doesNotMatch(p.raw(),/PRIVATE_TOKEN_PARTIAL/);
  }
  const p=pair(api,async o=>{await o.inspect({signal:o.signal});return baseline();});p.send(config());await request(p);
  p.output.destroy(Error('PRIVATE_OUTPUT_ERROR'));refused(await p.done);assert.doesNotMatch(p.raw(),/PRIVATE_OUTPUT_ERROR/);
});

test('abort while guard is held settles once and does not authorize a later baseline result',async()=>{
  const stop=new AbortController();let signal;
  const p=pair(api,async o=>{signal=o.signal;await o.inspect({signal:o.signal});return baseline();},stop.signal);
  p.send(config());await request(p);stop.abort(Error('PRIVATE_ABORT_REASON'));
  refused(await p.done);assert.equal(signal.aborted,true);assert.doesNotMatch(p.raw(),/PRIVATE_ABORT_REASON/);
});

test('an already aborted operation closes even when the baseline catches its rejection',async()=>{
  const p=pair(api,async o=>{const stop=new AbortController();stop.abort();
    await o.inspect({signal:stop.signal}).catch(()=>{});return baseline();});p.send(config());
  refused(await p.done);assert.equal(p.read().filter(v=>v.kind==='inspect').length,0);
});

test('a clean output close immediately cancels the outstanding parent guard',async()=>{
  const p=pair(api,async o=>{await o.inspect({signal:o.signal});return baseline();});p.send(config());await request(p);
  p.output.destroy();await turn();const closed=p.input.destroyed;if(!closed)p.input.end();
  refused(await p.done);assert.equal(closed,true);
});

test('literal 15-second guard deadline aborts a held parent read, without retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let stopped;
  const p=pair(api,async o=>{stopped=o.signal;await o.inspect({signal:o.signal});return baseline();});
  p.send(config());await request(p);t.mock.timers.tick(14999);await turn();assert.equal(p.read().filter(v=>v.kind==='result').length,0);
  t.mock.timers.tick(1);refused(await p.done);assert.equal(stopped.aborted,true);assert.equal(p.read().filter(v=>v.kind==='inspect').length,1);
});

test('literal 480-second total deadline also covers a baseline that never asks for inspect',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const p=pair(api,async()=>new Promise(()=>{}));p.send(config());await turn();
  t.mock.timers.tick(479999);await turn();assert.equal(p.read().filter(v=>v.kind==='result').length,0);
  t.mock.timers.tick(1);refused(await p.done);
});

test('held final flush has a finite 15-second deadline and cannot return accepted on unknown output',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const input=new PassThrough(),output=new Writable({write(_bytes,_encoding,_callback){}});
  const done=api.runRealtimeClientIpc({input,output,runBaseline:async()=>baseline()});input.write(JSON.stringify(config())+'\n');
  await turn();t.mock.timers.tick(15000);refused(await done);assert.equal(output.destroyed,true);
});

test('an actual final writable callback error refuses without exposing its private reason',async()=>{
  const input=new PassThrough(),output=new Writable({write(_bytes,_encoding,callback){callback(Error('PRIVATE_FINAL_WRITE'));}});
  const done=api.runRealtimeClientIpc({input,output,runBaseline:async()=>baseline()});input.write(JSON.stringify(config())+'\n');
  refused(await done);
});

test('256 is the actual inspect cap; the 257th request refuses before output',async()=>{
  const p=pair(api,async o=>{for(let i=0;i<257;i++)await o.inspect({signal:o.signal});return baseline();});
  p.send(config());let answered=0;
  for(let i=0;i<300;i++){
    await turn();for(const q of p.read().filter(v=>v.kind==='inspect').slice(answered)){answered++;p.answer(q);}
    if(p.read().some(v=>v.kind==='result'))break;
  }
  const result=await p.done;refused(result);assert.equal(answered,256);assert.equal(result.inspectCount,256);
});

test('false/fullstack/OS claims and thrown credentials become one fixed refusal, never payload output',async()=>{
  for(const patch of [{baselineAccepted:false},{fullstackAccepted:true},{legacyMuteAccepted:true},{osAccepted:true},{requests:81}]){
    const p=pair(api,async()=>({...baseline(),...patch}));p.send(config());refused(await p.done);
  }
  const p=pair(api,async()=>{throw Error('PRIVATE_A PRIVATE_B BODY');});p.send(config());refused(await p.done);assert.doesNotMatch(p.raw(),/PRIVATE_|BODY/);
});

test('loaded literal inspect-cap mutation is killed by an explicit 256-request expectation',async()=>{
  const text=readFileSync(url,'utf8'),anchor='const MAX_INSPECT=256;';
  assert.equal(text.split(anchor).length,2);
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(text.replace(anchor,'const MAX_INSPECT=257;')).toString('base64'));
  const control=async module=>{const p=pair(module,async o=>{for(let i=0;i<257;i++)await o.inspect({signal:o.signal});return baseline();});p.send(config());
    let count=0;for(let i=0;i<300;i++){await turn();for(const q of p.read().filter(v=>v.kind==='inspect').slice(count)){count++;p.answer(q);}
      if(p.read().some(v=>v.kind==='result'))break;}
    await p.done;assert.equal(count,256);};
  await control(api);await assert.rejects(()=>control(mutant),e=>e.code==='ERR_ASSERTION');
});

test('literal 1 MiB line-cap omission is killed before a valid oversized config invokes the baseline',async()=>{
  const text=readFileSync(url,'utf8'),anchor='MAX_LINE=1048576';assert.equal(text.split(anchor).length,2);
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(text.replace(anchor,'MAX_LINE=1048577')).toString('base64'));
  const large={...config(),sources:{text:''}};large.sources.text='a'.repeat(1048577-Buffer.byteLength(JSON.stringify(large)));
  assert.equal(Buffer.byteLength(JSON.stringify(large)),1048577);
  const control=async module=>{let calls=0;const p=pair(module,async()=>{calls++;return baseline();});p.send(large);await p.done;assert.equal(calls,0);};
  await control(api);await assert.rejects(()=>control(mutant),e=>e.code==='ERR_ASSERTION');
});
