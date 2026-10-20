import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ports } from '../fixtures/android-update-plugin/ports.mjs';
import { runtimePorts } from '../fixtures/android-update-plugin/runtime-ports.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const plugin = join(root, 'android/app/src/main/java/com/kub/messenger/AndroidUpdatesPlugin.java');
const fixtures = join(root, 'tests/fixtures/android-update-plugin');
const home = process.env.CHAT_PUSH_TEST_JDK ?? process.env.JAVA_HOME
  ?? (process.platform === 'win32' ? 'C:/Program Files/Android/Android Studio/jbr' : null);
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  ?? (process.platform === 'win32' ? 'D:/Progi/AndroidStudio-sdk' : null);
const android = join(sdk ?? '', 'platforms/android-36/android.jar');
const binary = name => home ? join(home, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
const outputs = [];
function compile(mutate) {
  const output = mkdtempSync(join(tmpdir(), 'android-update-plugin-thread-')); outputs.push(output);
  const source = readFileSync(plugin, 'utf8').replaceAll('\r\n', '\n');
  const changed = mutate ? mutate(source) : source;
  if (mutate) assert.notEqual(changed, source, 'literal mutation must hit the frozen plugin');
  const files = [];
  for (const [name, content] of Object.entries({ ...ports, 'com/kub/messenger/AndroidUpdatesPlugin.java': changed })) {
    const path = join(output, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); files.push(path);
  }
  const built = spawnSync(binary('javac'), ['-encoding', 'UTF-8', '-cp', android, '-d', output, ...files,
    join(fixtures, 'Queues.java'), join(fixtures, 'AndroidUpdatePluginProbe.java')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(built.status, 0, built.stderr);
  return output;
}
function run(output, scenario, ...args) {
  return spawnSync(binary('java'), ['-cp', output, 'com.kub.messenger.AndroidUpdatePluginProbe', scenario, ...args], {
    encoding: 'utf8', timeout: 5000,
  });
}
function compileRuntime(mutate) {
  const output = mkdtempSync(join(tmpdir(), 'android-installer-runtime-')); outputs.push(output);
  const native = join(root, 'android/app/src/main/java/com/kub/messenger');
  const source = readFileSync(join(native, 'AndroidUpdateRuntime.java'), 'utf8').replaceAll('\r\n', '\n');
  const changed = mutate ? mutate(source) : source;
  if (mutate) assert.notEqual(changed, source, 'literal runtime mutation must hit');
  const files = [];
  for (const [name, content] of Object.entries({ ...ports, ...runtimePorts, 'com/kub/messenger/AndroidUpdateRuntime.java': changed })) {
    const path = join(output, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); files.push(path);
  }
  const built = spawnSync(binary('javac'), ['-encoding', 'UTF-8', '-cp', android, '-d', output, ...files,
    join(native, 'AndroidUpdatePolicy.java'), join(native, 'AndroidUpdateRequest.java'), join(fixtures, 'Queues.java'),
    join(fixtures, 'AndroidUpdateFinalizationProbe.java')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(built.status, 0, built.stderr);
  return output;
}
function runRuntime(output, scenario) {
  return spawnSync(binary('java'), ['-cp', [output, android].join(process.platform === 'win32' ? ';' : ':'),
    'com.kub.messenger.AndroidUpdateFinalizationProbe', scenario], { encoding: 'utf8', timeout: 5000 });
}
let output, runtimeOutput;
test.before(() => {
  assert.ok(sdk && existsSync(android), 'cached Android36 API required, never skip');
  output = compile();
  runtimeOutput = compileRuntime();
});
test.after(() => {
  for (const output of outputs) {
    assert.ok(realpathSync(output).startsWith(realpathSync(tmpdir()) + sep));
    rmSync(output, { recursive: true, force: true });
  }
});
for (const scenario of ['webview-control', 'normal-status', 'normal-check', 'normal-start', 'normal-cancel',
  'null-activity', 'null-bridge', 'stale-before-ui', 'stale-before-worker', 'permission', 'install-denied',
  'install', 'install-stale', 'install-null-activity', 'install-destroyed', 'installer-return']) {
  test(`actual compiled plugin preserves ${scenario} thread/admission boundary`, () => {
    const result = run(output, scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`^PASS_PLUGIN_THREAD ${scenario}\\s*$`));
  });
}
for (const page of ['http://localhost/', 'https://app.letscube.ru/']) {
  test(`actual compiled plugin admits existing default-port origin ${page}`, () => {
    const result = run(output, 'normal-status', page);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^PASS_PLUGIN_THREAD normal-status\s*$/);
  });
}
for (const page of ['https://foreign.invalid/', 'https://localhost:443/', 'https://app.letscube.ru:443/', 'http://app.letscube.ru/']) {
  test(`actual compiled plugin refuses untrusted/explicit-port origin ${page}`, () => {
    const result = run(output, 'origin-refused', page);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^PASS_PLUGIN_THREAD origin-refused\s*$/);
  });
}

function replaceOne(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, 'unique loaded-plugin omission anchor');
  return source.replace(before, after);
}
for (const [name, before, after, scenario, args, expected] of [
  ['UI origin read', 'activity.runOnUiThread(() -> {', '((java.util.function.Consumer<Runnable>) Runnable::run).accept(() -> {',
    'normal-status', [], 'STATUS_MUST_RESOLVE_FROM_CAPACITOR_WORKER'],
  ['worker runtime dispatch', 'bridge.execute(() -> {\n                if (!current', '((java.util.function.Consumer<Runnable>) Runnable::run).accept(() -> {\n                if (!current',
    'normal-status', [], 'RUNTIME_GET_MOVED_ON_UI'],
  ['origin gate', '(!local && !web) || page.getPort() != -1', 'page.getPort() != -1',
    'origin-refused', ['https://foreign.invalid/'], 'UNTRUSTED_DOCUMENT_NOT_REFUSED'],
  ['explicit-port gate', '(!local && !web) || page.getPort() != -1', '(!local && !web)',
    'origin-refused', ['https://localhost:443/'], 'UNTRUSTED_DOCUMENT_NOT_REFUSED'],
  ['queued document revision', ' || documentRevision.get() != revision', '',
    'stale-before-worker', [], 'UNTRUSTED_DOCUMENT_NOT_REFUSED'],
  ['fresh install origin read', 'Uri.parse(bridge.getWebView().getUrl())', 'Uri.parse("https://localhost/")',
    'install-stale', [], 'STALE_DOCUMENT_OPENED_INSTALLER'],
  ['app-owned finalization', '() -> value.finishInstaller(owner, "INSTALLER", ignored -> unavailable(call))',
    '() -> getBridge().execute(() -> { value.installerReturned(owner, "INSTALLER"); unavailable(call); })',
    'install-destroyed', [], 'DESTROYED_BRIDGE_STRANDED_INSTALLING'],
]) test(`loaded omission of ${name} fails its literal boundary`, () => {
  const built = compile(source => replaceOne(source, before, after));
  const result = run(built, scenario, ...args);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`AssertionError: ${expected}`));
});

for (const scenario of ['complete', 'wrong-owner', 'superseded', 'persist-refused']) {
  test(`complete production Runtime finalization preserves ${scenario}`, () => {
    const result = runRuntime(runtimeOutput, scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`^PASS_RUNTIME_FINALIZATION ${scenario}\\s*$`));
  });
}
for (const [name, before, after, scenario, expected] of [
  ['runtime-owned queue', 'worker.execute(() -> {\n            installerReturned(owner, failure);',
    '((java.util.function.Consumer<Runnable>) Runnable::run).accept(() -> {\n            installerReturned(owner, failure);',
    'complete', 'INSTALL_FINALIZATION_NOT_ON_RUNTIME_WORKER'],
  ['original install owner', 'installerReturned(owner, failure);', 'installerReturned(generation, failure);',
    'wrong-owner', 'WRONG_INSTALL_OWNER_FINALIZED'],
]) test(`loaded Runtime omission of ${name} fails its literal outcome`, () => {
  const built = compileRuntime(source => replaceOne(source, before, after));
  const result = runRuntime(built, scenario);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`AssertionError: ${expected}`));
});
