import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { provisioningStubs } from '../android/message-preview-vault-provisioning.fixture.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const bin = process.env.LETSCUBE_TEST_JAVA_BIN ?? 'C:/Program Files/Android/Android Studio/jbr/bin';
const probe = path.join(root, 'tests/java/com/kub/messenger/MessagePreviewVaultProvisioningProbe.java');
const owned = [];
function directory(prefix) { const dir = mkdtempSync(path.join(tmpdir(), prefix)); owned.push(dir); return dir; }
const base = path.join(root, 'android/app/src/main/java/com/kub/messenger');
const names = ['MessagePreviewVerificationState', 'MessagePreviewVaultFence', 'MessagePreviewMetadataEnvelope',
  'MessagePreviewJournalIO', 'MessagePreviewInstallationMarker', 'MessagePreviewInitializationGate',
  'MessagePreviewOwnedKeyInventory', 'MessagePreviewKeystoreReader', 'MessagePreviewAtomicBackend',
  'MessagePreviewCredentialEnvelope', 'MessagePreviewCredentialKeyCustody', 'MessagePreviewPristineInitializer',
  'MessagePreviewVaultProvisioning'];
function compile(replacement) {
  const out = directory('nmpv-d3-');
  const files = Object.entries(provisioningStubs).map(([name, text]) => {
    const file = path.join(out, 'stubs', name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); return file;
  });
  const sources = names.filter(name => existsSync(path.join(base, `${name}.java`))).map(name => {
    if (replacement?.name === name) { const file = path.join(out, `${name}.java`); writeFileSync(file, replacement.text); return file; }
    return path.join(base, `${name}.java`);
  });
  const result = spawnSync(path.join(bin, process.platform === 'win32' ? 'javac.exe' : 'javac'),
    ['-encoding', 'UTF-8', '-g:none', '-d', out, ...files, ...sources, probe], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr); return out;
}
function run(out, scenario) {
  const files = directory('nmpv-d3-files-');
  return spawnSync(path.join(bin, process.platform === 'win32' ? 'java.exe' : 'java'),
    ['-cp', out, 'com.kub.messenger.MessagePreviewVaultProvisioningProbe', scenario, files], { encoding: 'utf8', timeout: 12000 });
}
let out;
test.before(() => { out = compile(); });
test.after(() => {
  for (const dir of owned) {
    const actual = realpathSync(dir);
    assert.equal(path.dirname(actual), realpathSync(tmpdir())); assert.ok(path.basename(actual).startsWith('nmpv-d3-'));
    rmSync(actual, { recursive: true });
  }
});
test('compiled D3 feature availability (absence, not a shipped regression)', () => {
  const result = run(out, 'feature');
  assert.equal(result.status, 0, result.stderr.includes('D3_FEATURE_ABSENT') ? 'D3_FEATURE_ABSENT' : result.stderr);
});
for (const scenario of ['healthy', 'replace', 'unbound', 'invalid-owner', 'empty-retire', 'no-match', 'lost-begin',
  'ticket-replay', 'expired', 'foreign-verification', 'verify-timeout', 'ticket-deadline', 'invalidate',
  'held-verifier', 'held-generate', 'held-readback', 'held-prewrite', 'unmaterialized', 'queue-expired',
  'key-loss', 'fallback', 'drift', 'unknown-finish', 'live-wall', 'expiry-delta', 'rejected-context', 'expiry-before-mint',
  'held-ack', 'failed-ticket-replay', 'clipped-create', 'readback-mismatch', 'invalidate-erase', 'refused-context-loss', 'phase-rollback']) {
  test(`actual conditional provisioning graph: ${scenario}`, () => {
    const result = run(out, scenario); assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}

const moduleName = 'MessagePreviewVaultProvisioning';
const ownerName = 'MessagePreviewPristineInitializer';
const mutations = [
  ['exact verification identity', moduleName, 'identity == expected && access.equals(input)', 'access.equals(input)', 'foreign-verification', 'REFUSAL_NO_COMMIT_ACK'],
  ['fresh verification invocation', moduleName, 'authority.verify(work.identity, access, verifyDeadline)',
    'new Verification(work.identity, access, System.currentTimeMillis()+60000)', 'verify-timeout', 'REFUSAL_NO_COMMIT_ACK'],
  ['validated expiry at each current boundary', moduleName, 'work.validatedExpiry=expiry;', '', 'expiry-before-mint', 'NO_MINT_AFTER_BAD_VERIFICATION_OR_DEADLINE'],
  ['allocation predecessor not phase head', moduleName, 'request(custody, work.original, work.checked)',
    'request(custody, work.checked, work.checked)', 'healthy', 'ACTUAL_NONEMPTY_G1'],
  ['ticket consumed on failed provision', ownerName, 'target.consumed=true; target.ticket=null;', '', 'failed-ticket-replay', 'FAILED_TICKET_STILL_SINGLE_USE'],
  ['intent before context binding', ownerName, 'else if (vaultRevision<=initialized.acceptedVaultRevision) status=ProvisionStatus.STALE_OWNER;', '', 'rejected-context', 'REJECTED_INTENT_NO_CONTEXT_MUTATION'],
  ['exact retained history', moduleName, 'require(predecessorWork.recognizes(actual));', '', 'drift', 'NO_UNKNOWN_HISTORY_DELETE'],
  ['entered candidate not hidden by old phase', moduleName, 'if (predecessorWork.candidateEntered) require(predecessor.header.alias.equals(predecessorWork.candidate));',
    'if (false) require(predecessor.header.alias.equals(predecessorWork.candidate));', 'phase-rollback', 'NO_PHASE_ROLLBACK_REWRITE'],
  ['single queued erasure', ownerName, '&& queuedErasure == null)', ')', 'held-verifier', 'ONE_QUEUED_ERASURE'],
  ['slot retained through erasure handoff', ownerName, 'activeTransition=queuedErasure; pendingTransition=queuedErasure;',
    'busy=false; activeTransition=queuedErasure; pendingTransition=queuedErasure;', 'held-verifier', 'ORDERED_ERASURE_AFTER_SETTLEMENT'],
  ['expired erase cannot start another effect', ownerName, '|| now < work.state.lastMillis || now < 0 || now >= work.deadline',
    '|| now < work.state.lastMillis || now < 0', 'queue-expired', 'UNRESOLVED_RESIDUE_RETAINED'],
  ['monotonic effective wall', moduleName, 'effectiveWall=Math.max(observed, effectiveWall+delta);',
    'effectiveWall=Math.max(observed, effectiveWall);', 'live-wall', 'LITERAL_MONOTONIC_LIVE_WALL'],
  ['D1 exact nonempty readback', moduleName, 'require(MessagePreviewCredentialEnvelope.verifyMatch(result, committed, work.operation.owner, access, expiry, credential));',
    '', 'readback-mismatch', 'REFUSAL_NO_COMMIT_ACK'],
  ['erasure-only refused continuation', ownerName, '&& initialized.acquisition.program.operation.kind==MessagePreviewVaultFence.Kind.BEGIN)',
    ')', 'refused-context-loss', 'REFUSED_ERASURE_SURVIVES_CONTEXT_LOSS'],
];
for (const [name, target, before, after, scenario, oracle] of mutations) {
  test(`compiled literal omission: ${name}`, () => {
    const text = readFileSync(path.join(base, `${target}.java`), 'utf8');
    assert.equal(text.split(before).length, 2, 'one exact literal production rule');
    const healthy = run(out, scenario); assert.equal(healthy.status, 0, healthy.stderr);
    const mutant = compile({ name: target, text: text.replace(before, after) });
    const result = run(mutant, scenario);
    assert.equal(result.status, 1, 'calibrated runtime assertion, not setup/timeout');
    assert.equal(result.stderr.trim(), `FAIL ${oracle}`); assert.equal(result.stdout, '');
  });
}
