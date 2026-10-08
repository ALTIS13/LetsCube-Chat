import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { androidStubs } from "../fixtures/native-message-preview-foreground-authority/android-stubs.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const java = join(root, "android/app/src/main/java/com/kub/messenger");
const source = join(java, "MessagePreviewForegroundAuthority.java");
const fixture = join(root, "tests/fixtures/native-message-preview-foreground-authority/MessagePreviewForegroundAuthorityProbe.java");
const frozen = {
  MessagePreviewInitializationGate: "6366e947e55f88183578294058c25116c6d717324536bebe67f8a4f8b239e621",
  MessagePreviewPristineInitializer: "5920ed1908b4376687cbf7ee1a19cd968fb48c3dcbbc94257f95a4b5ee469a04",
  MainActivity: "28015cfd78a2533e66d85ca44bcf6d82483b241ed88f6e8241dcbde28a639fe0",
};
const jbr = "C:/Program Files/Android/Android Studio/jbr/bin";
const binary = name => join(jbr, `${name}${process.platform === "win32" ? ".exe" : ""}`);
const prefix = "letscube-foreground-authority-";
let directory;
function pins() {
  for (const [name, hash] of Object.entries(frozen)) assert.equal(
    createHash("sha256").update(readFileSync(join(java, `${name}.java`))).digest("hex"), hash, "FROZEN_SOURCE_PIN");
}
function clean(path) {
  const actual = realpathSync(path);
  assert.equal(actual, resolve(path)); assert.equal(dirname(actual), realpathSync(tmpdir()));
  assert.ok(basename(actual).startsWith(prefix)); rmSync(actual, { recursive: true });
}
function compile(path, selected = source) {
  pins();
  const stubs = Object.entries(androidStubs).map(([name, text]) => {
    const file = join(path, "stubs", name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return file;
  });
  const result = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-g:none", "-d", path,
    ...stubs, join(java, "MessagePreviewInitializationGate.java"), selected, fixture],
  { encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ""); pins();
}
function run(mode, path = directory) {
  const result = spawnSync(binary("java"), ["-cp", path, "com.kub.messenger.MessagePreviewForegroundAuthorityProbe", mode],
    { encoding: "utf8", timeout: 6000, windowsHide: true });
  assert.equal(result.error, undefined); return result;
}
test.before(() => {
  if (!existsSync(source)) return;
  directory = mkdtempSync(join(tmpdir(), prefix)); compile(directory);
});
test.after(() => { if (directory) clean(directory); pins(); });
test("new passive foreground authority feature-absence calibration", () => {
  assert.ok(existsSync(source), "FEATURE_ABSENCE: inactive passive foreground authority not implemented; not a shipped regression");
});
for (const mode of ["startup", "reentrant-registration", "two-apps", "uid", "context", "replacement", "pause", "stop",
  "foreign-activity", "subclass", "foreign-callback", "malformed-callback", "off-main-create", "off-main-capture",
  "memory-worker", "off-main-callback", "off-main-close", "close", "detach-failure", "registration-failure", "overflow", "gate-worker",
  "pre-pause", "pre-stop", "pre-destroy", "pre-old", "retire-before-context"]) {
  test(`actual source foreground authority: ${mode}`, () => {
    const result = run(mode); assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, ""); assert.equal(result.stdout.trim(), `PASS ${mode}`);
  });
}

const checked = `    private boolean checkedCallback(Activity activity) {
        try {
            requireMain(); requireApplication(application, uid);
            if (activity == null || activity.getApplication() != application) throw new Unavailable();
            requireMain();
            return true;
        } catch (Exception refused) { retireMemory(true); return false; }
    }`;
const retire = `    private void retire(Activity activity) {
        synchronized (this) {
            if (active == activity && active != null) { active=null; if (!closed) advance(); }
        }
        checkedCallback(activity);
    }`;
const lateRetire = retire.replace("        checkedCallback(activity);\n", "").replace(
  "    private void retire(Activity activity) {\n", "    private void retire(Activity activity) {\n        checkedCallback(activity);\n");
