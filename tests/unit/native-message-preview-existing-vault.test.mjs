import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join, dirname, basename} from 'node:path';
import test from 'node:test';
import {markerIOStubs} from '../android/message-preview-marker-io-stubs.fixture.mjs';

const root = resolve(import.meta.dirname, '../..');
const java = resolve(root, 'android/app/src/main/java/com/kub/messenger');
const subject = join(java, 'MessagePreviewExistingVault.java');
const prefix = 'letscube-existing-vault-';
const bin = name => resolve('C:/Program Files/Android/Android Studio/jbr/bin', name + '.exe');
let classes;
function clean(path) {
  const actual = realpathSync(path);
  assert.equal(actual, resolve(path)); assert.equal(dirname(actual), realpathSync(tmpdir()));
  assert.ok(basename(actual).startsWith(prefix)); rmSync(actual, {recursive:true});
}
function compile(path, source = subject) {
  const stubs = {...markerIOStubs};
  stubs['android/content/Context.java'] = stubs['android/content/Context.java'].replace(
    'public abstract Object getSystemService(String name);',
    'public abstract Object getSystemService(String name);\n  public <T> T getSystemService(Class<T> kind) { return kind.cast(getSystemService(USER_SERVICE)); }');
  for (const name of ['KeyInfo','KeyProperties']) stubs['android/security/keystore/' + name + '.java'] =
    readFileSync(resolve(root,'tests/fixtures/native-message-preview-keystore-reader/android/security/keystore',name+'.java'),'utf8');
  const files = Object.entries(stubs).map(([name, text]) => {
    const target = join(path,'stubs',name); mkdirSync(dirname(target),{recursive:true}); writeFileSync(target,text); return target;
  });
  const result = spawnSync(bin('javac'), ['-encoding','UTF-8','-g:none','-d',path,...files,
    ...['VerificationState','MetadataEnvelope','JournalIO','InstallationMarker','InitializationGate','AtomicBackend','KeystoreReader']
      .map(name=>join(java,'MessagePreview'+name+'.java')),source,
    resolve(root,'tests/android/MessagePreviewExistingVaultProbe.java')],
    {encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:256*1024});
  assert.equal(result.error,undefined); assert.equal(result.status,0,result.stderr); assert.equal(result.stderr,'');
}
function run(scenario, path=classes) {
  const files = mkdtempSync(join(tmpdir(),prefix+'files-'));
  try { return spawnSync(bin('java'), ['-cp',path,'com.kub.messenger.MessagePreviewExistingVaultProbe',scenario,files],
    {encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:64*1024}); }
  finally { clean(files); }
}
function healthy(scenario, path=classes) {
  const result=run(scenario,path); assert.equal(result.error,undefined); assert.equal(result.status,0,result.stderr);
  assert.equal(result.stderr,''); assert.equal(result.stdout.trim(),'PASS '+scenario);
}
test.before(()=>{classes=mkdtempSync(join(tmpdir(),prefix+'classes-')); compile(classes);});
test.after(()=>{if(classes)clean(classes);});
const cases=['healthy','states','clock','metadata-key','corrupt','missing','marker-bounds','marker-mode','marker-owner',
  'namespace-mode','namespace-owner','root-owner','marker-type','namespace-type','descriptor','context','main-thread',
  'different-thread','marker-replaced','namespace-replaced','root-replaced','marker-changed','head-changed','ciphertext-changed','locked-during-read',
  'explicit-fd-close','read-failure','close-failure'];
for(const scenario of cases)test('compiled existing vault: '+scenario,()=>healthy(scenario));

const omissions=[
  ['read-only nofollow','OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW','OsConstants.O_RDONLY','healthy','READ_ONLY_NOFOLLOW'],
  ['expiry','now >= h.expiresWallMillis','false','clock','EXPIRY_REFUSED'],
  ['wall highwater','now < h.wallHighWaterMillis','false','clock','ROLLBACK_REFUSED'],
  ['marker mode','owned(marker, false, 0600)','owned(marker, false, -1)','marker-mode','MARKER_MODE',2],
  ['descriptor identity','same(markerBefore, Os.fstat(fd));','Os.fstat(fd);','descriptor','MARKER_DESCRIPTOR'],
  ['explicit fd close','Os.close(fd);','','explicit-fd-close','EXPLICIT_FD_CLOSE'],
  ['post-read context','current();\n            return record;','return record;','locked-during-read','LOCKED_POST_READ'],
  ['ciphertext equality','return Arrays.equals(left, right);','return true;','ciphertext-changed','CIPHERTEXT_CURRENT'],
];
for(const [name,before,after,scenario,oracle,sites=1] of omissions)test('compiled existing vault omission: '+name,()=>{
  healthy(scenario); const text=readFileSync(subject,'utf8'); assert.equal(text.split(before).length,sites+1,'EXACT_RULE_SITES');
  const path=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try {const source=join(path,'MessagePreviewExistingVault.java'); writeFileSync(source,text.replaceAll(before,after)); compile(path,source);
    const result=run(scenario,path); assert.equal(result.error,undefined); assert.equal(result.status,1); assert.equal(result.stdout,'');
    assert.equal(result.stderr.trim(),'FAIL '+oracle);}
  finally {clean(path);}
});
