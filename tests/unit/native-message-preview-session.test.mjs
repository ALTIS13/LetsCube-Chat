import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import test from 'node:test';
import {foregroundCompositionSourceNames,foregroundCompositionStubs,compositionPlatform} from '../android/message-preview-genuine-composition.fixture.mjs';
const root=resolve(import.meta.dirname,'../..'),java=join(root,'android/app/src/main/java/com/kub/messenger');
const prefix='letscube-preview-session-',bin=n=>join('C:/Program Files/Android/Android Studio/jbr/bin',n+'.exe');
let classes;
function clean(path){const p=realpathSync(path);assert.equal(p,resolve(path));assert.equal(dirname(p),realpathSync(tmpdir()));
  assert.ok(basename(p).startsWith(prefix));rmSync(p,{recursive:true});}
function compile(path,changes={}){
  const files=Object.entries(foregroundCompositionStubs).map(([name,text])=>{const p=join(path,'stubs',name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text);return p;});
  const platform=join(path,'MessagePreviewProducerPlatform.java');
  const hook='if(credential && afterGenerate!=null) afterGenerate.run();';
  assert.equal(compositionPlatform.split(hook).length,2,'one fictional provider latch point');
  // Expose the same test-only provider latch for metadata bootstrap, outside the gate monitor.
  writeFileSync(platform,compositionPlatform.replace(hook,'if(afterGenerate!=null) afterGenerate.run();'));
  const sources=[...new Set([...foregroundCompositionSourceNames,'MessagePreviewSession'])].map(n=>{
    if(!changes[n])return join(java,n+'.java');const p=join(path,n+'.java');writeFileSync(p,changes[n]);return p;
  }).filter(existsSync);
  const r=spawnSync(bin('javac'),['-encoding','UTF-8','-g:none','-d',path,...files,...sources,platform,
    join(root,'tests/android/MessagePreviewSessionProbe.java'),join(root,'tests/android/MessagePreviewDocumentProbe.java')],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:262144});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
}
test.before(()=>{classes=mkdtempSync(join(tmpdir(),prefix+'classes-'));compile(classes);});
test.after(()=>{if(classes)clean(classes);});
function run(scenario,path=classes,probe='MessagePreviewSessionProbe'){const files=mkdtempSync(join(tmpdir(),prefix+'files-'));
  try{return spawnSync(bin('java'),['-cp',path,'com.kub.messenger.'+probe,scenario,files],
    {encoding:'utf8',windowsHide:true,timeout:12000,maxBuffer:65536});}finally{clean(files);}}
