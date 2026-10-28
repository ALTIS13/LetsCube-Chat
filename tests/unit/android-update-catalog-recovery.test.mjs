import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {ports} from '../fixtures/android-update-plugin/ports.mjs';
import {runtimePorts} from '../fixtures/android-update-plugin/runtime-ports.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),native=join(root,'android/app/src/main/java/com/kub/messenger');
const home=process.env.CHAT_PUSH_TEST_JDK??process.env.JAVA_HOME??'C:/Program Files/Android/Android Studio/jbr';
const sdk=process.env.ANDROID_HOME??process.env.ANDROID_SDK_ROOT??'D:/Progi/AndroidStudio-sdk';
const android=join(sdk,'platforms/android-36/android.jar');
const cached=join(homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
const jars=existsSync(cached)?readdirSync(cached,{recursive:true}).filter(p=>p.endsWith('json-20250517.jar')).map(p=>join(cached,p)):[];
assert.equal(jars.length,1,'reuse cached org.json, no installation');
const outputs=[],binary=n=>join(home,'bin',n+(process.platform==='win32'?'.exe':''));
const leaves={
 'android/os/SystemClock.java':'package android.os; public class SystemClock {public static long elapsedRealtime(){return System.nanoTime()/1000000L;}}',
 'android/content/pm/Signature.java':'package android.content.pm; public class Signature {private final byte[] b;public Signature(byte[] b){this.b=b;}public byte[] toByteArray(){return b;}}',
 'android/content/pm/SigningInfo.java':'package android.content.pm; public class SigningInfo {private final Signature[] s;public SigningInfo(Signature[] s){this.s=s;}public Signature[] getApkContentsSigners(){return s;}}',
 'android/content/pm/PackageInfo.java':'package android.content.pm; public class PackageInfo {public String packageName,versionName;public int versionCode;public SigningInfo signingInfo;public Signature[] signatures;public long getLongVersionCode(){return versionCode;}}',
};
function compile(mutate){
 const out=mkdtempSync(join(tmpdir(),'android-update-catalog-'));outputs.push(out);
 let source=readFileSync(join(native,'AndroidUpdateRuntime.java'),'utf8');if(mutate){const before=source;source=mutate(source);assert.notEqual(source,before);}
 const entries={...ports,...runtimePorts,...leaves,'com/kub/messenger/AndroidUpdateRuntime.java':source};delete entries['org/json/JSONObject.java'];
 const paths=[];for(const [name,content] of Object.entries(entries)){const path=join(out,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content);paths.push(path);}
 const cp=[jars[0],android].join(process.platform==='win32'?';':':');
 const built=spawnSync(binary('javac'),['-encoding','UTF-8','-cp',cp,'-d',out,...paths,join(native,'AndroidUpdatePolicy.java'),join(native,'AndroidUpdateRequest.java'),join(root,'tests/fixtures/android-update-plugin/Queues.java'),join(root,'tests/fixtures/android-update/AndroidUpdateCatalogRecoveryProbe.java')],{encoding:'utf8',timeout:30000});assert.equal(built.status,0,built.stderr);return out;
}
function run(out,scenario){return spawnSync(binary('java'),['-cp',[out,jars[0],android].join(process.platform==='win32'?';':':'),'com.kub.messenger.AndroidUpdateCatalogRecoveryProbe',scenario,join(root,'tests/fixtures/android-update/public-release-signer.b64')],{encoding:'utf8',timeout:7000});}
let output;test.before(()=>{output=compile();});
test.after(()=>{for(const out of outputs){assert.ok(realpathSync(out).startsWith(realpathSync(tmpdir())+sep));rmSync(out,{recursive:true,force:true});}});
for(const scenario of ['stale','withdrawn','unchanged','network','invalid-source','cancelled','superseded','delete-refused'])test(`actual Runtime catalog recovery: ${scenario}`,()=>{const r=run(output,scenario);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,new RegExp(`^PASS_CATALOG_RECOVERY ${scenario}\\s*$`));});
test('ignoring the fresh catalog revives installation of the obsolete ready APK',()=>{
 const mutated=compile(s=>s.replace('if (!expected.same(fresh)) {','if (false) {'));
 const r=run(mutated,'stale');assert.notEqual(r.status,0);assert.match(r.stderr,/STALE_READY_TRAPS_OLD_INSTALL/);
});
test('omitting the stale-catalog owner check destroys the successor download',()=>{
 const mutated=compile(s=>s.replace('if (!current(owner)) { refused.accept(status()); return; }','if (false) { refused.accept(status()); return; }'));
 const r=run(mutated,'superseded');assert.notEqual(r.status,0);assert.match(r.stderr,/OLD_CATALOG_CHANGED_NEW_OWNER/);
});
