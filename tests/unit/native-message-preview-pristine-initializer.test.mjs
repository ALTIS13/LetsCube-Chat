import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { initializerStubs } from "../android/message-preview-pristine-initializer-stubs.fixture.mjs";

const root=fileURLToPath(new URL("../../",import.meta.url));
const home=process.env.MESSAGE_PREVIEW_TEST_JDK ?? "C:/Program Files/Android/Android Studio/jbr";
const binary=name=>resolve(home,"bin",name+(process.platform === "win32" ? ".exe" : ""));
const base=resolve(root,"android/app/src/main/java/com/kub/messenger");
const source=join(base,"MessagePreviewPristineInitializer.java");
const backend=join(base,"MessagePreviewAtomicBackend.java");
const supporting=["MessagePreviewVerificationState","MessagePreviewVaultFence","MessagePreviewMetadataEnvelope","MessagePreviewJournalIO",
  "MessagePreviewInstallationMarker","MessagePreviewInitializationGate","MessagePreviewOwnedKeyInventory","MessagePreviewKeystoreReader"]
  .map(name=>join(base,name+".java"));
const prefix="letscube-pristine-init-";
let directory;
function clean(path) {
  const actual=realpathSync(path); assert.equal(actual,resolve(path));
  assert.equal(dirname(actual),realpathSync(tmpdir())); assert.ok(basename(actual).startsWith(prefix));
  rmSync(actual,{recursive:true});
}
function compile(path, ownerSource=source, backendSource=backend) {
  const stubs={...initializerStubs};
  for (const name of ["KeyInfo","KeyProperties"]) stubs[`android/security/keystore/${name}.java`]=readFileSync(
    resolve(root,"tests/fixtures/native-message-preview-keystore-reader/android/security/keystore",name+".java"),"utf8");
  const files=Object.entries(stubs).map(([name,text])=>{
    const file=join(path,"stubs",name); mkdirSync(dirname(file),{recursive:true}); writeFileSync(file,text); return file;
  });
  const result=spawnSync(binary("javac"),["-encoding","UTF-8","-g:none","-d",path,...files,...supporting,
    backendSource,ownerSource,resolve(root,"tests/android/MessagePreviewPristineInitializerProbe.java")],
  {encoding:"utf8",timeout:30_000,windowsHide:true});
  assert.equal(result.error,undefined); assert.equal(result.status,0,result.stderr); assert.equal(result.stderr,"");
}
function run(scenario,path=directory) {
  const files=mkdtempSync(join(tmpdir(),prefix+"files-"));
  try {
    const result=spawnSync(binary("java"),["-cp",path,"com.kub.messenger.MessagePreviewPristineInitializerProbe",scenario,files],
      {encoding:"utf8",timeout:15_000,maxBuffer:256*1024,windowsHide:true});
    assert.equal(result.error,undefined); return result;
  } finally { clean(files); }
}
test.before(()=>{
  assert.ok(existsSync(source),"FEATURE_ABSENCE: composed initializer missing; not shipped behavioral regression");
  directory=mkdtempSync(join(tmpdir(),prefix+"classes-")); compile(directory);
});
test.after(()=>{if(directory) clean(directory);});
for (const scenario of ["healthy","factory","initial-owned","late-before-init","late-before-generate",
  "held-generate","close-held","held-reader","held-journal","expired-return","locked-return","journal-failure","post-extra","post-marker",
  "alias-before-init","alias-before-generate","wrong-g0","marker-phases","held-final-context","close-final-context"]) {
  test(`compiled pristine initializer: ${scenario}`,()=>{
    const result=run(scenario); assert.equal(result.status,0,result.stderr); assert.equal(result.stderr,"");
    assert.equal(result.stdout.trim(),`PASS ${scenario}`);
  });
}

