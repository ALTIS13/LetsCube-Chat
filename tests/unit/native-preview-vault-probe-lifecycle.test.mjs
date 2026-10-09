import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Explicitly fictional JVM framework. No APK, AndroidKeyStore, device or vault proof.
// Its one important side effect matches android-35 Activity.java:2170-2178:
// base onResume synchronously dispatches the resumed callback before returning.
const root = path.resolve(import.meta.dirname, '../..');
const sourcePath = path.join(root, 'tests/android/VaultProvisioningProbeActivity.java');
const javaHome = process.env.MESSAGE_PREVIEW_TEST_JDK ?? 'C:/Program Files/Android/Android Studio/jbr';
const temporaryRoot = realpathSync(tmpdir());
const owned = new Set();
const prefix = 'letscube-vault-probe-lifecycle-';
let source, exact;

const fictionalFramework = {
  'android/os/Bundle.java': `package android.os; public final class Bundle { }`,
  'android/os/SystemClock.java': `package android.os;
    public final class SystemClock {
      public static long fictionalElapsed;
      public static long elapsedRealtime() { return fictionalElapsed; }
    }`,
  'android/view/View.java': `package android.view;
    public final class View { public View(android.app.Activity activity) { } }`,
  'android/view/WindowManager.java': `package android.view;
    public interface WindowManager {
      final class LayoutParams { public static final int FLAG_SECURE = 8192, FLAG_KEEP_SCREEN_ON = 128; }
    }`,
  'android/view/Window.java': `package android.view;
    public final class Window { public void addFlags(int flags) { } }`,
  'android/app/Activity.java': `package android.app;
    import android.os.Bundle;
    import android.view.View;
    import android.view.Window;
    import java.util.function.Consumer;
    public class Activity {
      public static Consumer<Activity> fictionalResumedCallback;
      private final Window window = new Window();
      private boolean finishing, destroyed;
      protected void onCreate(Bundle state) { }
      protected void onResume() {
        if (fictionalResumedCallback != null) fictionalResumedCallback.accept(this);
      }
      protected void onPause() { }
      protected void onStop() { }
      protected void onDestroy() { destroyed = true; }
      public final Window getWindow() { return window; }
      public final void setContentView(View view) { }
      public final void finish() { finishing = true; }
      public final boolean isFinishing() { return finishing; }
      public final boolean isDestroyed() { return destroyed; }
    }`,
  'com/kub/messenger/VaultProbeLifecycleFixture.java': `package com.kub.messenger;
    import android.app.Activity;
    import android.os.Bundle;
    import android.os.SystemClock;
    public final class VaultProbeLifecycleFixture {
      private static final class OrderedControl extends Activity {
        boolean before, after;
        @Override protected void onResume() { before = true; super.onResume(); after = true; }
      }
      public static void main(String[] args) {
        try {
          if (args.length != 1) throw new IllegalArgumentException();
          if ("framework-order".equals(args[0])) {
            OrderedControl control = new OrderedControl();
            final boolean[] inside = {false};
            Activity.fictionalResumedCallback = activity -> {
              inside[0] = activity == control && control.before && !control.after;
            };
            control.onResume();
            System.out.println("{\\\"called_inside_super\\\":" + inside[0]
              + ",\\\"override_finished\\\":" + control.after + "}");
            return;
          }
          SystemClock.fictionalElapsed = 100;
          VaultProvisioningProbeActivity.allowLaunch(200);
          VaultProvisioningProbeActivity activity = new VaultProvisioningProbeActivity();
          final boolean[] callback = {false, false};
          Activity.fictionalResumedCallback = observed -> {
            callback[0] = observed == activity;
            callback[1] = observed == activity && activity.isProbeResumed();
          };
          activity.onCreate(new Bundle());
          if ("expired".equals(args[0])) SystemClock.fictionalElapsed = 200;
          activity.onResume();
          boolean afterResume = activity.isProbeResumed();
          switch (args[0]) {
            case "valid": case "expired": break;
            case "pause": activity.onPause(); break;
            case "stop": activity.onStop(); break;
            case "destroy": activity.onDestroy(); break;
            default: throw new IllegalArgumentException();
          }
          System.out.println("{\\\"callback_seen\\\":" + callback[0]
            + ",\\\"callback_resumed\\\":" + callback[1]
            + ",\\\"resumed_after_resume\\\":" + afterResume
            + ",\\\"resumed_after_transition\\\":" + activity.isProbeResumed()
            + ",\\\"finishing\\\":" + activity.isFinishing() + "}");
          VaultProvisioningProbeActivity.disallowLaunch();
        } catch (Throwable unavailable) {
          System.out.println("UNAVAILABLE"); System.exit(1);
        }
      }
    }`,
};

