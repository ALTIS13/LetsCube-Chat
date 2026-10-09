import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import test from "node:test";

const source = new URL("../android/VaultProvisioningInstrumentation.java", import.meta.url);
const jbr = "C:/Program Files/Android/Android Studio/jbr/bin";
const prefix = "letscube-vault-cleanup-";
const body = readFileSync(source, "utf8").replaceAll("\r\n", "\n");
const start = body.indexOf("    private void disposeMain() {");
assert.ok(start > 0);
const methods = body.slice(start, body.lastIndexOf("\n}"));
const cap = /private static final long CLEANUP_WAIT = ([0-9]+);/.exec(body);
assert.ok(cap);

// Executes the selected actual cleanup methods with explicitly fictional main/lifecycle ports.
// This is a JVM cleanup branch oracle, not Android Handler or physical lifecycle evidence.
const fixture = value => `
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.HashMap;
public class VaultCleanupProbe {
  static final long CLEANUP_WAIT = ${value};
  long deadline = SystemClock.elapsedRealtime() + 3000;
  CountDownLatch retired = new CountDownLatch(1), destroyed = new CountDownLatch(1);
  Application application = new Application();
  boolean registered = true;
  Object phaseSnapshot = new Object();
  Issuer issuer = new Issuer();
  MessagePreviewPristineInitializer owner;
  VaultProvisioningProbeActivity started = new VaultProvisioningProbeActivity(destroyed);
  HashMap<String, Boolean> flags = new HashMap<>();
  void setFinal(String name, boolean value) { flags.put(name, value); }
  static void require(boolean value) throws Exception { if (!value) throw new Exception(); }
  ${methods}
  public static void main(String[] args) {
    VaultCleanupProbe probe = new VaultCleanupProbe();
    long began = SystemClock.elapsedRealtime();
    probe.disposeMain();
    if (SystemClock.elapsedRealtime() - began > 1500) throw new AssertionError("CLEANUP_WAIT_BOUNDED");
    if (!Boolean.FALSE.equals(probe.flags.get("activity_retired"))) throw new AssertionError("MISSING_RETIREMENT_NOT_PASS");
    if (!Boolean.TRUE.equals(probe.flags.get("activity_destroyed"))) throw new AssertionError("DESTRUCTION_OBSERVED_INDEPENDENTLY");
    if (!Boolean.TRUE.equals(probe.flags.get("callbacks_removed")) || probe.application.calls != 1 || probe.registered)
      throw new AssertionError("UNREGISTER_AFTER_RETIREMENT_TIMEOUT");
    if (!probe.issuer.closed) throw new AssertionError("ISSUER_CLOSED");
    System.out.println("PASS cleanup");
  }
}
class SystemClock { static long elapsedRealtime() { return System.nanoTime() / 1000000; } }
class Looper { static Object getMainLooper() { return new Object(); } }
class Handler { Handler(Object ignored) {} boolean post(Runnable work) { work.run(); return true; } }
class Application { int calls; void unregisterActivityLifecycleCallbacks(Issuer ignored) { calls++; } }
class Issuer { boolean closed; void close() { closed = true; } boolean isCurrent(Object ignored) { return !closed; } }
class VaultProvisioningProbeActivity {
  CountDownLatch destroyed; VaultProvisioningProbeActivity(CountDownLatch latch) { destroyed = latch; }
  void finish() { destroyed.countDown(); }
}
class MessagePreviewPristineInitializer {
  static class Unavailable extends Exception {}
  static MessagePreviewPristineInitializer getOrCreate(Application app, Issuer issuer, Object authority) throws Unavailable { throw new Unavailable(); }
  void invalidate() {} void close() {}
}
`;

function run(text) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  try {
    const file = join(directory, "VaultCleanupProbe.java");
    // The copied method refers to this field, never a real provisioning authority.
    writeFileSync(file, text.replace("  Object phaseSnapshot", "  Object authority;\n  Object phaseSnapshot"));
    const compiler = spawnSync(join(jbr, "javac.exe"), ["-encoding", "UTF-8", "-proc:none", "-d", directory, file],
      { encoding: "utf8", timeout: 20000, maxBuffer: 32768, windowsHide: true });
    assert.equal(compiler.error, undefined, "JVM_COMPILE_UNAVAILABLE");
    assert.equal(compiler.status, 0, "JVM_FIXTURE_COMPILE_REFUSED");
    const execution = spawnSync(join(jbr, "java.exe"), ["-cp", directory, "VaultCleanupProbe"],
      { encoding: "utf8", timeout: 6000, maxBuffer: 32768, windowsHide: true });
    assert.equal(execution.error, undefined, "JVM_EXECUTION_UNAVAILABLE");
    return execution;
  } finally {
    const actual = realpathSync(directory);
    assert.equal(dirname(actual), realpathSync(tmpdir()));
    assert.ok(basename(actual).startsWith(prefix));
    rmSync(actual, { recursive: true });
  }
}

test("selected actual cleanup observes destruction and unregisters after missing retirement", () => {
  const result = run(fixture(cap[1]));
  assert.equal(result.status, 0, "ACTUAL_CLEANUP_BRANCH_REFUSED");
  assert.equal(result.stdout.trim(), "PASS cleanup");
  assert.equal(result.stderr, "");
});

test("compiled cleanup wait-cap mutation fails the literal time oracle", () => {
  const result = run(fixture("2250"));
  assert.equal(result.status, 1);
  assert.ok(result.stderr.startsWith('Exception in thread "main" java.lang.AssertionError: CLEANUP_WAIT_BOUNDED'));
});

test("compiled unregister omission fails after retirement timeout", () => {
  const original = "application.unregisterActivityLifecycleCallbacks(issuer); registered = false;";
  const selected = fixture(cap[1]);
  assert.equal(selected.split(original).length, 2);
  const result = run(selected.replace(original, "registered = false;"));
  assert.equal(result.status, 1);
  assert.ok(result.stderr.startsWith('Exception in thread "main" java.lang.AssertionError: UNREGISTER_AFTER_RETIREMENT_TIMEOUT'));
});
