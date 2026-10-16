import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join, dirname, basename} from 'node:path';
import {markerIOStubs} from '../android/message-preview-marker-io-stubs.fixture.mjs';

const root=resolve(import.meta.dirname,'../..'), java=join(root,'android/app/src/main/java/com/kub/messenger');
const subject=join(java,'MessagePreviewChoiceStore.java'), prefix='letscube-choice-store-';
const bin=n=>resolve('C:/Program Files/Android/Android Studio/jbr/bin',n+'.exe');
let classes;
function clean(path){const p=realpathSync(path);assert.equal(p,resolve(path));assert.equal(dirname(p),realpathSync(tmpdir()));
  assert.ok(basename(p).startsWith(prefix));rmSync(p,{recursive:true});}
function compile(path, source=subject){
  // Local-only overrides of shared read-only fixtures. These are NOT Android storage policy proof.
  const stubs={...markerIOStubs};
  stubs['android/content/Context.java']=stubs['android/content/Context.java'].replace('public abstract Object getSystemService(String name);',
    'public abstract Object getSystemService(String name); public <T> T getSystemService(Class<T> t){return t.cast(getSystemService(USER_SERVICE));}');
  for(const n of ['KeyInfo','KeyProperties'])stubs['android/security/keystore/'+n+'.java']=readFileSync(
    join(root,'tests/fixtures/native-message-preview-keystore-reader/android/security/keystore',n+'.java'),'utf8');
  stubs['android/util/AtomicFile.java']=`package android.util;
import java.io.*;import java.nio.file.*;
public final class AtomicFile {
  public static int starts,finishes,fails; public static boolean corruptReadback,failSync,lastClosed;public static Runnable afterRead,onFlush;public static byte[] readbackReplacement;
  private final File file;public AtomicFile(File file){this.file=file;}
  public FileInputStream openRead()throws FileNotFoundException{FileInputStream s=new FileInputStream(file);if(afterRead!=null)afterRead.run();return s;}
  public FileOutputStream startWrite()throws IOException{starts++;lastClosed=false;return new FileOutputStream(file.getPath()+".new"){
    public void flush()throws IOException{if(onFlush!=null)onFlush.run();if(failSync)throw new IOException("FIXTURE");super.flush();}
    public void close()throws IOException{lastClosed=true;super.close();}};}
  public void finishWrite(FileOutputStream s){finishes++;try{s.close();Files.move(Paths.get(file.getPath()+".new"),file.toPath(),StandardCopyOption.REPLACE_EXISTING);
    if(readbackReplacement!=null)Files.write(file.toPath(),readbackReplacement);
    if(corruptReadback){byte[] b=Files.readAllBytes(file.toPath());b[b.length-1]^=1;Files.write(file.toPath(),b);}}catch(IOException e){throw new IllegalStateException("FIXTURE");}}
  public void failWrite(FileOutputStream s){fails++;try{s.close();Files.deleteIfExists(Paths.get(file.getPath()+".new"));}catch(IOException e){throw new IllegalStateException("FIXTURE");}}
}`;
  const files=Object.entries(stubs).map(([name,text])=>{const p=join(path,'stubs',name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text);return p;});
  const r=spawnSync(bin('javac'),['-encoding','UTF-8','-g:none','-d',path,...files,
    ...['VerificationState','MetadataEnvelope','JournalIO','KeystoreReader'].map(n=>join(java,'MessagePreview'+n+'.java')),
    ...(existsSync(source)?[source]:[]),join(root,'tests/android/MessagePreviewChoiceStoreProbe.java')],
    {encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:262144});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');
}
function run(name,path=classes){const files=mkdtempSync(join(tmpdir(),prefix+'files-'));try{return spawnSync(bin('java'),
  ['-cp',path,'com.kub.messenger.MessagePreviewChoiceStoreProbe',name,files],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536});}finally{clean(files);}}
