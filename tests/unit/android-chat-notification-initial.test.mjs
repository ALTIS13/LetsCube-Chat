import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,realpathSync} from 'node:fs';
import {join,dirname,basename,resolve} from 'node:path';
import {tmpdir} from 'node:os';

const root=resolve(import.meta.dirname,'../..');
const source=readFileSync(join(root,'android/app/src/main/java/com/kub/messenger/ChatNotificationCleanup.java'),'utf8');
const home=process.env.CHAT_PUSH_TEST_JDK??process.env.JAVA_HOME
  ??(process.platform==='win32'?'C:/Program Files/Android/Android Studio/jbr':null);
const binary=name=>home?resolve(home,'bin',name+(process.platform==='win32'?'.exe':'')):name;
const prefix='letscube-initial-card-';
let directory;
function compile(target,text){
  const file=join(target,'src/com/kub/messenger/ChatNotificationCleanup.java');
  mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);
  const result=spawnSync(binary('javac'),['-encoding','UTF-8','-g:none','-d',target,file,
    join(root,'tests/android/ChatNotificationInitialProbe.java')],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:256*1024});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
}
function cleanup(target){
  const actual=realpathSync(target);
  assert.equal(actual,resolve(target));assert.equal(dirname(actual),realpathSync(tmpdir()));
  assert.ok(basename(actual).startsWith(prefix));rmSync(actual,{recursive:true});
}
function run(scenario,target=directory){
  const result=spawnSync(binary('java'),['-cp',target,'com.kub.messenger.ChatNotificationInitialProbe',scenario],
    {encoding:'utf8',windowsHide:true,timeout:12000,maxBuffer:64*1024});
  assert.equal(result.error,undefined);return result;
}
function healthy(scenario,target=directory){
  const result=run(scenario,target);assert.equal(result.status,0,result.stderr);
  assert.equal(result.stderr,'');assert.equal(result.stdout.trim(),'PASS '+scenario);
}
test.before(()=>{directory=mkdtempSync(join(tmpdir(),prefix));compile(directory,source);});
test.after(()=>{if(directory)cleanup(directory);});
const cases=['current','cold-generation','exhausted','invalid','null','null-callback','exactly-once','exception','error','reentrant',
  'two-publishers','replacement-serialized','read-inflight','new-after-cancel','new-after-read','durable-highwater','store-read-exception',
  'cancel','replaced','legacy-replaced','durable-missing','durable-notification','durable-message','durable-generation',
  'write-refused','write-exception','queued-read','read-cancel-failure','unrelated-read','stale-owner-read'];
for(const scenario of cases)test('actual initial reservation: '+scenario,()=>healthy(scenario));

const omissions=[
  ['initial latch','reservation.closed = true;\n            posting.accept(reservation.intent.generation);',
    'posting.accept(reservation.intent.generation);','exactly-once','NO_LATE_UPGRADE'],
  ['fresh durable tuple','&& sameIntent(reservation.intent, durable)','', 'durable-missing','STALE_INITIAL_NOT_PUBLISHED'],
  ['exact latest reference','&& latestPosts.get(reservation.tag) == reservation.intent','', 'write-refused','STALE_INITIAL_NOT_PUBLISHED'],
  ['read retirement','&& !reservation.intent.previewRetired','', 'queued-read','STALE_INITIAL_NOT_PUBLISHED'],
  ['cancellation','if (reservation != null) reservation.closed = true;','if (reservation != null) { }','cancel','STALE_INITIAL_NOT_PUBLISHED'],
  ['durable write','if (!intents.write(tag, intent)) return null;','intents.write(tag, intent);','write-refused','DURABLE_WRITE_REQUIRED'],
  ['generation highwater','durable == null ? 0 : durable.generation','0','durable-highwater','FRESH_DURABLE_GENERATION'],
  ['publication lock','if (reservation == null || posting == null) return false;\n        synchronized (CARDS) {',
    'if (reservation == null || posting == null) return false;\n        {','replacement-serialized','INITIAL_PUBLICATION_SERIALIZES_REPLACEMENT'],
  ['unknown callback failure','posting.accept(reservation.intent.generation);',
    'try { posting.accept(reservation.intent.generation); } catch (RuntimeException ignored) { return false; }',
    'exception','UNKNOWN_EFFECT_NEVER_RETRIED'],
];
for(const [name,before,after,scenario,oracle] of omissions)test('compiled initial omission: '+name,()=>{
  healthy(scenario);assert.equal(source.split(before).length,2,'EXACT_ONE_RULE');
  const target=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try{
    compile(target,source.replace(before,after));const result=run(scenario,target);
    assert.equal(result.status,1,'COMPILED_BEHAVIORAL_FAILURE');assert.equal(result.stdout,'');
    assert.equal(result.stderr.trim(),'FAIL '+oracle);
  }finally{cleanup(target);}
});
