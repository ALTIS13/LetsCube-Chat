import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {ports} from '../fixtures/android-update-plugin/ports.mjs';
import {runtimePorts} from '../fixtures/android-update-plugin/runtime-ports.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const native = join(root, 'android/app/src/main/java/com/kub/messenger');
const fixtures = join(root, 'tests/fixtures/android-update');
const home = process.env.CHAT_PUSH_TEST_JDK ?? process.env.JAVA_HOME
  ?? (process.platform === 'win32' ? 'C:/Program Files/Android/Android Studio/jbr' : null);
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  ?? (process.platform === 'win32' ? 'D:/Progi/AndroidStudio-sdk' : null);
const android = join(sdk ?? '', 'platforms/android-36/android.jar');
const binary = name => home ? join(home, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
const outputs = [];
const leaves = {
  'android/os/Build.java': 'package android.os; public class Build {public static class VERSION {public static int SDK_INT=33;}}',
  'android/content/pm/Signature.java': 'package android.content.pm; public class Signature {private final byte[] b;public Signature(byte[] b){this.b=b;}public byte[] toByteArray(){return b;}}',
  'android/content/pm/SigningInfo.java': 'package android.content.pm; public class SigningInfo {private final Signature[] s;public SigningInfo(Signature[] s){this.s=s;}public Signature[] getApkContentsSigners(){return s;}}',
  'android/content/pm/PackageInfo.java': 'package android.content.pm; public class PackageInfo {public String packageName,versionName;public int versionCode;public SigningInfo signingInfo;public Signature[] signatures;public long getLongVersionCode(){return versionCode;}}',
};
function compile(mutate) {
  assert.ok(existsSync(android), 'reuse cached Android36 API, never skip');
  const output = mkdtempSync(join(tmpdir(), 'android-update-archive-')); outputs.push(output);
  const source = readFileSync(join(native, 'AndroidUpdateRuntime.java'), 'utf8');
  const changed = mutate ? mutate(source) : source;
  if (mutate) assert.notEqual(changed, source, 'mutation must hit actual Runtime');
  const files = [];
  for (const [name, content] of Object.entries({...ports, ...runtimePorts, ...leaves,
    'com/kub/messenger/AndroidUpdateRuntime.java': changed})) {
    const path = join(output, name); mkdirSync(dirname(path), {recursive:true}); writeFileSync(path, content); files.push(path);
  }
  const built = spawnSync(binary('javac'), ['-encoding','UTF-8','-cp',android,'-d',output,...files,
    join(native,'AndroidUpdatePolicy.java'),join(native,'AndroidUpdateRequest.java'),
    join(root,'tests/fixtures/android-update-plugin/Queues.java'),join(fixtures,'AndroidUpdateArchiveProbe.java')],
    {encoding:'utf8',timeout:30000});
  assert.equal(built.status,0,built.stderr); return output;
}
function run(output, scenario) {
  return spawnSync(binary('java'), ['-cp',[output,android].join(process.platform==='win32'?';':':'),
    'com.kub.messenger.AndroidUpdateArchiveProbe',scenario,join(fixtures,'public-release-signer.b64')],
    {encoding:'utf8',timeout:5000});
}
let output;
test.before(()=>{output=compile();});
test.after(()=>{for(const dir of outputs){assert.ok(realpathSync(dir).startsWith(realpathSync(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});}});
for(const scenario of ['oem','normal','legacy','missing-modern','multiple','foreign']) {
  test(`actual Runtime archive verification preserves ${scenario}`,()=>{
    const result=run(output,scenario);assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,new RegExp(`^PASS_ARCHIVE_IDENTITY ${scenario}\\s*$`));
  });
}
test('removing legacy collection flag rejects the measured valid OEM archive',()=>{
  const mutated=compile(s=>s.replace('PackageManager.GET_SIGNING_CERTIFICATES | PackageManager.GET_SIGNATURES','PackageManager.GET_SIGNING_CERTIFICATES'));
  const result=run(mutated,'oem');assert.notEqual(result.status,0);assert.match(result.stderr,/VALID_OEM_ARCHIVE_REFUSED/);
});
test('using legacy identity on modern Android cannot bypass the modern signer',()=>{
  const mutated=compile(s=>s.replace('info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()','info.signatures'));
  const result=run(mutated,'foreign');assert.notEqual(result.status,0);assert.match(result.stderr,/UNTRUSTED_ARCHIVE_ACCEPTED/);
});
