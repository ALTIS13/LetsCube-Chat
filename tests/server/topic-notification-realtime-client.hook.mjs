import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT=new URL('../../',import.meta.url),SRC=new URL('artifacts/kub/src/',ROOT);
const LEGACY='75096aa30427fdf551fd0c3bdcb7d9eee7fbd5c5';
// LF-normalized public source at this exact commit, including matching deps.
const OLD=Object.freeze({
  'hooks/useNotifications.ts':'95defaf26de5b92754c0920507c7bc2f4a86a6e4d0ce10043121d262c84eb1ab',
  'hooks/useCallSound.ts':'fbfc4a344d728683faf54eb642c65c804702dee363be4502a97747a8f2a07b75',
  'lib/callSounds.ts':'109ec208869a176d366279b29e12b1102519cac6e3b2b87b052b087bbbadffda',
  'lib/callSoundPlayer.ts':'184018323e4a5f5e47d5a6033ed5b2667aedf8dc27008ceff2d98d1005fc1f47',
  'lib/messageNotificationProjection.ts':'7b4a4474ea48bb10ddbe4a29732290556e38d9a3709d63386b1fb2aa32fd91cf',
  'lib/browserNotificationPresentation.ts':'7049ae82f7cf280cea993e177aa0aeab5bf5cc9a51b186992ded80ff3da47b31',
  'lib/platform/desktopNotifications.ts':'2604771a07dd9dcda188eea7ba4c66311c8adc37ca482d382b89673f7c59dc4a',
  'lib/support/notifications.ts':'7b8289222f8260c16e05346b9eb9d2a3085fc29174465431e6cb097147714a58',
  'lib/notificationReadSync.ts':'4ff2177d598787d9032f8711623e31424988fa09fa516c581aafcc63efca0c1f',
  'lib/notificationRows.ts':'850464d44870e1a3022a761db135ba19ea2e2d64d93fb039efdc88766a9b082e',
  'lib/rpcAvailability.ts':'3a8bc8535b44f4782101bd16a295cfc24f887b4336ee5dec51262dd9a9efd296',
  'lib/notificationEvents.ts':'b26f7504cba9daa9df241428d139cee64000d4d0806e47df6caf91ecef40c69d',
});
const CURRENT=[...Object.keys(OLD),'lib/notificationFeedV2.ts','lib/realtimeRevival.ts','lib/messageAlertDecisions.ts'];
const sha=v=>createHash('sha256').update(v).digest('hex');
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const need=x=>{if(!x)throw Error('RT_CLIENT_SOURCE_REFUSED');};
const normalize=s=>s.replaceAll('\r\n','\n');
function freeze(v){for(const x of Object.values(v))if(x&&typeof x==='object')freeze(x);return Object.freeze(v);}
function pins(bundle){return {legacyRevision:LEGACY,old:Object.fromEntries(Object.entries(bundle.old).map(([k,v])=>[k,sha(v)])),
  current:Object.fromEntries(Object.entries(bundle.current).map(([k,v])=>[k,sha(v)]))};}

export function validateRealtimeClientSources(input){
  try {
    need(input&&input.legacyRevision===LEGACY&&input.old&&input.current);
    need(stable(Object.keys(input.old).sort())===stable(Object.keys(OLD).sort())&&stable(Object.keys(input.current).sort())===stable([...CURRENT].sort()));
    for(const [name,text] of [...Object.entries(input.old),...Object.entries(input.current)])
      need(typeof text==='string'&&text.length>0&&text.length<=1048576&&!text.includes('\0')&&!text.includes('\r'));
    for(const [name,hash] of Object.entries(OLD))need(sha(input.old[name])===hash);
    need(stable(input.pins)===stable(pins(input))&&input.digest===sha(stable(input.pins)));
    return freeze(structuredClone(input));
  }catch{throw Error('RT_CLIENT_SOURCE_REFUSED');}
}
export async function loadRealtimeClientSources(){
  try {
    const old=Object.fromEntries(Object.keys(OLD).map(name=>[name,normalize(execFileSync('git',['show',LEGACY+':artifacts/kub/src/'+name],
      {cwd:fileURLToPath(ROOT),encoding:'utf8',maxBuffer:1048576,timeout:10000,stdio:['ignore','pipe','pipe']}))]));
    const current=Object.fromEntries(CURRENT.map(name=>[name,normalize(readFileSync(new URL(name,SRC),'utf8'))]));
    const bundle={legacyRevision:LEGACY,old,current};bundle.pins=pins(bundle);bundle.digest=sha(stable(bundle.pins));
    return validateRealtimeClientSources(bundle);
  }catch{throw Error('RT_CLIENT_SOURCE_REFUSED');}
}

