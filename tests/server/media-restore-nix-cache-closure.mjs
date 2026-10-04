import assert from 'node:assert/strict';
import {createPublicKey, verify} from 'node:crypto';

const storePath = /^\/nix\/store\/[0-9a-df-np-sv-z]{32}-[A-Za-z0-9+._?-]+$/;
const referencePath = /^[0-9a-df-np-sv-z]{32}-[A-Za-z0-9+._?-]+$/;

function namedBase64(value, size) {
  const match = /^([A-Za-z0-9._-]+):([A-Za-z0-9+/]+={0,2})$/.exec(value ?? '');
  assert.ok(match, 'signature/anchor shape');
  const bytes = Buffer.from(match[2], 'base64');
  assert.equal(bytes.length, size, 'signature/anchor size');
  assert.equal(bytes.toString('base64'), match[2], 'canonical signature/anchor');
  return {name: match[1], bytes};
}

function readSubject(raw, expectedPath, anchor) {
  assert.ok(typeof raw === 'string' && Buffer.byteLength(raw) <= 32768, 'bounded narinfo');
  const fields = new Map();
  const signatures = [];
  for (const line of raw.split('\n').filter(Boolean)) {
    const match = /^([A-Za-z]+): (.*)$/.exec(line);
    assert.ok(match, 'narinfo line');
    if (match[1] === 'Sig') signatures.push(match[2]);
    else {
      assert.equal(fields.has(match[1]), false, 'duplicate field');
      fields.set(match[1], match[2]);
    }
  }
  const path = fields.get('StorePath');
  assert.match(path ?? '', storePath, 'store path');
  assert.equal(path, expectedPath, 'subject binding');
  const narHash = fields.get('NarHash');
  assert.match(narHash ?? '', /^sha256:[01][0-9a-df-np-sv-z]{51}$/, 'NarHash');
  const size = fields.get('NarSize');
  assert.match(size ?? '', /^[1-9][0-9]{0,15}$/, 'NarSize');
  assert.ok(Number.isSafeInteger(Number(size)), 'NarSize safe integer');
  assert.equal(fields.has('References'), true, 'References required');
  const shortRefs = fields.get('References').split(' ').filter(Boolean);
  assert.ok(shortRefs.length <= 256, 'reference bound');
  assert.equal(new Set(shortRefs).size, shortRefs.length, 'duplicate reference');
  for (const ref of shortRefs) assert.match(ref, referencePath, 'reference path');
  const references = shortRefs.map(ref => '/nix/store/' + ref).sort();
  const fingerprint = ['1', path, narHash, size, references.join(',')].join(';');
  assert.ok(signatures.length > 0 && signatures.length <= 8, 'signature count');
  let valid = false;
  for (const value of signatures) {
    const signature = namedBase64(value, 64);
    if (signature.name === anchor.name && verify(null, Buffer.from(fingerprint), anchor.key, signature.bytes)) valid = true;
  }
  assert.equal(valid, true, 'signature verification');
  return {path, narHash, signedDeclaredNarBytes: Number(size), references};
}

// Cache assertions close a reference graph; they do not attest installed bytes or a build.
export function validateCacheClosure({paths, root, anchor, metadata}) {
  assert.ok(Array.isArray(paths) && paths.length > 0 && paths.length <= 256, 'subject bound');
  for (const path of paths) assert.match(path, storePath, 'store path');
  const expected = new Set(paths);
  assert.equal(expected.size, paths.length, 'duplicate subject');
  assert.equal(expected.has(root), true, 'root membership');
  assert.ok(metadata instanceof Map, 'metadata map');
  assert.equal(metadata.size, expected.size, 'metadata membership');
  for (const path of expected) assert.equal(metadata.has(path), true, 'metadata membership');
  const declared = namedBase64(anchor, 32);
  const key = createPublicKey({format: 'jwk', key: {kty: 'OKP', crv: 'Ed25519', x: declared.bytes.toString('base64url')}});
  const subjects = [...expected].sort().map(path => readSubject(metadata.get(path), path, {...declared, key}));
  const byPath = new Map(subjects.map(subject => [subject.path, subject]));
  for (const subject of subjects) {
    for (const ref of subject.references) assert.equal(expected.has(ref), true, 'reference outside frozen set');
  }
  const reached = new Set();
  const pending = [root];
  while (pending.length) {
    const path = pending.pop();
    if (reached.has(path)) continue;
    reached.add(path);
    pending.push(...byPath.get(path).references);
  }
  assert.equal(reached.size, expected.size, 'unreachable subject');
  const signedDeclaredNarBytes = subjects.reduce((total, subject) => total + subject.signedDeclaredNarBytes, 0);
  assert.ok(Number.isSafeInteger(signedDeclaredNarBytes), 'total NarSize safe integer');
  return {
    subjectCount: subjects.length, subjects, signedDeclaredNarBytes,
    metadataClosureVerified: true, installedContentsVerified: false,
    authenticatedBuildBinding: false, recipeToOutputBindingVerified: false,
    fullRestoreApproved: false, pg17Accepted: false, runtimeApproved: false,
    productionApproved: false, nativeHeaderDispatchApproved: false, mainApproved: false,
  };
}
