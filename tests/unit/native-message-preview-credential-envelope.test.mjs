import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
test('feature absence: inactive credential envelope leaf', () => {
  assert.ok(existsSync(resolve(root, 'android/app/src/main/java/com/kub/messenger/MessagePreviewCredentialEnvelope.java')),
    'FEATURE_ABSENCE: credential envelope not implemented; not a shipped regression');
});

const javaRoot = resolve(root,'android/app/src/main/java/com/kub/messenger');
const subject = join(javaRoot,'MessagePreviewCredentialEnvelope.java');
const probe = resolve(root,'tests/android/MessagePreviewCredentialEnvelopeProbe.java');
const bin = name => resolve('C:/Program Files/Android/Android Studio/jbr/bin',name+'.exe');
const prefix = 'letscube-credential-envelope-';
const dependencies = Object.freeze({
  MessagePreviewVerificationState:'0b16484c9fcdf57a7f944660a2689ce22ab20d4dfc36b8804a0a68713f3bd73b',
  MessagePreviewVaultFence:'0dfcc1664b9d513cb0e524a2eaade4fa595de5000429a2c6130bd59fe6ff853b',
  MessagePreviewMetadataEnvelope:'eb1b585e237bff3326b74185aeb1378e3082ea45f6e728fe917e74de3a2f416b',
});
let classes;
function pins() {
  for (const [name,pin] of Object.entries(dependencies)) assert.equal(
    createHash('sha256').update(readFileSync(join(javaRoot,name+'.java'))).digest('hex'),pin,'DEPENDENCY_PIN');
}
function clean(path) {
  const actual=realpathSync(path); assert.equal(actual,resolve(path)); assert.equal(dirname(actual),realpathSync(tmpdir()));
  assert.ok(basename(actual).startsWith(prefix)); rmSync(actual,{recursive:true});
}
function compile(directory, source=subject) {
  pins();
  const result=spawnSync(bin('javac'),['-encoding','UTF-8','-g:none','-d',directory,
    ...Object.keys(dependencies).map(name=>join(javaRoot,name+'.java')),source,probe],
    {encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:256*1024});
  assert.equal(result.error,undefined,'JVM_COMPILE_EXEC');
  assert.ok(result.status===0&&result.stderr===''&&result.stdout==='','JVM_COMPILE_METADATA_ONLY'); pins();
}
function run(scenario,directory=classes) {
  const result=spawnSync(bin('java'),['-cp',directory,'com.kub.messenger.MessagePreviewCredentialEnvelopeProbe',scenario],
    {encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:64*1024});
  assert.equal(result.error,undefined,'JVM_PROBE_EXEC'); return result;
}
function healthy(scenario,directory=classes) {
  const r=run(scenario,directory); assert.equal(r.status,0,r.stderr); assert.equal(r.stderr,''); assert.equal(r.stdout.trim(),'PASS '+scenario);
}
test.before(()=>{classes=mkdtempSync(join(tmpdir(),prefix+'classes-'));compile(classes);});
test.after(()=>{if(classes)clean(classes);pins();});
const cases = ['healthy','external','bounds','minimum','input-shapes','snapshots',
  ...['recipient','session','device','epoch','access','expiry'].map(v=>'match-'+v),
  ...['installation','generation','kind','alias','expiry','wall','operation','base','revision'].map(v=>'header-'+v),
  ...['iv','tag','ciphertext','domain','key','aad-installation','aad-generation','aad-alias','aad-expiry','aad-wall','aad-operation','aad-base','aad-revision'].map(v=>'tamper-'+v),
  ...['version','length','control','uuid','epoch','expiry','expiry-header','trailing'].map(v=>'decode-'+v),
  ...['access','empty','control','null','epoch','alias','overflow'].map(v=>'early-'+v),
  ...['iv','tag','clear'].map(v=>'provider-'+v)];
for(const scenario of cases)test('actual credential codec: '+scenario,()=>healthy(scenario));

