import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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
function compile({ calibrated = true, mutateRuntime, mutateHelper } = {}) {
  const output = mkdtempSync(join(tmpdir(), 'android-update-deadline-'));
  outputs.push(output);
  // Only in-memory budget calibration: real production literals are independently asserted below.
  let source = readFileSync(join(native, 'AndroidUpdateRuntime.java'), 'utf8');
  assert.match(source, /20000/);
  assert.match(source, /15 \* 60 \* 1000/);
  if (mutateRuntime) { const changed = mutateRuntime(source); assert.notEqual(changed, source); source = changed; }
  if (calibrated) source = source.replaceAll('20000', '150').replaceAll('15 * 60 * 1000', '150');
  writeFileSync(join(output, 'AndroidUpdateRuntime.java'), source);
  let helper = readFileSync(join(native, 'AndroidUpdateRequest.java'), 'utf8');
  if (mutateHelper) { const changed = mutateHelper(helper); assert.notEqual(changed, helper); helper = changed; }
  writeFileSync(join(output, 'AndroidUpdateRequest.java'), helper);
  const built = spawnSync(binary('javac'), ['-encoding', 'UTF-8', '-cp', android, '-d', output,
    join(output, 'AndroidUpdateRuntime.java'), join(native, 'AndroidUpdatePolicy.java'),
    join(output, 'AndroidUpdateRequest.java'),
    join(fixtures, 'deadline/android/os/SystemClock.java'), join(fixtures, 'deadline/com/getcapacitor/JSObject.java'),
    join(fixtures, 'AndroidUpdateDeadlineProbe.java'), join(fixtures, 'AndroidUpdateRequestProbe.java')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(built.status, 0, built.stderr);
  return output;
}
function java(output, probe, ...arguments_) {
  return spawnSync(binary('java'), ['-cp', [output, android].join(process.platform === 'win32' ? ';' : ':'),
    'com.kub.messenger.' + probe, ...arguments_], { encoding: 'utf8', timeout: 5000 });
}
let output, literal;
test.before(() => {
  assert.ok(sdk && existsSync(android), 'reuse cached Android36 API only');
  output = compile();
  literal = compile({ calibrated: false });
});
test.after(() => {
  for (const output of outputs) {
    assert.ok(realpathSync(output).startsWith(realpathSync(tmpdir()) + sep));
    rmSync(output, { recursive: true, force: true });
  }
});
for (const [operation, boundary] of [
  ['catalog', 'headers'], ['catalog', 'connect'], ['catalog', 'body'],
  ['download', 'headers'], ['download', 'body'], ['download', 'complete'],
]) test(`actual native ${operation} owns total ${boundary} lifetime`, () => {
  const run = java(output, 'AndroidUpdateDeadlineProbe', operation, boundary);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, new RegExp(`^PASS_RUNTIME_DEADLINE ${operation} ${boundary}\\s*$`));
});
for (const operation of ['catalog', 'download']) test(`literal native ${operation} budget is armed before headers`, () => {
  const run = java(literal, 'AndroidUpdateDeadlineProbe', operation, 'headers', 'budget');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, new RegExp(`^PASS_RUNTIME_DEADLINE ${operation} headers budget\\s*$`));
});
for (const scenario of ['close', 'elapsed', 'ownership']) test(`native request ${scenario} preserves cleanup and owner fences`, () => {
  const run = java(output, 'AndroidUpdateRequestProbe', scenario);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, new RegExp(`^PASS_REQUEST_DEADLINE ${scenario}\\s*$`));
});
for (const [name, mutation, probe, args, expected] of [
  ['watchdog', { mutateHelper: source => source.replace('this::expire, timeoutMillis,', 'this::expire, timeoutMillis + 60000,') },
    'AndroidUpdateDeadlineProbe', ['catalog', 'headers'], 'TOTAL_HEADERS_DEADLINE_MISSING'],
  ['alarm cleanup', { mutateHelper: source => source.replace('alarm.cancel(false);', '') },
    'AndroidUpdateRequestProbe', ['close'], 'ALARM_NOT_CANCELLED'],
  ['late body check', { mutateHelper: source => source.replace('if (expired || SystemClock.elapsedRealtime() >= deadline)', 'if (false)') },
    'AndroidUpdateRequestProbe', ['elapsed'], 'LATE_EOF_ACCEPTED'],
  ['connection owner', { mutateRuntime: source => source.replace('if (connection == request) connection = null;', 'connection = null;') },
    'AndroidUpdateRequestProbe', ['ownership'], 'NEW_REQUEST_LOST'],
  ['catalog budget', { calibrated: false, mutateRuntime: source => source.replace('CATALOG, 20000', 'CATALOG, 30000') },
    'AndroidUpdateDeadlineProbe', ['catalog', 'headers', 'budget'], 'CATALOG_DEADLINE_NOT_20000'],
]) test(`loaded omission of ${name} fails its literal outcome`, () => {
  const run = java(compile(mutation), probe, ...args);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, new RegExp(`AssertionError: ${expected}`));
});