export function realtimeClientFeedParsers(input){
  const sources=validateRealtimeClientSources(input),module={exports:{}};
  const compiled=ts.transpileModule(sources.current['lib/notificationFeedV2.ts'],{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  vm.runInNewContext(compiled.outputText,{module,exports:module.exports,Object,JSON,Promise,Map,Set,Date,
    require(){throw Error('RT_CLIENT_SOURCE_REFUSED');}},{timeout:1000});
  return module.exports;
}

function events(){
  const listeners=new Map();
  return {addEventListener(k,fn){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},
    removeEventListener(k,fn){listeners.get(k)?.delete(fn);}};
}

// Adapted from notification-feed-v2-hook's actual-TS scheduler. No policy/rows,
// Phoenix frames or SDK replies are synthesized here. Each mount is a document.
export async function mountRealtimeClientHook({generation,desktop,sources,client,actor}){
  sources=validateRealtimeClientSources(sources);need(['old','current'].includes(generation)&&typeof desktop==='boolean');
  const texts=sources[generation],modules=new Map(),slots=[],effects=new Map(),cleanups=new Map(),timers=new Set();
  let cursor=0,dirty=false,queued=false,closed=false,failed=false,view,frames=0,sounds=0,cards=0,removals=0,barrier=null;
  const statuses=new Map(),eventIds=new Set();
  const state={currentUser:{id:actor.uid},authSessionIdentity:{userId:actor.uid,sessionId:actor.sid},accountEpoch:1,
    mutedChatIds:[],selectedChatId:null,selectedTopicId:null};
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  function enqueue(){if(!closed&&!queued){queued=true;queueMicrotask(()=>{queued=false;try{pump();}catch{failed=true;}});}}
  const react={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;
      return [slots[i],next=>{if(closed)return;const v=typeof next==='function'?next(slots[i]):next;
        if(!Object.is(v,slots[i])){slots[i]=v;dirty=true;enqueue();}}];},
    useRef(initial){return slots[cursor++]??={current:initial};},
    useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={fn,deps};return slots[i].fn;},
    useEffect(fn,deps){const i=cursor++;if(!same(slots[i],deps)){slots[i]=deps;effects.set(i,fn);}},
  };
  const timer=(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);if(!closed){try{fn();}catch{failed=true;}}},ms);timers.add(id);return id;};
  const clear=id=>{clearTimeout(id);timers.delete(id);};
  const window=events(),document={...events(),hidden:false,visibilityState:'visible',querySelector:()=>null};
  const parameter=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},setValueCurveAtTime(){},cancelScheduledValues(){}});
  class AudioContext {
    state='suspended';destination={};get currentTime(){return performance.now()/1000;}
    async resume(){this.state='running';}
    createGain(){return {gain:parameter(),connect(){},disconnect(){}};}
    createOscillator(){const osc={frequency:parameter(),connect(){},disconnect(){},onended:null,
      start(){sounds++;},stop(at){timer(()=>osc.onended?.(),Math.max(0,(at-performance.now()/1000)*1000));}};return osc;}
  }
  window.AudioContext=AudioContext;
  const bridge={async isMainForeground(){return false;},async notify(){cards++;return true;},async removeNotification(){removals++;return true;}};
  const app=Object.assign(select=>select(state),{getState:()=>state});
  const sdk={from:client.from.bind(client),
    async rpc(name,args){const result=await client.rpc(name,args);
      if(!closed&&name==='notification_feed_open_v2'&&result.error===null&&typeof result.data?.barrier_event_id==='string')barrier=result.data.barrier_event_id;
      return result;},
    channel(name){const channel=client.channel(name),on=channel.on.bind(channel),subscribe=channel.subscribe.bind(channel);statuses.set(channel,'PENDING');
      channel.on=(kind,filter,callback)=>on(kind,filter,payload=>{if(!closed){frames++;if(frames>256){failed=true;return;}
        if(filter.table==='notification_feed_events_v2'&&typeof payload.new?.event_id==='string')eventIds.add(payload.new.event_id);}
        try{callback(payload);}catch{failed=true;}});
      channel.subscribe=callback=>subscribe((status,...args)=>{statuses.set(channel,status);
        if(!closed&&['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))failed=true;
        try{callback?.(status,...args);}catch{failed=true;}});return channel;},
    removeChannel:client.removeChannel.bind(client),
  };
  const ports={react,'@/store/app.store':{useAppStore:app},'@/lib/supabase/client':{createClient:()=>sdk},
    '@/lib/errors':{mapPgError:()=> 'RT_CLIENT_HOOK_RPC_REFUSED'},'@/hooks/useAudioSettings':{getAudioSettings:()=>({notificationSoundEnabled:true})},
    '@/hooks/useOwnPresence':{ownAlertPolicySnapshot:()=> 'allow'},'@/hooks/useVoiceCall':{voiceCallSnapshot:()=>({phase:'idle'})},
    '@/lib/dev/instrumentation':{bumpFetch(){},registerChannel(){},unregisterChannel(){}},'@/lib/chatEvents':{dispatchChatsRefresh(){}},
    '@/lib/platform/desktop':{isDesktopApp:()=>desktop,getDesktopBridge:()=>desktop?bridge:null},
    '@/lib/platform/capabilities':{isNativeAndroid:()=>false},'@/lib/platform/nativePush':{async closeNativeChatNotification(){throw Error('RT_CLIENT_NATIVE_UNEXPECTED');}}};
  const globals={window,document,navigator:{onLine:true},performance,URL,AbortController,setTimeout:timer,clearTimeout:clear,
    console:{warn(){},error(){},log(){}},queueMicrotask};
  function load(name){
    if(modules.has(name))return modules.get(name).exports;need(Object.hasOwn(texts,name));
    const module={exports:{}};modules.set(name,module);
    const compiled=ts.transpileModule(texts[name],{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
      transformers:{before:[context=>tree=>{const visit=node=>ts.isPropertyAccessExpression(node)&&node.getText(tree)==='import.meta.env.DEV'
        ?context.factory.createFalse():ts.visitEachChild(node,visit,context);return ts.visitNode(tree,visit);}]}});
    need(!compiled.diagnostics.some(d=>d.category===ts.DiagnosticCategory.Error));
    const require=key=>{
      if(Object.hasOwn(ports,key))return ports[key];
      let resolved=key.startsWith('@/')?key.slice(2):key.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(name),key)):'';
      if(!resolved.endsWith('.ts'))resolved+='.ts';const port='@/'+resolved.slice(0,-3);
      if(Object.hasOwn(ports,port))return ports[port];need(Object.hasOwn(texts,resolved));return load(resolved);
    };
    try{vm.runInNewContext(compiled.outputText,{module,exports:module.exports,require,Object,JSON,Promise,Map,Set,Date,...globals},
      {filename:name,timeout:1000});}catch{throw Error('RT_CLIENT_HOOK_COMPILE_REFUSED');}return module.exports;
  }
  const hook=load('hooks/useNotifications.ts').useNotifications;
  function pump(){for(let n=0;n<100;n++){
    if(closed)return;if(n===99)throw Error('RT_CLIENT_HOOK_SCHEDULER_REFUSED');
    if(dirty||view===undefined){cursor=0;dirty=false;view=hook();}
    if(effects.size){const work=[...effects];effects.clear();for(const [i] of work)cleanups.get(i)?.();for(const [i,fn] of work)cleanups.set(i,fn());}
    if(!dirty&&!effects.size)return;
  }}
  dirty=true;pump();
  return {
    async drain(){for(let i=0;i<12;i++)await Promise.resolve();if(!closed)pump();},
    snapshot(){return {closed,failed,sounds,cards,removals,frames,rows:view?.items.length??0,error:Boolean(view?.error),
      ready:!closed&&!failed&&statuses.size>0&&[...statuses.values()].every(s=>s==='SUBSCRIBED')
        &&[...statuses.keys()].every(c=>c.state==='joined')&&client.realtime?.isConnected()===true&&!view?.loading&&!view?.error
        &&(generation==='old'||barrier!==null&&eventIds.has(barrier))};},
    hasMessage(messageId){return Boolean(view?.items.some(row=>row.kind==='message'&&row.user_id===actor.uid&&row.payload?.message_id===messageId));},
    close(){if(closed)return;closed=true;for(const cleanup of cleanups.values()){try{cleanup?.();}catch{failed=true;}}
      cleanups.clear();for(const id of timers)clearTimeout(id);timers.clear();},
  };
}
