import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { foregroundCompositionStubs, compositionPlatform, foregroundCompositionSourceNames }
  from '../android/message-preview-genuine-composition.fixture.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const base = path.join(root, 'android/app/src/main/java/com/kub/messenger');
const bin = process.env.LETSCUBE_TEST_JAVA_BIN ?? 'C:/Program Files/Android/Android Studio/jbr/bin';
const probe = path.join(root, 'tests/java/com/kub/messenger/MessagePreviewForegroundCompositionProbe.java');
const sources = foregroundCompositionSourceNames.map(name => path.join(base, `${name}.java`));
const snapshots = sources.map(file => [file, readFileSync(file)]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = path.join(root, 'tests/android/message-preview-genuine-composition.fixture.mjs');
const before = [...snapshots, [probe, readFileSync(probe)], [fixture, readFileSync(fixture)]]
  .map(([file, bytes]) => [file, hash(bytes)]);
const owned = [];
const prefix = 'nmpv-genuine-composition-';
function directory() {
  const result = mkdtempSync(path.join(tmpdir(), prefix));
  owned.push(result);
  return result;
}
function binary(name) { return path.join(bin, name + (process.platform === 'win32' ? '.exe' : '')); }
function compile(replacements = {}, reportHashes = true) {
  const out = directory();
  const stubs = Object.entries(foregroundCompositionStubs).map(([name, source]) => {
    const file = path.join(out, 'stubs', name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
    return file;
  });
  // Snapshot real sources before javac; a concurrent edit is refused by readback.
  const selected = snapshots.map(([file, bytes]) => {
    const copy = path.join(out, 'sources', path.basename(file));
    mkdirSync(path.dirname(copy), { recursive: true });
    writeFileSync(copy, replacements[path.basename(file)] ?? bytes);
    return copy;
  });
  const platform = path.join(out, 'MessagePreviewProducerPlatform.java');
  writeFileSync(platform, compositionPlatform);
  const result = spawnSync(binary('javac'),
    ['-encoding', 'UTF-8', '-g:none', '-d', out, ...stubs, ...selected, platform, probe],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 256 * 1024 });
  assert.equal(result.error, undefined, 'finite javac invocation');
  assert.equal(result.status, 0, `COMPOSITION_JAVAC_FAILURE_NOT_FEATURE_RED\n${result.stderr}`);
  console.log(`JVM_COMPILE_PASS production_sources=${snapshots.length}${reportHashes ? '' : ' mutant=true'}`);
  if (reportHashes) for (const [file, bytes] of snapshots) console.log(`SOURCE_SHA256 ${path.basename(file)} ${hash(bytes)}`);
  return out;
}
function run(out, scenario) {
  const files = directory();
  const result = spawnSync(binary('java'),
    ['-cp', out, 'com.kub.messenger.MessagePreviewForegroundCompositionProbe', scenario, files],
    { encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024 });
  assert.equal(result.error, undefined, 'finite actual-class reflection execution');
  return result;
}
let out;
test.before(() => { out = compile(); });
test.after(() => {
  try {
    for (const [file, original] of before) {
      assert.equal(hash(readFileSync(file)), original, 'source preserved during selected test');
    }
    console.log(`SOURCE_READBACK_PASS production_sources=${snapshots.length}`);
  } finally {
    for (const directory of owned) {
      const actual = realpathSync(directory);
      assert.equal(path.dirname(actual), realpathSync(tmpdir()));
      assert.ok(path.basename(actual).startsWith(prefix));
      assert.equal(actual, path.resolve(directory));
      rmSync(actual, { recursive: true });
    }
  }
});

test('genuine QA composition feature: reflection contract (absence, not shipped regression)', () => {
  const result = run(out, 'feature-contract');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim(), 'PASS feature-contract');
});

