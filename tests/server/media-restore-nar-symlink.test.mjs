import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';

const module = await import('./media-restore-nar-symlink.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const string = value => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const out = Buffer.alloc(8 + Math.ceil(bytes.length / 8) * 8);
  out.writeBigUInt64LE(BigInt(bytes.length)); bytes.copy(out, 8); return out;
};
const tokens = (...values) => Buffer.concat(values.map(string));
const file = tokens('(', 'type', 'regular', 'contents', Buffer.from([0, 255, 41, 0, 40]), ')');
const link = tokens('(', 'type', 'symlink', 'target', '/usr/lib/example/key.sh', ')');
const entry = (name, node) => Buffer.concat([tokens('entry', '(', 'name', name, 'node'), node, string(')')]);
const directory = entries => Buffer.concat([tokens('(', 'type', 'directory'), ...entries, string(')')]);
const envelope = node => Buffer.concat([string('nix-archive-1'), node]);
const fixture = envelope(directory([entry('ext', directory([entry('a', file), entry('z', file)]))]));
const changed = envelope(directory([entry('ext', directory([entry('a', file), entry('key', link), entry('z', file)]))]));
const options = {path: 'ext/key', target: '/usr/lib/example/key.sh', expectedSha256: hash(fixture), installedSha256: hash(changed)};
const explain = (...args) => {
  assert.equal(typeof module.explainNarSymlink, 'function', 'NAR symlink explanation feature absent');
  return module.explainNarSymlink(...args);
};

test('one serialized symlink preserves opaque file bytes and matches independently encoded NAR', () => {
  const result = explain(fixture, options);
  assert.equal(result.matchesInstalledHash, true);
  assert.equal(result.transformedSha256, hash(changed));
  assert.equal(result.inputSha256, hash(fixture));
  assert.equal(result.addedBytes, 208);
  assert.equal(result.inputNodes, 4);
  assert.equal(result.installedClosureAccepted, false);
  assert.equal(result.authenticatedBuildBinding, false);
  assert.equal(result.nativeHeaderDispatchApproved, false);
  assert.equal(result.fullRestoreApproved, false);
  assert.equal(result.productionApproved, false);
});
test('wrong installed hash cannot be treated as an explained difference', () => {
  assert.throws(() => explain(fixture, {...options, installedSha256: '0'.repeat(64)}), /transformed NAR mismatch/);
});
test('untrusted input NAR hash is refused before its structure is used', () => {
  assert.throws(() => explain(fixture, {...options, expectedSha256: '0'.repeat(64)}), /input NAR mismatch/);
});
test('existing entry is not replaced', () => {
  assert.throws(() => explain(changed, {...options, expectedSha256: hash(changed)}), /entry already exists/);
});
test('absent parent cannot silently create directories', () => {
  assert.throws(() => explain(fixture, {...options, path: 'absent/key'}), /parent directory absent/);
});
test('a file cannot serve as the selected parent', () => {
  assert.throws(() => explain(fixture, {...options, path: 'ext/a/key'}), /parent directory absent/);
});
test('relative and traversing link specifications are refused', () => {
  for (const delta of [{path: '../key'}, {path: 'ext//key'}, {path: '/ext/key'}, {target: '../secret'}]) {
    assert.throws(() => explain(fixture, {...options, ...delta}), /link specification/);
  }
});
test('trailing and truncated NAR bytes cannot pass as complete input', () => {
  for (const bytes of [Buffer.concat([fixture, Buffer.alloc(8)]), fixture.subarray(0, -1)]) {
    assert.throws(() => explain(bytes, {...options, expectedSha256: hash(bytes)}), /NAR (trailing|truncated)/);
  }
});
test('nonzero padding is refused', () => {
  const bytes = Buffer.from(fixture); bytes[21] = 1;
  assert.throws(() => explain(bytes, {...options, expectedSha256: hash(bytes)}), /NAR padding/);
});
test('unordered or duplicate directory entries are refused even outside the target', () => {
  for (const entries of [[entry('z', file), entry('a', file)], [entry('a', file), entry('a', file)]]) {
    const bytes = envelope(directory([entry('ext', directory(entries))]));
    assert.throws(() => explain(bytes, {...options, expectedSha256: hash(bytes)}), /NAR entry order/);
  }
});
test('malformed node types are refused', () => {
  const bytes = envelope(tokens('(', 'type', 'socket', ')'));
  assert.throws(() => explain(bytes, {...options, expectedSha256: hash(bytes)}), /NAR node type/);
});
test('archive size above 32 MiB is refused before parsing', () => {
  assert.throws(() => explain(Buffer.alloc(33554433), options), /NAR byte budget/);
});
test('manifest reports contents hashes, not contents, and keeps directory order', () => {
  assert.equal(typeof module.narManifest, 'function', 'NAR manifest feature absent');
  assert.deepEqual(module.narManifest(fixture, hash(fixture)), [
    {path: '', type: 'directory'}, {path: 'ext', type: 'directory'},
    {path: 'ext/a', type: 'regular', executable: false, bytes: 5, sha256: hash(Buffer.from([0, 255, 41, 0, 40]))},
    {path: 'ext/z', type: 'regular', executable: false, bytes: 5, sha256: hash(Buffer.from([0, 255, 41, 0, 40]))},
  ]);
});
test('manifest reports a symbolic target without following it', () => {
  assert.equal(typeof module.narManifest, 'function', 'NAR manifest feature absent');
  assert.deepEqual(module.narManifest(envelope(link), hash(envelope(link))), [
    {path: '', type: 'symlink', target: '/usr/lib/example/key.sh'},
  ]);
});
test('manifest distinguishes the executable bit represented by NAR', () => {
  assert.equal(typeof module.narManifest, 'function', 'NAR manifest feature absent');
  const bytes = envelope(tokens('(', 'type', 'regular', 'executable', '', 'contents', 'data', ')'));
  assert.deepEqual(module.narManifest(bytes, hash(bytes)), [
    {path: '', type: 'regular', executable: true, bytes: 4, sha256: hash(Buffer.from('data'))},
  ]);
});
test('tree depth above 64 is refused', () => {
  let node = file;
  for (let depth = 0; depth < 65; depth++) node = directory([entry('a', node)]);
  const bytes = envelope(node);
  assert.throws(() => module.narManifest(bytes, hash(bytes)), /NAR tree budget/);
});
test('tree nodes above 100000 are refused below the byte cap', () => {
  const leaf = tokens('(', 'type', 'regular', 'contents', '', ')');
  const entries = Array.from({length:100000}, (_,i) => entry('n' + String(i).padStart(6,'0'), leaf));
  const bytes = envelope(directory(entries));
  assert.ok(bytes.length < 33554432);
  assert.throws(() => module.narManifest(bytes, hash(bytes)), /NAR tree budget/);
});
test('metadata token above 4096 bytes is refused', () => {
  const bytes = envelope(tokens('(', 'type', 'symlink', 'target', 'x'.repeat(4097), ')'));
  assert.throws(() => module.narManifest(bytes, hash(bytes)), /NAR token budget/);
});
