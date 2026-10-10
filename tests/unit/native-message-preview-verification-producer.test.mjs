import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { foregroundCompositionStubs as producerStubs, compositionPlatform as producerPlatform }
  from '../android/message-preview-genuine-composition.fixture.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const base = path.join(root, 'android/app/src/main/java/com/kub/messenger');
const bin = process.env.LETSCUBE_TEST_JAVA_BIN ?? 'C:/Program Files/Android/Android Studio/jbr/bin';
const probe = path.join(root, 'tests/java/com/kub/messenger/MessagePreviewVerificationProducerProbe.java');
const names = ['MessagePreviewVerificationState', 'MessagePreviewVaultFence', 'MessagePreviewMetadataEnvelope',
  'MessagePreviewJournalIO', 'MessagePreviewInstallationMarker', 'MessagePreviewInitializationGate',
  'MessagePreviewOwnedKeyInventory', 'MessagePreviewKeystoreReader', 'MessagePreviewAtomicBackend',
  'MessagePreviewCredentialEnvelope', 'MessagePreviewCredentialKeyCustody', 'MessagePreviewPristineInitializer',
  'MessagePreviewVaultProvisioning', 'MessagePreviewVerificationRuntime', 'MessagePreviewResponseParser',
  'MessagePreviewHttpTransport', 'MessagePreviewsPlugin', 'MessagePreviewForegroundAuthority',
  'MessagePreviewForegroundComposition', 'MainActivity'];
