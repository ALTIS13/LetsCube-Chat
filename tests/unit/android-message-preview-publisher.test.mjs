import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve, sep} from 'node:path';
import test from 'node:test';
import {nativeChatStubs} from '../android/native-chat-stubs.fixture.mjs';

const root=resolve(import.meta.dirname,'../..'), native=join(root,'android/app/src/main/java/com/kub/messenger');
const publisher='ChatMessagePreviewPublisher.java';
const files=['ChatNotificationCleanup.java','ChatNotificationIntentStore.java','ChatNotificationsPlugin.java',
  'ChatPushNotifications.java','ChatPushNotificationContract.java','MessagePreviewContent.java',publisher];
const sources=Object.fromEntries(files.filter(file=>existsSync(join(native,file)))
  .map(file=>[file,readFileSync(join(native,file),'utf8').replaceAll('\r\n','\n')]));
const home=process.env.CHAT_PUSH_TEST_JDK??process.env.JAVA_HOME
  ??(process.platform==='win32'?'C:/Program Files/Android/Android Studio/jbr':null);
const binary=name=>home?resolve(home,'bin',name+(process.platform==='win32'?'.exe':'')):name;
let directory;
function compile(target,changed={},omitted=false){
  const paths=[];
  for(const [file,source] of Object.entries(nativeChatStubs)){
    const path=join(target,'src',file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,source);paths.push(path);
  }
  for(const [file,source] of Object.entries({...sources,...changed})){
    if(omitted&&file===publisher)continue;
    const path=join(target,'src/com/kub/messenger',file);writeFileSync(path,source);paths.push(path);
  }
  paths.push(join(root,'tests/android/ChatMessagePreviewPublisherProbe.java'));
  const result=spawnSync(binary('javac'),['-encoding','UTF-8','-d',target,...paths],{encoding:'utf8',timeout:30000});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
}
function run(scenario,target=directory){
  const result=spawnSync(binary('java'),['-cp',target,'com.kub.messenger.ChatMessagePreviewPublisherProbe',scenario],{encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined);return result;
}
function clean(target){
  const actual=realpathSync(target);assert.ok(actual.startsWith(realpathSync(tmpdir())+sep)&&actual===resolve(target));
  rmSync(actual,{recursive:true});
}
test.before(()=>{directory=mkdtempSync(join(tmpdir(),'letscube-publisher-'));compile(directory);});
test.after(()=>{if(directory)clean(directory);});
for(const scenario of ['message','sender','api24','identity','recipient','notification','chat','message-id','missing','duplicate','unknown',
  'unavailable','foreign','retired','retire-snapshot','replaced','read','retire-build','read-build','replace-build','dismiss-build',
  'route-build','when-build','channel-build','expired','expire-build','rollback-build','final-clock','future','unknown-level','null-content','null-owner',
  'null-card','null-manager','null-context','null-clock','bad-clock','overflow-clock','clock-error','no-route','no-icon','no-extras','legacy','summary','api23','unknown-notify']){
  test('compiled native preview publisher: '+scenario,()=>{
    const result=run(scenario);assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
    assert.equal(result.stdout.trim(),'PASS '+scenario);
  });
}

test('compiled entry omission is a behavioral refusal, not a javac failure',()=>{
  const target=mkdtempSync(join(tmpdir(),'letscube-publisher-absent-'));
  try{
    compile(target,{},true);const result=run('message',target);
    assert.equal(result.status,1);assert.match(result.stderr,/java.lang.AssertionError: NATIVE_CARD_PUBLISHER_ENTRY_REQUIRED/);
  }finally{clean(target);}
});

const omissions=[
  ['!content.recipient.equals(owner.ownerId)','false','recipient','REJECTED_WITHOUT_REPOST'],
  ['!content.notification.equals(expected.notificationId)','false','notification','REJECTED_WITHOUT_REPOST'],
  ['!content.chat.equals(expected.chatId)','false','chat','REJECTED_WITHOUT_REPOST'],
  ['!content.message.equals(expected.messageId)','false','message-id','REJECTED_WITHOUT_REPOST'],
  ['.setOnlyAlertOnce(true)','.setOnlyAlertOnce(false)','message','PRIVATE_QUIET_UPDATE'],
  ['.setPublicVersion(publicVersion)','','message','GENERIC_PUBLIC_VERSION'],
  ['original.clone()','original','message','ORIGINAL_NOT_RECOVERED_IN_PLACE'],
  ['if (now < first || !fresh(content, now)) return;','if (false) return;','final-clock','REJECTED_WITHOUT_REPOST'],
  ['now < first || ','','rollback-build','REJECTED_WITHOUT_REPOST'],
  ['content.expiresAt - now <= 15_000','true','future','REJECTED_WITHOUT_REPOST'],
];
for(const [before,after,scenario,oracle] of omissions)test('compiled publisher omission control: '+scenario+' / '+oracle,()=>{
  assert.equal(sources[publisher]?.split(before).length,2,'one selected publisher rule');
  const target=mkdtempSync(join(tmpdir(),'letscube-publisher-mutant-'));
  try{
    compile(target,{[publisher]:sources[publisher].replace(before,after)});const result=run(scenario,target);
    assert.equal(result.status,1,'compiled behavioral failure, not setup/timeout');
    assert.match(result.stderr,new RegExp('java.lang.AssertionError: '+oracle));
  }finally{clean(target);}
});