// One rule may have two redundant comparison sites. Pair omission is explicitly one compiled rule mutant.
const mutations = [
  ...['recipient','session','device'].map(field=>[field+' comparison',[[`&& ${field}.equals(expectedOwner.${field})`,'']], 'match-'+field, 'MATCH_'+field.toUpperCase()]),
  ['accountEpoch comparison',[['&& accountEpoch == expectedOwner.accountEpoch','']], 'match-epoch','MATCH_EPOCH'],
  ['access comparison',[['&& MessageDigest.isEqual(decodedAccess, expected)','']], 'match-access','MATCH_ACCESS'],
  ['expiry comparison pair',[['&& a.expiresWallMillis == b.expiresWallMillis',''],['&& expiry == expectedExpiry','']], 'match-expiry','MATCH_EXPIRY'],
  ['AAD version literal',[['output.putInt(1); text(output, h.installation);','output.putInt(2); text(output, h.installation);']], 'external','EXTERNAL_AAD_AUTH'],
  ['AAD installation',[['text(output, h.installation);','text(output, "00000000000000000000000000000000");']], 'external','EXTERNAL_AAD_AUTH'],
  ['AAD generation',[['output.putLong(h.generation).put((byte) 2);','output.putLong(0).put((byte) 2);']], 'external','EXTERNAL_AAD_AUTH'],
  ['AAD kind literal',[['.put((byte) 2);','.put((byte) 0);']], 'external','EXTERNAL_AAD_AUTH'],
  ['AAD alias',[['text(output, h.alias);','text(output, ALIAS_PREFIX + h.installation + ".00000000000000000000000000000000");']], 'external','EXTERNAL_AAD_AUTH'],
  ['AAD expiry',[['output.putLong(h.expiresWallMillis)','output.putLong(0)']], 'external','EXTERNAL_AAD_AUTH'],
  ['AAD wall',[['.putLong(h.wallHighWaterMillis);','.putLong(0);']], 'external','EXTERNAL_AAD_AUTH'],
  ['AAD operation',[['text(output, h.operationId);','text(output, "00000000000000000000000000000000");']], 'external','EXTERNAL_AAD_AUTH'],
  ['AAD base',[['output.putLong(h.baseGeneration)','output.putLong(0)']], 'external','EXTERNAL_AAD_AUTH'],
  ['AAD revision',[['.putLong(h.vaultRevision);','.putLong(0);']], 'external','EXTERNAL_AAD_AUTH'],
  ['AAD domain',[['LETSCUBE-NMPV-CREDENTIAL-v1','LETSCUBE-NMPV-CREDENTIAL-v0']], 'external','EXTERNAL_AAD_AUTH'],
  ['authentication before success',[['plaintext = cipher.doFinal(blob, IV_BYTES, blob.length - IV_BYTES);',
    'if (blob.length > 0) return true;\n            plaintext = cipher.doFinal(blob, IV_BYTES, blob.length - IV_BYTES);']], 'tamper-tag','AUTHENTICATION_MUST_REFUSE'],
  ['access bound before crypto',[['&& access.length() <= MAX_ACCESS','']], 'early-access','EARLY_BOUND_BEFORE_PROVIDER'],
  ['nonempty access before crypto',[['&& access.length() > 0','']], 'early-empty','EARLY_INPUT_MUST_REFUSE'],
  ['provider IV validation',[['iv = cipher.getIV(); parameters(cipher, iv);','iv = cipher.getIV();']], 'provider-iv','PROVIDER_PARAMETERS_MUST_REFUSE'],
  ['provider-generated fresh IV',[['cipher.init(Cipher.ENCRYPT_MODE, suppliedCredentialKey);',
    'cipher.init(Cipher.ENCRYPT_MODE, suppliedCredentialKey, new GCMParameterSpec(128, new byte[12]));']], 'snapshots','FRESH_PROVIDER_IV'],
  ['provider tag128',[['spec.getTLen() == 128 && ','']], 'provider-tag','PROVIDER_PARAMETERS_MUST_REFUSE'],
  ['decoded version',[['require(input.getInt() == 1);','input.getInt();']], 'decode-version','DECODE_MUST_REFUSE'],
  ['decoded ASCII',[['for (byte value : decodedAccess) require(value >= 33 && value <= 126);','']], 'decode-control','DECODE_MUST_REFUSE'],
  ['decoded UUID',[['require(uuid(value));','']], 'decode-uuid','DECODE_MUST_REFUSE'],
  ['decoded epoch bound',[['&& MessagePreviewVerificationState.safe(accountEpoch)','']], 'decode-epoch','DECODE_MUST_REFUSE'],
  ['decoded expiry/header consistency',[['&& expiry == authenticatedRecord.header.expiresWallMillis','']], 'decode-expiry-header','DECODE_MUST_REFUSE'],
];
for(const [name,changes,scenario,oracle] of mutations)test('compiled credential omission: '+name,()=>{
  healthy(scenario);
  let text=readFileSync(subject,'utf8');
  for(const [before,after] of changes){assert.equal(text.split(before).length,2,'EXACT_ONE_LITERAL_SITE');text=text.replace(before,after);}
  const directory=mkdtempSync(join(tmpdir(),prefix+'mutant-'));
  try {
    const source=join(directory,'MessagePreviewCredentialEnvelope.java');writeFileSync(source,text);compile(directory,source);
    const result=run(scenario,directory);assert.equal(result.status,1,'runtime oracle, not compilation/setup/timeout');
    assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'FAIL '+oracle);
  } finally {clean(directory);}
});