function positive(compiled, scenario) {
  const result = run(compiled, scenario);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim(), `PASS ${scenario}`);
}
for (const scenario of ['qa-disabled-ordinary', 'no-choice', 'request-off-main', 'request-expired',
  'wrong-recipient', 'wrong-bridge', 'wrong-runtime', 'unbound-clear', 'attempted-ticket',
  'healthy-main-worker', 'admission-delay', 'held-main-expired', 'held-auth-pause', 'held-auth-destroy',
  'lost-pending', 'final-at', 'final-before', 'duplicate-offer', 'stale-binding', 'ack-no-renew',
  'plugin-clear', 'plugin-destroy', 'wrong-epoch', 'wrong-session', 'wrong-account', 'wrong-device',
  'held-init-unknown', 'late-retire-after-unknown', 'vault-failure-after-verifier', 'logout', 'final-producer-shorter',
  'reload-unbound', 'reload-bound']) {
  test(`actual QA foreground composition boundary: ${scenario}`, () => positive(out, scenario));
}

function changedSource(name, rule, replacement, count = 1) {
  const source = snapshots.find(([file]) => path.basename(file) === `${name}.java`)[1].toString('utf8').replace(/\r\n/g, '\n');
  assert.equal(source.split(rule).length - 1, count, 'exact current production mutation sites');
  return source.replaceAll(rule, replacement);
}
function killed(compiled, scenario, oracle) {
  const result = run(compiled, scenario);
  assert.equal(result.status, 1, 'compiled runtime assertion, not setup/compile/timeout');
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
  console.log(`COMPILED_MUTANT_KILLED scenario=${scenario} oracle=${oracle}`);
}
test('compiled QA foreground composition mutant: final producer permit', () => {
  positive(out, 'final-producer-shorter');
  const holder = changedSource('MessagePreviewForegroundComposition',
    '        try { producer.requireCurrentInvocation(); }\n        catch (Exception refused) { close(); return; }\n', '');
  const mutant = compile({ 'MessagePreviewForegroundComposition.java': holder }, false);
  killed(mutant, 'final-producer-shorter', 'FINAL_ACK_REFUSES_AFTER_PRODUCER_D_25000_BEFORE_NATIVE_D_32000');
});