for(const scenario of ['commit','refresh','logout','pause','reject','stale','singleton','held-logout','begin-invalidate','content-retirement','auth-denial','begin-collision','retire-collision','queued-ack-invalidate','queued-ack-deadline'])
  test('ordinary durable Auth session: '+scenario,()=>{const r=run(scenario);
    assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');assert.equal(r.stdout.trim(),'PASS '+scenario);});
for(const scenario of ['idle-clear-login','idle-clear-corrupt','idle-clear-missing-key','idle-clear-unknown-namespace','idle-clear-orphan-key'])
  test('signed-out idle clear: '+scenario,()=>{const r=run(scenario);
    assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');assert.equal(r.stdout.trim(),'PASS '+scenario);});
for(const scenario of ['bootstrap-verify','bootstrap-latest','bootstrap-clear','bootstrap-rebind','bootstrap-pause','credential-held-clear'])
  test('held installation/account separation: '+scenario,()=>{const r=run(scenario);
    assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');assert.equal(r.stdout.trim(),'PASS '+scenario);});
for(const [name,after,scenario,oracle] of [
  ['account intent must not cancel metadata bootstrap','owner.invalidate();','bootstrap-verify','BOOTSTRAP_OVERLAP_COMMITS_LATEST'],
  ['loaded credential work still invalidated','if (terminal || !busy) owner.invalidate();','credential-held-clear','LOADED_CREDENTIAL_OWNER_INVALIDATED'],
])test('bootstrap invalidation literal omission: '+name,()=>{
  const source=readFileSync(join(java,'MessagePreviewSession.java'),'utf8');
  const before='if (terminal || loaded || !busy) owner.invalidate();';
  assert.equal(source.split(before).length,2,'one actual-source invalidation boundary');
  const path=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try{compile(path,{MessagePreviewSession:source.replace(before,after)});const result=run(scenario,path);
    assert.equal(result.error,undefined);assert.equal(result.status,1,'compiled behavioral failure, not setup/timeout');
    assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'FAIL '+oracle);
  }finally{clean(path);}
});
for(const [name,before,after,oracle] of [
  ['retirement-only pristine fallback',
    'if (!pristineAttempt && (retireRequested || (pending != null && current(pending)))) {',
    'if (!pristineAttempt && pending != null && current(pending)) {','IDLE_CLEAR_LATER_LOGIN_COMMITS'],
  ['clear obligation retained through pristine initialization',
    'owner.initializeExplicit(next -> post(() -> loaded(next, true)));',
    'retireRequested = false; owner.initializeExplicit(next -> post(() -> loaded(next, true)));','IDLE_CLEAR_CONFIRMED_EMPTY'],
])test('idle clear literal omission: '+name,()=>{
  const source=readFileSync(join(java,'MessagePreviewSession.java'),'utf8');
  assert.equal(source.split(before).length,2,'one actual-source rule');
  const path=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try{compile(path,{MessagePreviewSession:source.replace(before,after)});const result=run('idle-clear-login',path);
    assert.equal(result.error,undefined);assert.equal(result.status,1,'compiled behavioral failure, not setup/timeout');
    assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'FAIL '+oracle);
  }finally{clean(path);}
});
for(const scenario of ['old-clear','old-begin','cold-clear','concurrent-lock','cold-new-bridge','remote-context','context-extra-keys'])test('native document ownership: '+scenario,()=>{
  const r=run(scenario,classes,'MessagePreviewDocumentProbe');assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');assert.equal(r.stdout.trim(),'PASS '+scenario);
});

for(const [name,before,after,scenario,oracle] of [
  ['one producer verification','attempt.producer.arm(attempt.identity, attempt.deadline);','', 'commit','ONE_VERIFIED_COMMIT'],
  ['clear exact durable state','authRevision = revision; cancelRequests(); retireRequested = true; post(this::drive);',
    'authRevision = revision; cancelRequests();','logout','LOGOUT_EXACT_ERASURE'],
  ['Auth denial before disk','committed = false; binding = null; denyContent();','committed = false; binding = null;', 'auth-denial','AUTH_DENIES_BEFORE_ASYNC_ERASURE'],
  ['content epoch','!contentDenied && permit.epoch == contentEpoch','!contentDenied', 'content-retirement','RETIRED_CONTENT_NEVER_REOPENS'],
  ['bounded pinned-ID skip','skipped < 2 && floor < ceiling','skipped < 1 && floor < ceiling','begin-collision','PINNED_BEGIN_SKIPS_ONCE'],
])test('ordinary session literal omission: '+name,()=>{
  const source=readFileSync(join(java,'MessagePreviewSession.java'),'utf8');assert.equal(source.split(before).length,2,'one current rule');
  const control=run(scenario);assert.equal(control.status,0,control.stderr);
  const path=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try{compile(path,{MessagePreviewSession:source.replace(before,after)});const result=run(scenario,path);
    assert.equal(result.status,1,'runtime failure, not setup or timeout');assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'FAIL '+oracle);
  }finally{clean(path);}
});

for(const [name,subject,before,after,scenario,oracle,probe] of [
  ['completion outside monitor','MessagePreviewSession','post(() -> {\n            boolean accepted;',
    'java.util.function.Consumer<Runnable> inline = Runnable::run;\n        inline.accept(() -> {\n            boolean accepted;',
    'concurrent-lock','NO_PLUGIN_SESSION_LOCK_INVERSION','MessagePreviewDocumentProbe'],
  ['queued ACK current binding','MessagePreviewSession','accepted = value && current(attempt) && binding != null && binding.source == attempt && current(binding);',
    'accepted = value;','queued-ack-invalidate','QUEUED_ACK_REVALIDATES_ONCE','MessagePreviewSessionProbe'],
  ['claim completion once','MessagePreviewSession','attempt.completion = null; attempt.access = null;',
    'attempt.access = null;','held-logout','ONCE_FALSE','MessagePreviewSessionProbe'],
  ['attach before first clear','MessagePreviewsPlugin','else try { sessionOwner.attach(getBridge(), runtime); }',
    'else try { }','cold-clear','COLD_CLEAR_RETIRES_EXISTING_HEAD','MessagePreviewDocumentProbe'],
  ['local document handshake','MessagePreviewsPlugin','boolean ready = keys(call) && localDocument();',
    'boolean ready = keys(call);','remote-context','NO_NONLOCAL_OR_WRONG_SHAPE_CONTEXT','MessagePreviewDocumentProbe'],
  ['exact handshake shape','MessagePreviewsPlugin','boolean ready = keys(call) && localDocument();',
    'boolean ready = localDocument();','context-extra-keys','NO_NONLOCAL_OR_WRONG_SHAPE_CONTEXT','MessagePreviewDocumentProbe'],
  ['stale nonce still refused','MessagePreviewsPlugin','documentId.equals(call.getString("documentId"))',
    'true','old-clear','OLD_DOCUMENT_CANNOT_CLEAR_NEW_SESSION','MessagePreviewDocumentProbe'],
])test('Session/Document literal omission: '+name,()=>{
  const source=readFileSync(join(java,subject+'.java'),'utf8').replaceAll('\r\n','\n');
  assert.equal(source.split(before).length,2,'one actual-source guard');
  const path=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try{compile(path,{[subject]:source.replace(before,after)});const result=run(scenario,path,probe);
    assert.equal(result.error,undefined);assert.equal(result.status,1,'compiled behavioral failure, not setup/timeout');
    assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'FAIL '+oracle);
  }finally{clean(path);}
});
