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
  const replacements = replacement ? (Array.isArray(replacement) ? replacement : [replacement]) : [];
  const files = Object.entries(provisioningStubs).map(([name, text]) => {
    const file = path.join(out, 'stubs', name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); return file;
  });
  const sources = names.filter(name => existsSync(path.join(base, `${name}.java`))).map(name => {
    const changed = replacements.find(value => value.name === name);
    if (changed) { const file = path.join(out, `${name}.java`); writeFileSync(file, changed.text); return file; }
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
  'held-verifier', 'held-generate', 'held-readback', 'held-initial-read', 'held-jio-preauthentication', 'unmaterialized', 'queue-expired',
  'key-loss', 'fallback', 'drift', 'unknown-finish', 'live-wall', 'expiry-delta', 'rejected-context', 'expiry-before-mint',
  'held-ack', 'failed-ticket-replay', 'clipped-create', 'readback-mismatch', 'invalidate-erase', 'refused-context-loss', 'phase-rollback',
  'rising-healthy', 'rising-expiry', 'rising-regression', 'repeat-erase', 'no-phase-zero', 'no-phase-nonzero',
  'no-phase-old-key-absent', 'no-phase-refused', 'no-phase-expired', 'no-phase-drift', 'no-phase-missing-metadata',
  'no-phase-unknown-finish', 'no-phase-unknown-delete', 'no-phase-foreign-correlation',
  'no-phase-foreign-history', 'entered-key-original-rewind', 'basis-ordinary-gap', 'basis-lineage', 'basis-no-create', 'basis-foreign-gate']) {
  test(`actual conditional provisioning graph: ${scenario}`, () => {
    const result = run(out, scenario); assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `PASS ${scenario}`);
  });
}

