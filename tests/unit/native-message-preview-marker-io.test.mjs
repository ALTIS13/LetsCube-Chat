import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { markerIOStubs } from "../android/message-preview-marker-io-stubs.fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const javaHome = process.env.MESSAGE_PREVIEW_TEST_JDK ?? "C:/Program Files/Android/Android Studio/jbr";
const binary = name => resolve(javaHome, "bin", name + (process.platform === "win32" ? ".exe" : ""));
const source = resolve(root, "android/app/src/main/java/com/kub/messenger/MessagePreviewAtomicBackend.java");
const supporting = ["MessagePreviewVerificationState", "MessagePreviewMetadataEnvelope", "MessagePreviewJournalIO",
  "MessagePreviewInstallationMarker", "MessagePreviewInitializationGate"]
  .map(name => resolve(root, "android/app/src/main/java/com/kub/messenger", name + ".java"));
const probe = resolve(root, "tests/android/MessagePreviewMarkerIOProbe.java");
const prefix = "letscube-marker-io-";
let directory;
function clean(path) {
  const actual = realpathSync(path);
  assert.equal(actual, resolve(path));
  assert.equal(dirname(actual), realpathSync(tmpdir()));
  assert.ok(basename(actual).startsWith(prefix));
  rmSync(actual, { recursive: true });
}
function compile(path, backend = source) {
  const files = Object.entries(markerIOStubs).map(([name, text]) => {
    const file = join(path, "stubs", name);
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return file;
  });
  const result = spawnSync(binary("javac"), ["-encoding", "UTF-8", "-g:none", "-d", path,
    ...files, ...supporting, backend, probe], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
}
function run(scenario, path = directory) {
  const files = mkdtempSync(join(tmpdir(), prefix + "files-"));
  try {
    const result = spawnSync(binary("java"), ["-cp", path, "com.kub.messenger.MessagePreviewMarkerIOProbe", scenario, files],
      { encoding: "utf8", timeout: 15_000, maxBuffer: 256 * 1024, windowsHide: true });
    assert.equal(result.error, undefined); return result;
  } finally { clean(files); }
}
test.before(() => {
  assert.ok(existsSync(source) && readFileSync(source, "utf8").includes("static final class MarkerIO"),
    "FEATURE_ABSENCE: inactive MarkerIO is not implemented; not a shipped regression");
  directory = mkdtempSync(join(tmpdir(), prefix + "classes-")); compile(directory);
});
test.after(() => { if (directory) clean(directory); });
test("Android36 public Os member closure (javap only)", () => {
  const jar = "D:/Progi/AndroidStudio-sdk/platforms/android-36/android.jar";
  assert.ok(existsSync(jar), "INSTALLED_ANDROID36_API_REQUIRED");
  const symbols = spawnSync(binary("javap"), ["-classpath", jar, "android.system.OsConstants", "android.system.Os"],
    { encoding: "utf8", timeout: 10_000, windowsHide: true });
  assert.equal(symbols.error, undefined); assert.equal(symbols.status, 0, symbols.stderr);
  assert.equal(symbols.stderr, "");
  const sections = symbols.stdout.split("public final class android.system.");
  const members = name => new Set([...sections.find(section => section.startsWith(name + " "))
    .matchAll(/^\s+public static(?: final)? [\w.$\[\]]+ (\w+)[;(]/gm)].map(match => match[1]));
  const constants = members("OsConstants"), methods = members("Os");
  for (const name of ["O_RDONLY", "O_NOFOLLOW", "S_ISDIR"]) assert.ok(constants.has(name), "PUBLIC_API_CALIBRATION");
  for (const name of ["open", "fstat", "fsync", "close"]) assert.ok(methods.has(name), "PUBLIC_API_CALIBRATION");
  assert.equal(constants.has("O_DIRECTORY"), false, "NO_PUBLIC_DIRECTORY_FLAG");
  const requirePublic = text => {
    for (const [type, allowed] of [["OsConstants", constants], ["Os", methods]]) {
      for (const match of text.matchAll(new RegExp(`\\b${type}\\.(\\w+)`, "g"))) {
        assert.ok(allowed.has(match[1]), `PUBLIC_OS_MEMBER_REQUIRED: ${type}.${match[1]}`);
      }
    }
  };
  requirePublic(readFileSync(source, "utf8"));
  assert.throws(() => requirePublic("OsConstants.O_DIRECTORY"),
    { message: "PUBLIC_OS_MEMBER_REQUIRED: OsConstants.O_DIRECTORY" });
  assert.doesNotMatch(markerIOStubs["android/system/OsConstants.java"], /\bO_DIRECTORY\b/);
});
for (const scenario of ["healthy", "policy", "absence", "permits", "failures", "readback", "identities", "held",
  "context-return", "context-write", "namespace-stat", "root-stat", "descriptor", "descriptor-size", "directory-descriptor", "file-sync-fault", "file-write-fault", "root-alias", "android-main", "entry-failure"]) {
  test(`compiled marker I/O: ${scenario}`, () => {
    const result = run(scenario);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, "");
    assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}
test("old backend52B2 byte projection is unchanged outside root-helper extraction", () => {
  let actual = readFileSync(source, "utf8");
  const start = actual.indexOf("\n    static final class MarkerUnavailable");
  assert.ok(start > 0);
  actual = actual.slice(0, start) + "}\n";
  for (const line of ["import android.os.Looper;\n", "import android.os.Process;\n", "import java.io.FileDescriptor;\n",
    "import java.io.FileInputStream;\n", "import java.security.SecureRandom;\n", "import java.util.Arrays;\n"]) {
    assert.equal(actual.split(line).length, 2); actual = actual.replace(line, "");
  }
  const extraction = "    private File platformRoot() throws IOException {\n        return platformRoot(context);\n    }\n\n    private static File platformRoot(Context context) throws IOException {";
  assert.equal(actual.split(extraction).length, 2);
  actual = actual.replace(extraction, "    private File platformRoot() throws IOException {");
  assert.equal(createHash("sha256").update(actual).digest("hex"), "52b2a9fa8235a943f0282b9a398f2d4bf09163b9fd8a236643b00ac613bdd637");
});

const mutations = [
  ["create exclusive/no-follow", "OsConstants.O_WRONLY | OsConstants.O_CREAT | OsConstants.O_EXCL | OsConstants.O_NOFOLLOW", "OsConstants.O_WRONLY | OsConstants.O_CREAT", "healthy", "EXCLUSIVE_NOFOLLOW_0600"],
  ["namespace fsync", "Os.fsync(namespaceFd);", "", "healthy", "BOTH_DIRECTORY_SYNCS"],
  ["root fsync", "Os.fsync(rootFd);", "", "healthy", "BOTH_DIRECTORY_SYNCS"],
  ["one-use reservation", "if (attempted) throw new MarkerUnavailable();", "", "absence", "ONE_USE_RESERVE_REQUIRED"],
  ["exact fresh marker bytes", "total != 28 || !Arrays.equals(encoded, Arrays.copyOf(bytes, total))", "total != 28", "readback", "EXACT_MARKER_READBACK_REQUIRED"],
  ["fresh post-read size", "if (after.st_size != 28) throw new MarkerUnavailable();\n            } finally", "\n            } finally", "readback", "FRESH_28_SIZE_REQUIRED"],
  ["post-platform currency", "if (!(service instanceof UserManager) || !((UserManager) service).isUserUnlocked()) throw new MarkerUnavailable();\n                gate.currentBeforeEffect(permit);", "if (!(service instanceof UserManager) || !((UserManager) service).isUserUnlocked()) throw new MarkerUnavailable();", "context-return", "POST_CONTEXT_CURRENCY_REQUIRED"],
  ["post-namespace-FD currency", "same(namespaceIdentity, Os.fstat(namespaceFd)); currentMemory(); Os.fsync", "same(namespaceIdentity, Os.fstat(namespaceFd)); Os.fsync", "namespace-stat", "POST_NAMESPACE_STAT_CURRENCY_REQUIRED"],
  ["post-root-FD currency", "same(rootIdentity, Os.fstat(rootFd)); currentMemory(); Os.fsync", "same(rootIdentity, Os.fstat(rootFd)); Os.fsync", "root-stat", "POST_ROOT_STAT_CURRENCY_REQUIRED"],
  ["FD identity", "StructStat opened = Os.fstat(fd); same(markerIdentity, opened);", "StructStat opened = Os.fstat(fd);", "descriptor", "DIRECT_FD_IDENTITY_REQUIRED"],
  ["initial FD size", "if (opened.st_size != 0) throw new MarkerUnavailable();", "", "descriptor-size", "FRESH_EMPTY_DESCRIPTOR_REQUIRED"],
  ["entry latch ordering", "attempted = true;\n                currentRoot();", "currentRoot();\n                attempted = true;", "entry-failure", "ONE_USE_ON_ENTRY_FAILURE"],
  ["directory no-follow", "FileDescriptor fd = Os.open(path.getPath(), OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW, 0);", "FileDescriptor fd = Os.open(path.getPath(), OsConstants.O_RDONLY, 0);", "healthy", "DIRECTORY_RDONLY_NOFOLLOW"],
  ["opened directory custody", "if (!OsConstants.S_ISDIR(opened.st_mode)) throw new MarkerUnavailable();\n                same(identity, opened);", "", "directory-descriptor", "DIRECTORY_FD_CUSTODY_REQUIRED"],
];
for (const [name, before, after, scenario, oracle] of mutations) {
  test(`compiled marker I/O omission: ${name}`, () => {
    const actual = readFileSync(source, "utf8"); assert.equal(actual.split(before).length, 2, "one exact production rule");
    const healthy = run(scenario); assert.equal(healthy.status, 0, healthy.stderr);
    assert.equal(healthy.stdout.trim(), `PASS ${scenario}`);
    const path = mkdtempSync(join(tmpdir(), prefix + "mutant-"));
    try {
      const changed = join(path, "MessagePreviewAtomicBackend.java");
      writeFileSync(changed, actual.replace(before, after)); compile(path, changed);
      const result = run(scenario, path);
      assert.equal(result.status, 1, "runtime oracle, not compiler/timeout/setup failure");
      assert.equal(result.stdout, "");
      assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
    } finally { clean(path); }
  });
}
