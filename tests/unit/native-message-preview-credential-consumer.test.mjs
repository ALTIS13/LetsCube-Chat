import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import test from 'node:test';

const root=resolve(import.meta.dirname,'../..'), javaRoot=join(root,'android/app/src/main/java/com/kub/messenger');
const source=join(javaRoot,'MessagePreviewCredentialEnvelope.java');
const bin=name=>join(process.env.MESSAGE_PREVIEW_TEST_JDK??'C:/Program Files/Android/Android Studio/jbr','bin',name+(process.platform==='win32'?'.exe':''));
const prefix='letscube-credential-consumer-';let classes;
function compile(directory,selected=source){
  const result=spawnSync(bin('javac'),['-encoding','UTF-8','-g:none','-d',directory,
    ...['MessagePreviewVerificationState','MessagePreviewVaultFence','MessagePreviewMetadataEnvelope'].map(name=>join(javaRoot,name+'.java')),
    selected,join(root,'tests/android/MessagePreviewCredentialEnvelopeProbe.java'),join(root,'tests/android/MessagePreviewCredentialConsumerProbe.java')],
    {encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:256*1024});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
}
function run(scenario,directory=classes){
  const result=spawnSync(bin('java'),['-cp',directory,'com.kub.messenger.MessagePreviewCredentialConsumerProbe',scenario],
    {encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:64*1024});
  assert.equal(result.error,undefined);return result;
}
function clean(directory){
  const actual=realpathSync(directory);assert.equal(actual,resolve(directory));assert.equal(dirname(actual),realpathSync(tmpdir()));
  assert.ok(basename(actual).startsWith(prefix));rmSync(actual,{recursive:true});
}
test.before(()=>{assert.equal(process.env.KUB_QA_ALLOW_MUTATIONS,'0');classes=mkdtempSync(join(tmpdir(),prefix));compile(classes);});
test.after(()=>{if(classes)clean(classes);});
const cases=['current','minimum','maximum','callback-throw','callback-error','borrower-write','repeat',
  'null-record','null-header','null-key','null-consumer','wrong-key','wrong-algorithm','short','oversize','iv','tag','ciphertext','domain','provider-tag','provider-iv',
  ...['installation','generation','kind','alias','expiry','wall','operation','base','revision'].map(field=>'header-'+field),
  ...['version','length','empty','oversize','control','high-byte','recipient','session','device','epoch','expiry','expiry-zero','expiry-header','trailing'].map(field=>'decode-'+field)];
for(const scenario of cases)test('actual JCA borrowed credential: '+scenario,()=>{
  const result=run(scenario);assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');assert.equal(result.stdout.trim(),'PASS '+scenario);
});

const omissions=[
  ['require(sameHeader(authenticatedRecord.header, expectedHeader));','','header-wall','CONSUMER_REFUSAL_REQUIRED'],
  ['require(input.getInt() == 1);','input.getInt();','decode-version','CONSUMER_REFUSAL_REQUIRED'],
  ['for (byte value : decodedAccess) require(value >= 33 && value <= 126);','','decode-control','CONSUMER_REFUSAL_REQUIRED'],
  ['require(uuid(value));','','decode-recipient','CONSUMER_REFUSAL_REQUIRED'],
  ['&& MessagePreviewVerificationState.safe(accountEpoch)','','decode-epoch','CONSUMER_REFUSAL_REQUIRED'],
  ['&& expiry == authenticatedRecord.header.expiresWallMillis','','decode-expiry-header','CONSUMER_REFUSAL_REQUIRED'],
  ['clear(decodedAccess);','','current','BORROWED_ACCESS_SCRUBBED'],
  ['clear(plaintext); clear(aad); clear(iv); clear(decodedAccess);','clear(aad); clear(iv); clear(decodedAccess);','current','DECRYPT_TEMPORARIES_SCRUBBED'],
  ['consumer.accept(owner, decodedAccess, expiry);',
    'try { consumer.accept(owner, decodedAccess, expiry); } catch (RuntimeException refused) { throw new Unavailable(); }',
    'callback-throw','CALLBACK_NOT_MISLABELLED_UNAVAILABLE'],
];
for(const [before,after,scenario,oracle] of omissions)test('compiled credential consumer omission: '+scenario+' / '+oracle,()=>{
  const original=readFileSync(source,'utf8');assert.equal(original.split(before).length,2,'one selected literal');
  const directory=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try{
    const selected=join(directory,'MessagePreviewCredentialEnvelope.java');writeFileSync(selected,original.replace(before,after));compile(directory,selected);
    const result=run(scenario,directory);assert.equal(result.status,1,'compiled behavioral failure, not setup/timeout');
    assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'FAIL '+oracle);
  }finally{clean(directory);}
});