const mutations = [
  ["registration", "application.registerActivityLifecycleCallbacks(this);", "", "startup", "EXACT_ONE_REGISTRATION"],
  ["retained singleton", "registered=owner;", "", "startup", "SINGLETON_SAME_APP"],
  ["exact Application", "application != supplied || ", "", "two-apps", "FOREIGN_APPLICATION_REFUSES"],
  ["Application UID", "info == null || info.uid != uid", "info == null", "uid", "INVALID_APPLICATION_REFUSES"],
  ["Application context identity", "|| application.getApplicationContext() != application", "", "context", "INVALID_APPLICATION_REFUSES"],
  ["exact MainActivity class", "activity.getClass() != MainActivity.class", "false", "subclass", "SUBCLASS_MUST_NOT_GRANT"],
  ["Activity Application", "activity == null || activity.getApplication() != application", "activity == null", "foreign-callback", "FOREIGN_CALLBACK_MUST_NOT_GRANT"],
  ["snapshot epoch", "&& snapshot.epoch == epoch", "", "pause", "RESUME_NOT_ABA"],
  ["exact retired instance", "active == activity && active != null", "active != null", "replacement", "OLD_CALLBACK_MUST_NOT_RETIRE_B"],
  ["main-only capture", "public Object capture() throws Unavailable {\n        requireMain();", "public Object capture() throws Unavailable {", "off-main-capture", "WORKER_ORACLE", "OFFMAIN_CAPTURE_REFUSES"],
  ["retirement before detach", "void close() throws Unavailable {\n        retireMemory(true);", "void close() throws Unavailable {", "detach-failure", "DETACH_FAILURE_MEMORY_RETIRED"],
  ["failed registration cleanup", "try { owner.close(); } catch (Unavailable detachFailed) { /* Retained terminal owner, no recreation. */ }", "", "registration-failure", "FAILED_REGISTER_OWNED_DETACH"],
  ["terminal epoch overflow", "if (epoch == Long.MAX_VALUE)", "if (false)", "overflow", "OVERFLOW_TERMINAL_NO_WRAP"],
  ["confirmed registration only", "if (closed || !listening || !advance())", "if (closed || !advance())", "reentrant-registration", "REGISTRATION_NOT_YET_CONFIRMED"],
  ["early pre-pause", "onActivityPrePaused(Activity activity) { retire(activity); }", "onActivityPrePaused(Activity activity) { }", "pre-pause", "PRE_CALLBACK_RETIRES_BEFORE_ORDINARY"],
  ["retire before Context read", retire, lateRetire, "retire-before-context", "RETIRE_BEFORE_CONTEXT_READ"],
  ["owned unregister", "application.unregisterActivityLifecycleCallbacks(this);", "", "startup", "OWNED_CLOSE_DETACH"],
  ["callback main and owner validation", checked, "    private boolean checkedCallback(Activity activity) { return true; }", "off-main-callback", "BAD_CALLBACK_TERMINAL"],
];
for (const [name, before, after, mode, oracle, cause] of mutations) {
  test(`compiled foreground authority omission: ${name}`, () => {
    const body = readFileSync(source, "utf8"); assert.equal(body.split(before).length, 2, "one exact current mutation site");
    const healthy = run(mode); assert.equal(healthy.status, 0, healthy.stderr); assert.equal(healthy.stdout.trim(), `PASS ${mode}`);
    const path = mkdtempSync(join(tmpdir(), prefix + "mutant-"));
    try {
      const selected = join(path, "MessagePreviewForegroundAuthority.java"); writeFileSync(selected, body.replace(before, after));
      compile(path, selected); const result = run(mode, path);
      assert.equal(result.status, 1, "runtime assertion required, not compile/setup/timeout failure"); assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
      if (cause) assert.ok(result.stderr.includes(`Caused by: java.lang.AssertionError: ${cause}`), "exact off-main denial oracle");
    } finally { clean(path); }
  });
}
