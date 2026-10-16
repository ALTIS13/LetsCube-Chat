import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { userChoiceStubs, userChoiceSourceNames, userChoicePlatform } from '../android/message-preview-user-choice.fixture.mjs';
import { foregroundCompositionStubs } from '../android/message-preview-genuine-composition.fixture.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const base=path.join(root,'android/app/src/main/java/com/kub/messenger');
const bin=process.env.LETSCUBE_TEST_JAVA_BIN ?? 'C:/Program Files/Android/Android Studio/jbr/bin';
const probe=path.join(root,'tests/java/com/kub/messenger/MessagePreviewQaUserChoiceProbe.java');
const snapshots=userChoiceSourceNames.map(name=>path.join(base,`${name}.java`)).filter(existsSync).map(file=>[file,readFileSync(file)]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const prefix='nmpv-user-choice-';
const owned=[];
function directory() { const out=mkdtempSync(path.join(tmpdir(),prefix)); owned.push(out); return out; }
function compile(replacements={},stubs=userChoiceStubs,selectedProbe=probe) {
  const out=directory();
  const files=Object.entries(stubs).map(([name,source])=>{
    const file=path.join(out,'stubs',name); mkdirSync(path.dirname(file),{recursive:true}); writeFileSync(file,source); return file;
  });
  for(const [file,bytes] of snapshots) {
    const copy=path.join(out,'sources',path.basename(file)); mkdirSync(path.dirname(copy),{recursive:true});
    writeFileSync(copy,replacements[path.basename(file)] ?? bytes); files.push(copy);
  }
  const platform=path.join(out,'MessagePreviewProducerPlatform.java'); writeFileSync(platform,userChoicePlatform); files.push(platform,selectedProbe);
  const result=spawnSync(path.join(bin,'javac'+(process.platform==='win32'?'.exe':'')),['-encoding','UTF-8','-g:none','-d',out,...files],
    {encoding:'utf8',timeout:30_000,maxBuffer:256*1024});
  assert.equal(result.error,undefined,'finite focused JVM compile');
  assert.equal(result.status,0,`JVM_COMPILE_FAILURE_NOT_BEHAVIORAL_RED\n${result.stderr}`);
  console.log(`QA_CHOICE_JVM_COMPILE_PASS actual_sources=${snapshots.length}`);
  return out;
}
function run(out,scenario) {
  const result=spawnSync(path.join(bin,'java'+(process.platform==='win32'?'.exe':'')),['-cp',out,'com.kub.messenger.MessagePreviewQaUserChoiceProbe',scenario],
    {encoding:'utf8',timeout:10_000,maxBuffer:64*1024});
  assert.equal(result.error,undefined,'finite focused JVM scenario'); return result;
}
let out;
test.before(()=>{ out=compile(); });
test.after(()=>{
  try {
    for(const [file,bytes] of snapshots) assert.equal(hash(readFileSync(file)),hash(bytes),'selected production readback');
    console.log(`QA_CHOICE_SOURCE_READBACK_PASS actual_sources=${snapshots.length}`);
  } finally {
    for(const dir of owned) {
      const actual=realpathSync(dir);
      assert.equal(path.dirname(actual),realpathSync(tmpdir())); assert.ok(path.basename(actual).startsWith(prefix));
      assert.equal(actual,path.resolve(dir)); rmSync(actual,{recursive:true});
    }
  }
});
test('qa-choice route absent with ordinary protocol0 intact',()=>{
  const result=run(out,'feature');
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stderr,'');
  assert.equal(result.stdout.replaceAll('\r\n','\n').trim(),'CONTROL ordinary binding and protocol0 PASS\nPASS feature');
});
const scenarios=['ordinary-false','main-request','origin-remote','origin-logging','origin-userinfo','origin-port','origin-scheme','origin-foreign-activity',
  'arm-clock-bound','first-recipient','first-failed','startup-clear','publication-held-worker-clear','publication-clear','publication-begin',
  'publication-reload','publication-pause','publication-state','publication-runtime','publication-bridge','publication-load',
  'deadline-wall','deadline-elapsed','deadline-rollback','deadline-elapsed-back','authority-check','selector-not-lease',
  'strict-inputs','save-expiry','held-confirm','retire-never-begun','confirm-once','intent-successor','foreign-larger','retire-pause','retire-logging','retire-expiry','main-methods'];
