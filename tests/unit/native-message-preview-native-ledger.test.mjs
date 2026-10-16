import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import test from 'node:test';
import {provisioningStubs} from '../android/message-preview-vault-provisioning.fixture.mjs';
const root=resolve(import.meta.dirname,'../..'),java=join(root,'android/app/src/main/java/com/kub/messenger');
const prefix='letscube-native-ledger-',bin=n=>join(process.env.LETSCUBE_TEST_JAVA_BIN??'C:/Program Files/Android/Android Studio/jbr/bin',n+(process.platform==='win32'?'.exe':''));
const names=['VerificationState','VaultFence','MetadataEnvelope','JournalIO','InstallationMarker','InitializationGate',
  'OwnedKeyInventory','KeystoreReader','AtomicBackend','CredentialEnvelope','CredentialKeyCustody','PristineInitializer','VaultProvisioning','ExistingVault'];
const sources=Object.fromEntries(names.map(n=>['MessagePreview'+n+'.java',readFileSync(join(java,'MessagePreview'+n+'.java'),'utf8').replaceAll('\r\n','\n')]));
let classes;
function clean(path){const p=realpathSync(path);assert.equal(p,resolve(path));assert.equal(dirname(p),realpathSync(tmpdir()));assert.ok(basename(p).startsWith(prefix));rmSync(p,{recursive:true});}
function compile(path,changes={}){
  const files=Object.entries(provisioningStubs).map(([n,text])=>{const p=join(path,'stubs',n);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text);return p;});
  for(const [name,text] of Object.entries({...sources,...changes})){const p=join(path,name);writeFileSync(p,text);files.push(p);}
  const probes=['MessagePreviewExistingVaultProbe','MessagePreviewVaultAdoptionProbe','MessagePreviewNativeLedgerProbe'].map(n=>join(root,'tests/android',n+'.java'));
  const r=spawnSync(bin('javac'),['-encoding','UTF-8','-g:none','-d',path,...files,...probes],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:262144});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
}
function run(scenario,path=classes){const files=mkdtempSync(join(tmpdir(),prefix+'files-'));
  try{const r=spawnSync(bin('java'),['-cp',path,'com.kub.messenger.MessagePreviewNativeLedgerProbe',scenario,files],{encoding:'utf8',windowsHide:true,timeout:12000});assert.equal(r.error,undefined);return r;}finally{clean(files);}}
test.before(()=>{classes=mkdtempSync(join(tmpdir(),prefix+'classes-'));compile(classes);});
test.after(()=>{if(classes)clean(classes);});
for(const scenario of ['legacy','construct','many','ids','replay','collision','correlation','refused','bounds','pinned-headroom','pinned-headroom-skip',
  'owner-mode','owner-legacy','owner-generator','owner-two','owner-refused','owner-collision','owner-rejections','owner-invalid-owner'])test('compiled native ledger: '+scenario,()=>{
  const r=run(scenario);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');assert.equal(r.stdout.trim(),'PASS '+scenario);
});

const fence='MessagePreviewVaultFence.java',owner='MessagePreviewPristineInitializer.java';
const mutations=[
  [fence,'nativePrefix != null && !operationId.equals(nativeOperationId(nativePrefix, nextRevision))','false','ids','NATIVE_INVALID_ID_REFUSED'],
  [fence,'nextRevision <= vaultRevision','false','replay','NATIVE_INVALID_ID_REFUSED'],
  [fence,'if (initialGeneration > 0) seenIds.add(durableOperationId);','if (false) seenIds.add(durableOperationId);','collision','NATIVE_INVALID_ID_REFUSED'],
  [fence,'if (nativePrefix == null) seenIds.add(operationId);','seenIds.add(operationId);','many','NATIVE_CONSTANT_MEMORY'],
  [fence,'if (seenIds.size() >= MAX_OPERATIONS - (kind == Kind.RETIRE ? 0 : 1)) return rejected(Decision.EXHAUSTED);','','legacy','LEGACY_ERASURE_SLOT'],
  [fence,'installationPrefix.matches("[0-9a-f]{16}")','installationPrefix.matches("[0-9a-fA-F]{16}")','construct','EXACT_NATIVE_PREFIX'],
  [fence,'current.operationId.equals(lost.operationId)','true','correlation','NATIVE_CORRELATION_ID'],
  [fence,'current.vaultRevision == lost.vaultRevision','true','correlation','NATIVE_CORRELATION_REVISION'],
  [fence,'current.baseGeneration == expectedGeneration','true','correlation','NATIVE_CORRELATION_BASE'],
  [fence,'operation.completed = true;','operation.completed = false;','many','NATIVE_ONE_USE_COMPLETION'],
  [fence,'if (generation == 9007199254740991L) return rejected(Decision.EXHAUSTED);','','bounds','NATIVE_GENERATION_EXHAUSTION'],
  [fence,'if (kind != Kind.RETIRE && generation == 9007199254740990L) return rejected(Decision.EXHAUSTED);','','bounds','NATIVE_BEGIN_HEADROOM'],
  [fence,'if (kind != Kind.RETIRE && nextRevision == 9007199254740991L) return rejected(Decision.EXHAUSTED);','','bounds','NATIVE_REVISION_HEADROOM'],
  [fence,'if (kind != Kind.RETIRE && nativePrefix != null && nextRevision == 9007199254740990L\n            && seenIds.contains(nativeOperationId(nativePrefix, 9007199254740991L))) return rejected(Decision.EXHAUSTED);',
    '','pinned-headroom','NATIVE_PINNED_REVISION_HEADROOM'],
  [owner,'registered.nativeSession != nativeSession','false','owner-mode','REGISTERED_MODE_MUST_MATCH'],
  [owner,'nativeSession && !operationId.equals(MessagePreviewVaultFence.nativeOperationId(\n                    initialized.installation.substring(0,16), vaultRevision))',
    'false','owner-refused','BAD_ID_BEFORE_CONTEXT_BIND'],
  [owner,'if (!state.nativeSession) state.acceptedOperations.add(operation.operationId);','state.acceptedOperations.add(operation.operationId);','owner-two','OWNER_CONSTANT_MEMORY'],
  [owner,'state.acceptedVaultRevision=operation.vaultRevision;','state.acceptedVaultRevision=state.acceptedVaultRevision;','owner-two','RESERVED_FLOOR_NOT_REUSED'],
  [owner,'queueAcquiring(new AcquiringTask(initialized, target, true, false, null, completion, program.deadline)); return true;',
    'queueAcquiring(new AcquiringTask(initialized, target, true, false, null, completion, program.deadline)); return false;','owner-two','ACTUAL_BEGIN_ADMITTED'],
  [owner,'if (completion == null) return false;','if (completion == null) return true;','owner-refused','NULL_CALLBACK_NOT_ADMITTED'],
  [owner,'return id != null && !initialized.acceptedOperations.contains(id) ? id : null;','return id;','owner-collision','OWNER_DURABLE_COLLISION_PIN'],
];
for(const [file,before,after,scenario,oracle] of mutations)test('compiled native ledger omission: '+oracle,()=>{
  assert.equal(sources[file].split(before).length,2,'one literal selected rule');
  const out=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try{compile(out,{[file]:sources[file].replace(before,after)});const r=run(scenario,out);
    assert.equal(r.status,1,'compiled behavioral assertion, not setup/timeout');assert.equal(r.stderr.trim(),'FAIL '+oracle);
  }finally{clean(out);}
});
