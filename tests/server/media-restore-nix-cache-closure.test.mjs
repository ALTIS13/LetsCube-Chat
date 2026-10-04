import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync, sign} from 'node:crypto';

const moduleUrl = new URL('./media-restore-nix-cache-closure.mjs', import.meta.url);
const uut = await import(moduleUrl).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const {privateKey, publicKey} = generateKeyPairSync('ed25519');
const anchor = 'fixture-cache:' + Buffer.from(publicKey.export({format: 'jwk'}).x, 'base64url').toString('base64');
const root = '/nix/store/00000000000000000000000000000000-fixture-root';
const dep = '/nix/store/11111111111111111111111111111111-fixture-dependency';
const leaf = '/nix/store/22222222222222222222222222222222-fixture-leaf';
const outside = '/nix/store/33333333333333333333333333333333-outside';
const hash0 = 'sha256:' + '0'.repeat(52);
const hash1 = 'sha256:' + '1'.repeat(52);

function signed(path, refs, hash = hash0, size = 120) {
  const short = refs.map(p => p.slice('/nix/store/'.length));
  const fingerprint = ['1', path, hash, String(size), [...refs].sort().join(',')].join(';');
  const signature = sign(null, Buffer.from(fingerprint), privateKey).toString('base64');
  return `StorePath: ${path}\nNarHash: ${hash}\nNarSize: ${size}\nReferences: ${short.join(' ')}\nSig: fixture-cache:${signature}\n`;
}
function fixture() {
  return {
    paths: [root, dep, leaf], root, anchor,
    metadata: new Map([[root, signed(root, [root, dep])], [dep, signed(dep, [leaf], hash1, 80)], [leaf, signed(leaf, [], hash0, 40)]]),
  };
}
function check(input) {
  assert.equal(typeof uut.validateCacheClosure, 'function', 'signed reference-closure validator not implemented');
  return uut.validateCacheClosure(input);
}

test('complete signed chain includes self-reference without losing reachable leaves', () => {
  const result = check(fixture());
  assert.equal(result.subjectCount, 3);
  assert.equal(result.signedDeclaredNarBytes, 240);
  assert.equal(result.metadataClosureVerified, true);
  assert.equal(result.installedContentsVerified, false);
  assert.equal(result.authenticatedBuildBinding, false);
  assert.equal(result.fullRestoreApproved, false);
  assert.deepEqual(result.subjects.map(s => s.path), [root, dep, leaf]);
});

for (const [name, mutate, reason] of [
  ['missing metadata', x => x.metadata.delete(leaf), /metadata membership/],
  ['unexpected metadata', x => x.metadata.set(outside, signed(outside, [])), /metadata membership/],
  ['duplicate expected path', x => x.paths.push(dep), /duplicate subject/],
  ['signed reference outside frozen set', x => x.metadata.set(dep, signed(dep, [outside])), /outside frozen set/],
  ['unreachable signed subject', x => x.metadata.set(dep, signed(dep, [])), /unreachable subject/],
  ['wrong subject binding', x => x.metadata.set(dep, signed(leaf, [])), /subject binding/],
  ['changed hash without resigning', x => x.metadata.set(dep, x.metadata.get(dep).replace(hash1, hash0)), /signature/],
  ['changed size without resigning', x => x.metadata.set(dep, x.metadata.get(dep).replace('NarSize: 80', 'NarSize: 81')), /signature/],
  ['changed references without resigning', x => x.metadata.set(root, x.metadata.get(root).replace(dep.slice(11), leaf.slice(11))), /signature/],
  ['absent signed References field', x => x.metadata.set(leaf, x.metadata.get(leaf).replace('References: \n', '')), /References/],
  ['duplicate signed field', x => x.metadata.set(leaf, x.metadata.get(leaf) + 'NarSize: 40\n'), /duplicate field/],
  ['duplicate reference even with a valid signature', x => x.metadata.set(root, signed(root, [dep, dep])), /duplicate reference/],
  ['wrong signature key name', x => x.metadata.set(leaf, x.metadata.get(leaf).replace('Sig: fixture-cache:', 'Sig: other-cache:')), /signature/],
  ['missing root', x => x.root = outside, /root membership/],
  ['unsafe subject path', x => x.paths[0] = root + '/../../etc', /store path/],
  ['unsafe reference path', x => x.metadata.set(root, signed(root, [dep + '/../../etc'])), /reference path/],
  ['fractional size', x => x.metadata.set(leaf, x.metadata.get(leaf).replace('NarSize: 40', 'NarSize: 4.0')), /NarSize/],
  ['unsafe integer size', x => x.metadata.set(leaf, x.metadata.get(leaf).replace('NarSize: 40', 'NarSize: 9007199254740992')), /NarSize/],
  ['unsigned subject', x => x.metadata.set(leaf, x.metadata.get(leaf).replace(/^Sig:.*\n/m, '')), /signature/],
]) {
  test('refuses ' + name, () => {
    assert.equal(typeof uut.validateCacheClosure, 'function', 'signed reference-closure validator not implemented');
    const input = fixture(); mutate(input);
    assert.throws(() => uut.validateCacheClosure(input), reason);
  });
}

test('reference order is a signed set, not traversal order', () => {
  const input = fixture();
  input.metadata.set(root, signed(root, [dep, root]));
  assert.equal(check(input).subjectCount, 3);
});
test('another cache signature does not replace the required anchor', () => {
  const input = fixture();
  input.metadata.set(leaf, input.metadata.get(leaf) + 'Sig: other-cache:' + Buffer.alloc(64).toString('base64') + '\n');
  assert.equal(check(input).subjectCount, 3);
});
test('incomplete signed reference set cannot become a root-only success', () => {
  const input = fixture(); input.paths = [root]; input.metadata = new Map([[root, signed(root, [dep])]]);
  assert.equal(typeof uut.validateCacheClosure, 'function', 'signed reference-closure validator not implemented');
  assert.throws(() => uut.validateCacheClosure(input), /outside frozen set/);
});
