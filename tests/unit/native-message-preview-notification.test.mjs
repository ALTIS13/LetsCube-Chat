import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import test from 'node:test';
import {nativeChatStubs} from '../android/native-chat-stubs.fixture.mjs';
import {messagePreviewStubs} from '../android/message-preview-stubs.fixture.mjs';

const root=resolve(import.meta.dirname,'../..'), native=join(root,'android/app/src/main/java/com/kub/messenger');
const names=['MessagePreviewNotification','ChatNotificationCleanup','ChatNotificationIntentStore','ChatPushNotifications','ChatPushNotificationContract',
  'MessagePreviewContent','MessagePreviewContentLookup','MessagePreviewResponseParser','MessagePreviewHttpTransport',
  'MessagePreviewVerificationState','MessagePreviewVerificationRuntime','MessagePreviewMetadataEnvelope','MessagePreviewCredentialEnvelope','MessagePreviewVaultFence'];
const sources=Object.fromEntries(names.map(n=>[n+'.java',readFileSync(join(native,n+'.java'),'utf8').replaceAll('\r\n','\n')]));
const java=process.env.MESSAGE_PREVIEW_TEST_JDK??'C:/Program Files/Android/Android Studio/jbr';
const binary=n=>join(java,'bin',n+(process.platform==='win32'?'.exe':''));
const pkg='com/kub/messenger/';
const stubs={...nativeChatStubs,...Object.fromEntries(Object.entries(messagePreviewStubs).filter(([n])=>n.startsWith('org/json/')||n==='android/util/Base64.java'||n==='android/os/SystemClock.java')),
  [pkg+'MessagePreviewSession.java']:`package com.kub.messenger; final class MessagePreviewSession {
    static final Object CONTENT=new Object(); static boolean allowed=true; static final class ContentPermit{}
    static ContentPermit captureContent(){synchronized(CONTENT){return allowed?new ContentPermit():null;}}
    static boolean contentCurrent(ContentPermit p){synchronized(CONTENT){return p!=null&&allowed;}}
    static boolean publishContent(ContentPermit p,Runnable r){synchronized(CONTENT){if(!contentCurrent(p))return false;r.run();return true;}} }`,
  [pkg+'MessagePreviewExistingVault.java']:`package com.kub.messenger; import android.content.Context; final class MessagePreviewExistingVault {
    static MessagePreviewExistingVault open(Context c){MessagePreviewNotificationProbe.vaultReads++;if(MessagePreviewNotificationProbe.missing)throw new IllegalStateException();return new MessagePreviewExistingVault();}
    MessagePreviewMetadataEnvelope.Record readCommitted(long now){return MessagePreviewNotificationProbe.head;}
    boolean isCurrent(MessagePreviewMetadataEnvelope.Record r,long now){return MessagePreviewNotificationProbe.headCurrent&&r==MessagePreviewNotificationProbe.head&&now<r.header.expiresWallMillis;} }`,
  [pkg+'MessagePreviewChoiceStore.java']:`package com.kub.messenger; import android.content.Context; final class MessagePreviewChoiceStore {
    static final class Choice {final String level,publicKey;Choice(String l,String k){level=l;publicKey=k;}}
    MessagePreviewChoiceStore(Context c){} Choice read(MessagePreviewMetadataEnvelope.Record r){MessagePreviewNotificationProbe.choiceReads++;return new Choice(MessagePreviewNotificationProbe.level,MessagePreviewNotificationProbe.publicKey);}
    boolean isCurrent(MessagePreviewMetadataEnvelope.Record r,Choice c){return MessagePreviewNotificationProbe.choiceCurrent&&c.level.equals(MessagePreviewNotificationProbe.level)&&c.publicKey.equals(MessagePreviewNotificationProbe.publicKey);} }`,
  [pkg+'MessagePreviewKeystoreReader.java']:`package com.kub.messenger; import android.content.Context; import javax.crypto.SecretKey; final class MessagePreviewKeystoreReader {
    MessagePreviewKeystoreReader(Context c,String installation){if(!MessagePreviewNotificationProbe.INSTALL.equals(installation))throw new AssertionError("EXACT_INSTALLATION");}
    SecretKey loadCredential(String alias){if(MessagePreviewNotificationProbe.keyLoss)throw new IllegalStateException();if(!MessagePreviewNotificationProbe.ALIAS.equals(alias))throw new AssertionError("EXACT_CREDENTIAL_ALIAS");return MessagePreviewNotificationProbe.AES;} }`,
};
stubs[pkg+'VoiceCallRuntime.java']=stubs[pkg+'VoiceCallRuntime.java'].replace('return false;','return resumed;').replace('public static boolean','public static boolean resumed; public static boolean');
stubs['android/os/SystemClock.java']=stubs['android/os/SystemClock.java'].replace('public static long elapsedRealtime','public static long offset; public static long elapsedRealtime').replace('System.nanoTime()/1000000','System.nanoTime()/1000000+offset');
stubs['android/app/PendingIntent.java']=stubs['android/app/PendingIntent.java'].replace(
  'String key=n+":"+i.action+":"+i.data;', 'com.kub.messenger.MessagePreviewNotificationProbe.preparation(false); String key=n+":"+i.action+":"+i.data;');
