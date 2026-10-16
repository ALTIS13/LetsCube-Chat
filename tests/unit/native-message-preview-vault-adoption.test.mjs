import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import test from 'node:test';
import {provisioningStubs} from '../android/message-preview-vault-provisioning.fixture.mjs';
const root=resolve(import.meta.dirname,'../..'),java=join(root,'android/app/src/main/java/com/kub/messenger');
const prefix='letscube-vault-adoption-',bin=n=>join('C:/Program Files/Android/Android Studio/jbr/bin',n+'.exe');
let classes;
const names=['VerificationState','VaultFence','MetadataEnvelope','JournalIO','InstallationMarker','InitializationGate',
  'OwnedKeyInventory','KeystoreReader','AtomicBackend','CredentialEnvelope','CredentialKeyCustody','PristineInitializer','VaultProvisioning','ExistingVault'];
function clean(path){const a=realpathSync(path);assert.equal(a,resolve(path));assert.equal(dirname(a),realpathSync(tmpdir()));
  assert.ok(basename(a).startsWith(prefix));rmSync(a,{recursive:true});}
function compile(path,changes={}){
  const stubs={...provisioningStubs};
  if(!stubs['android/system/Os.java'].includes('public static int read('))stubs['android/system/Os.java']=stubs['android/system/Os.java'].replace(
    '  public static void fsync(',`  public static int read(java.io.FileDescriptor fd,byte[] b,int o,int n)throws android.system.ErrnoException {
      Handle h=handles.get(fd);if(h==null||h.file==null)throw new android.system.ErrnoException(13);
      try{int r=h.file.read(b,o,n);return r<0?0:r;}catch(java.io.IOException e){throw new android.system.ErrnoException(13);}
    }
    public static void fsync(`);
  const files=Object.entries(stubs).map(([name,text])=>{const p=join(path,'stubs',name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text);return p;});
  const sources=names.map(name=>{const n='MessagePreview'+name+'.java';if(!changes[n])return join(java,n);
    const p=join(path,n);writeFileSync(p,changes[n]);return p;});
  const r=spawnSync(bin('javac'),['-encoding','UTF-8','-g:none','-d',path,...files,...sources,
    join(root,'tests/android/MessagePreviewExistingVaultProbe.java'),join(root,'tests/android/MessagePreviewVaultAdoptionProbe.java')],
    {encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:262144});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
}
function run(scenario,path=classes){const files=mkdtempSync(join(tmpdir(),prefix+'files-'));
  try{return spawnSync(bin('java'),['-cp',path,'com.kub.messenger.MessagePreviewVaultAdoptionProbe',scenario,files],
    {encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536});}finally{clean(files);}}
test.before(()=>{classes=mkdtempSync(join(tmpdir(),prefix+'classes-'));compile(classes);});
test.after(()=>{if(classes)clean(classes);});
for(const scenario of ['healthy','empty','pending','retiring','key-loss','corrupt','missing','stale-revision','retire','repeat','replayed-id','marker-changed-load'])
  test('compiled existing owner adoption: '+scenario,()=>{const r=run(scenario);assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
    assert.equal(r.stderr,'');assert.equal(r.stdout.trim(),'PASS '+scenario);});