for(const scenario of scenarios) test(`compiled QA user choice: ${scenario}`,()=>{
  const result=run(out,scenario); assert.equal(result.status,0,result.stderr); assert.equal(result.stderr,'');
  assert.equal(result.stdout.trim(),`PASS ${scenario}`);
});

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', SID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const DEVICE='cccccccc-cccc-4ccc-8ccc-ccccccccccc1', CONTEXT='dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const owner={recipientId:USER,recipientSessionId:SID,deviceId:DEVICE,accountEpoch:1};
const wire={qa_choice_v:1,purpose:'consent-only',contextId:CONTEXT,...owner,expiresAt:121000};
const plain=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
function client(options={}) {
  const platform=path.join(root,'artifacts/kub/src/lib/platform');
  const modules=new Map(), calls=[], timers=new Map(); let mono=0, serial=0;
  const boundary={
    '@capacitor/core': {registerPlugin:()=>options.native ?? new Proxy({}, {get:(_,name)=>async input=>{calls.push({name,input}); return options.reply;}})},
    [path.join(platform,'capabilities.ts')]: {isNativeAndroid:()=>options.android!==false,supportsCapacitorPlugin:()=>options.plugin!==false},
  };
  function load(file) {
    if(boundary[file]) return boundary[file];
    if(modules.has(file)) return modules.get(file).exports;
    const module={exports:{}}; modules.set(file,module);
    let source=readFileSync(file,'utf8').replaceAll('import.meta.env.VITE_LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE',JSON.stringify(options.flag ?? 'true'));
    if(options.transform) source=options.transform(file,source);
    const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,Date:class extends Date {static now(){return 1000;}},
      setTimeout:(work,delay)=>{const id=++serial;timers.set(id,{work,due:mono+delay});return id;},clearTimeout:id=>timers.delete(id),
      require:name=>boundary[name] ?? load(path.resolve(path.dirname(file),`${name}.ts`))},{filename:file});
    return module.exports;
  }
  return {contract:load(path.join(platform,'nativeMessagePreviewContract.ts')),
    adapter:()=>load(path.join(platform,'nativeMessagePreviews.ts')),calls,timers,
    advance:async ms=>{mono+=ms;for(const [id,timer]of timers)if(timer.due<=mono){timers.delete(id);timer.work();}for(let i=0;i<8;i++)await Promise.resolve();}};
}
test('strict QA context parser is separate from ordinary protocol1',()=>{
  const c=client().contract;
  assert.equal(c.readMessagePreviewBinding({protocol:1,...owner},owner).deviceId,DEVICE,'ordinary protocol1 positive control');
  assert.equal(typeof c.readQaMessagePreviewChoiceContext,'function','QA_CONTEXT_PARSER_PRESENT');
  const result=c.readQaMessagePreviewChoiceContext(wire,owner,1000);
  assert.deepEqual(plain(result),{contextId:CONTEXT,...owner,expiresAt:121000});
  assert.ok(Object.isFrozen(result)); assert.equal(c.readMessagePreviewBinding(wire,owner),null,'QA_NEVER_ORDINARY_PROTOCOL1');
});
test('strict QA parser refuses malformed foreign expired and extra contexts',()=>{
  const {readQaMessagePreviewChoiceContext:read}=client().contract;
  assert.ok(read(wire,owner,1000),'QA_PARSER_POSITIVE_CONTROL');
  for(const input of [null,[],{qa_choice_v:0},{protocol:1,...owner},{...wire,protocol:1},{...wire,url:'https://example.invalid'},
    {...wire,qa_choice_v:'1'},{...wire,purpose:'preview'},{...wire,contextId:CONTEXT.toUpperCase()},
    {...wire,recipientId:CONTEXT},{...wire,recipientSessionId:CONTEXT},{...wire,deviceId:CONTEXT},
    {...wire,accountEpoch:2},{...wire,accountEpoch:'1'},{...wire,accountEpoch:-1},{...wire,accountEpoch:1.5},
    {...wire,expiresAt:1000},{...wire,expiresAt:121001},{...wire,expiresAt:Number.MAX_SAFE_INTEGER+1},{...wire,expiresAt:'121000'}])
    assert.equal(read(input,owner,1000),null,'QA_PARSER_EXACT_SHAPE_IDENTITY_EXPIRY');
  for(const key of Object.keys(wire)) {const input={...wire};delete input[key];assert.equal(read(input,owner,1000),null,'QA_PARSER_OWN_EIGHT_KEYS');}
  assert.equal(read(wire,owner,NaN),null); assert.equal(read(wire,owner,-1),null);
  const result=read(wire,owner,1000), input={...wire}; const copy=read(input,owner,1000); input.contextId=USER;
  assert.deepEqual(plain(copy),plain(result),'QA_CONTEXT_IMMUTABLE_COPY');
});
test('QA wrapper snapshots the exact intent before an awaited bridge call',async()=>{
  const c=client({reply:{applied:true}}), input={contextId:CONTEXT,revision:1};
  const result=c.adapter().nativeMessagePreviewQaChoiceBridge.beginQaUserChoice(input);
  input.contextId=USER; input.revision=99;
  assert.deepEqual(plain(await result),{applied:true});
  assert.deepEqual(plain(c.calls),[{name:'beginQaUserChoice',input:{contextId:CONTEXT,revision:1}}],'QA_WRAPPER_CAPTURED_INPUT');
});
test('QA wrappers leave disabled web/native admission with zero calls',async()=>{
  for(const options of [{flag:'false'},{flag:true},{flag:undefined,android:false},{plugin:false}]) {
    const c=client(options), b=c.adapter().nativeMessagePreviewQaChoiceBridge;
    assert.equal(await b.getQaUserChoiceContext(owner),null); assert.equal(await b.beginQaUserChoice({contextId:CONTEXT,revision:1}),null);
    assert.equal(await b.confirmQaUserChoice({contextId:CONTEXT,revision:1,choice:'sender'}),null);
    assert.equal(await b.retireQaUserChoice({contextId:CONTEXT,expectedIntentRevision:1,revision:2}),null);
    assert.equal(c.calls.length,0,'WEB_FALSE_ZERO_QA_BRIDGE_CALLS'); assert.equal(c.timers.size,0);
  }
});
test('exact native false ACK is known but missing malformed or failed ACK is UNKNOWN',async()=>{
  for(const reply of [{applied:true},{applied:false}]) {
    const c=client({reply}); assert.deepEqual(plain(await c.adapter().nativeMessagePreviewQaChoiceBridge.beginQaUserChoice({contextId:CONTEXT,revision:1})),reply);
    assert.equal(c.calls.length,1); assert.equal(c.timers.size,0);
  }
  for(const reply of [undefined,null,{},false,{applied:0},{applied:'false'},{applied:false,extra:1}]) {
    const c=client({reply}); assert.equal(await c.adapter().nativeMessagePreviewQaChoiceBridge.beginQaUserChoice({contextId:CONTEXT,revision:1}),null,'UNKNOWN_NOT_KNOWN_FALSE');
    assert.equal(c.calls.length,1); assert.equal(c.timers.size,0);
  }
  for(const native of [{}, {beginQaUserChoice(){throw new Error('fictional');}}, {beginQaUserChoice(){return Promise.reject(new Error('fictional'));}}]) {
    const c=client({native});assert.equal(await c.adapter().nativeMessagePreviewQaChoiceBridge.beginQaUserChoice({contextId:CONTEXT,revision:1}),null,'ERROR_NOT_FABRICATED_FALSE');
    assert.equal(c.timers.size,0);
  }
});
test('QA bridge timeout is literal 2000ms UNKNOWN and never replays late ACK',async()=>{
  let resolve, count=0;
  const c=client({native:{beginQaUserChoice(){count++;return new Promise(r=>resolve=r);}}});
  let settled=false;
  const pending=c.adapter().nativeMessagePreviewQaChoiceBridge.beginQaUserChoice({contextId:CONTEXT,revision:1}).then(value=>{settled=true;return value;});
  await c.advance(1999); assert.equal(settled,false,'QA_ACK_D_MINUS_ONE'); assert.equal(count,1);
  await c.advance(1); assert.equal(await pending,null,'QA_ACK_LITERAL_2000_UNKNOWN');
  resolve({applied:true});await c.advance(5000);assert.equal(count,1,'NO_UNKNOWN_REPLAY');assert.equal(c.timers.size,0);
});
test('QA wrapper validates exact context/refusal replies without changing ordinary capabilities',async()=>{
  const c=client({reply:wire}), b=c.adapter().nativeMessagePreviewQaChoiceBridge;
  assert.deepEqual(plain(await b.getQaUserChoiceContext(owner)),wire);
  assert.deepEqual(plain(c.calls),[{name:'getQaUserChoiceContext',input:owner}]);
  const refused=client({reply:{qa_choice_v:0}}); assert.deepEqual(plain(await refused.adapter().nativeMessagePreviewQaChoiceBridge.getQaUserChoiceContext(owner)),{qa_choice_v:0});
  for(const reply of [{protocol:0},{qa_choice_v:0,extra:1},{...wire,recipientId:CONTEXT},{...wire,expiresAt:1000}]) {
    const bad=client({reply});assert.equal(await bad.adapter().nativeMessagePreviewQaChoiceBridge.getQaUserChoiceContext(owner),null);
  }
  const ordinary=client({flag:'false',reply:{protocol:0}}); assert.deepEqual(plain(await ordinary.adapter().readNativeMessagePreviewCandidate()),{protocol:0});
  assert.deepEqual(ordinary.calls.map(c=>c.name),['getCapabilities'],'ORDINARY_SELECTOR_UNCHANGED');
});
test('QA wrappers reject extras credentials coercions and unsafe revisions without calls',async()=>{
  const c=client({reply:{applied:true}}), b=c.adapter().nativeMessagePreviewQaChoiceBridge;
  for(const revision of ['1',-1,0,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])
    assert.equal(await b.beginQaUserChoice({contextId:CONTEXT,revision}),null);
  assert.equal(await b.beginQaUserChoice({contextId:CONTEXT,revision:1,accessToken:'fictional'}),null);
  assert.equal(await b.getQaUserChoiceContext({...owner,publicApiKey:'fictional'}),null);
  assert.equal(await b.confirmQaUserChoice({contextId:CONTEXT,revision:1,choice:'rich'}),null);
  assert.equal(await b.retireQaUserChoice({contextId:CONTEXT,expectedIntentRevision:2,revision:2}),null);
  assert.equal(c.calls.length,0,'MALFORMED_NO_BRIDGE_EFFECTS');
});
test('selected Task1 TypeScript interfaces typecheck without emitting or building',()=>{
  const project=path.join(root,'artifacts/kub');
  const config=ts.readConfigFile(path.join(project,'tsconfig.json'),ts.sys.readFile);
  assert.equal(config.error,undefined);
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,project);
  const files=['src/lib/platform/nativeMessagePreviews.ts','src/lib/platform/nativeMessagePreviewContract.ts','src/types/desktop.d.ts'].map(f=>path.join(project,f));
  const options={...parsed.options,noEmit:true,incremental:false,composite:false};
  const host=ts.createCompilerHost(options); host.getCurrentDirectory=()=>project;
  const program=ts.createProgram(files,options,host);
  const diagnostics=ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length,0,ts.formatDiagnostics(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>project,getNewLine:()=> '\n'}));
});
test('existing default-false fixture and producer source closure compile without replay',()=>{
  assert.match(foregroundCompositionStubs['com/kub/messenger/BuildConfig.java'],/LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE=false;/);
  const oldProbe=path.join(root,'tests/java/com/kub/messenger/MessagePreviewVerificationProducerProbe.java');
  compile({},foregroundCompositionStubs,oldProbe);
  assert.match(readFileSync(path.join(root,'tests/unit/native-message-preview-verification-producer.test.mjs'),'utf8'),/'MainActivity', 'MessagePreviewQaUserChoice'/);
  assert.match(readFileSync(path.join(root,'android/app/build.gradle'),'utf8'),/buildConfigField "boolean", "LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE", "false"/);
});
test('each typed QA intent wrapper preserves known false and UNKNOWN independently',async()=>{
  for(const [method,input]of [['beginQaUserChoice',{contextId:CONTEXT,revision:1}],
    ['confirmQaUserChoice',{contextId:CONTEXT,revision:1,choice:'sender'}],
    ['retireQaUserChoice',{contextId:CONTEXT,expectedIntentRevision:1,revision:2}]]) {
    for(const reply of [{applied:true},{applied:false},null,undefined,{applied:true,extra:1}]) {
      const c=client({reply});const result=await c.adapter().nativeMessagePreviewQaChoiceBridge[method](input);
      assert.deepEqual(plain(result),reply?.applied!==undefined && !reply.extra ? reply:null);
      assert.deepEqual(plain(c.calls),[{name:method,input}]);assert.equal(c.timers.size,0);
    }
  }
});
const ownerFile='MessagePreviewQaUserChoice.java', pluginFile='MessagePreviewsPlugin.java';
const mutations=[
  ['native QA guard',null,'ordinary-false','ORDINARY_FALSE_ZERO_OWNER'],
  ['main admission',pluginFile,'main-methods','CONTEXT_EXACT_EIGHT_FIELDS',
    'if (!new Handler(Looper.getMainLooper()).post(work)) call.resolve(refused);','work.run();'],
  ['actual authority',ownerFile,'authority-check','ACTUAL_AUTHORITY_CURRENT_RECHECK',
    ' || !issuer.isCurrent(authority) || !ownActivity(application, bridge)',' || !ownActivity(application, bridge)'],
  ['first recipient',ownerFile,'first-recipient','FIRST_RECIPIENT_FENCE',' || !recipient.equals(user)',''],
  ['fixed elapsed deadline',ownerFile,'deadline-elapsed','CONTEXT_FIXED_D_OR_ROLLBACK',
    'elapsedDeadline=lastElapsed + 120_000;','elapsedDeadline=lastElapsed + 120_001;'],
  ['fixed wall deadline +1ms',ownerFile,'deadline-wall','NONRENEWABLE_WALL_EXPIRY',
    'wallDeadline=lastWall + 120_000;','wallDeadline=lastWall + 120_001;'],
  ['wall deadline D',ownerFile,'deadline-wall','CONTEXT_FIXED_D_OR_ROLLBACK','wall >= wallDeadline','wall > wallDeadline'],
  ['wall rollback',ownerFile,'deadline-rollback','CONTEXT_FIXED_D_OR_ROLLBACK','wall < lastWall || ',''],
  ['exact context',ownerFile,'foreign-larger','FOREIGN_CONTEXT_ZERO_EFFECT','contextId != null && contextId.equals(context)','contextId != null'],
  ['exact retirement revision',ownerFile,'intent-successor','HELD_RETIRE_CANNOT_CHANGE_B',' || expectedRevision != intentRevision',''],
  ['strict newer begin',ownerFile,'intent-successor','BEGIN_STRICT_NEWER','revision <= intentRevision || !current()','false || !current()'],
  ['exact pending revision',ownerFile,'held-confirm','HELD_A_CANNOT_CONFIRM_B',' || revision != intentRevision',''],
  ['single confirm',ownerFile,'confirm-once','CONFIRM_ONCE',' || !pending',''],
  ['publication exact runtime state',ownerFile,'publication-state','LATE_MAIN_PUBLICATION_REFUSED',
    '|| !runtime.matchesVerified(expected.revision, expected.epoch, expected.user,\n                expected.session, expected.account, expected.device)','|| false'],
  ['publication plugin runtime object',pluginFile,'publication-runtime','LATE_MAIN_PUBLICATION_REFUSED',' || runtime != choiceRuntime',''],
  ['literal capability0',pluginFile,'main-methods','CAPABILITIES_LITERAL_ZERO','.put("protocol", 0)','.put("protocol", 1)'],
  ['early MainActivity bootstrap','MainActivity.java','feature','QA_CHOICE_FEATURE_ABSENT_WITH_ORDINARY_PROTOCOL0_INTACT',
    '        MessagePreviewQaUserChoice.bootstrap(getApplication());',''],
];
for(const [name,file,scenario,oracle,before,after] of mutations) test(`compiled QA omission killed: ${name}`,()=>{
  const control=run(out,scenario); assert.equal(control.status,0,control.stderr);
  const replacements={};
  if(file===null) {
    for(const name of [ownerFile,pluginFile]) {
      const source=snapshots.find(([f])=>path.basename(f)===name)[1].toString();
      assert.ok(source.includes('BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE'));
      replacements[name]=source.replaceAll('BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE','true');
    }
  } else {
    const source=snapshots.find(([f])=>path.basename(f)===file)[1].toString();
    assert.equal(source.split(before).length,2,'one selected actual source rule');
    replacements[file]=source.replace(before,after);
  }
  const result=run(compile(replacements),scenario);
  assert.equal(result.status,1,'compiled runtime assertion, not compiler/setup/timeout');
  assert.equal(result.stderr.split(/\r?\n/)[0],`Exception in thread "main" java.lang.AssertionError: ${oracle}`);
});
const tsMutations=[
  ['QA shape cardinality','nativeMessagePreviewContract.ts','Object.keys(value).length !== 8','false',c=>
    assert.equal(c.contract.readQaMessagePreviewChoiceContext({...wire,extra:1},owner,1000),null,'QA_EXACT_EIGHT_MUTANT')],
  ['QA marker','nativeMessagePreviewContract.ts','value.qa_choice_v !== 1','false',c=>
    assert.equal(c.contract.readQaMessagePreviewChoiceContext({...wire,qa_choice_v:0},owner,1000),null,'QA_MARKER_MUTANT')],
  ['QA account identity','nativeMessagePreviewContract.ts',' || value.accountEpoch !== expected.accountEpoch','',c=>
    assert.equal(c.contract.readQaMessagePreviewChoiceContext({...wire,accountEpoch:2},owner,1000),null,'QA_ACCOUNT_MUTANT')],
  ['web exact true guard','nativeMessagePreviews.ts','import.meta.env.VITE_LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE !== "true"','false',async c=>{
    await c.adapter().nativeMessagePreviewQaChoiceBridge.beginQaUserChoice({contextId:CONTEXT,revision:1});assert.equal(c.calls.length,0,'WEB_GUARD_MUTANT');}, {flag:'false',reply:{applied:true}}],
  ['finite literal ACK timeout','nativeMessagePreviews.ts','2_000','2_001',async c=>{
    let settled=false;c.adapter().nativeMessagePreviewQaChoiceBridge.beginQaUserChoice({contextId:CONTEXT,revision:1}).then(()=>{settled=true;});
    await c.advance(2000);assert.equal(settled,true,'ACK_2000_MUTANT');}, {native:{beginQaUserChoice:()=>new Promise(()=>{})}}],
  ['unknown ACK not false','nativeMessagePreviews.ts',': null;\n}\n// Null means UNKNOWN',': Object.freeze({ applied: false });\n}\n// Null means UNKNOWN',async c=>
    assert.equal(await c.adapter().nativeMessagePreviewQaChoiceBridge.beginQaUserChoice({contextId:CONTEXT,revision:1}),null,'ACK_UNKNOWN_MUTANT'),{reply:undefined}],
];
for(const [name,file,before,after,check,options={}] of tsMutations) test(`transpiled QA omission killed: ${name}`,async()=>{
  await check(client(options));
  const source=readFileSync(path.join(root,'artifacts/kub/src/lib/platform',file),'utf8');
  assert.equal(source.split(before).length,2,'one selected TS rule');
  const mutated=client({...options,transform:(f,s)=>path.basename(f)===file?s.replace(before.replaceAll('import.meta.env.VITE_LETSCUBE_QA_MESSAGE_PREVIEW_USER_CHOICE',JSON.stringify(options.flag ?? 'true')),after):s});
  await assert.rejects(async()=>check(mutated),error=>error?.code==='ERR_ASSERTION');
});
