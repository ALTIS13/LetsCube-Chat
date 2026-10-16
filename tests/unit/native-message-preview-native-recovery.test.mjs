import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import test from 'node:test';
import {provisioningStubs} from '../android/message-preview-vault-provisioning.fixture.mjs';
const root=resolve(import.meta.dirname,'../..'),java=join(root,'android/app/src/main/java/com/kub/messenger');
const prefix='letscube-native-recovery-',bin=n=>join(process.env.LETSCUBE_TEST_JAVA_BIN??'C:/Program Files/Android/Android Studio/jbr/bin',n+(process.platform==='win32'?'.exe':''));
const names=['VerificationState','VaultFence','MetadataEnvelope','JournalIO','InstallationMarker','InitializationGate',
  'OwnedKeyInventory','KeystoreReader','AtomicBackend','CredentialEnvelope','CredentialKeyCustody','PristineInitializer','VaultProvisioning','ExistingVault'];
const sources=Object.fromEntries(names.map(n=>['MessagePreview'+n+'.java',readFileSync(join(java,'MessagePreview'+n+'.java'),'utf8').replaceAll('\r\n','\n')]));
let classes;
function clean(path){const p=realpathSync(path);assert.equal(p,resolve(path));assert.equal(dirname(p),realpathSync(tmpdir()));assert.ok(basename(p).startsWith(prefix));rmSync(p,{recursive:true});}
function compile(path,changes={}){
  const files=Object.entries(provisioningStubs).map(([n,text])=>{const p=join(path,'stubs',n);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text);return p;});
  for(const [name,text] of Object.entries({...sources,...changes})){const p=join(path,name);writeFileSync(p,text);files.push(p);}
  const probes=['MessagePreviewExistingVaultProbe','MessagePreviewVaultAdoptionProbe','MessagePreviewNativeRecoveryProbe'].map(n=>join(root,'tests/android',n+'.java'));
  const result=spawnSync(bin('javac'),['-encoding','UTF-8','-g:none','-d',path,...files,...probes],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:262144});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
}
function run(scenario,path=classes){const files=mkdtempSync(join(tmpdir(),prefix+'files-'));
  try{const r=spawnSync(bin('java'),['-cp',path,'com.kub.messenger.MessagePreviewNativeRecoveryProbe',scenario,files],{encoding:'utf8',windowsHide:true,timeout:12000});assert.equal(r.error,undefined);return r;}finally{clean(files);}}
test.before(()=>{classes=mkdtempSync(join(tmpdir(),prefix+'classes-'));compile(classes);});
test.after(()=>{if(classes)clean(classes);});
for(const scenario of ['pending','retiring','pending-load','retiring-load','legacy-pending','legacy-retiring','metadata-missing','all-keys-missing',
  'corrupt','missing-marker','unknown-namespace','reader-identity','stale-head','metadata-lost-after-load','retiring-no-key','retiring-empty-alias','committed','empty','owned-pending-replace'])
  test('compiled native recovery: '+scenario,()=>{const r=run(scenario);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');assert.equal(r.stdout.trim(),'PASS '+scenario);});

const owner='MessagePreviewPristineInitializer.java';
const mutations=[
  ['&& !(nativeSession && retirementKind(record.header.kind))','&& !retirementKind(record.header.kind)','legacy-pending','UNTRUSTED_OR_LEGACY_RAW_REFUSED'],
  ['&& !(nativeSession && retirementKind(record.header.kind))','&& true','pending','EXPLICIT_RAW_RETIRE_ONLY_ADOPTION'],
  ['? Status.LOADED_FOR_RETIREMENT : Status.LOADED_EXISTING','? Status.LOADED_EXISTING : Status.LOADED_EXISTING','pending','EXPLICIT_RAW_RETIRE_ONLY_ADOPTION'],
  ['kind == MessagePreviewMetadataEnvelope.Kind.PENDING || kind == MessagePreviewMetadataEnvelope.Kind.RETIRING','kind == MessagePreviewMetadataEnvelope.Kind.RETIRING','pending','EXPLICIT_RAW_RETIRE_ONLY_ADOPTION'],
  ['kind == MessagePreviewMetadataEnvelope.Kind.PENDING || kind == MessagePreviewMetadataEnvelope.Kind.RETIRING','kind == MessagePreviewMetadataEnvelope.Kind.PENDING','retiring','EXPLICIT_RAW_RETIRE_ONLY_ADOPTION'],
  ['|| (nativeSession && retirementKind(initialized.checkedHead.header.kind))','','pending','EXPLICIT_RAW_RETIREMENT_COMPLETES'],
  ['(nativeSession && initialized.acquisition == null\n                    && retirementKind(initialized.checkedHead.header.kind))','false','pending','RAW_HEAD_NO_BEGIN_ADMISSION'],
  ['nativeSession && initialized.acquisition == null\n                    && retirementKind(initialized.checkedHead.header.kind)','nativeSession && retirementKind(initialized.checkedHead.header.kind)','owned-pending-replace','OWNED_PENDING_CAN_REPLACE'],
  ['MessagePreviewMetadataEnvelope.Record finalRecord=reader.readAuthenticated();','MessagePreviewMetadataEnvelope.Record finalRecord=fresh;','reader-identity','UNTRUSTED_OR_LEGACY_RAW_REFUSED'],
  ['prepared.record.header.generation, prepared.record.header.vaultRevision);','0L, 0L);','pending','EXPLICIT_RAW_RETIRE_ONLY_ADOPTION'],
];
for(const [before,after,scenario,oracle] of mutations)test('compiled native recovery omission: '+oracle+' / '+scenario,()=>{
  assert.equal(sources[owner].split(before).length,2,'one selected actual-source rule');
  const out=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try{compile(out,{[owner]:sources[owner].replace(before,after)});const r=run(scenario,out);
    assert.equal(r.status,1,'compiled behavioral failure, not setup/timeout');assert.equal(r.stderr.trim(),'FAIL '+oracle);
  }finally{clean(out);}
});