const producer = path.join(base, 'MessagePreviewVerificationProducer.java');
const sources = names.map(name => path.join(base, `${name}.java`));
if (existsSync(producer)) sources.push(producer);
const before = sources.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]);
const owned = [];
const prefix = 'nmpv-6e-producer-';
function directory() {
  const result = mkdtempSync(path.join(tmpdir(), prefix)); owned.push(result); return result;
}
function binary(name) { return path.join(bin, name + (process.platform === 'win32' ? '.exe' : '')); }
function compile(replacement) {
  const out = directory();
  // Compile existing graph contracts against labeled Android doubles; no old probe/suite runs.
  const stubs = Object.entries(producerStubs).map(([name, text]) => {
    const file = path.join(out, 'stubs', name);
    mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); return file;
  });
  const platform = path.join(out, 'MessagePreviewProducerPlatform.java'); writeFileSync(platform, producerPlatform);
  const selected = sources.map(file => {
    if (!replacement || path.basename(file) !== `${replacement.name}.java`) return file;
    const changed = path.join(out, `${replacement.name}.java`); writeFileSync(changed, replacement.text); return changed;
  });
  const result = spawnSync(binary('javac'), ['-encoding', 'UTF-8', '-g:none', '-d', out, ...stubs, ...selected, platform, probe],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 256 * 1024 });
  assert.equal(result.error, undefined, 'finite javac invocation');
  assert.equal(result.status, 0, result.stderr); return out;
}
function run(out, scenario) {
  const files = directory();
  const result = spawnSync(binary('java'), ['-cp', out, 'com.kub.messenger.MessagePreviewVerificationProducerProbe', scenario, files],
    { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 });
  assert.equal(result.error, undefined, 'finite actual-class execution'); return result;
}
function positive(out, scenario) {
  const result = run(out, scenario);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, ''); assert.equal(result.stdout.trim(), `PASS ${scenario}`);
}
let out;
test.before(() => { out = compile(); });
test.after(() => {
  try {
    for (const [file, hash] of before) {
      assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), hash,
        'production source preserved during finite test execution');
    }
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
for (const scenario of ['producer-feature', 'guarded-feature']) {
  test(`compiled Task6E feature availability: ${scenario} (absence, not shipped regression)`, () => positive(out, scenario));
}
test('original native deadline feature: native-deadline-feature (reflection absence, not shipped regression)',
  () => positive(out, 'native-deadline-feature'));
for (const scenario of ['legacy-calibration', 'clamp', 'tighter-vault', 'expired-admission', 'at-admission',
  'unsafe-negative', 'unsafe-large', 'unsafe-sentinel', 'capture-expiry', 'current-at', 'current-after',
  'verify-expired', 'unsafe-supplied', 'held-auth', 'final-before', 'final-at']) {
  test(`original native deadline boundary: native-deadline-${scenario}`,
    () => positive(out, `native-deadline-${scenario}`));
}
const nativeDeadlineMutations = [
  ['original D clamp', 'MessagePreviewVerificationProducer',
    'Math.min(admitted.originalDeadline, deadlineElapsedMillis)', 'deadlineElapsedMillis',
    'clamp', 'ORIGINAL_NATIVE_D_11000_NOT_18000'],
  ['current original D guard', 'MessagePreviewVerificationProducer',
    '&& (admitted.originalDeadline == Long.MAX_VALUE || runtime.deadlineFuture(admitted.originalDeadline))', '',
    'current-at', 'NATIVE_D_CURRENT_REFUSES_current-at'],
  ['safe original D shape', 'MessagePreviewVerificationRuntime',
    ' || !MessagePreviewVerificationState.safe(deadline)', '',
    'unsafe-large', 'NATIVE_D_ADMISSION_REFUSAL_unsafe-large'],
  ['future original D guard', 'MessagePreviewVerificationRuntime',
    ' && now < deadline', '', 'at-admission', 'NATIVE_D_ADMISSION_REFUSAL_at-admission'],
  ['post-capture original D guard', 'MessagePreviewVerificationProducer',
    'require(originalDeadline == Long.MAX_VALUE || runtime.deadlineFuture(originalDeadline));', '',
    'capture-expiry', 'NATIVE_D_ADMISSION_REFUSAL_capture-expiry'],
  ['supplied D shape before min', 'MessagePreviewVerificationProducer',
    'require(MessagePreviewVerificationState.safe(deadlineElapsedMillis));', '',
    'unsafe-supplied', 'NATIVE_D_UNSAFE_SUPPLIED_REFUSED'],
  ['exact retained Admission D', 'MessagePreviewVerificationProducer',
    'this.originalDeadline = originalDeadline;', 'this.originalDeadline = Long.MAX_VALUE;',
    'clamp', 'ORIGINAL_NATIVE_D_11000_NOT_18000'],
];
for (const [name, sourceName, rule, changed, scenario, oracle] of nativeDeadlineMutations) {
  test(`original native deadline compiled mutant: ${name}`, () => {
    positive(out, `native-deadline-${scenario}`);
    const source = readFileSync(path.join(base, `${sourceName}.java`), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(source.split(rule).length, 2, 'one exact changed boundary');
    const mutant = compile({ name: sourceName, text: source.replace(rule, changed) });
    const result = run(mutant, `native-deadline-${scenario}`);
    assert.equal(result.status, 1, 'compiled runtime assertion, not setup or timeout');
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
  });
}
for (const scenario of ['old-ticket', 'original-deadline']) {
  test(`actual old Runtime/State calibration: ${scenario}`, () => positive(out, scenario));
}
for (const scenario of ['healthy', 'task5-deadline', 'conditional-unset', 'final-before', 'final-at', 'final-context-loss',
  'final-rotate', 'final-context', 'final-close', 'final-producer-close', 'final-retire', 'final-invalid-begin',
  'final-regression', 'final-expiry', 'final-failure',
  'final-stale-clear', 'final-stale-context',
  'held-auth', 'held-resolver', 'held-second', 'refuse-unbound', 'refuse-unguarded',
  'refuse-wrong-device', 'refuse-multirow', 'refuse-extra-key', 'refuse-sdk-change', 'refuse-unsafe-expiry',
  'refuse-8s', 'refuse-lifecycle', 'refuse-expiry-before-create', 'admit-epoch', 'admit-account', 'admit-session',
  'admit-owner', 'admit-cached', 'result-identity', 'result-input', 'result-one-use', 'result-short-deadline',
  'context-before', 'context-after', 'ordinary-plugin']) {
  test(`actual dormant producer/composed boundary: ${scenario}`, () => positive(out, scenario));
}
test('compiled old-ticket attempted-guard omission calibrates the literal refusal oracle', () => {
  positive(out, 'old-ticket');
  const source = readFileSync(path.join(base, 'MessagePreviewVerificationState.java'), 'utf8');
  const rule = ' || ticket.attempted';
  assert.equal(source.split(rule).length, 2, 'exactly one actual rule omission');
  const mutant = compile({ name: 'MessagePreviewVerificationState', text: source.replace(rule, '') });
  const result = run(mutant, 'old-ticket');
  assert.equal(result.status, 1, 'runtime assertion, not compile/setup/timeout');
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.split(/\r?\n/)[0],
    'Exception in thread "main" java.lang.AssertionError: OLD_TICKET_CANNOT_BE_REUSED');
});

const mutations = [
  ['owner Current between external boundaries', 'MessagePreviewVerificationRuntime',
    'current.current();', '', 'held-auth', 'NO_IO_AFTER_VAULT_RETIREMENT'],
  ['supplied original deadline clamp', 'MessagePreviewVerificationState',
    'ticket.deadline = Math.min(ticket.deadline, deadline);', '', 'result-short-deadline', 'ORIGINAL_DEADLINE_AT_ALL_IO'],
  ['exact Task5 account epoch', 'MessagePreviewVerificationState',
    '&& ticket.user.equals(user) && ticket.session.equals(session) && ticket.accountEpoch == accountEpoch',
    '&& ticket.user.equals(user) && ticket.session.equals(session)', 'admit-account', 'EXACT_TASK5_ADMISSION_REFUSAL_account'],
  ['exact Task5 epoch', 'MessagePreviewVerificationState',
    '&& ticket.epoch.equals(epoch)', '', 'admit-epoch', 'EXACT_TASK5_ADMISSION_REFUSAL_epoch'],
  ['retained invocation reference', 'MessagePreviewVerificationProducer',
    '&& (admitted.invocation == null || admitted.invocation == identity)', '', 'result-identity', 'CURRENT_EXACT_INVOCATION'],
  ['same validated input result', 'MessagePreviewVaultProvisioning',
    ' && access.equals(input)', '', 'result-input', 'RESULT_EXACT_input'],
  ['one-use producer result', 'MessagePreviewVaultProvisioning',
    'require(!consumed); consumed=true;', 'consumed=true;', 'result-one-use', 'RESULT_EXACT_one-use'],
  ['guarded Authority call', 'MessagePreviewVaultProvisioning',
    'authority.verify(work.identity, access, verifyDeadline, current)',
    'authority.verify(work.identity, access, verifyDeadline)', 'healthy', 'ACTUAL_GENUINE_NONEMPTY_G1'],
  ['producer deadline retained in Work', 'MessagePreviewVaultProvisioning',
    'work.producerPermit=verification.producerPermit;', '', 'final-at', 'FINAL_ORIGINAL_PRODUCER_DEADLINE'],
  ['producer original deadline minted with result', 'MessagePreviewVerificationProducer',
    'new MessagePreviewVaultProvisioning.Verification(identity, borrowedAccess, expiry, permit)',
    'new MessagePreviewVaultProvisioning.Verification(identity, borrowedAccess, expiry)', 'final-at', 'FINAL_ORIGINAL_PRODUCER_DEADLINE'],
  ['in-monitor final publication deadline', 'MessagePreviewPristineInitializer',
    'if (!work.observe && program.producerPermit!=null\n            && (program.producerPermit.revoked || now>=program.producerPermit.deadline)) throw new Unavailable();',
    '', 'final-at', 'FINAL_ORIGINAL_PRODUCER_DEADLINE'],
  ['unguarded legacy producer entry refuses', 'MessagePreviewVerificationProducer',
    'String borrowedAccess, long deadlineElapsedMillis) throws Unavailable {\n        throw new Unavailable();',
    'String borrowedAccess, long deadlineElapsedMillis) throws Unavailable {\n        return new MessagePreviewVaultProvisioning.Verification(identity, borrowedAccess, 1);',
    'refuse-unguarded', 'UNGUARDED_ENTRY_REFUSED'],
  ['safe validated expiry before dispatch', 'MessagePreviewVerificationRuntime',
    ' || (producer != null && !MessagePreviewVerificationState.safe(expires))', '', 'refuse-unsafe-expiry', 'UNSAFE_EXPIRY_NO_DISPATCH'],
  ['late A catch cannot retire B', 'MessagePreviewVerificationProducer',
    'if (admitted != null && current == admitted) admitted.refused = true;',
    'if (admitted != null && current != null) current.refused = true;', 'context-before', 'OLD_CATCH_CANNOT_RETIRE_B'],
  ['exact live resolver in common chain', 'MessagePreviewVerificationRuntime',
    '!MessagePreviewResponseParser.binding(response, user, session, device)', 'false',
    'refuse-wrong-device', 'GENUINE_REFUSAL_NO_KEY_OR_ACK'],
  ['second own SDK in common chain', 'MessagePreviewVerificationRuntime',
    '!first.equals(second)', 'false', 'refuse-sdk-change', 'GENUINE_REFUSAL_NO_KEY_OR_ACK'],
  ['exact ticket revocation reaches final publication', 'MessagePreviewVerificationState',
    'if (ticket != null && ticket.producerPermit != null) ticket.producerPermit.revoked = true;', '',
    'final-context-loss', 'FINAL_RETIRED_PRODUCER_CONTEXT'],
  ['in-monitor ticket retirement check', 'MessagePreviewPristineInitializer',
    'program.producerPermit.revoked || ', '', 'final-close', 'FINAL_RETIRED_PRODUCER_CONTEXT'],
];
for (const [name, sourceName, rule, changed, scenario, oracle] of mutations) {
  test(`compiled producer literal omission: ${name}`, () => {
    positive(out, scenario);
    const source = readFileSync(path.join(base, `${sourceName}.java`), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(source.split(rule).length, 2, 'one independently selected actual rule');
    const mutant = compile({ name: sourceName, text: source.replace(rule, changed) });
    const result = run(mutant, scenario);
    assert.equal(result.status, 1, 'intended runtime assertion after healthy control');
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.split(/\r?\n/)[0], `Exception in thread "main" java.lang.AssertionError: ${oracle}`);
  });
}