const holderName = 'MessagePreviewForegroundComposition';
const pluginName = 'MessagePreviewsPlugin';
const permitCheck = '        try { producer.requireCurrentInvocation(); }\n        catch (Exception refused) { close(); return; }\n';
const mutations = [
  ['QA guard conjunction', 'qa-disabled-ordinary', 'QA_DISABLED_NEVER_CREATES_HOLDER', () => ({
    [`${holderName}.java`]: changedSource(holderName, '!BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_COMPOSITION', 'false', 5),
    [`${pluginName}.java`]: changedSource(pluginName, '!BuildConfig.LETSCUBE_QA_MESSAGE_PREVIEW_COMPOSITION', 'false'),
  })],
  ['no-choice ordinary dispatch', 'no-choice', 'NO_CHOICE_LEAVES_ORDINARY_ROUTE', () => ({
    [`${holderName}.java`]: changedSource(holderName, 'if (!requested) return false;',
      'if (!requested) { completion.complete(false); return true; }'),
  })],
  ['main admission dispatch', 'healthy-main-worker', 'COMPOSITION_ACK_TRUE', () => ({
    [`${holderName}.java`]: changedSource(holderName, 'post(this::admit);', 'admit();'),
  })],
  ['original producer D arm', 'admission-delay', 'ORIGINAL_PLUGIN_D_18000_NOT_VAULT_D_21000', () => ({
    [`${holderName}.java`]: changedSource(holderName, 'producer.arm(attempt.identity, attempt.deadline);', 'producer.arm(attempt.identity);'),
  })],
  ['checked COMMITTED result', 'vault-failure-after-verifier', 'ORDINARY_VERIFIED_BOOLEAN_IS_NOT_VAULT_COMMIT', () => ({
    [`${holderName}.java`]: changedSource(holderName,
      'result.status != MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED\n            || result.generation == null || result.generation != 1L', 'false'),
  })],
  ['both native final ACK guards', 'final-at', 'LATE_COMMIT_CALLBACK_REFUSES_AT_D_18000', () => {
    let source = changedSource(holderName,
      'if (!current(attempt) || result.status != MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED',
      'if (result.status != MessagePreviewPristineInitializer.ProvisionStatus.COMMITTED');
    assert.equal(source.split(permitCheck).length, 2, 'one final permit check');
    source = source.replace(permitCheck, '');
    return { [`${holderName}.java`]: source };
  }],
  ['logout bound retirement', 'logout', 'LOGOUT_REVOKES_BOUND_INVOCATION', () => ({
    [`${holderName}.java`]: changedSource(holderName,
      '&& nextRevision > invocation.identity.context.revision) close();',
      '&& nextRevision > invocation.identity.context.revision) { }'),
  })],
  ['retained owner before erasure', 'healthy-main-worker', 'COMMIT_THEN_EXACT_ERASURE_BEFORE_CLOSE', () => ({
    [`${holderName}.java`]: changedSource(holderName, 'owner.retireExact(MessagePreviewVaultProvisioning.opaque()',
      'owner.close(); owner.retireExact(MessagePreviewVaultProvisioning.opaque()'),
  })],
  ['ACK retains original timer', 'ack-no-renew', 'ACK_RETAINS_EXACT_ORIGINAL_D_18000', () => ({
    [`${holderName}.java`]: changedSource(holderName, 'reply(attempt, true);', 'reply(attempt, true); expiry.cancel(false);'),
  })],
  ['terminal UNKNOWN observation', 'late-retire-after-unknown', 'LATE_RETIREMENT_AFTER_UNKNOWN_MUST_NOT_CLAIM_RETIRED', () => ({
    [`${holderName}.java`]: changedSource(holderName,
      'if (!finished && result.status == MessagePreviewPristineInitializer.TransitionStatus.RETIRED',
      'if (result.status == MessagePreviewPristineInitializer.TransitionStatus.RETIRED'),
  })],
  ['actual plugin QA routing', 'plugin-clear', 'PLUGIN_QA_OFFER_POSTS_MAIN_NOT_ORDINARY_WORKER', () => ({
    [`${pluginName}.java`]: changedSource(pluginName,
      'if (qaComposition != null && qaComposition.offer(getBridge(), runtime,',
      'if (false && qaComposition.offer(getBridge(), runtime,'),
  })],
  ['literal plugin entry budget', 'plugin-clear', 'PLUGIN_ENTRY_D_18000_NOT_DELAYED_MAIN_D_21000', () => ({
    [`${pluginName}.java`]: changedSource(pluginName, 'started + 8_000 : -1;', 'started + 15_000 : -1;'),
  })],
  ['document reload callback', 'reload-unbound', 'UNBOUND_QA_INTENT_CANNOT_CROSS_DOCUMENT_RELOAD', () => ({
    [`${pluginName}.java`]: changedSource(pluginName,
      'public void onPageStarted(WebView webView) { retireQaDocument(); }',
      'public void onPageStarted(WebView webView) { }'),
  })],
  ['known PENDING exact generation', 'healthy-main-worker', 'COMMIT_THEN_EXACT_ERASURE_BEFORE_CLOSE', () => ({
    [`${holderName}.java`]: changedSource(holderName, '2, pendingObserved ? 1 : 0, correlation,', '2, 0, correlation,'),
  })],
  ['lost PENDING exact correlation', 'lost-pending', 'LOST_PENDING_CORRELATED_ERASURE_G2', () => ({
    [`${holderName}.java`]: changedSource(holderName,
      'MessagePreviewVaultFence.Correlation correlation = pendingObserved ? null\n            : new MessagePreviewVaultFence.Correlation(attempt.identity.operationId, 1);',
      'MessagePreviewVaultFence.Correlation correlation = null;'),
  })],
];
for (const [name, scenario, oracle, replace] of mutations) {
  test(`compiled QA foreground composition mutant: ${name}`, () => {
    positive(out, scenario);
    const mutant = compile(replace(), false);
    killed(mutant, scenario, oracle);
  });
}