function healthy(name,path=classes){const r=run(name,path);assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');assert.equal(r.stdout.trim(),'PASS '+name);}
test.before(()=>{classes=mkdtempSync(join(tmpdir(),prefix+'classes-'));compile(classes);});
test.after(()=>{if(classes)clean(classes);});
for(const name of ['healthy','missing','revisions','new-head','header-generation','header-revision','header-alias','header-expiry',
  'header-wall','header-operation','header-installation','invalid','corrupt','purpose','trailing','keyloss','main','context',
  'namespace','path','symlink','readback','post-read-lock','failure','post-write-lock','payload-valid','noncommitted','thread',
  'concurrent-read','concurrent-write','concurrent-guard','guard-refusal'])test('compiled choice store: '+name,()=>healthy(name));

const omissions=[
  ['shared file lock','private static final Object FILE_LOCK = new Object();','private final Object FILE_LOCK = new Object();','concurrent-read','SHARED_CHOICE_SERIALIZATION'],
  ['pre-write guard','beforeWrite.run();','','guard-refusal','PREWRITE_GUARD_REFUSES_WITHOUT_EFFECTS'],
  ['durable revision','if (revision <= floor) return false;','','revisions','DURABLE_MONOTONIC'],
  ['process rollback','require(choice.revision >= floor(expected.header));','','revisions','PROCESS_ROLLBACK_REFUSED'],
  ['head revision',' && a.vaultRevision == b.vaultRevision','','header-revision','FULL_HEADER_REVISION'],
  ['head alias','a.alias.equals(b.alias) && ','','header-alias','FULL_HEADER_ALIAS'],
  ['choice purpose','require(Arrays.equals(magic, PURPOSE));','','purpose','CHOICE_PURPOSE'],
  ['exact payload length','b.remaining() == length','b.remaining() >= length','trailing','EXACT_PAYLOAD_LENGTH'],
  ['literal key maximum','publicKey.length() <= 4096','publicKey.length() <= 4097','invalid','REFUSAL_NO_WRITE'],
  ['choice AAD','LETSCUBE-NMPV-CHOICE-v1','LETSCUBE-NMPV-META-v1','payload-valid','CHOICE_AAD_INTEROP'],
  ['ciphertext readback','!= MessagePreviewJournalIO.Result.CHECKED','== null','readback','CIPHERTEXT_READBACK'],
];
for(const [name,from,to,scenario,oracle]of omissions)test('compiled choice omission: '+name,()=>{
  const text=readFileSync(subject,'utf8');assert.equal(text.split(from).length,2,'EXACT_RULE_SITE');
  const path=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try{const source=join(path,'MessagePreviewChoiceStore.java');writeFileSync(source,text.replace(from,to));compile(path,source);
    const r=run(scenario,path);assert.equal(r.error,undefined);assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr.trim(),'FAIL '+oracle);
  }finally{clean(path);}
});
for(const [name,changes,scenario,oracle]of [
  ['guard after shared slot', [['                beforeWrite.run();',''],
    ['long revision, Runnable beforeWrite) {\n        synchronized (FILE_LOCK) {',
      'long revision, Runnable beforeWrite) {\n        try { beforeWrite.run(); } catch (Exception refused) { return false; }\n        synchronized (FILE_LOCK) {']], 'concurrent-guard','GUARD_AFTER_SHARED_SLOT'],
  ['head generation and linked base', [[' && a.generation == b.generation',''],[' && a.baseGeneration == b.baseGeneration','']], 'header-generation','FULL_HEADER_GENERATION'],
  ['both post-read context guards', [['current(); return choice;','return choice;'],['current(); remember(choice);','remember(choice);']], 'post-read-lock','POST_READ_CONTEXT'],
  ['failed write stream close', [['finally { active = null; closing.close(); }','finally { active = null; }']], 'post-write-lock','FAILED_WRITE_STREAM_CLOSED'],
])test('compiled choice omission: '+name,()=>{
  let text=readFileSync(subject,'utf8');
  for(const[from,to]of changes){assert.equal(text.split(from).length,2,'EXACT_RULE_SITE');text=text.replace(from,to);}
  const path=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try{const source=join(path,'MessagePreviewChoiceStore.java');writeFileSync(source,text);compile(path,source);
    const r=run(scenario,path);assert.equal(r.error,undefined);assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr.trim(),'FAIL '+oracle);
  }finally{clean(path);}
});
test('compiled choice omission: authenticated plaintext is not encrypted storage',()=>{
  let text=readFileSync(subject,'utf8');
  const changes=[['blob = encrypt(plain, key);','blob = plain.clone();'],
    ['plain = c.doFinal(blob, 12, blob.length - 12);','plain = blob.clone();']];
  for(const [from,to]of changes){assert.equal(text.split(from).length,2);text=text.replace(from,to);}
  const path=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try{const source=join(path,'MessagePreviewChoiceStore.java');writeFileSync(source,text);compile(path,source);
    const r=run('healthy',path);assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr.trim(),'FAIL ENCRYPTED_NOT_AUTH_ONLY');
  }finally{clean(path);}
});