const finalHeaderGuard=`        if (!installation.equals(h.installation) || h.generation != 0 || h.kind != MessagePreviewMetadataEnvelope.Kind.EMPTY
            || !h.alias.isEmpty() || h.expiresWallMillis != 0 || h.wallHighWaterMillis != wall
            || !h.operationId.isEmpty() || h.baseGeneration != 0 || h.vaultRevision != 0
            || readback.credentialBytes().length != 0) throw new Unavailable();`;
const postChildrenGuard=`                if (children == null || children.length != 2
                    || !Arrays.asList(children).contains("installation-v1.bin")
                    || !Arrays.asList(children).contains("journal-v1.bin")) throw new MarkerUnavailable();`;
const mutations=[
  ["initial full inventory",source,"current(permit); store.load(null); current(permit);\n        cleanInventory(store, permit);",
    "current(permit); store.load(null); current(permit);","initial-owned","INVENTORY_BEFORE_RESERVATION"],
  ["late full prefix inventory",source,"current(permit); markers.requireCurrent(reservation);\n        cleanInventory(store, permit);",
    "current(permit); markers.requireCurrent(reservation);","late-before-generate","CURRENT_COMPOSITION_REFUSED"],
  ["exact alias absence",source,"if (store.containsAlias(alias)) throw new Unavailable();","","alias-before-generate","CURRENT_COMPOSITION_REFUSED"],
  ["AES256",source,".setKeySize(256)",".setKeySize(128)","healthy","EXACT_CREATION_POLICY"],
  ["literal G0 creation",source,'installation, 0, MessagePreviewMetadataEnvelope.Kind.EMPTY, "", 0, wall, "", 0, 0)',
    'installation, 1, MessagePreviewMetadataEnvelope.Kind.EMPTY, "", 0, wall, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 0, 0)',"healthy","ACTUAL_G0_REQUIRED"],
  ["retained sole owner",source,"if (registered != null)","if (false)","healthy","ONE_RETAINED_OWNER"],
  ["after generate currency",source,"generator.generateKey();\n        current(permit); markers.requireCurrent(reservation);",
    "generator.generateKey();","held-generate","NO_READER_AFTER_STALE_GENERATE"],
  ["after journal currency",source,"current(permit); markers.requireCurrentAfterInitialJournal(reservation);\n        MessagePreviewMetadataEnvelope.Record readback=",
    "MessagePreviewMetadataEnvelope.Record readback=","held-journal","NO_OWNER_READ_AFTER_STALE_WRITE"],
  ["final platform outside lock",source,"current(attempt.permit);\n                synchronized (this) {",
    "synchronized (this) {\n                    current(attempt.permit);","held-final-context","MEMORY_RETIREMENT_PROMPT"],
  ["literal authenticated G0 recheck",source,finalHeaderGuard,"","wrong-g0","CURRENT_COMPOSITION_REFUSED"],
  ["post exact namespace",backend,postChildrenGuard,"","marker-phases","POST_EXACT_CHILDREN"],
  ["post bounded journal",backend,"if (before.st_size <= 0 || before.st_size > 16_384) throw new MarkerUnavailable();",
    "","marker-phases","POST_BOUNDED_BASE"],
];
for (const [name,target,before,after,scenario,oracle] of mutations) {
  test(`compiled pristine omission: ${name}`,()=>{
    const actual=readFileSync(target,"utf8"); assert.equal(actual.split(before).length,2,"one exact production rule");
    const healthy=run(scenario); assert.equal(healthy.status,0,healthy.stderr); assert.equal(healthy.stdout.trim(),`PASS ${scenario}`);
    const path=mkdtempSync(join(tmpdir(),prefix+"mutant-"));
    try {
      const changed=join(path,basename(target)); writeFileSync(changed,actual.replace(before,after));
      compile(path,target === source ? changed : source,target === backend ? changed : backend);
      const result=run(scenario,path);
      assert.equal(result.status,1,"runtime assertion, not compile/setup/timeout failure"); assert.equal(result.stdout,"");
      assert.equal(result.stderr.split(/\r?\n/)[0],`Exception in thread "main" java.lang.AssertionError: ${oracle}`);
    } finally { clean(path); }
  });
}