stubs['android/os/Bundle.java']=stubs['android/os/Bundle.java'].replace('public void putLong(String k,long v){',
  'public void putLong(String k,long v){if(k.equals("letscube.cleanup.generation"))com.kub.messenger.MessagePreviewNotificationProbe.preparation(true);');
stubs['android/content/Context.java']=stubs['android/content/Context.java'].replace('public int checkSelfPermission','public static int permission; public int checkSelfPermission').replace('return 0;','return permission;');
stubs['android/app/NotificationManager.java']=stubs['android/app/NotificationManager.java']
  .replace('public int cancels;','public int cancels,posts; public boolean throwNotify,muted,enabled=true;')
  .replace('return true;','return enabled;').replace('return new NotificationChannel(s,s,3);','return new NotificationChannel(s,s,muted?0:3);')
  .replace('cards.put(t+":"+id,','posts++; if(throwNotify)throw new IllegalStateException();cards.put(t+":"+id,');
stubs['android/app/NotificationChannel.java']=stubs['android/app/NotificationChannel.java']
  .replace('private final String id;','private final String id;private final int importance;').replace('id=i;}','id=i;this.importance=importance;}').replace('return 3;','return importance;');
let directory;
function clean(out){const p=realpathSync(out);assert.ok(p.startsWith(realpathSync(tmpdir())+sep)&&p===resolve(out));rmSync(p,{recursive:true});}
function compile(out,changed={}){
  const paths=[];
  for(const [name,source] of Object.entries({...stubs,...Object.fromEntries(Object.entries({...sources,...changed}).map(([n,s])=>[pkg+n,s]))})){
    const p=join(out,'src',name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,source);paths.push(p);
  }
  paths.push(join(root,'tests/android/MessagePreviewNotificationProbe.java'));
  const r=spawnSync(binary('javac'),['-encoding','UTF-8','-d',out,...paths],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
}
function run(scenario,out=directory){const r=spawnSync(binary('java'),['-cp',out,'com.kub.messenger.MessagePreviewNotificationProbe',scenario],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(r.error,undefined);return r;}
test.before(()=>{directory=mkdtempSync(join(tmpdir(),'letscube-initial-receiver-'));compile(directory);});
test.after(()=>{if(directory)clean(directory);});
const scenarios=['message','sender','maxlevel','none','missing','no-permit','owner-open','bad-key','service-key','anon-key','access-owner','access-session','access-role',
  'expired-head','head-before','choice-before','head-late','choice-late','owner-late','owner-final','head-final','choice-final','expire-final','elapsed-expire-final',
  'receipt-deadline','receipt-spent','network-spent','elapsed-rollback','wall-rollback','empty','wrong-route','refused','read','replacement','durable-change','durable-fail','unknown-rich','unknown-generic','crypto-fail',
  'native-rich','native-api24','native-sender','native-missing','native-none','native-keyloss','native-read','native-replaced','native-unknown','native-durable','native-muted','native-disabled','native-resumed','native-expired','native-render-failure','native-render-expired',
  'native-render-read','native-render-replaced','native-render-owner','native-render-head','native-render-choice','native-no-permission','native-legacy',
  'held-storage','cards-deadline','cards-content-expired','native-pending-clock','native-pending-locks','native-generation-locks','native-legacy-pending-locks',
  'lock-order','unknown-final-generic'];
for(const scenario of scenarios)test('compiled initial receiver: '+scenario,()=>{
  const r=run(scenario);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');assert.equal(r.stdout.trim(),'PASS '+scenario);
});

const receiver='MessagePreviewNotification.java', push='ChatPushNotifications.java';
const mutations=[
  [receiver,'!ports.contentCurrent(permit) || ','','owner-open','REFUSAL_BEFORE_NETWORK'],
  [receiver,'!lease.current(effectiveWall)','false','head-before','RICH_POLICY_head-before'],
  [receiver,'attempt.ports.publishContent(attempt.permit,','MessagePreviewNotificationProbe.publishUnchecked(attempt.ports, attempt.permit,','head-final','RICH_POLICY_head-final'],
  [receiver,'contentExpiry <= effective','false','expire-final','RICH_POLICY_expire-final'],
  [receiver,'contentExpiry <= effective','contentExpiry <= w','elapsed-expire-final','RICH_POLICY_elapsed-expire-final'],
  [receiver,'Math.min(deadline, attempt.deadline)','deadline','receipt-deadline','ORIGINAL_RECEIPT_2S'],
  [receiver,'deadline = elapsed + 2_000','deadline = elapsed + 2_001','receipt-spent','RICH_POLICY_receipt-spent'],
  [receiver,'publicKey(ports, attempt.lease.publicKey())','true','service-key','RICH_POLICY_service-key'],
  [receiver,'!= expiry) return;','== -1) return;','access-owner','RICH_POLICY_access-owner'],
  [receiver,'attempt.reservation.generation(), attempt.lease.level()','attempt.reservation.generation(), "message"','maxlevel','RICH_POLICY_maxlevel'],
  [receiver,'return invoked[0] ? Result.UNKNOWN : null;','return null;','unknown-rich','UNKNOWN_NEVER_RETRIED'],
  [receiver,'("sender".equals(attempt.lease.level()) || "message".equals(attempt.lease.level()))','true','none','NO_DECRYPT_WITHOUT_CHOICE'],
  [push,'result == MessagePreviewNotification.Result.UNTRACKED','result != MessagePreviewNotification.Result.PUBLISHED','native-read','NATIVE_NOTIFY_ONCE'],
  [push,'.setPublicVersion(publicVersion)','','native-rich','GENERIC_PUBLIC_VERSION'],
  [push,'"bot_id", "kub_message_type"','"bot_id", "sender_name", "preview", "sender_avatar_url", "kub_message_type"','native-missing','NO_PROVIDER_PII_INTENT'],
  [push,'recoverBuilder(context, generic.clone())','recoverBuilder(context, generic)','native-rich','GENERIC_PUBLIC_VERSION'],
  [receiver,'attempt.memoryFresh(attempt.ports.wallTime(), attempt.ports.elapsedTime(), content.expiresAt)',
    'true','cards-deadline','FINAL_CARDS_WAIT_CANNOT_POST_STALE_RICH'],
  [receiver,'attempt.memoryFresh(attempt.ports.wallTime(), attempt.ports.elapsedTime(), content.expiresAt)',
    'MessagePreviewNotificationProbe.storageCurrent(attempt.lease, attempt.effectiveWall) && attempt.memoryFresh(attempt.ports.wallTime(), attempt.ports.elapsedTime(), content.expiresAt)',
    'held-storage','HELD_STORAGE_BLOCKS_AUTH'],
  [push,'initial.contentIntent = PendingIntent.getActivity(context, event.chatId.hashCode(), intent,\n                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);\n            if (generation > 0) initial.extras.putLong(ChatNotificationCleanup.EXTRA_GENERATION, generation);\n            return () -> manager.notify(event.tag, 0, initial);',
    'return () -> { initial.contentIntent = PendingIntent.getActivity(context, event.chatId.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT); if (generation > 0) initial.extras.putLong(ChatNotificationCleanup.EXTRA_GENERATION, generation); manager.notify(event.tag, 0, initial); };',
    'native-pending-clock','NATIVE_RICH_INITIAL'],
  [push,'if (generation > 0) initial.extras.putLong(ChatNotificationCleanup.EXTRA_GENERATION, generation);\n            return () -> manager.notify(event.tag, 0, initial);',
    'return () -> { if (generation > 0) initial.extras.putLong(ChatNotificationCleanup.EXTRA_GENERATION, generation); manager.notify(event.tag, 0, initial); };',
    'native-generation-locks','GENERATION_PREPARED_OUTSIDE_LOCKS'],
  [push,'Runnable prepared = posting.prepare(0, null);\n            untracked = !ChatNotificationCleanup.post(intents, event.tag, null, event.messageId,\n                generation -> prepared.run());',
    'untracked = !ChatNotificationCleanup.post(intents, event.tag, null, event.messageId, generation -> posting.prepare(generation, null).run());',
    'native-legacy-pending-locks','PENDING_INTENT_OUTSIDE_LOCKS'],
];
for(const [file,before,after,scenario,oracle] of mutations)test('compiled initial receiver omission: '+oracle+' / '+scenario,()=>{
  assert.equal(sources[file].split(before).length,file===push&&before.includes('recoverBuilder')?3:2,'exact selected source rule');
  const out=mkdtempSync(join(tmpdir(),'letscube-initial-mutant-'));
  try{
    compile(out,{[file]:sources[file].replaceAll(before,after)});const r=run(scenario,out);
    assert.equal(r.status,1,'compiled behavioral failure, not setup or timeout');
    assert.equal(r.stderr.split(/\r?\n/)[0],`Exception in thread "main" java.lang.AssertionError: ${oracle}`);
  }finally{clean(out);}
});
