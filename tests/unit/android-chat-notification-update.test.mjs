import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,realpathSync} from 'node:fs';
import {join,dirname,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
const root=resolve(import.meta.dirname,'../..');
const source=readFileSync(join(root,'android/app/src/main/java/com/kub/messenger/ChatNotificationCleanup.java'),'utf8');
const home=process.env.CHAT_PUSH_TEST_JDK??process.env.JAVA_HOME
  ??(process.platform==='win32'?'C:/Program Files/Android/Android Studio/jbr':null);
const binary=name=>home?resolve(home,'bin',name+(process.platform==='win32'?'.exe':'')):name;
let directory;
function compile(target,text){
  const file=join(target,'src/com/kub/messenger/ChatNotificationCleanup.java');mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);
  const result=spawnSync(binary('javac'),['-encoding','UTF-8','-d',target,file,join(root,'tests/android/ChatNotificationUpdateProbe.java')],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);
}
function cleanup(target){const actual=realpathSync(target);assert.ok(actual.startsWith(realpathSync(tmpdir())+sep)&&actual===resolve(target));rmSync(actual,{recursive:true});}
test.before(()=>{directory=mkdtempSync(join(tmpdir(),'letscube-current-card-'));compile(directory,source);});
test.after(()=>{if(directory)cleanup(directory);});
for(const name of ['current','durable-missing','durable-different','durable-generation','replaced','lagging-generation','dismissed','duplicate','retired','retire-snapshot','read','queued-read','read-failure','new-after-read','wrong-message','legacy','summary','unknown-effect'])test('actual current-card publication: '+name,()=>{
  const result=spawnSync(binary('java'),['-cp',directory,'com.kub.messenger.ChatNotificationUpdateProbe',name],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'PASS '+name);
});
for(const [before,after,scenario] of [
  ['current.previewRetired = true;','current.previewRetired = false;','read'],
  ['|| current == null || current.previewRetired','|| current == null','queued-read'],
  [' || !matchesPosted(expectedCard, durable)','', 'durable-missing'],
  ['if (matches != 1 || owner != expected ||','if (matches != 1 ||','retire-snapshot'],
  ['if (matches != 1 || owner != expected ||','if (owner != expected ||','dismissed'],
  ['card.generation != expectedCard.generation','false','lagging-generation'],
])test('compiled omission control: '+scenario,()=>{
  assert.equal(source.split(before).length,2);
  const target=mkdtempSync(join(tmpdir(),'letscube-current-card-mutant-'));
  try{
    compile(target,source.replace(before,after));
    const result=spawnSync(binary('java'),['-cp',target,'com.kub.messenger.ChatNotificationUpdateProbe',scenario],{encoding:'utf8',timeout:10000});
    assert.equal(result.status,1,'COMPILED_BEHAVIORAL_FAILURE');
    assert.match(result.stderr,/^Exception in thread "main" java.lang.AssertionError: STALE_OR_READ_CARD_NOT_UPDATED/);
  }finally{cleanup(target);}
});
