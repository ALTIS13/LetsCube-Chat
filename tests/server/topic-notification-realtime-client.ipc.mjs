import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const MAX_INSPECT=256;
const MAX_LINE=1048576,OP_MS=15000,TOTAL_MS=480000;
const REFUSED='RT_CLIENT_IPC_REFUSED';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const need=value=>{if(!value)throw Error(REFUSED);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const stable=value=>JSON.stringify(value,(_k,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hashCheckpoint=value=>createHash('sha256').update(stable(value)).digest('hex');
const keys=(value,names)=>need(object(value)&&stable(Object.keys(value).sort())===stable([...names].sort()));

/** IPC only: runBaseline is the pinned real client export, not a policy port.
 * stdin: one {v:1,kind:'config',binding,credentials,sources}, then
 * {v:1,kind:'inspect-result',nonce,result:{binding,runtimeEnabled:true}}.
 * The host must actually guard Docker/PG; this adapter cannot establish that.
 * Entry must exit nonzero for REFUSED, missing final frame or unknown transport.
 * Aborting closes local work; it cannot recall an issued server transaction.
 */
export async function runRealtimeClientIpc({input=process.stdin,output=process.stdout,runBaseline,signal}={}){
  return runClientIpc({input,output,runBaseline,signal,phases:false});
}
// The parent handles phase='rollback' exactly once, then freshly verifies the
// snapshot and runtime=false. This protocol does not implement that inspector.
export async function runRealtimeClientPhaseIpc({input=process.stdin,output=process.stdout,runPhases,signal}={}){
  return runClientIpc({input,output,runBaseline:runPhases,signal,phases:true});
}
async function runClientIpc({input,output,runBaseline,signal,phases}){
  need(typeof runBaseline==='function'&&input&&output&&typeof input.on==='function'&&typeof output.end==='function');
  const controller=new AbortController(),pending=new Map(),seen=new Set(),start=performance.now();
  let count=0,failed=false,totalExpired=false,phase='config',configuration,resolveConfig,resolveFailure,phaseCount=0,checkpoint=null;
  let parts=[],bytes=0;
  const stopped=Symbol('stopped'),failure=new Promise(resolve=>{resolveFailure=()=>resolve(stopped);});
  const configReady=new Promise(resolve=>{resolveConfig=resolve;});
  const guarded=async promise=>{const result=await Promise.race([promise,failure]);need(result!==stopped);return result;};
  function release(record){clearTimeout(record.timer);record.signal?.removeEventListener('abort',record.abort);}
  function fail(){
    if(failed||phase==='closed')return;failed=true;controller.abort();resolveFailure();
    for(const record of pending.values()){release(record);record.reject(Error(REFUSED));}pending.clear();
    input.destroy();
  }
  const totalTimer=setTimeout(()=>{totalExpired=true;fail();},TOTAL_MS);
  const externalAbort=()=>fail();signal?.addEventListener('abort',externalAbort,{once:true});
  if(signal?.aborted)fail();
  const outputError=()=>fail();output.on('error',outputError);
  const outputClose=()=>{if(phase==='config'||phase==='running')fail();};output.on('close',outputClose);
  function writeInspect(nonce,kind,context){
    need(!failed&&!output.destroyed&&!output.writableEnded);
    output.write(JSON.stringify({v:1,kind,nonce,...context})+'\n',error=>{if(error)fail();});
  }
  function inspect(options={}){return request('inspect',options);}
  function phaseGuard(options={}){return request('phase',options);}
  function request(kind,{signal:operationSignal,...details}={}){
    if(failed||phase!=='running'||operationSignal?.aborted){fail();return Promise.reject(Error(REFUSED));}
    try{
      let context={};
      if(phases){
        if(kind==='phase'){
          keys(details,['phase','snapshot','runtimeEnabled']);
          need(pending.size===0&&details.phase===['baseline','disabled','rollback'][phaseCount]
            &&details.runtimeEnabled===(phaseCount!==2)&&object(details.snapshot));
        }else{
          keys(details,['phase','snapshotSha256','runtimeEnabled']);
          need(details.phase===['initial','baseline','disabled','rollback'][phaseCount]
            &&details.runtimeEnabled===(phaseCount!==3)&&details.snapshotSha256===checkpoint);
        }
        context=JSON.parse(JSON.stringify(details));
      }else need(kind==='inspect');
      need(count<MAX_INSPECT);const nonce=randomUUID();need(!seen.has(nonce));seen.add(nonce);count++;
      return new Promise((resolve,reject)=>{
        const record={resolve,reject,kind,context,signal:operationSignal,abort:fail,timer:setTimeout(fail,OP_MS)};
        pending.set(nonce,record);operationSignal?.addEventListener('abort',record.abort,{once:true});
        try{writeInspect(nonce,kind,context);}catch{fail();}
      });
    }catch{fail();return Promise.reject(Error(REFUSED));}
  }
  function line(buffer){
    need(!failed&&buffer.length>0);const message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));
    if(phase==='config'){
      keys(message,['v','kind','binding','credentials','sources']);need(message.v===1&&message.kind==='config');
      need(object(message.binding)&&object(message.sources));keys(message.credentials,['a','b']);
      need(Object.values(message.credentials).every(v=>typeof v==='string'&&v.length>0&&v.length<=8192));
      configuration=message;phase='running';resolveConfig(message);return;
    }
    need(phase==='running');keys(message,['v','kind','nonce','result']);
    need(message.v===1&&typeof message.nonce==='string'&&uuid.test(message.nonce)&&pending.has(message.nonce));
    const record=pending.get(message.nonce);need(message.kind===record.kind+'-result');
    keys(message.result,['binding','runtimeEnabled',...(phases?['phase',record.kind==='phase'?'snapshot':'snapshotSha256']:[])]);
    need(stable(message.result)===stable({binding:configuration.binding,...(phases?record.context:{runtimeEnabled:true})}));
    if(phases&&record.kind==='phase'){
      phaseCount++;checkpoint=hashCheckpoint(record.context.snapshot);
    }
    release(record);pending.delete(message.nonce);record.resolve(message.result);
  }
  function data(chunk){
    if(failed||phase==='closed')return;
    try{
      need(Buffer.isBuffer(chunk)||chunk instanceof Uint8Array);let from=0;
      while(from<chunk.length){
        const end=chunk.indexOf(10,from),to=end<0?chunk.length:end,part=chunk.subarray(from,to);
        bytes+=part.length;need(bytes<=MAX_LINE);if(part.length)parts.push(part);
        if(end<0)return;
        const buffer=Buffer.concat(parts,bytes);parts=[];bytes=0;line(buffer);from=end+1;
      }
    }catch{fail();}
  }
  const inputFailure=()=>{if(phase!=='finishing'&&phase!=='closed')fail();};
  input.on('data',data);input.on('end',inputFailure);input.on('error',inputFailure);input.on('close',inputFailure);
  const refusal=()=>({v:1,kind:'result',status:'REFUSED',code:REFUSED,baselineAccepted:false,
    legacyMuteAccepted:false,fullstackAccepted:false,osAccepted:false,inspectCount:count,requests:null});
  let outcome;
  try{
    const config=await guarded(configReady);need(!failed);
    const result=await guarded(Promise.resolve().then(()=>runBaseline({binding:config.binding,credentials:config.credentials,
      sources:config.sources,inspect,...(phases?{phase:phaseGuard}:{}),signal:controller.signal})));
    need(!failed&&pending.size===0&&result?.v===1&&result.boundary===(phases?'REAL_SDK_ACTUAL_HOOK_CAS_ROLLBACK_ONLY':'REAL_SDK_ACTUAL_HOOK_BASELINE_ONLY')
      &&result.baselineAccepted===true&&result.legacyMuteAccepted===false&&result.fullstackAccepted===false&&result.osAccepted===false
      &&result.sameJwtOldNewDocuments===true&&result.sameOldSocketProducerAndMarker===true
      &&Number.isInteger(result.requests)&&result.requests>=0&&result.requests<=80);
    if(phases)need(phaseCount===3&&result.phaseCount===3&&result.casDisableAccepted===true&&result.rollbackAccepted===true
      &&result.sameClientLifetime===true&&result.runtimeEnabled===false);
    outcome={v:1,kind:'result',status:phases?'CAS_ROLLBACK_ACCEPTED':'BASELINE_ACCEPTED',baselineAccepted:true,legacyMuteAccepted:false,
      fullstackAccepted:false,osAccepted:false,inspectCount:count,requests:result.requests,
      ...(phases?{casDisableAccepted:true,rollbackAccepted:true,sameClientLifetime:true,runtimeEnabled:false,phaseCount}:{} )};
  }catch{fail();outcome=refusal();}
  phase='finishing';controller.abort();input.destroy();parts=[];bytes=0;configuration=undefined;
  input.removeListener('data',data);input.removeListener('end',inputFailure);input.removeListener('error',inputFailure);input.removeListener('close',inputFailure);
  for(const record of pending.values()){release(record);record.reject(Error(REFUSED));}pending.clear();
  // No raw baseline result/error is serialized. A failed final flush is UNKNOWN:
  // return REFUSED, never send a second final frame or retry the transport.
  let flushed=false;
  if(!totalExpired&&!output.destroyed&&!output.writableEnded){
    flushed=await new Promise(resolve=>{
      const remaining=Math.max(0,Math.min(OP_MS,TOTAL_MS-(performance.now()-start)));
      const timer=setTimeout(()=>{output.destroy();finish(false);},remaining);
      const finish=value=>{clearTimeout(timer);output.removeListener('close',closed);resolve(value);};
      const closed=()=>finish(false);output.once('close',closed);
      try{output.end(JSON.stringify(outcome)+'\n',error=>finish(!error&&(!failed||outcome.status==='REFUSED')));}catch{finish(false);}
    });
  }
  if(!flushed)outcome=refusal();
  phase='closed';clearTimeout(totalTimer);signal?.removeEventListener('abort',externalAbort);
  output.removeListener('error',outputError);
  output.removeListener('close',outputClose);
  if(!output.destroyed&&!flushed)output.destroy();
  return outcome;
}