function binary(name) {
  const file = path.join(javaHome, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
  assert.ok(existsSync(file), 'Fixed JBR binary unavailable');
  return file;
}

function child(name, args, timeout) {
  const env = { ...process.env };
  delete env.JAVA_TOOL_OPTIONS;
  delete env.JDK_JAVA_OPTIONS;
  delete env._JAVA_OPTIONS;
  const result = spawnSync(binary(name), args, {
    encoding: 'utf8', timeout, maxBuffer: 16_384, windowsHide: true, env,
  });
  assert.ok(!result.error, 'JBR child unavailable; raw errors suppressed');
  assert.equal(result.status, 0, 'JBR child failed; raw diagnostics suppressed');
  assert.equal((result.stderr ?? '').trim().length, 0, 'JBR diagnostics suppressed');
  return result.stdout;
}

function compile(activitySource) {
  const directory = mkdtempSync(path.join(temporaryRoot, prefix));
  owned.add(directory);
  const files = Object.entries(fictionalFramework).map(([name, text]) => {
    const file = path.join(directory, 'src', name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    return file;
  });
  const activity = path.join(directory, 'src/com/kub/messenger/VaultProvisioningProbeActivity.java');
  writeFileSync(activity, activitySource);
  const classes = path.join(directory, 'classes');
  mkdirSync(classes);
  child('javac', ['-encoding', 'UTF-8', '-g:none', '-d', classes, ...files, activity], 30_000);
  return classes;
}

function run(classes, scenario) {
  const stdout = child('java', ['-cp', classes, 'com.kub.messenger.VaultProbeLifecycleFixture', scenario], 5_000);
  let value;
  try { value = JSON.parse(stdout); }
  catch { throw new Error('Fictional fixture boolean result unavailable'); }
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), 'Boolean result object required');
  assert.ok(Object.values(value).every(flag => typeof flag === 'boolean'), 'Boolean-only fixture output required');
  return value;
}

function orderedVariant(beforeDispatch) {
  // Mutation input only. Oracles below assert literal executable behavior, not source text.
  const pair = /super\.onResume\(\);\s*resumed = launchCurrent\(\);|resumed = launchCurrent\(\);\s*super\.onResume\(\);/g;
  assert.equal([...source.matchAll(pair)].length, 1, 'Single resume-order mutation anchor required');
  return source.replace(pair, beforeDispatch
    ? 'resumed = launchCurrent(); super.onResume();'
    : 'super.onResume(); resumed = launchCurrent();');
}

test.before(() => {
  source = readFileSync(sourcePath, 'utf8');
  exact = compile(source);
});

test.after(() => {
  for (const directory of owned) {
    const actual = realpathSync(directory);
    assert.equal(actual, directory);
    assert.equal(path.dirname(actual), temporaryRoot);
    assert.ok(path.basename(actual).startsWith(prefix));
    rmSync(actual, { recursive: true, force: false });
  }
});

test('fictional framework positive control dispatches inside super.onResume', () => {
  assert.deepEqual(run(exact, 'framework-order'), { called_inside_super: true, override_finished: true });
});

test('exact QA Activity exposes valid resumed state to the synchronous callback', () => {
  const result = run(exact, 'valid');
  assert.equal(result.callback_seen, true);
  assert.equal(result.resumed_after_resume, true);
  assert.equal(result.finishing, false);
  assert.equal(result.callback_resumed, true, 'Valid resume must be visible during base Activity dispatch');
});

test('exact QA Activity refuses launch at the expired deadline during callback and afterward', () => {
  assert.deepEqual(run(exact, 'expired'), {
    callback_seen: true, callback_resumed: false, resumed_after_resume: false,
    resumed_after_transition: false, finishing: true,
  });
});

for (const transition of ['pause', 'stop', 'destroy']) {
  test(`exact QA Activity is no longer resumed after ${transition}`, () => {
    const result = run(exact, transition);
    assert.equal(result.callback_seen, true);
    assert.equal(result.resumed_after_resume, true);
    assert.equal(result.resumed_after_transition, false);
  });
}

test('isolated pre-dispatch ordering control makes valid resume visible without editing QA source', () => {
  const result = run(compile(orderedVariant(true)), 'valid');
  assert.deepEqual(result, {
    callback_seen: true, callback_resumed: true, resumed_after_resume: true,
    resumed_after_transition: true, finishing: false,
  });
});

test('causal swapped-order mutant fails the literal valid-callback oracle', () => {
  const preDispatch = orderedVariant(true);
  const badOrder = preDispatch.replace('resumed = launchCurrent(); super.onResume();',
    'super.onResume(); resumed = launchCurrent();');
  assert.notEqual(badOrder, preDispatch, 'Order mutant must actually change the isolated control');
  const result = run(compile(badOrder), 'valid');
  assert.equal(result.callback_seen, true);
  assert.equal(result.resumed_after_resume, true);
  assert.equal(result.finishing, false);
  assert.equal(result.callback_resumed, false);
  assert.throws(() => assert.equal(result.callback_resumed, true), { name: 'AssertionError' });
});