const moduleName = 'MessagePreviewVaultProvisioning';
const ownerName = 'MessagePreviewPristineInitializer';
const custodyName = 'MessagePreviewCredentialKeyCustody';
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
  ['R1 sample merged before post-current', moduleName,
    'work.advanceWall(elapsed, observed);\n        current.requireCurrent(); return work.effectiveWall;',
    'current.requireCurrent(); return work.advanceWall(elapsed, observed);', 'rising-healthy', 'ACTUAL_NONEMPTY_G1'],
  ['R1 calibrated expiry sample ordering', moduleName,
    'work.advanceWall(elapsed, observed);\n        current.requireCurrent(); return work.effectiveWall;',
    'current.requireCurrent(); return work.advanceWall(elapsed, observed);', 'rising-expiry', 'RISING_REFUSAL_REACHED_KEY_INIT'],
  ['R2 completed acquisition detached', ownerName, 'work.state.acquisition=null;', '', 'repeat-erase', 'CHECKED_EMPTY_G3'],
  ['R3 acquiring JIO startWrite barrier', ownerName, 'if (acquiring != null) acquiringCurrent(acquiring);', '',
    'held-jio-preauthentication', 'NO_A_START_WRITE_AFTER_JIO_PREAUTH'],
  ['D4 ordinary exact predecessor', custodyName, 'if (r.unmaterializedAllocation == null) require(p.generation == op.baseGeneration);',
    'if (r.unmaterializedAllocation == null) { }',
    'basis-ordinary-gap', 'ORDINARY_EXACT_BASIS_REQUIRED'],
  ['D4 single skipped base', custodyName, 'p.generation == a.baseGeneration && ', '',
    'basis-lineage', 'ONE_UNMATERIALIZED_BASE_REQUIRED'],
  ['D4 nonnull deletion basis', custodyName, 'require(abandoned != null);', '', 'basis-lineage', 'NULL_BASIS_NOT_RETIRE_AUTHORITY'],
  ['D4 deletion-only factory', custodyName,
    'op.kind == MessagePreviewVaultFence.Kind.RETIRE && h.kind == MessagePreviewMetadataEnvelope.Kind.RETIRING\n                && ',
    '', 'basis-no-create', 'UNMATERIALIZED_FACTORY_REJECTS_ACQUISITION'],
  ['D4 exact predecessor alias', custodyName,
    'if (h.kind == MessagePreviewMetadataEnvelope.Kind.RETIRING) require(h.alias.equals(p.alias));',
    'if (h.kind == MessagePreviewMetadataEnvelope.Kind.RETIRING) { }', 'basis-lineage', 'UNMATERIALIZED_ALIAS_MUST_EQUAL_P'],
  ['D4 real no-phase owner identity', ownerName, '|| work.state.acquisition.program!=abandoned ', '',
    'no-phase-foreign-history', 'NO_PHASE_FOREIGN_HISTORY_NOT_AUTHORITY'],
  ['D4 original erase admission deadline', ownerName,
    '|| now < work.state.lastMillis || now < 0 || now >= work.deadline', '|| now < work.state.lastMillis || now < 0',
    'no-phase-expired', 'NO_PHASE_ERASE_DEADLINE_NOT_RENEWED'],
  ['D4 explicit unmaterialized request route', moduleName,
    'enteredRequest=MessagePreviewCredentialKeyCustody.Request.retireUnmaterialized(custody, fence, work.operation,\n            abandoned.original, abandoned.operation, head, work.admitted, work.deadline);',
    'enteredRequest=new MessagePreviewCredentialKeyCustody.Request(custody, fence, work.operation, abandoned.original, head, work.admitted, work.deadline);',
    'no-phase-zero', 'NO_PHASE_EXACT_EMPTY_RETIREMENT_REQUIRED'],
];
for (const [name, target, before, after, scenario, oracle] of mutations) {
  test(`compiled literal omission: ${name}`, () => {
    const text = readFileSync(path.join(base, `${target}.java`), 'utf8').replaceAll('\r\n', '\n');
    assert.equal(text.split(before).length, 2, 'one exact literal production rule');
    const healthy = run(out, scenario); assert.equal(healthy.status, 0, healthy.stderr);
    const mutant = compile({ name: target, text: text.replace(before, after) });
    const result = run(mutant, scenario);
    assert.equal(result.status, 1, 'calibrated runtime assertion, not setup/timeout');
    assert.equal(result.stderr.trim(), `FAIL ${oracle}`); assert.equal(result.stdout, '');
  });
}

for (const [name, edits, scenario, oracle] of [
  ['D4 full authenticated P equality', [
    [moduleName, 'require(predecessorWork.recognizes(actual));', ''],
    [moduleName, '&& equal(actual, predecessorWork.original) ', ''],
  ], 'no-phase-drift', 'NO_PHASE_UNTRUSTED_PREDECESSOR_NO_EFFECTS'],
  ['D4 attempted preauthentication is not no-phase', [
    [moduleName, 'predecessorWork.attempts==0 && ', ''],
    [ownerName, 'abandoned.attempts!=0 || ', ''],
  ], 'held-jio-preauthentication', 'NO_INVENTED_EMPTY_OR_RENEWAL'],
]) {
  test(`compiled literal omission: ${name}`, () => {
    const healthy = run(out, scenario); assert.equal(healthy.status, 0, healthy.stderr);
    const changed = new Map();
    for (const [target, before, after] of edits) {
      const text = changed.get(target) ?? readFileSync(path.join(base, `${target}.java`), 'utf8').replaceAll('\r\n', '\n');
      assert.equal(text.split(before).length, 2, 'one exact literal production rule');
      changed.set(target, text.replace(before, after));
    }
    const mutant = compile([...changed].map(([name, text]) => ({ name, text })));
    const result = run(mutant, scenario);
    assert.equal(result.status, 1, 'calibrated runtime assertion, not setup/timeout');
    assert.equal(result.stderr.trim(), `FAIL ${oracle}`); assert.equal(result.stdout, '');
  });
}
