import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root=new URL('../../artifacts/kub/src/',import.meta.url);
const hookPath=new URL('hooks/useCallSound.ts',root);
const source=readFileSync(hookPath,'utf8');
const playerSource=readFileSync(new URL('lib/callSoundPlayer.ts',root),'utf8');
const policySource=readFileSync(new URL('lib/callSounds.ts',root),'utf8');
const input={userId:'fictional-owner',chatId:'fictional-chat',topicId:null};

function compile(text,imports,globals={},devPort=false) {
  const result=ts.transpileModule(text,{reportDiagnostics:true,compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
  },transformers:devPort?{before:[context=>tree=>{
    const visit=node=>ts.isPropertyAccessExpression(node)&&node.getText(tree)==='import.meta.env.DEV'
      ?context.factory.createTrue():ts.visitEachChild(node,visit,context);
    return ts.visitNode(tree,visit);
  }]}:undefined});
  assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
  const module={exports:{}};
  vm.runInNewContext(result.outputText,{module,exports:module.exports,require(name){
    assert.ok(Object.hasOwn(imports,name),'unexpected actual consumer dependency');return imports[name];
  },...globals});
  return module.exports;
}
function fixture(hook=source) {
  let state={currentUser:{id:input.userId},accountEpoch:1,selectedChatId:input.chatId,selectedTopicId:null};
  let now=1000,policy='allow',enabled=true,resumeDone,resumes=0;
  const starts=[],timers=[];
  const gate=new Promise(resolve=>{resumeDone=resolve;});
  const parameter=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},setValueCurveAtTime(){},cancelScheduledValues(){}});
  class ControlledContext {
    state='suspended';currentTime=0;destination={};
    resume(){resumes++;return gate.then(()=>{this.state='running';});}
    createGain(){return {gain:parameter(),connect(){},disconnect(){}};}
    createOscillator(){const osc={frequency:parameter(),connect(){},disconnect(){},stop(){},
      start(at){starts.push({at});},onended:null};return osc;}
  }
  const window={__letscubeAudioContext:ControlledContext};
  const globals={window,document:{hidden:false,querySelector:()=>null},performance:{now:()=>now},
    setTimeout(callback,delay){timers.push({callback,delay});return timers.length;},clearTimeout(){}};
  const sounds=compile(policySource,{});
  const player=compile(playerSource,{'./callSounds.ts':sounds},globals,true);
  const hookExports=compile(hook,{
    react:{useEffect(){throw Error('HOOK_INSTALLATION_NOT_IN_SCOPE');}},
    '@/lib/callSounds':sounds,'@/lib/callSoundPlayer':player,
    '@/hooks/useAudioSettings':{getAudioSettings:()=>({notificationSoundEnabled:enabled})},
    '@/hooks/useOwnPresence':{ownAlertPolicySnapshot:()=>policy},
    '@/hooks/useVoiceCall':{voiceCallSnapshot:()=>({phase:'idle'})},
    '@/store/app.store':{useAppStore:{getState:()=>state}},
  },globals);
  return {starts,player,get resumes(){return resumes;},play:()=>hookExports.playMessageSentSoundFor(input),
    replaceSameUserSession(){state={...state,currentUser:null,accountEpoch:state.accountEpoch+1,selectedChatId:null};
      player.stopAllCallSounds();state={...state,currentUser:{id:input.userId},selectedChatId:input.chatId,selectedTopicId:null};},
    resume:()=>resumeDone(),advance:ms=>{now+=ms;},quiet:()=>{policy='quiet';},disable:()=>{enabled=false;}};
}
async function drain(){for(let i=0;i<12;i++)await Promise.resolve();}
async function retiredCue(hook=source) {
  const f=fixture(hook);f.play();assert.equal(f.resumes,1,'actual player reached suspended resume');
  assert.equal(f.starts.length,0,'no oscillator before resume');f.replaceSameUserSession();f.resume();await drain();
  assert.equal(f.starts.length,0,'MESSAGE_SENT_RETIRED_EPOCH_MUST_BE_SILENT');return f;
}

test('same-user epoch replacement retires the actual pending message-sent oscillator cue',()=>retiredCue());
test('unchanged epoch confirmed send still schedules the actual one-shot',async()=>{
  const f=fixture();f.play();assert.equal(f.resumes,1);f.resume();await drain();assert.equal(f.starts.length,2);
  assert.equal(f.player.scheduledCallSoundVoices(),2);
});
test('retired cue does not consume the successor cue coalescing allowance',async()=>{
  const f=await retiredCue();f.play();await drain();assert.equal(f.starts.length,2);
});
test('held resume still honors current DND and disabled sound setting',async()=>{
  for(const change of ['quiet','disable']){const f=fixture();f.play();f[change]();f.resume();await drain();assert.equal(f.starts.length,0);}
});
test('current-epoch actual player preserves the literal 100ms coalescing boundary',async()=>{
  const f=fixture();f.play();f.resume();await drain();assert.equal(f.starts.length,2);
  f.advance(99);f.play();await drain();assert.equal(f.starts.length,2);
  f.advance(1);f.play();await drain();assert.equal(f.starts.length,4);
});
test('compiled epoch-guard omission restores the actual stale oscillator failure',async()=>{
  const guard='    if (store.accountEpoch !== accountEpoch) return false;\n';
  assert.equal(source.split(guard).length-1,1);
  await assert.rejects(retiredCue(source.replace(guard,'')),e=>e.code==='ERR_ASSERTION'
    &&e.message.includes('MESSAGE_SENT_RETIRED_EPOCH_MUST_BE_SILENT'));
});
test.after(()=>{
  assert.equal(readFileSync(hookPath,'utf8'),source);
  assert.equal(readFileSync(new URL('lib/callSoundPlayer.ts',root),'utf8'),playerSource);
  assert.equal(readFileSync(new URL('lib/callSounds.ts',root),'utf8'),policySource);
});
