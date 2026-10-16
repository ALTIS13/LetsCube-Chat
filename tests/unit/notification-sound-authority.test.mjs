import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root=new URL("../../artifacts/kub/src/",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");
function compile(text,imports,globals={},dev=false) {
  const result=ts.transpileModule(text,{reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    transformers:dev?{before:[context=>tree=>{
      const visit=node=>ts.isPropertyAccessExpression(node)&&node.getText(tree)==="import.meta.env.DEV"
        ?context.factory.createTrue():ts.visitEachChild(node,visit,context);
      return ts.visitNode(tree,visit);
    }]}:undefined});
  assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
  const module={exports:{}};
  vm.runInNewContext(result.outputText,{module,exports:module.exports,require(name){assert.ok(Object.hasOwn(imports,name));return imports[name];},...globals});
  return module.exports;
}
const drain=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function fixture({hook=read("hooks/useCallSound.ts"),playerSource=read("lib/callSoundPlayer.ts")}={}) {
  let state={currentUser:{id:"fictional-owner"},accountEpoch:1,selectedChatId:"other-chat"};
  let enabled=true,policy="allow",current=true,permission=true,releaseResume,releasePermission;
  const starts=[],requests=[];
  const resume=new Promise(resolve=>{releaseResume=resolve;});
  const authority=new Promise(resolve=>{releasePermission=resolve;});
  const parameter=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},setValueCurveAtTime(){},cancelScheduledValues(){}});
  class ControlledContext {
    state="suspended";currentTime=0;destination={};
    resume(){return resume.then(()=>{this.state="running";});}
    createGain(){return {gain:parameter(),connect(){},disconnect(){}};}
    createOscillator(){return {frequency:parameter(),connect(){},disconnect(){},stop(){},start(){starts.push("oscillator");},onended:null};}
  }
  const globals={window:{__letscubeAudioContext:ControlledContext},document:{hidden:false,querySelector:()=>null},
    performance:{now:()=>1000},setTimeout:()=>1,clearTimeout(){}};
  const sounds=compile(read("lib/callSounds.ts"),{});
  const player=compile(playerSource,{"./callSounds.ts":sounds},globals,true);
  const hooks=compile(hook,{react:{useEffect(){}},"@/lib/callSounds":sounds,"@/lib/callSoundPlayer":player,
    "@/hooks/useAudioSettings":{getAudioSettings:()=>({notificationSoundEnabled:enabled})},
    "@/hooks/useOwnPresence":{ownAlertPolicySnapshot:()=>policy},"@/hooks/useVoiceCall":{voiceCallSnapshot:()=>({phase:"idle"})},
    "@/store/app.store":{useAppStore:{getState:()=>state}}},globals);
  const input={chatId:"fictional-chat",osToast:false,isCurrent:()=>current,
    authorize:async()=>{requests.push("authority");await authority;return permission;}};
  return {starts,requests,player,play:()=>hooks.playNotificationSoundFor(input),resume:()=>releaseResume(),permit:()=>releasePermission(),
    deny(){permission=false;},retire(){current=false;},quiet(){policy="quiet";},disable(){enabled=false;},
    openChat(){state={...state,selectedChatId:input.chatId};},replaceSession(){state={...state,accountEpoch:2};}};
}

test("actual notification oscillator waits for fresh authority after the audio resume",async()=>{
  const f=fixture();f.play();assert.deepEqual(f.requests,[]);assert.deepEqual(f.starts,[]);
  f.resume();await drain();assert.deepEqual(f.requests,["authority"]);assert.deepEqual(f.starts,[]);
  f.permit();await drain();assert.equal(f.starts.length,4);
});
test("denial after audio warm-up schedules no actual oscillator",async()=>{
  const f=fixture();f.play();f.deny();f.resume();f.permit();await drain();assert.equal(f.starts.length,0);
});
for(const change of ["retire","replaceSession","quiet","disable","openChat"]) test(`pending audio authority rechecks ${change} before scheduling`,async()=>{
  const f=fixture();f.play();f.resume();await drain();assert.equal(f.requests.length,1,"actual authority reached its held boundary");
  f[change]();f.permit();await drain();assert.equal(f.starts.length,0);
});
test("audio context retirement during the authority wait cannot schedule into the old context",async()=>{
  const f=fixture();f.play();f.resume();await drain();assert.equal(f.requests.length,1);
  f.player.resetCallSoundsForTest();f.permit();await drain();assert.equal(f.starts.length,0);
});

test("actual compiled sound authority omissions break literal zero-oscillator expectations",async()=>{
  const originalPlayer=read("lib/callSoundPlayer.ts"),originalHook=read("hooks/useCallSound.ts");
  const finalGuard='  }\n  if (stillAllowed && !stillAllowed()) return { readiness: state, bursts: 0 };\n  if (context';
  const mutations=[
    ["ignore permission",originalPlayer,
      'try { if (!await authorize()) return { readiness: state, bursts: 0 }; }',
      'try { await authorize(); }',"deny","playerSource"],
    ["omit final live guard",originalPlayer,finalGuard,'  }\n  if (context',"disable","playerSource"],
    ["reuse retired context",originalPlayer,
      '  if (context !== ctx || ctx.state !== "running") return { readiness: context === ctx ? "blocked" : readiness, bursts: 0 };',
      '',"context","playerSource"],
    ["reuse same-UID epoch",originalHook,'state.accountEpoch !== accountEpoch || ','',"replaceSession","hook"],
  ];
  for(const [name,source,before,after,change,part] of mutations) {
    assert.equal(source.split(before).length,2,`${name}: one actual mutation`);
    const f=fixture({[part]:source.replace(before,after)});f.play();f.resume();await drain();
    assert.equal(f.requests.length,1,"setup must reach the real authority callback");
    if(change==="context")f.player.resetCallSoundsForTest();else f[change]();
    f.permit();await drain();
    assert.notEqual(f.starts.length,0,`${name}: omission must violate the independent zero-oscillator oracle`);
  }
});
